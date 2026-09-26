import { afterEach, describe, expect, it, vi } from "vitest";

const MAINNET = {
  chainId: 1,
  stakeManager: "0x5e3Ef299fDDf15eAa0432E6e66473ace8c13D908",
  stakingLogger: "0xa59C847Bd5aC0172Ff4FE912C5d29E5A71A7512B",
  stakeToken: "0x455e53CBB86018Ac2B8092FdCd39d8444aFFC3F6",
};

const TESTNET = {
  chainId: 11155111,
  stakeManager: "0x4AE8f648B1Ec892B6cc68C89cc088583964d08bE",
  stakingLogger: "0x5E3111a5d928D24718c1A7897261D0B9087002ed",
  stakeToken: "0x44499312f493F62f2DFd3C6435Ca3603EbFCeeBa",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Polygon settlement build defaults", () => {
  it.each([
    ["testnet", TESTNET],
    ["mainnet", MAINNET],
  ])("uses %s defaults when Docker build overrides are blank", async (mode, expected) => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_MODE", mode);
    vi.stubEnv("NEXT_PUBLIC_POLYGON_SETTLEMENT_CHAIN_ID", "");
    vi.stubEnv("NEXT_PUBLIC_POLYGON_STAKE_MANAGER", "");
    vi.stubEnv("NEXT_PUBLIC_POLYGON_STAKING_LOGGER", "");
    vi.stubEnv("NEXT_PUBLIC_POLYGON_STAKE_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_SHARE_SLIPPAGE_BPS", "");
    vi.resetModules();

    const chains = await import("@/lib/chains");
    expect(chains.POLYGON_SETTLEMENT_CHAIN_ID).toBe(expected.chainId);
    expect(chains.stakeManagerAddress).toBe(expected.stakeManager);
    expect(chains.stakingLoggerAddress).toBe(expected.stakingLogger);
    expect(chains.stakeTokenAddress).toBe(expected.stakeToken);
    expect(chains.SHARE_SLIPPAGE_BPS).toBe(50);
  });

  it("honors explicit Polygon settlement overrides", async () => {
    const overrides = {
      stakeManager: "0x1111111111111111111111111111111111111111",
      stakingLogger: "0x2222222222222222222222222222222222222222",
      stakeToken: "0x3333333333333333333333333333333333333333",
    };
    vi.stubEnv("NEXT_PUBLIC_NETWORK_MODE", "mainnet");
    vi.stubEnv("NEXT_PUBLIC_POLYGON_SETTLEMENT_CHAIN_ID", "1");
    vi.stubEnv("NEXT_PUBLIC_POLYGON_STAKE_MANAGER", overrides.stakeManager);
    vi.stubEnv("NEXT_PUBLIC_POLYGON_STAKING_LOGGER", overrides.stakingLogger);
    vi.stubEnv("NEXT_PUBLIC_POLYGON_STAKE_TOKEN", overrides.stakeToken);
    vi.stubEnv("NEXT_PUBLIC_SHARE_SLIPPAGE_BPS", "75");
    vi.resetModules();

    const chains = await import("@/lib/chains");
    expect(chains.POLYGON_SETTLEMENT_CHAIN_ID).toBe(1);
    expect(chains.stakeManagerAddress).toBe(overrides.stakeManager);
    expect(chains.stakingLoggerAddress).toBe(overrides.stakingLogger);
    expect(chains.stakeTokenAddress).toBe(overrides.stakeToken);
    expect(chains.SHARE_SLIPPAGE_BPS).toBe(75);
  });

  it.each([
    ["testnet", "1"],
    ["mainnet", "11155111"],
    ["testnet", "80002"],
    ["testnet", "invalid"],
  ])("rejects a %s build with settlement chain %s", async (mode, chainId) => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_MODE", mode);
    vi.stubEnv("NEXT_PUBLIC_POLYGON_SETTLEMENT_CHAIN_ID", chainId);
    vi.resetModules();
    await expect(import("@/lib/chains")).rejects.toThrow("does not match this frontend's network mode");
  });
});
