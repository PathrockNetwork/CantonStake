/** Parse a user-entered 18-decimal stake without rounding fractional units. */
export function stakeAmountWei(value: string): bigint | null {
  if (!/^\d+(\.\d{0,18})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
  return amount > 0n ? amount : null;
}
