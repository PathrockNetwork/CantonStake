/** Decode only transactions submitted by a delegator to Aptos's native
 * delegation-pool entry functions. Events alone are not sufficient proof:
 * the stake module emits lower-level pool events for unrelated operations.
 */
export type AptosDelegationAction = {
  kind: "stake" | "unlock" | "withdraw";
  delegator: string;
  pool: string;
  amountOcta: bigint;
  requestedOcta: bigint;
  txHash: string;
  version: bigint;
  timestamp: Date;
};

export interface AptosAccountTransaction {
  type?: string;
  version?: string;
  hash?: string;
  sender?: string;
  success?: boolean;
  sequence_number?: string;
  timestamp?: string;
  payload?: { type?: string; function?: string; arguments?: unknown[] };
  events?: Array<{ type?: string; data?: Record<string, unknown> }>;
}

export function canonicalAptosAddress(value: unknown): string | null {
  if (typeof value !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(value)) return null;
  return `0x${value.slice(2).toLowerCase().padStart(64, "0")}`;
}

function octa(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value);
  return /^\d+$/.test(raw) ? BigInt(raw) : null;
}

export function decodeAptosDelegationActions(tx: AptosAccountTransaction): AptosDelegationAction[] {
  if (tx.type !== "user_transaction" || tx.success !== true || !tx.hash || !tx.version) return [];
  const delegator = canonicalAptosAddress(tx.sender);
  if (!delegator || tx.payload?.type !== "entry_function_payload") return [];
  const fn = tx.payload.function?.toLowerCase();
  const action = fn === "0x1::delegation_pool::add_stake" ? "stake"
    : fn === "0x1::delegation_pool::unlock" ? "unlock"
    : fn === "0x1::delegation_pool::withdraw" ? "withdraw" : null;
  if (!action) return [];
  const args = tx.payload.arguments;
  if (!Array.isArray(args) || args.length !== 2) return [];
  const pool = canonicalAptosAddress(args[0]);
  const requestedOcta = octa(args[1]);
  if (!pool || !requestedOcta || requestedOcta <= 0n) return [];
  const eventName = action === "stake" ? "AddStake" : action === "unlock" ? "UnlockStake" : "WithdrawStake";
  const amountField = action === "stake" ? "amount_added" : action === "unlock" ? "amount_unlocked" : "amount_withdrawn";
  const timestampMicros = octa(tx.timestamp);
  if (!timestampMicros || timestampMicros <= 0n) return [];
  const timestamp = new Date(Number(timestampMicros / 1000n));
  if (!Number.isFinite(timestamp.getTime())) return [];
  const out: AptosDelegationAction[] = [];
  for (const event of tx.events ?? []) {
    if (event.type !== `0x1::delegation_pool::${eventName}` &&
        event.type !== `0x1::delegation_pool::${eventName}Event`) continue;
    if (canonicalAptosAddress(event.data?.pool_address) !== pool ||
        canonicalAptosAddress(event.data?.delegator_address) !== delegator) continue;
    const amountOcta = octa(event.data?.[amountField]);
    if (!amountOcta || amountOcta <= 0n) continue;
    if (action === "stake" && amountOcta !== requestedOcta) continue;
    out.push({ kind: action, delegator, pool, amountOcta, requestedOcta,
      txHash: tx.hash, version: BigInt(tx.version), timestamp });
  }
  return out;
}
