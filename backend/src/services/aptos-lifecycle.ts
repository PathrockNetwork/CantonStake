import type { AptosDelegationAction } from "./aptos-events.js";

const MAX_U64 = (1n << 64n) - 1n;

export function aptosU64(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value) || BigInt(value) > MAX_U64) {
    throw new Error(`Invalid Aptos ${label}`);
  }
  return BigInt(value);
}

/** Historical settlement reads must never silently fall back to latest state. */
export async function aptosViewAtVersion(base: string, fn: string, args: string[], version: bigint): Promise<unknown[]> {
  if (version < 0n || version > MAX_U64) throw new Error("Invalid Aptos ledger version");
  const response = await fetch(`${base.replace(/\/$/, "")}/v1/view?ledger_version=${version}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ function: fn, type_arguments: [], arguments: args }),
  });
  if (!response.ok) {
    const hint = response.status === 410 ? "; use a fullnode retaining this ledger version" : "";
    throw new Error(`Aptos view ${fn} at version ${version} returned ${response.status}${hint}`);
  }
  const result: unknown = await response.json();
  if (!Array.isArray(result)) throw new Error(`Aptos view ${fn} returned invalid data`);
  return result;
}

export function parseAptosDelegationStake(values: unknown): { active: bigint; inactive: bigint; pendingInactive: bigint } {
  if (!Array.isArray(values) || values.length !== 3) throw new Error("Invalid Aptos delegation stake");
  return {
    active: aptosU64(values[0], "active stake"),
    inactive: aptosU64(values[1], "inactive stake"),
    pendingInactive: aptosU64(values[2], "pending inactive stake"),
  };
}

export type AptosUnbondSnapshot = { amountOcta: bigint; readyAt: Date };

export function aptosActionAfterPositionStart(action: AptosDelegationAction, bondedAt: unknown, unbondingStartedAt?: Date | null): boolean {
  if (typeof bondedAt !== "string") return false;
  const startedAt = Date.parse(bondedAt);
  return Number.isFinite(startedAt) && action.timestamp.getTime() >= startedAt &&
    (!unbondingStartedAt || action.timestamp >= unbondingStartedAt);
}

export async function aptosUnbondSnapshot(base: string, action: AptosDelegationAction): Promise<AptosUnbondSnapshot | null> {
  const stake = parseAptosDelegationStake(await aptosViewAtVersion(base,
    "0x1::delegation_pool::get_stake", [action.pool, action.delegator], action.version));
  // Canton tracks a whole wallet/pool position. Partial external unlocks
  // must not mark the entire position unbonding while active stake remains.
  const amountOcta = stake.inactive + stake.pendingInactive;
  if (stake.active > 0n || amountOcta === 0n) return null;
  const lockup = await aptosViewAtVersion(base, "0x1::stake::get_lockup_secs", [action.pool], action.version);
  if (lockup.length !== 1) throw new Error("Invalid Aptos lockup view");
  const expiresAt = aptosU64(lockup[0], "lockup expiration");
  const observedAt = BigInt(Math.floor(action.timestamp.getTime() / 1000));
  const readyAt = new Date(Number((expiresAt > observedAt ? expiresAt : observedAt) * 1000n));
  if (!Number.isFinite(readyAt.getTime())) throw new Error("Invalid Aptos lockup date");
  return { amountOcta, readyAt };
}

export async function aptosWithdrawalCompletesPosition(base: string, action: AptosDelegationAction): Promise<boolean> {
  const stake = parseAptosDelegationStake(await aptosViewAtVersion(base,
    "0x1::delegation_pool::get_stake", [action.pool, action.delegator], action.version));
  return stake.active === 0n && stake.inactive === 0n && stake.pendingInactive === 0n;
}
