import type { PositionRow } from "@/lib/api";

export type DemoPositionRow = PositionRow & {
  __demo: true;
  chainId: "polygon" | "moonbeam" | "monad";
  validatorName: string;
  apy: number;
  ccBonusApy: number;
  amountSymbol: number;
  symbolPriceUsd: number;
  nativeRewards: number;
  ccEarned: number;
};

export const DEMO_POSITIONS: DemoPositionRow[] = [
  {
    __demo: true,
    chainId: "polygon",
    validatorName: "Everstake",
    apy: 6.2,
    ccBonusApy: 2.4,
    amountSymbol: 12500,
    symbolPriceUsd: 0.42,
    nativeRewards: 142.8,
    ccEarned: 1842.5,
    contractId: "demo::polygon::everstake",
    argument: {
      delegator: "demo-polygon",
      evmAddress: "0xdemo...pol",
      amountPol: "12500",
      status: "Bonded",
      bondedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString(),
      markersEmitted: 38,
    },
  },
  {
    __demo: true,
    chainId: "moonbeam",
    validatorName: "Stakefish",
    apy: 12.4,
    ccBonusApy: 3.1,
    amountSymbol: 4200,
    symbolPriceUsd: 0.28,
    nativeRewards: 38.4,
    ccEarned: 612.3,
    contractId: "demo::moonbeam::stakefish",
    argument: {
      delegator: "demo-moonbeam",
      evmAddress: "0xdemo...glmr",
      amountPol: "4200",
      status: "Bonded",
      bondedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString(),
      markersEmitted: 14,
    },
  },
  {
    __demo: true,
    chainId: "monad",
    validatorName: "Figment",
    apy: 9.8,
    ccBonusApy: 4.2,
    amountSymbol: 850,
    symbolPriceUsd: 1.85,
    nativeRewards: 12.6,
    ccEarned: 287.1,
    contractId: "demo::monad::figment",
    argument: {
      delegator: "demo-monad",
      evmAddress: "0xdemo...mon",
      amountPol: "850",
      status: "Bonded",
      bondedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 22).toISOString(),
      markersEmitted: 7,
    },
  },
];

export const DEMO_AGGREGATES = {
  totalStakedUsd: 8060,
  ccBalance: 2741.9,
  ccEarned24h: 18.4,
  nativeUsd24h: 2.44,
  nativeRewardsUsd: 73.2,
  blendedApy: 9.4,
  ccBonusApy: 2.8,
  totalEffectiveApy: 12.2,
  ccPriceUsd: 0.16,
  rewardsRound: 287412,
  poolSharePct: 62,
  networkSharePct: 2.41,
};

export function isDemoPosition(position: unknown): position is DemoPositionRow {
  return (
    !!position &&
    typeof position === "object" &&
    (position as { __demo?: boolean }).__demo === true
  );
}
