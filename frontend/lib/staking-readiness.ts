import type { CantonReadiness } from "./api";

/** A cached success must not hide a failed refresh or a different deployment. */
export function isCantonReadyForStaking(
  readiness: CantonReadiness | undefined,
  mode: "testnet" | "mainnet",
  failed = false,
): boolean {
  return !failed && readiness?.status === "ready" && readiness.canton === "reachable"
    && readiness.networkMode === mode;
}
