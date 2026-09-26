/**
 * Deployment network mode — must mirror the backend's NETWORK_MODE env.
 *
 * One deployment serves one mode (baked at build time via
 * NEXT_PUBLIC_NETWORK_MODE, default testnet). The backend is the source of
 * truth at runtime (/api/watchers.networkMode). If the two disagree, the
 * stake page blocks signing and the backend rejects the request; displaying
 * the backend's value alone cannot protect against a stale frontend image.
 */
export const networkMode =
  process.env.NEXT_PUBLIC_NETWORK_MODE === "mainnet" ? "mainnet" : "testnet";

export const isMainnet = networkMode === "mainnet";
