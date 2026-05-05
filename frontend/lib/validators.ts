import type { ChainConfig } from "@/lib/chains";

export type ValidatorRow = {
  address: `0x${string}`;
  name: string;
  apr: number;
  uptime: number;
  commission: number;
  totalStaked?: string;
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
      totalStaked: "98.7M POL",
      recommended: true,
    },
    {
      address: "0xf190000000000000000000000000000000000002",
      name: "Figment",
      apr: 8.2,
      uptime: 99.7,
      commission: 6,
      totalStaked: "76.3M POL",
    },
    {
      address: "0xe3e000000000000000000000000000000000003",
      name: "Everstake",
      apr: 8.5,
      uptime: 99.3,
      commission: 7,
      totalStaked: "124.2M POL",
    },
    {
      address: "0x0200000000000000000000000000000000000004",
      name: "P2P",
      apr: 9.1,
      uptime: 98.8,
      commission: 8,
      totalStaked: "42.8M POL",
    },
    {
      address: "0x9e1d000000000000000000000000000000000005",
      name: "YieldMax",
      apr: 10.4,
      uptime: 97.5,
      commission: 10,
      totalStaked: "54.1M POL",
    },
  ],
  moonbeam: [
    {
      address: "0x9a2c000000000000000000000000000000f471",
      name: "Stakefish",
      apr: 12.4,
      uptime: 99.96,
      commission: 5,
      recommended: true,
      totalStaked: "12.4M GLMR",
    },
    {
      address: "0x4f8e00000000000000000000000000000023b1",
      name: "Everstake",
      apr: 12.0,
      uptime: 99.98,
      commission: 4,
      totalStaked: "9.8M GLMR",
    },
    {
      address: "0xc0in00000000000000000000000000000000ba5e",
      name: "Coinbase Cloud",
      apr: 11.8,
      uptime: 99.99,
      commission: 8,
      totalStaked: "7.2M GLMR",
    },
  ],
  monad: [
    {
      address: "0x1d7b0000000000000000000000000000008e29",
      name: "Figment",
      apr: 9.8,
      uptime: 99.99,
      commission: 5,
      recommended: true,
      totalStaked: "8.1M MON",
    },
    {
      address: "0x88aa000000000000000000000000000000ee01",
      name: "Chorus One",
      apr: 9.5,
      uptime: 99.95,
      commission: 6,
      totalStaked: "6.4M MON",
    },
    {
      address: "0x9a2c000000000000000000000000000000f471",
      name: "Stakefish",
      apr: 9.6,
      uptime: 99.97,
      commission: 5,
      totalStaked: "5.8M MON",
    },
  ],
};

export const validatorsForChain = (id: string) =>
  VALIDATORS[id as ChainConfig["id"]] ?? [];

export const validatorByAddress = (id: string, address: string) =>
  validatorsForChain(id).find(
    (validator) => validator.address.toLowerCase() === address.toLowerCase(),
  );

export const recommendedValidatorForChain = (id: string) =>
  validatorsForChain(id).find((validator) => validator.recommended) ??
  validatorsForChain(id)[0];
