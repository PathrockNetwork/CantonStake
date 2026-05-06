import { getPublicClient, readContract, watchContractEvent } from "@wagmi/core";
import type { Address } from "viem";
import { mockValidatorShareAbi } from "@/lib/abi";
import {
  isRealValidatorShare,
  polygonChain,
  resolveValidatorShare,
} from "@/lib/chains";
import type { ValidatorRow } from "@/lib/validators";
import { fetchScoredValidators } from "@/lib/validators-live";
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

let cachedRows: ValidatorRow[] = [];

async function loadValidators(): Promise<ValidatorRow[]> {
  const { rows } = await fetchScoredValidators(POLYGON_CHAIN_ID);
  cachedRows = rows;
  return rows;
}

function defaultRow(): ValidatorRow {
  const [first] = cachedRows;
  if (!first) {
    throw networkError("No Polygon validators are configured.");
  }
  return first;
}

function rowByAddress(address: string): ValidatorRow | undefined {
  return cachedRows.find(
    (row) => row.address.toLowerCase() === address.toLowerCase(),
  );
}

function assertValidatorAddress(address: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new ChainAdapterError(
      "VALIDATOR_NOT_FOUND",
      `Invalid validator address ${address}.`,
    );
  }
}

function networkError(message: string, cause?: unknown) {
  return new ChainAdapterError("NETWORK", message, cause);
}

function toAdapterError(message: string, cause: unknown) {
  if (cause instanceof ChainAdapterError) return cause;
  return networkError(message, cause);
}

function contractAddress(validator?: string) {
  // Real-mode: per-validator ValidatorShare lookup. Demo-mode: single
  // mock contract from chains.ts.
  if (isRealValidatorShare && validator) {
    const resolved = resolveValidatorShare(validator);
    if (!resolved) {
      throw new ChainAdapterError(
        "VALIDATOR_NOT_FOUND",
        `No real ValidatorShare contract registered for validator ${validator}. ` +
          `Add it to NEXT_PUBLIC_REAL_VALIDATOR_SHARES.`,
      );
    }
    return resolved;
  }
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

function toValidator(row: ValidatorRow): Validator {
  return {
    address: row.address,
    name: row.name,
    apr: row.apr,
    commission: row.commission,
    uptime: row.uptime,
  };
}

function evmTx(
  data: `0x${string}`,
  value: bigint | undefined,
  validator: string,
  gas?: bigint,
): UnsignedTx {
  const base = value === undefined
    ? { kind: "evm" as const, to: contractAddress(validator), data }
    : { kind: "evm" as const, to: contractAddress(validator), data, value };
  return gas ? { ...base, gas } : base;
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
      validator: defaultRow().address,
      amount: event.args.amount,
      status: "unbonding",
      unbondingReadyAt: Number(block.timestamp) + UNBONDING_SECONDS,
    },
  ];
}

export const polygonAdapter: IChainAdapter = {
  chainId: POLYGON_CHAIN_ID,

  async getValidators() {
    const rows = await loadValidators();
    return rows.map(toValidator);
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
        if (cachedRows.length === 0) await loadValidators();
        return [
          {
            validator: defaultRow().address,
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
      assertValidatorAddress(args.validator);
      return evmTx(
        encodeFunctionData({
          abi: mockValidatorShareAbi,
          functionName: "buyVoucher",
          args: [args.amount, args.amount],
        }),
        args.amount,
        args.validator,
        500000n, // Set explicit gas limit to avoid estimation issues
      );
    } catch (cause) {
      throw toAdapterError("Failed to build Polygon delegate transaction.", cause);
    }
  },

  async buildUndelegateTx(args) {
    try {
      assertValidatorAddress(args.validator);
      return evmTx(
        encodeFunctionData({
          abi: mockValidatorShareAbi,
          functionName: "sellVoucher_new",
          args: [args.amount, args.amount],
        }),
        undefined,
        args.validator,
      );
    } catch (cause) {
      throw toAdapterError("Failed to build Polygon undelegate transaction.", cause);
    }
  },

  async buildClaimTx(args) {
    try {
      assertValidatorAddress(args.validator);
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
        undefined,
        args.validator,
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
        if (cachedRows.length === 0) await loadValidators();
        const positions = await polygonAdapter.getDelegations(address);
        cb(
          positions[0] ?? {
            validator: defaultRow().address,
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
