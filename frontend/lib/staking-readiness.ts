import type { CantonReadiness } from "./api";

/** A cached success must not hide a failed refresh or a different deployment. */
export function isCantonReadyForStaking(
  readiness: CantonReadiness | undefined,
  mode: "testnet" | "mainnet",
  failed = false,
  chain?: string,
): boolean {
  if (process.env.NEXT_PUBLIC_LOOP_STAKING_FLOW === "external" &&
      (mode !== "testnet" || readiness?.loopStaking?.status !== "ready" ||
        (chain !== undefined && (!Array.isArray(readiness.loopStaking.supportedChains) ||
          !readiness.loopStaking.supportedChains.includes(chain))))) return false;
  return !failed && readiness?.status === "ready" && readiness.canton === "reachable"
    && readiness.networkMode === mode;
}
