/**
 * Canton wallet provider abstraction. Mirrors CIP-103 (the Canton dApp
 * Standard) at the interface level so any compliant wallet — Loop,
 * Console, Dfns, or a future @canton-network/dapp-sdk drop-in — can be
 * registered as a provider without touching consumers.
 *
 * Today there is one provider (the Loop mock). When the real
 * @canton-network/dapp-sdk lands, add a second provider file that
 * implements ICantonProvider and register it in ./index.ts. Consumers
 * keep using useCantonWallet().
 */

export type CantonNetwork = "local" | "devnet" | "mainnet";

export interface CantonIdentity {
  partyId: string;
  displayName: string;
}

export interface CantonConnectOptions {
  displayName?: string;
  evmAddress?: string;
}

export interface ICantonProvider {
  readonly id: string;
  readonly displayName: string;

  isAvailable(): boolean;
  getStoredIdentity(): CantonIdentity | null;
  connect(opts: CantonConnectOptions): Promise<CantonIdentity>;
  disconnect(): Promise<void>;
  subscribe(cb: () => void): () => void;
}
