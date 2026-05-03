/**
 * Typed mirror of the design tokens defined in:
 *   - tailwind.config.ts (Tailwind theme.extend)
 *   - app/globals.css (CSS custom properties)
 *
 * Use this in inline SVG `stroke=`/`fill=` props and any place a Tailwind
 * class can't reach. Keep values byte-identical to TOKENS.md and
 * handoff/prototype/redesign/components.jsx (`const C`).
 */

export const tokens = {
  ink: {
    950: "#0a0a0b",
    900: "#111113",
    850: "#141417",
    800: "#17171a",
    700: "#1e1e22",
    600: "#2a2a30",
    500: "#3a3a42",
    400: "#6a6a75",
    300: "#9a9aa3",
    200: "#cacad0",
    100: "#e8e8ec",
  },
  neon: "#00ff9d",
  neonText: "#001a10",
  neonDim: "rgba(0,255,157,0.12)",
  neonGlow: "rgba(0,255,157,0.40)",
  cc: "#f5a623",
  ccDim: "rgba(245,166,35,0.12)",
  ccGlow: "#fbbf24",
  amber: "#d97706",
  amberBright: "#f59e0b",
  danger: "#ef4444",
  warning: "#f59e0b",
  success: "#10b981",
  hairline: "rgba(255,255,255,0.08)",
  hairlineStrong: "rgba(255,255,255,0.16)",
} as const;

export type Tokens = typeof tokens;

/** Short alias matching the prototype's `C` constant for porting fidelity. */
export const C = {
  ink950: tokens.ink[950],
  ink900: tokens.ink[900],
  ink850: tokens.ink[850],
  ink800: tokens.ink[800],
  ink700: tokens.ink[700],
  ink600: tokens.ink[600],
  ink500: tokens.ink[500],
  ink400: tokens.ink[400],
  ink300: tokens.ink[300],
  ink200: tokens.ink[200],
  ink100: tokens.ink[100],
  neon: tokens.neon,
  neonText: tokens.neonText,
  neonDim: tokens.neonDim,
  neonGlow: tokens.neonGlow,
  cc: tokens.cc,
  ccDim: tokens.ccDim,
  ccGlow: tokens.ccGlow,
  amber: tokens.amber,
  amberBright: tokens.amberBright,
  danger: tokens.danger,
  warning: tokens.warning,
  success: tokens.success,
  hairline: tokens.hairline,
  hairlineStrong: tokens.hairlineStrong,
} as const;
