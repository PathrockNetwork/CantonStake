/**
 * Facts about each Canton network and the identifier formats shared by every
 * ledger caller. Dependency-free so config.ts can validate against it.
 */
export type CantonNetwork = "devnet" | "testnet" | "mainnet";

export interface CantonNetworkInfo {
  label: string;
  /** Fixed Loop origin; user bearer tokens are only ever sent here. */
  loopOrigin: string;
  /** Global synchronizer; its namespace is also the DSO party's. Changes only on a network reset. */
  synchronizerId: string;
}

export const CANTON_NETWORKS: Record<CantonNetwork, CantonNetworkInfo> = {
  devnet: { label: "Canton DevNet", loopOrigin: "https://devnet.cantonloop.com",
    synchronizerId: "global-domain::1220be58c29e65de40bf273be1dc2b266d43a9a002ea5b18955aeef7aac881bb471a" },
  testnet: { label: "Canton TestNet", loopOrigin: "https://testnet.cantonloop.com",
    synchronizerId: "global-domain::1220f22a8b8f2d813c25b9a684dc4dd52b532a0174d8e73a13cdf2baabfff7518337" },
  mainnet: { label: "Canton MainNet", loopOrigin: "https://cantonloop.com",
    synchronizerId: "global-domain::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc" },
};

const SYNCHRONIZER = /^global-domain::(1220[a-f0-9]{64})$/;
const PARTY = /^[^\s:]+::[a-f0-9]{68}$/;

/** The global synchronizer is named after the DSO namespace on every Splice network. */
export function dsoPartyFor(synchronizerId: string): string | null {
  const match = SYNCHRONIZER.exec(synchronizerId);
  return match ? `DSO::${match[1]}` : null;
}

export const isCantonParty = (value: unknown): value is string => typeof value === "string" && PARTY.test(value);

export const isContractId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{2,512}$/.test(value) && value.length % 2 === 0;
