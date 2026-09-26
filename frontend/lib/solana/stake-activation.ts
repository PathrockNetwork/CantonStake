import { getStakeActivation } from "@anza-xyz/solana-rpc-get-stake-activation";
import { Connection, PublicKey } from "@solana/web3.js";
import { Buffer as BrowserBuffer } from "buffer";
import { assertSolanaGenesis, solanaNetwork } from "./network";

export type SolanaStakeState = "active" | "activating" | "deactivating" | "inactive";

// The removed getStakeActivation JSON-RPC method must not be used. Anza's
// client-side calculation reads the stake account, StakeHistory sysvar, and
// current epoch. Keep all three reads on a finalized connection.
const finalizedConnection = new Connection(solanaNetwork.rpc, "finalized");

export async function readSolanaStakeActivation(
  stakeAccount: PublicKey,
  connection: Connection = finalizedConnection,
): Promise<{ state: SolanaStakeState; active: bigint; inactive: bigint }> {
  assertSolanaGenesis(await connection.getGenesisHash());
  // The Anza v1 implementation checks parsed account data with `instanceof
  // Buffer` but does not import Buffer. Node provides it globally; browsers
  // do not. Supply the same browser Buffer implementation used by web3.js.
  if (typeof globalThis.Buffer === "undefined") globalThis.Buffer = BrowserBuffer;
  const result = await getStakeActivation(connection, stakeAccount);
  if (!["active", "activating", "deactivating", "inactive"].includes(result.status)) {
    throw new Error(`Unrecognized Solana stake state: ${result.status}`);
  }
  return { state: result.status as SolanaStakeState, active: result.active, inactive: result.inactive };
}
