/**
 * Number formatting helpers — ported verbatim from
 * handoff/prototype/redesign/components.jsx (`fmt`, `fmtUsd`).
 *
 * Use these for tabular display values across the redesign. They accept
 * `null`/`undefined` defensively (returns `'0'` / `'$0.00'`) so a
 * still-loading query doesn't crash the render.
 */

export function fmt(value: number | null | undefined, decimals = 2): string {
  if (value == null) return "0";
  if (value === 0) return "0";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtUsd(value: number | null | undefined, decimals = 2): string {
  return "$" + fmt(value, decimals);
}

/** Compact magnitude suffix: 1.2K / 3.4M / 5.6B. Used for big stats. */
export function fmtCompact(value: number | null | undefined): string {
  if (value == null) return "0";
  const n = Number(value);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}
