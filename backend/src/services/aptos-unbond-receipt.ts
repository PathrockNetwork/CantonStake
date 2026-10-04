import { rpcUrls } from "./rpc-registry.js";
import { canonicalAptosAddress, decodeAptosDelegationActions, type AptosAccountTransaction } from "./aptos-events.js";
import { aptosU64, aptosUnbondSnapshot } from "./aptos-lifecycle.js";

/** Existing TestNet receipt only. No signer, simulations or transaction writes.
 * Success also requires the historical full-position unlock state; a partial
 * external unlock is not evidence that this entire Canton position unbonded.
 */
export async function readAptosUnbondReceipt(args: {
  wallet: string; pool: string; hash: string; bondHeight: number;
}): Promise<{ hash: string; status: "pending" | "settled" | "reverted" }> {
  if (!/^0x[a-f0-9]{64}$/.test(args.wallet) || !canonicalAptosAddress(args.pool) ||
      !/^0x[a-fA-F0-9]{64}$/.test(args.hash) || !Number.isSafeInteger(args.bondHeight) || args.bondHeight <= 0) {
    throw new Error("Aptos recovery requires the verified wallet, pool, hash and original bond version");
  }
  const base = rpcUrls.aptos;
  const options = { signal: AbortSignal.timeout(12000), redirect: "error" as const };
  const ledgerResponse = await fetch(`${base}/v1`, options);
  if (!ledgerResponse.ok || (await ledgerResponse.json() as { chain_id?: number }).chain_id !== 2) throw new Error("Aptos recovery RPC is unavailable or not TestNet");
  const hash = args.hash.toLowerCase();
  const response = await fetch(`${base}/v1/transactions/by_hash/${hash}`, { ...options, signal: AbortSignal.timeout(12000) });
  if (response.status === 404) return { hash, status: "pending" };
  if (!response.ok) throw new Error("Aptos transaction lookup is unavailable");
  const transaction = await response.json() as AptosAccountTransaction & { payload?: { type_arguments?: unknown[] } };
  if (transaction.type === "pending_transaction") {
    if (transaction.hash?.toLowerCase() !== hash) throw new Error("Aptos pending receipt hash does not match");
    return { hash, status: "pending" };
  }
  const payload = transaction.payload;
  const functionId = payload?.function?.split("::");
  if (transaction.type !== "user_transaction" || transaction.hash?.toLowerCase() !== hash ||
      canonicalAptosAddress(transaction.sender) !== args.wallet || typeof transaction.success !== "boolean" ||
      aptosU64(transaction.version, "receipt version") <= BigInt(args.bondHeight) ||
      payload?.type !== "entry_function_payload" || functionId?.length !== 3 || canonicalAptosAddress(functionId[0]) !== canonicalAptosAddress("0x1") ||
      functionId[1] !== "delegation_pool" || functionId[2] !== "unlock" || !Array.isArray(payload.type_arguments) || payload.type_arguments.length !== 0 ||
      payload.arguments?.length !== 2 || canonicalAptosAddress(payload.arguments[0]) !== canonicalAptosAddress(args.pool) ||
      aptosU64(payload.arguments[1], "unlock amount") <= 0n) throw new Error("Aptos receipt does not unlock this wallet's exact delegation pool after the native bond");
  if (!transaction.success) return { hash, status: "reverted" };
  const actions = decodeAptosDelegationActions(transaction).filter(action => action.kind === "unlock" &&
    action.delegator === args.wallet && action.pool === canonicalAptosAddress(args.pool));
  if (actions.length !== 1 || !await aptosUnbondSnapshot(base, actions[0]!)) {
    throw new Error("Aptos receipt does not prove a complete historical position unlock");
  }
  return { hash, status: "settled" };
}
