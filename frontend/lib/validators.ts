import type { ChainConfig } from "@/lib/chains";

export type ValidatorRow = {
  address: `0x${string}`;
  name: string;
  apr: number;
  uptime: number;
  commission: number;
  recommended?: boolean;
};

export const VALIDATORS: Partial<Record<ChainConfig["id"], ValidatorRow[]>> = {
  polygon: [
    {
      address: "0x5a10000000000000000000000000000000000001",
      name: "Stakefish",
      apr: 7.8,
      uptime: 99.95,
      commission: 5,
      recommended: true,
    },
    {
      address: "0xf190000000000000000000000000000000000002",
      name: "Figment",
      apr: 8.2,
      uptime: 99.7,
      commission: 6,
    },
    {
      address: "0xe3e000000000000000000000000000000000003",
      name: "Everstake",
      apr: 8.5,
      uptime: 99.3,
      commission: 7,
    },
    {
      address: "0x0200000000000000000000000000000000000004",
      name: "P2P",
      apr: 9.1,
      uptime: 98.8,
      commission: 8,
    },
    {
      address: "0x9e1d000000000000000000000000000000000005",
      name: "YieldMax",
      apr: 10.4,
      uptime: 97.5,
      commission: 10,
    },
  ],
};

export const validatorsForChain = (id: string) =>
  VALIDATORS[id as ChainConfig["id"]] ?? [];
