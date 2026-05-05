import { getPublicClient, readContract, watchContractEvent } from "@wagmi/core";
import type { Address } from "viem";
import { mockValidatorShareAbi } from "@/lib/abi";
import { polygonChain } from "@/lib/chains";
import {
  recommendedValidatorForChain,
  validatorByAddress,
  validatorsForChain,
} from "@/lib/validators";
import { encodeFunctionData } from "@/lib/viem-encode-function-data";
import { wagmiConfig } from "@/lib/wagmi";
import {
  ChainAdapterError,
  type IChainAdapter,
  type Position,
  type UnsignedTx,
  type Validator,
} from "./types";

const POLYGON_CHAIN_ID = "polygon";
const UNBONDING_SECONDS = 21 * 24 * 60 * 60;

function networkError(message: string, cause?: unknown) {
  return new ChainAdapterError("NETWORK", message, cause);
}

function toAdapterError(message: string, cause: unknown) {
  if (cause instanceof ChainAdapterError) return cause;
  return networkError(message, cause);
}

function contractAddress() {
  const address = polygonChain().validatorContract;
  if (!address) throw networkError("Polygon validator contract is not configured.");
  return address;
}

function publicClient() {
  if (!polygonChain().wagmiChain) {
    throw networkError("Polygon wagmi chain is not configured.");
  }

  const client = getPublicClient(wagmiConfig);
  if (!client) throw networkError("Polygon public client is not configured.");
  return client;
}

function toValidator(validator: ReturnType<typeof validatorsForChain>[number]): Validator {
  return {
    address: validator.address,
    name: validator.name,
    apr: validator.apr,
    commission: validator.commission,
    uptime: validator.uptime,
  };
}

function defaultValidator() {
  const validator = recommendedValidatorForChain(POLYGON_CHAIN_ID);
  if (!validator) throw networkError("No Polygon validators are configured.");
  return validator;
}

function assertValidator(address: string) {
  const validator = validatorByAddress(POLYGON_CHAIN_ID, address);
  if (!validator) {
    throw new ChainAdapterError(
      "VALIDATOR_NOT_FOUND",
      `Validator ${address} not found for Polygon.`,
    );
  }
  return validator;
}

function evmTx(data: `0x${string}`, value?: bigint): UnsignedTx {
  return value === undefined
    ? { kind: "evm", to: contractAddress(), data }
    : { kind: "evm", to: contractAddress(), data, value };
}

async function latestUnbondFor(delegator: Address) {
  const logs = await publicClient().getContractEvents({
    address: contractAddress(),
    abi: mockValidatorShareAbi,
    eventName: "ShareBurnedWithId",
    args: { user: delegator },
    fromBlock: 0n,
  });
  return logs.at(-1);
}

async function unbondingPosition(delegator: Address): Promise<Position[]> {
  const event = await latestUnbondFor(delegator);
  if (
    !event ||
    event.args.amount === undefined ||
    event.blockNumber === null ||
    event.blockNumber === undefined
  ) {
    return [];
  }

  const block = await publicClient().getBlock({ blockNumber: event.blockNumber });
  return [
    {
      validator: defaultValidator().address,
      amount: event.args.amount,
      status: "unbonding",
      unbondingReadyAt: Number(block.timestamp) + UNBONDING_SECONDS,
    },
  ];
}

export const polygonAdapter: IChainAdapter = {
  chainId: POLYGON_CHAIN_ID,

  async getValidators() {
    return validatorsForChain(POLYGON_CHAIN_ID).map(toValidator);
  },

  async getDelegations(address) {
    try {
      const amount = await readContract(wagmiConfig, {
        address: contractAddress(),
        abi: mockValidatorShareAbi,
        functionName: "balanceOf",
        args: [address as Address],
      });

      if (amount > 0n) {
        return [
          {
            validator: defaultValidator().address,
            amount,
            status: "bonded",
          },
        ];
      }

      return await unbondingPosition(address as Address);
    } catch (cause) {
      throw toAdapterError(`Failed to load Polygon delegations for ${address}.`, cause);
    }
  },

  async buildDelegateTx(args) {
    try {
      assertValidator(args.validator);
      return evmTx(
        encodeFunctionData({
          abi: mockValidatorShareAbi,
          functionName: "buyVoucher",
          args: [args.amount, args.amount],
        }),
        args.amount,
      );
    } catch (cause) {
      throw toAdapterError("Failed to build Polygon delegate transaction.", cause);
    }
  },

  async buildUndelegateTx(args) {
    try {
      assertValidator(args.validator);
      return evmTx(
        encodeFunctionData({
          abi: mockValidatorShareAbi,
          functionName: "sellVoucher_new",
          args: [args.amount, args.amount],
        }),
      );
    } catch (cause) {
      throw toAdapterError("Failed to build Polygon undelegate transaction.", cause);
    }
  },

  async buildClaimTx(args) {
    try {
      assertValidator(args.validator);
      const unbond = await latestUnbondFor(args.delegator as Address);
      if (!unbond || unbond.args.nonce === undefined) {
        throw new ChainAdapterError(
          "UNBONDING_PERIOD",
          `No claimable Polygon unbond found for ${args.delegator}.`,
        );
      }

      return evmTx(
        encodeFunctionData({
          abi: mockValidatorShareAbi,
          functionName: "unstakeClaimTokens_new",
          args: [unbond.args.nonce],
        }),
      );
    } catch (cause) {
      throw toAdapterError("Failed to build Polygon claim transaction.", cause);
    }
  },

  async estimateGas(tx, from) {
    try {
      if (tx.kind !== "evm") {
        throw networkError(`Polygon adapter cannot estimate gas for ${tx.kind} txs.`);
      }

      return await publicClient().estimateGas({
        account: from as Address,
        to: tx.to,
        data: tx.data,
        value: tx.value ?? 0n,
      });
    } catch (cause) {
      throw toAdapterError("Failed to estimate Polygon gas.", cause);
    }
  },

  watchPosition(address, cb) {
    const delegator = address as Address;
    const emitLatest = async () => {
      try {
        const positions = await polygonAdapter.getDelegations(address);
        cb(
          positions[0] ?? {
            validator: defaultValidator().address,
            amount: 0n,
            status: "released",
          },
        );
      } catch {
        // Swallow watcher refresh failures and keep the subscription alive.
      }
    };

    void emitLatest();

    const unsubs = [
      watchContractEvent(wagmiConfig, {
        address: contractAddress(),
        abi: mockValidatorShareAbi,
        eventName: "ShareMinted",
        args: { user: delegator },
        onLogs: () => void emitLatest(),
      }),
      watchContractEvent(wagmiConfig, {
        address: contractAddress(),
        abi: mockValidatorShareAbi,
        eventName: "ShareBurnedWithId",
        args: { user: delegator },
        onLogs: () => void emitLatest(),
      }),
    ];

    return () => {
      for (const unsub of unsubs) unsub();
    };
  },
};
