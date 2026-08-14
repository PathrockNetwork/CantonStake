import { getPublicClient, readContract, watchContractEvent } from "@wagmi/core";
import type { Address } from "viem";
import {
  erc20Abi,
  mockValidatorShareAbi,
  stakingLoggerAbi,
  validatorShareAbi,
} from "@/lib/abi";
import {
  isRealValidatorShare,
  knownValidatorShares,
  polygonChain,
  POLYGON_SETTLEMENT_CHAIN_ID,
  resolveValidatorShare,
  SHARE_SLIPPAGE_BPS,
  stakeManagerAddress,
  stakeTokenAddress,
  stakingLoggerAddress,
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

/**
 * Polygon PoS adapter.
 *
 * The staking contracts are NOT on Bor. StakeManager, the StakingInfo logger
 * and one ValidatorShare per validator are deployed on Ethereum L1 (Sepolia
 * for Amoy), so every call here targets the settlement chain. Consequences
 * that drive the code below:
 *
 *   - The staking contract address is per-validator. `contractAddress()`
 *     refuses to guess.
 *   - `buyVoucher` is not payable. Delegating means approving the
 *     StakeManager to move the ERC-20 stake token first — see
 *     `buildApprovalTx`.
 *   - Shares are not 1:1 with POL. Slippage bounds are derived from
 *     `exchangeRate()` / `withdrawExchangeRate()` and the validator's
 *     precision constant (100 for validatorId < 8, 1e29 otherwise).
 *   - Unbonding is checkpoint-based. Claimability is
 *     `withdrawEpoch + withdrawalDelay <= epoch`, and the wall-clock ETA is
 *     a measurement served by /api/polygon/staking-params, not a constant.
 */

const POLYGON_CHAIN_ID = "polygon";
const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4001";

/** Fallback only: the local MockValidatorShare fixture's 60 s period. */
const MOCK_UNBONDING_SECONDS = 60;

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

/**
 * The ValidatorShare contract for one validator.
 *
 * In real mode there is deliberately no fallback: delegating to the wrong
 * validator's book is worse than failing, so an unregistered validator is a
 * hard error.
 */
function contractAddress(validator?: string): `0x${string}` {
  if (isRealValidatorShare) {
    if (!validator) {
      throw new ChainAdapterError(
        "VALIDATOR_NOT_FOUND",
        "Polygon deploys one ValidatorShare per validator — a validator " +
          "address is required to resolve the staking contract.",
      );
    }
    const resolved = resolveValidatorShare(validator);
    if (!resolved) {
      throw new ChainAdapterError(
        "VALIDATOR_NOT_FOUND",
        `No ValidatorShare contract registered for validator ${validator}. ` +
          `Add it to NEXT_PUBLIC_REAL_VALIDATOR_SHARES (or check ` +
          `/api/polygon/validator-shares).`,
      );
    }
    return resolved;
  }

  // Local fixture path: a single MockValidatorShare on Amoy.
  const address = polygonChain().validatorContract;
  if (!address) throw networkError("Polygon validator contract is not configured.");
  return address;
}

function publicClient() {
  if (!polygonChain().wagmiChain) {
    throw networkError("Polygon wagmi chain is not configured.");
  }

  const client = getPublicClient(wagmiConfig, {
    chainId: isRealValidatorShare ? POLYGON_SETTLEMENT_CHAIN_ID : undefined,
  });
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
  to: `0x${string}`,
  gas?: bigint,
): UnsignedTx {
  const base = value === undefined
    ? { kind: "evm" as const, to, data }
    : { kind: "evm" as const, to, data, value };
  return gas ? { ...base, gas } : base;
}

// --- Exchange-rate math ----------------------------------------------------

/** Polygon's `_getRatePrecision`: foundation validators (id < 8) use 100. */
export function ratePrecision(validatorId: bigint): bigint {
  return validatorId < 8n ? 100n : 10n ** 29n;
}

export function sharesForAmount(
  amount: bigint,
  rate: bigint,
  precision: bigint,
): bigint {
  if (rate === 0n) return 0n;
  return (amount * precision) / rate;
}

export function withSlippage(
  value: bigint,
  bps: number,
  direction: "min" | "max",
): bigint {
  const factor = BigInt(Math.round(bps));
  return direction === "min"
    ? (value * (10_000n - factor)) / 10_000n
    : (value * (10_000n + factor)) / 10_000n;
}

async function exchangeRateFor(share: `0x${string}`): Promise<{
  validatorId: bigint;
  rate: bigint;
  withdrawRate: bigint;
  precision: bigint;
}> {
  const chainId = POLYGON_SETTLEMENT_CHAIN_ID;
  const [validatorId, rate, withdrawRate] = await Promise.all([
    readContract(wagmiConfig, {
      chainId,
      address: share,
      abi: validatorShareAbi,
      functionName: "validatorId",
    }),
    readContract(wagmiConfig, {
      chainId,
      address: share,
      abi: validatorShareAbi,
      functionName: "exchangeRate",
    }),
    readContract(wagmiConfig, {
      chainId,
      address: share,
      abi: validatorShareAbi,
      functionName: "withdrawExchangeRate",
    }),
  ]);
  return {
    validatorId,
    rate,
    withdrawRate,
    precision: ratePrecision(validatorId),
  };
}

// --- Live staking parameters ----------------------------------------------

export interface PolygonStakingParams {
  settlementChainId: number;
  stakeManager: string;
  stakingLogger: string;
  stakeToken: string;
  currentEpoch: string;
  withdrawalDelayEpochs: number;
  checkpointCadenceSeconds: number | null;
  unbondingEtaSeconds: number | null;
  activeValidatorCount: number;
}

let paramsCache: { at: number; value: PolygonStakingParams } | null = null;

/**
 * Live unbonding parameters, measured on-chain by the backend.
 *
 * There is no honest constant to hardcode here: `withdrawalDelay()` is a
 * checkpoint count (80 on this deployment) and checkpoints land whenever
 * Heimdall proposes them. The backend samples RootChain header blocks to get
 * the real cadence, so the ETA the UI shows is an observation, not a slogan.
 */
/** Drop the memoised parameters, e.g. after a chain switch. */
export function clearStakingParamsCache(): void {
  paramsCache = null;
}

export async function fetchStakingParams(): Promise<PolygonStakingParams | null> {
  if (paramsCache && Date.now() - paramsCache.at < 60_000) {
    return paramsCache.value;
  }
  try {
    const res = await fetch(`${BACKEND_URL}/api/polygon/staking-params`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const value = (await res.json()) as PolygonStakingParams;
    paramsCache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}

// --- Position reads --------------------------------------------------------

/**
 * The validator signers we can query. Prefers the resolver map (which the
 * adapter can actually build transactions against) and falls back to the
 * scored list.
 */
async function queryableValidators(): Promise<
  Array<{ validator: `0x${string}`; share: `0x${string}` }>
> {
  if (isRealValidatorShare) {
    const known = knownValidatorShares();
    if (known.length > 0) return known;
  }
  if (cachedRows.length === 0) await loadValidators();
  return cachedRows
    .map((row) => {
      const share = resolveValidatorShare(row.address);
      return share
        ? { validator: row.address as `0x${string}`, share }
        : null;
    })
    .filter(
      (v): v is { validator: `0x${string}`; share: `0x${string}` } => v !== null,
    );
}

async function realDelegations(delegator: Address): Promise<Position[]> {
  const validators = await queryableValidators();
  if (validators.length === 0) return [];

  const client = publicClient();
  const params = await fetchStakingParams();

  // One multicall for every validator's book, rather than N round trips.
  const stakes = await client.multicall({
    contracts: validators.map((v) => ({
      address: v.share,
      abi: validatorShareAbi,
      functionName: "getTotalStake" as const,
      args: [delegator] as const,
    })),
    allowFailure: true,
  });

  const nonces = await client.multicall({
    contracts: validators.map((v) => ({
      address: v.share,
      abi: validatorShareAbi,
      functionName: "unbondNonces" as const,
      args: [delegator] as const,
    })),
    allowFailure: true,
  });

  const positions: Position[] = [];

  for (let i = 0; i < validators.length; i++) {
    const v = validators[i]!;
    const stake = stakes[i];
    if (stake?.status === "success") {
      const amount = (stake.result as readonly bigint[])[0] ?? 0n;
      if (amount > 0n) {
        positions.push({ validator: v.validator, amount, status: "bonded" });
      }
    }

    const nonce = nonces[i];
    if (nonce?.status !== "success") continue;
    const latest = nonce.result as bigint;
    if (latest === 0n) continue;

    const unbond = (await client.readContract({
      address: v.share,
      abi: validatorShareAbi,
      functionName: "unbonds_new",
      args: [delegator, latest],
    })) as readonly [bigint, bigint];

    const [shares, withdrawEpoch] = unbond;
    if (shares === 0n) continue; // already claimed

    // Authoritative condition: withdrawEpoch + withdrawalDelay <= epoch.
    // The timestamp is only a projection of that using the measured cadence.
    let readyAt: number | undefined;
    if (params?.checkpointCadenceSeconds) {
      const claimableAt = withdrawEpoch + BigInt(params.withdrawalDelayEpochs);
      const current = BigInt(params.currentEpoch);
      const remaining = claimableAt > current ? Number(claimableAt - current) : 0;
      readyAt =
        Math.floor(Date.now() / 1000) + remaining * params.checkpointCadenceSeconds;
    }

    // `unbonds_new` stores SHARES, but Position.amount is denominated in the
    // stake token everywhere else in the UI. Convert with the same formula
    // _unstakeClaimTokens uses: shares * withdrawExchangeRate / precision.
    const { withdrawRate, precision } = await exchangeRateFor(v.share);
    const amountOut = (shares * withdrawRate) / precision;

    positions.push({
      validator: v.validator,
      amount: amountOut,
      status: "unbonding",
      ...(readyAt !== undefined ? { unbondingReadyAt: readyAt } : {}),
    });
  }

  return positions;
}

// --- Local fixture reads (MockValidatorShare) -----------------------------

async function mockLatestUnbondFor(delegator: Address) {
  const logs = await publicClient().getContractEvents({
    address: contractAddress(),
    abi: mockValidatorShareAbi,
    eventName: "ShareBurnedWithId",
    args: { user: delegator },
    fromBlock: 0n,
  });
  return logs.at(-1);
}

async function mockUnbondingPosition(delegator: Address): Promise<Position[]> {
  const event = await mockLatestUnbondFor(delegator);
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
      unbondingReadyAt: Number(block.timestamp) + MOCK_UNBONDING_SECONDS,
    },
  ];
}

async function mockDelegations(address: string): Promise<Position[]> {
  const amount = await readContract(wagmiConfig, {
    address: contractAddress(),
    abi: mockValidatorShareAbi,
    functionName: "balanceOf",
    args: [address as Address],
  });

  if (amount > 0n) {
    if (cachedRows.length === 0) await loadValidators();
    return [{ validator: defaultRow().address, amount, status: "bonded" }];
  }
  return mockUnbondingPosition(address as Address);
}

// --- Adapter ---------------------------------------------------------------

export const polygonAdapter: IChainAdapter = {
  chainId: POLYGON_CHAIN_ID,

  async getValidators() {
    const rows = await loadValidators();
    if (!isRealValidatorShare) return rows.map(toValidator);
    // A validator with no ValidatorShare cannot be delegated to, so don't
    // offer it in the picker.
    return rows
      .filter((row) => Boolean(resolveValidatorShare(row.address)))
      .map(toValidator);
  },

  async getDelegations(address) {
    try {
      if (!isRealValidatorShare) return await mockDelegations(address);
      return await realDelegations(address as Address);
    } catch (cause) {
      throw toAdapterError(`Failed to load Polygon delegations for ${address}.`, cause);
    }
  },

  /**
   * ERC-20 approval that must land BEFORE buyVoucher.
   *
   * `StakeManager.delegationDeposit` does the transferFrom, so the spender is
   * the StakeManager, not the ValidatorShare. Returns null when the existing
   * allowance already covers the amount, or on the mock path (which is
   * payable and needs no approval).
   */
  async buildApprovalTx(args) {
    if (!isRealValidatorShare) return null;
    try {
      const allowance = (await readContract(wagmiConfig, {
        chainId: POLYGON_SETTLEMENT_CHAIN_ID,
        address: stakeTokenAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [args.delegator as Address, stakeManagerAddress],
      })) as bigint;

      if (allowance >= args.amount) return null;

      return evmTx(
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [stakeManagerAddress, args.amount],
        }),
        undefined,
        stakeTokenAddress,
      );
    } catch (cause) {
      throw toAdapterError("Failed to build Polygon approval transaction.", cause);
    }
  },

  async buildDelegateTx(args) {
    try {
      assertValidatorAddress(args.validator);

      if (!isRealValidatorShare) {
        // Mock fixture: payable, 1:1 shares.
        return evmTx(
          encodeFunctionData({
            abi: mockValidatorShareAbi,
            functionName: "buyVoucher",
            args: [args.amount, args.amount],
          }),
          args.amount,
          contractAddress(args.validator),
          500000n,
        );
      }

      const share = contractAddress(args.validator);
      const { rate, precision } = await exchangeRateFor(share);
      const expectedShares = sharesForAmount(args.amount, rate, precision);
      const minShares = withSlippage(expectedShares, SHARE_SLIPPAGE_BPS, "min");

      // No `value`: buyVoucher is nonpayable and the stake token moves via
      // the StakeManager's transferFrom.
      return evmTx(
        encodeFunctionData({
          abi: validatorShareAbi,
          functionName: "buyVoucher",
          args: [args.amount, minShares],
        }),
        undefined,
        share,
      );
    } catch (cause) {
      throw toAdapterError("Failed to build Polygon delegate transaction.", cause);
    }
  },

  async buildUndelegateTx(args) {
    try {
      assertValidatorAddress(args.validator);

      if (!isRealValidatorShare) {
        return evmTx(
          encodeFunctionData({
            abi: mockValidatorShareAbi,
            functionName: "sellVoucher_new",
            args: [args.amount, args.amount],
          }),
          undefined,
          contractAddress(args.validator),
        );
      }

      const share = contractAddress(args.validator);
      const { withdrawRate, precision } = await exchangeRateFor(share);
      const expectedShares = sharesForAmount(args.amount, withdrawRate, precision);
      const maxShares = withSlippage(expectedShares, SHARE_SLIPPAGE_BPS, "max");

      return evmTx(
        encodeFunctionData({
          abi: validatorShareAbi,
          functionName: "sellVoucher_new",
          args: [args.amount, maxShares],
        }),
        undefined,
        share,
      );
    } catch (cause) {
      throw toAdapterError("Failed to build Polygon undelegate transaction.", cause);
    }
  },

  async buildClaimTx(args) {
    try {
      assertValidatorAddress(args.validator);

      if (!isRealValidatorShare) {
        const unbond = await mockLatestUnbondFor(args.delegator as Address);
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
          contractAddress(args.validator),
        );
      }

      const share = contractAddress(args.validator);
      const nonce = (await readContract(wagmiConfig, {
        chainId: POLYGON_SETTLEMENT_CHAIN_ID,
        address: share,
        abi: validatorShareAbi,
        functionName: "unbondNonces",
        args: [args.delegator as Address],
      })) as bigint;

      if (nonce === 0n) {
        throw new ChainAdapterError(
          "UNBONDING_PERIOD",
          `No Polygon unbond found for ${args.delegator} on validator ${args.validator}.`,
        );
      }

      const [shares, withdrawEpoch] = (await readContract(wagmiConfig, {
        chainId: POLYGON_SETTLEMENT_CHAIN_ID,
        address: share,
        abi: validatorShareAbi,
        functionName: "unbonds_new",
        args: [args.delegator as Address, nonce],
      })) as readonly [bigint, bigint];

      if (shares === 0n) {
        throw new ChainAdapterError(
          "UNBONDING_PERIOD",
          `Polygon unbond #${nonce} for ${args.delegator} has already been claimed.`,
        );
      }

      // Guard on the real checkpoint condition rather than a wall clock:
      // unstakeClaimTokens_new reverts until
      // withdrawEpoch + withdrawalDelay <= epoch.
      const params = await fetchStakingParams();
      if (params) {
        const claimableAt = withdrawEpoch + BigInt(params.withdrawalDelayEpochs);
        const current = BigInt(params.currentEpoch);
        if (current < claimableAt) {
          const remaining = Number(claimableAt - current);
          const eta = params.checkpointCadenceSeconds
            ? ` (~${Math.round(
                (remaining * params.checkpointCadenceSeconds) / 3600,
              )}h at the current checkpoint rate)`
            : "";
          throw new ChainAdapterError(
            "UNBONDING_PERIOD",
            `Polygon unbond #${nonce} is not claimable yet: ${remaining} more ` +
              `checkpoints, epoch ${current}/${claimableAt}${eta}.`,
          );
        }
      }

      return evmTx(
        encodeFunctionData({
          abi: validatorShareAbi,
          functionName: "unstakeClaimTokens_new",
          args: [nonce],
        }),
        undefined,
        share,
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

    // Real mode: delegation events are emitted by the shared StakingInfo
    // logger on L1, filtered by delegator. Fixture mode: by the mock itself.
    const unsubs = isRealValidatorShare
      ? [
          watchContractEvent(wagmiConfig, {
            chainId: POLYGON_SETTLEMENT_CHAIN_ID,
            address: stakingLoggerAddress,
            abi: stakingLoggerAbi,
            eventName: "ShareMinted",
            args: { user: delegator },
            onLogs: () => void emitLatest(),
          }),
          watchContractEvent(wagmiConfig, {
            chainId: POLYGON_SETTLEMENT_CHAIN_ID,
            address: stakingLoggerAddress,
            abi: stakingLoggerAbi,
            eventName: "ShareBurnedWithId",
            args: { user: delegator },
            onLogs: () => void emitLatest(),
          }),
          watchContractEvent(wagmiConfig, {
            chainId: POLYGON_SETTLEMENT_CHAIN_ID,
            address: stakingLoggerAddress,
            abi: stakingLoggerAbi,
            eventName: "DelegatorUnstakeWithId",
            args: { user: delegator },
            onLogs: () => void emitLatest(),
          }),
        ]
      : [
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
