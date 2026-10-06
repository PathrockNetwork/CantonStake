/** Exact Daml Decimal (Numeric 10) arithmetic as scaled bigints; never via JS numbers. */
const SCALE = 10n ** 10n;
const NUMERIC10 = /^(?:0|[1-9]\d{0,27})(?:\.\d{1,10})?$/;

export function toUnits(value: string): bigint {
  if (!NUMERIC10.test(value)) throw new Error(`Not an exact nonnegative Daml Decimal: ${value}`);
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * SCALE + BigInt(fraction.padEnd(10, "0"));
}

/** Ten fractional digits by default (ledger form); `trim` drops trailing zeros for display. */
export function fromUnits(units: bigint, { trim = false } = {}): string {
  const fraction = (units % SCALE).toString().padStart(10, "0");
  const shown = trim ? fraction.replace(/0+$/, "") : fraction;
  return shown ? `${units / SCALE}.${shown}` : `${units / SCALE}`;
}
