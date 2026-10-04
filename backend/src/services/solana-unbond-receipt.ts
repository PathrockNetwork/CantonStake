import { Ed25519 } from "@cosmjs/crypto";
import { fromBase64, toBase64 } from "@cosmjs/encoding";
import { fromBase58, toBase58 } from "@mysten/sui/utils";
import { assertSolanaNetwork, solanaRpc, SOLANA_STAKE_PROGRAM } from "./solana-rpc.js";

/** Decode only the legacy single-signer, single-instruction deactivate emitted
 * by our real wallet flow. No versioned transactions, CPI, added instructions,
 * alternative authorities or parser labels may clear a retry guard.
 * Layout: @solana/web3.js programs/stake.ts, StakeInstruction.Deactivate (5).
 */
async function verifyDeactivate(bytes: Uint8Array, args: { wallet: string; stakeAccount: string; signature: string }): Promise<boolean> {
  let cursor = 0;
  const take = (size: number): Uint8Array => {
    if (cursor + size > bytes.length) throw new Error("Truncated Solana transaction");
    const value = bytes.slice(cursor, cursor + size); cursor += size; return value;
  };
  const shortvec = (): number => {
    let value = 0;
    for (let shift = 0; shift <= 14; shift += 7) {
      const byte = take(1)[0]!;
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) {
        if ((shift > 0 && (byte & 127) === 0) || value > 65535) throw new Error("Non-canonical Solana length");
        return value;
      }
    }
    throw new Error("Invalid Solana length");
  };
  try {
    if (bytes.length > 1232 || shortvec() !== 1) return false;
    const signature = take(64);
    if (toBase58(signature) !== args.signature) return false;
    const message = bytes.slice(cursor);
    const header = take(3);
    // One writable signer (fee payer), two readonly unsigned keys (clock/program).
    if (header[0] !== 1 || header[1] !== 0 || header[2] !== 2 || shortvec() !== 4) return false;
    const keys = Array.from({ length: 4 }, () => take(32));
    if (toBase58(keys[0]!) !== args.wallet || toBase58(keys[1]!) !== args.stakeAccount) return false;
    const names = keys.map(toBase58);
    const clock = names.indexOf("SysvarC1ock11111111111111111111111111111111");
    const program = names.indexOf(SOLANA_STAKE_PROGRAM);
    if (clock < 2 || program < 2 || clock === program) return false;
    take(32); // recent blockhash
    if (shortvec() !== 1 || take(1)[0] !== program || shortvec() !== 3) return false;
    const accounts = take(3);
    if (accounts[0] !== 1 || accounts[1] !== clock || accounts[2] !== 0 || shortvec() !== 4) return false;
    const instruction = take(4);
    if (instruction[0] !== 5 || instruction[1] !== 0 || instruction[2] !== 0 || instruction[3] !== 0 || cursor !== bytes.length) return false;
    return Ed25519.verifySignature(signature, message, keys[0]!);
  } catch { return false; }
}

/** Finalized RPC receipt only; no signer, simulations, broadcasts or writes.
 * Unknown/expired signatures remain pending, never permission to retry.
 * https://solana.com/docs/rpc/http/getsignaturestatuses
 * https://solana.com/docs/rpc/http/gettransaction
 */
export async function readSolanaUnbondReceipt(args: {
  wallet: string; stakeAccount: string; signature: string; bondHeight: number;
}): Promise<{ hash: string; status: "pending" | "settled" | "reverted" }> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(args.wallet) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(args.stakeAccount) ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(args.signature) || fromBase58(args.signature).length !== 64 ||
      !Number.isSafeInteger(args.bondHeight) || args.bondHeight <= 0) throw new Error("Solana recovery requires the verified wallet, stake account, signature and bond slot");
  await assertSolanaNetwork();
  const statuses = await solanaRpc<{ value?: Array<{ slot?: number; confirmationStatus?: string; err?: unknown } | null> }>(
    "getSignatureStatuses", [[args.signature], { searchTransactionHistory: true }],
  );
  if (!Array.isArray(statuses.value) || statuses.value.length !== 1) throw new Error("Solana signature status is unavailable");
  const status = statuses.value[0];
  if (!status || status.confirmationStatus !== "finalized") return { hash: args.signature, status: "pending" };
  const transaction = await solanaRpc<{ slot?: number; meta?: { err?: unknown }; transaction?: [string, string] } | null>(
    "getTransaction", [args.signature, { encoding: "base64", commitment: "finalized", maxSupportedTransactionVersion: 0 }],
  );
  if (transaction === null) return { hash: args.signature, status: "pending" };
  if (!Number.isSafeInteger(transaction.slot) || transaction.slot! <= args.bondHeight || transaction.slot !== status.slot ||
      !transaction.meta || !("err" in transaction.meta) || !("err" in status) ||
      JSON.stringify(transaction.meta.err) !== JSON.stringify(status.err) || !Array.isArray(transaction.transaction) ||
      transaction.transaction[1] !== "base64") throw new Error("Solana finalized receipt is incomplete or inconsistent");
  const bytes = fromBase64(transaction.transaction[0]);
  if (toBase64(bytes) !== transaction.transaction[0] || !await verifyDeactivate(bytes, args)) {
    throw new Error("Solana signature does not prove this wallet's exact stake-account deactivation");
  }
  return { hash: args.signature, status: transaction.meta.err === null ? "settled" : "reverted" };
}
