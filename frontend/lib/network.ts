/**
 * Deployment network mode — must mirror the backend's NETWORK_MODE env.
 *
 * One deployment serves one mode (baked at build time via
 * NEXT_PUBLIC_NETWORK_MODE, default testnet). The backend is the source of
 * truth at runtime (/api/health.networkMode) — if the two ever disagree the
 * UI shows the backend's value (see SystemStatus), because the backend is
 * what settles transactions.
 */
export const networkMode =
  process.env.NEXT_PUBLIC_NETWORK_MODE === "mainnet" ? "mainnet" : "testnet";

export const isMainnet = networkMode === "mainnet";
