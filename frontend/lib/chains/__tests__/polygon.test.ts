import { beforeEach, describe, expect, it, vi } from "vitest";
import { erc20Abi, validatorShareAbi } from "@/lib/abi";
import { encodeFunctionData } from "@/lib/viem-encode-function-data";

/**
 * These tests exercise the REAL Polygon ValidatorShare path
 * (NEXT_PUBLIC_USE_REAL_VALIDATOR_SHARE=true), which is what ships. The
 * facts they pin down were verified on Sepolia:
 *
 *   - the staking contract is per-validator, so an unregistered validator
 *     must fail rather than fall back to some global address;
 *   - buyVoucher is NOT payable and takes an exchange-rate-derived
 *     minSharesToMint, not the raw amount;
 *   - delegating requires an ERC-20 approval to the StakeManager;
 *   - the share precision constant is 100 for validatorId < 8 and 1e29
 *     for every later validator;
 *   - claiming is gated on checkpoint progress, not a wall clock.
 */

const VALIDATOR = "0x5a10000000000000000000000000000000000001";
const SHARE = "0x3333333333333333333333333333333333333333";
const UNREGISTERED = "0x9999999999999999999999999999999999999999";
const STAKE_MANAGER = "0x4AE8f648B1Ec892B6cc68C89cc088583964d08bE";
const STAKE_TOKEN = "0x44499312f493F62f2DFd3C6435Ca3603EbFCeeBa";
const LOGGER = "0x5E3111a5d928D24718c1A7897261D0B9087002ed";
const DELEGATOR = "0x1111111111111111111111111111111111111111";

vi.mock("@/lib/wagmi", () => ({ wagmiConfig: {} }));

vi.mock("@/lib/chains", () => ({
  polygonChain: () => ({
    id: "polygon",
    validatorContract: undefined,
    wagmiChain: { id: 11155111 },
  }),
  isRealValidatorShare: true,
  POLYGON_SETTLEMENT_CHAIN_ID: 11155111,
  SHARE_SLIPPAGE_BPS: 50,
  stakeManagerAddress: STAKE_MANAGER,
  stakeTokenAddress: STAKE_TOKEN,
  stakingLoggerAddress: LOGGER,
  resolveValidatorShare: (v: string) =>
    v.toLowerCase() === VALIDATOR ? SHARE : undefined,
  knownValidatorShares: () => [{ validator: VALIDATOR, share: SHARE }],
  // The live registry refresh is a no-op under test — the mocked
  // resolveValidatorShare above already defines the known world.
  ensureValidatorSharesLive: async () => {},
  ensureValidatorMinimums: async () => {},
  validatorMinAmounts: new Map<string, bigint>(),
}));

vi.mock("@/lib/validators-live", () => ({
  fetchScoredValidators: vi.fn().mockResolvedValue({
    rows: [
      {
        address: VALIDATOR,
        name: "Stakefish",
        apr: 7.8,
        uptime: 99.95,
        commission: 5,
        recommended: true,
      },
      {
        address: UNREGISTERED,
        name: "No Share Registered",
        apr: 6.0,
        uptime: 99.0,
        commission: 10,
      },
    ],
    source: "live",
  }),
}));

const readContract = vi.fn();
vi.mock("@wagmi/core", () => ({
  getPublicClient: vi.fn(),
  readContract: (...args: unknown[]) => readContract(...args),
  watchContractEvent: vi.fn(),
}));

// validatorId 8 → high precision (1e29). exchangeRate above par so shares
// are strictly fewer than the POL amount, which is the case the old 1:1
// mock could not represent.
const VALIDATOR_ID = 8n;
const PRECISION = 10n ** 29n;
const RATE = (PRECISION * 11n) / 10n; // 1.1 POL per share

