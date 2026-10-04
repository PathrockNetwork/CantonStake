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
