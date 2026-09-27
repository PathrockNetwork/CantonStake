import type { Connection } from "@solana/web3.js";

/** HTTP polling keeps confirmation on the verified failover pool. Never
 * rebuild or re-sign a transaction when confirmation is temporarily missing. */
export async function waitForSolanaFinality(
  connection: Pick<Connection, "getSignatureStatuses" | "getBlockHeight">,
  signature: string,
  lastValidBlockHeight: number,
  options: { now?: () => number; sleep?: () => Promise<void>; timeoutMs?: number } = {},
): Promise<void> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 180_000);
  const sleep = options.sleep ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 2_000)));
  while (now() < deadline) {
    // Only RPC reads are repeated. An unavailable provider must not trigger a
    // second wallet prompt or new stake-account creation.
    const observed = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true }).catch(() => null);
    const status = observed?.value[0];
    if (status?.err) throw new Error(`Solana transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "finalized") return;
    if (observed && !status) {
      const height = await connection.getBlockHeight("finalized").catch(() => null);
      if (height !== null && height > lastValidBlockHeight) {
        throw new Error(`Solana transaction ${signature} was not found before its blockhash expired. Check the explorer before retrying.`);
      }
    }
    await sleep();
  }
  throw new Error(`Solana transaction ${signature} was submitted but finality could not be confirmed. Check the explorer before retrying.`);
}