function mockReads(overrides: Record<string, unknown> = {}) {
  readContract.mockImplementation((_config: unknown, args: { functionName: string }) => {
    const table: Record<string, unknown> = {
      validatorId: VALIDATOR_ID,
      exchangeRate: RATE,
      withdrawExchangeRate: RATE,
      allowance: 0n,
      unbondNonces: 0n,
      ...overrides,
    };
    if (!(args.functionName in table)) {
      throw new Error(`unexpected read: ${args.functionName}`);
    }
    return Promise.resolve(table[args.functionName]);
  });
}

// Imported after the mocks so the module picks them up.
const {
  clearStakingParamsCache,
  polygonAdapter,
  ratePrecision,
  sharesForAmount,
  withSlippage,
} = await import("@/lib/chains/polygon");

beforeEach(() => {
  readContract.mockReset();
  clearStakingParamsCache();
  mockReads();
  global.fetch = vi.fn().mockRejectedValue(new Error("no backend in tests")) as never;
});

describe("share math", () => {
  it("uses precision 100 for the foundation validators and 1e29 after", () => {
    // Verified on Sepolia: validators 1..7 report exchangeRate 100, 8+ report 1e29.
    expect(ratePrecision(1n)).toBe(100n);
    expect(ratePrecision(7n)).toBe(100n);
    expect(ratePrecision(8n)).toBe(10n ** 29n);
    expect(ratePrecision(33n)).toBe(10n ** 29n);
  });

  it("mints fewer shares than POL once the exchange rate is above par", () => {
    const amount = 10n ** 18n;
    const shares = sharesForAmount(amount, RATE, PRECISION);
    expect(shares).toBe((amount * 10n) / 11n);
    expect(shares).toBeLessThan(amount);
  });

  it("returns zero rather than dividing by a zero rate", () => {
    expect(sharesForAmount(10n ** 18n, 0n, PRECISION)).toBe(0n);
  });

  it("applies slippage in the direction that protects the user", () => {
    expect(withSlippage(10_000n, 50, "min")).toBe(9_950n);
    expect(withSlippage(10_000n, 50, "max")).toBe(10_050n);
  });
});

describe("polygonAdapter", () => {
  it("getValidators drops validators with no registered ValidatorShare", async () => {
    await expect(polygonAdapter.getValidators()).resolves.toEqual([
      {
        address: VALIDATOR,
        name: "Stakefish",
        apr: 7.8,
        commission: 5,
        uptime: 99.95,
      },
    ]);
  });

  it("buildDelegateTx targets the validator's own ValidatorShare, is not payable, and derives minShares", async () => {
    const amount = 1_000_000_000_000_000_000n;
    const expectedShares = sharesForAmount(amount, RATE, PRECISION);
    const minShares = withSlippage(expectedShares, 50, "min");

    const tx = await polygonAdapter.buildDelegateTx({
      validator: VALIDATOR,
      amount,
      delegator: DELEGATOR,
    });

    expect(tx).toEqual({
      kind: "evm",
      to: SHARE,
      data: encodeFunctionData({
        abi: validatorShareAbi,
        functionName: "buyVoucher",
        args: [amount, minShares],
      }),
    });
    // No `value` key at all — buyVoucher reverts on a payable call.
    expect(tx).not.toHaveProperty("value");
    expect(minShares).toBeLessThan(amount);
  });

  it("buildApprovalTx approves the StakeManager on the stake token", async () => {
    const amount = 5n * 10n ** 18n;
    const tx = await polygonAdapter.buildApprovalTx!({
      validator: VALIDATOR,
      amount,
      delegator: DELEGATOR,
    });

    expect(tx).toEqual({
      kind: "evm",
      // The token, not the ValidatorShare...
      to: STAKE_TOKEN,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        // ...and the StakeManager is the spender, because it does the
        // transferFrom in delegationDeposit.
        args: [STAKE_MANAGER, amount],
      }),
    });
  });

  it("buildApprovalTx is a no-op when the allowance already covers the amount", async () => {
    mockReads({ allowance: 10n ** 30n });
    await expect(
      polygonAdapter.buildApprovalTx!({
        validator: VALIDATOR,
        amount: 10n ** 18n,
        delegator: DELEGATOR,
      }),
    ).resolves.toBeNull();
  });

  it("buildUndelegateTx bounds maximumSharesToBurn from withdrawExchangeRate", async () => {
    const amount = 2n * 10n ** 18n;
    const maxShares = withSlippage(
      sharesForAmount(amount, RATE, PRECISION),
      50,
      "max",
    );

    await expect(
      polygonAdapter.buildUndelegateTx({
        validator: VALIDATOR,
        amount,
        delegator: DELEGATOR,
      }),
    ).resolves.toEqual({
      kind: "evm",
      to: SHARE,
      data: encodeFunctionData({
        abi: validatorShareAbi,
        functionName: "sellVoucher_new",
        args: [amount, maxShares],
      }),
    });
  });

  it("refuses to build a tx for a validator with no registered ValidatorShare", async () => {
    await expect(
      polygonAdapter.buildDelegateTx({
        validator: UNREGISTERED,
        amount: 1n,
        delegator: DELEGATOR,
      }),
    ).rejects.toMatchObject({
      name: "ChainAdapterError",
      code: "VALIDATOR_NOT_FOUND",
    });
  });

  it("throws VALIDATOR_NOT_FOUND when the validator address is malformed", async () => {
    await expect(
      polygonAdapter.buildDelegateTx({
        validator: "not-an-address",
        amount: 1n,
        delegator: DELEGATOR,
      }),
    ).rejects.toMatchObject({
      name: "ChainAdapterError",
      code: "VALIDATOR_NOT_FOUND",
    });
  });

  it("buildClaimTx reports UNBONDING_PERIOD when there is no unbond", async () => {
    await expect(
      polygonAdapter.buildClaimTx({ validator: VALIDATOR, delegator: DELEGATOR }),
    ).rejects.toMatchObject({
      name: "ChainAdapterError",
      code: "UNBONDING_PERIOD",
    });
  });

  it("buildClaimTx refuses an unbond that has already been claimed", async () => {
    mockReads({ unbondNonces: 3n, unbonds_new: [0n, 44_000n] });
    await expect(
      polygonAdapter.buildClaimTx({ validator: VALIDATOR, delegator: DELEGATOR }),
    ).rejects.toMatchObject({
      name: "ChainAdapterError",
      code: "UNBONDING_PERIOD",
    });
  });

  it("buildClaimTx blocks on checkpoint progress, not a wall clock", async () => {
    mockReads({ unbondNonces: 3n, unbonds_new: [10n ** 18n, 44_000n] });
    // 44_000 + 80 = 44_080 > 44_050, so 30 checkpoints remain.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        settlementChainId: 11155111,
        currentEpoch: "44050",
        withdrawalDelayEpochs: 80,
        checkpointCadenceSeconds: 1000,
        unbondingEtaSeconds: 80_000,
      }),
    }) as never;

    await expect(
      polygonAdapter.buildClaimTx({ validator: VALIDATOR, delegator: DELEGATOR }),
    ).rejects.toMatchObject({
      name: "ChainAdapterError",
      code: "UNBONDING_PERIOD",
      message: expect.stringContaining("30 more"),
    });
  });

  it("buildClaimTx encodes unstakeClaimTokens_new once the checkpoints have passed", async () => {
    mockReads({ unbondNonces: 3n, unbonds_new: [10n ** 18n, 44_000n] });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        settlementChainId: 11155111,
        currentEpoch: "44100",
        withdrawalDelayEpochs: 80,
        checkpointCadenceSeconds: 1000,
        unbondingEtaSeconds: 80_000,
      }),
    }) as never;

    await expect(
      polygonAdapter.buildClaimTx({ validator: VALIDATOR, delegator: DELEGATOR }),
    ).resolves.toEqual({
      kind: "evm",
      to: SHARE,
      data: encodeFunctionData({
        abi: validatorShareAbi,
        functionName: "unstakeClaimTokens_new",
        args: [3n],
      }),
    });
  });
});
