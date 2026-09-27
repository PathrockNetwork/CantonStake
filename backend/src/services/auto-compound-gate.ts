// A route belongs here only after its wallet authorization and full native
// lifecycle are implemented and validated. An operator flag alone must not
// activate the experimental keeper executors.
const VERIFIED_COMPOUND_CHAINS: readonly string[] = [];

export type AutoCompoundStatus = {
  status: "disabled" | "unavailable" | "ready";
  executionEnabled: boolean;
  supportedChains: string[];
  reason: string | null;
};

export function autoCompoundStatus(disabled: boolean): AutoCompoundStatus {
  const supportedChains = [...VERIFIED_COMPOUND_CHAINS];
  if (disabled) return { status: "disabled", executionEnabled: false, supportedChains,
    reason: "Auto-compound is disabled for this deployment." };
  if (supportedChains.length === 0) return { status: "unavailable", executionEnabled: false, supportedChains,
    reason: "Auto-compound is not available yet; no route has completed authorization and lifecycle validation." };
  return { status: "ready", executionEnabled: true, supportedChains, reason: null };
}

/** Existing BullMQ jobs can survive a configuration change. Check actual
 * availability at execution time as well as before scheduling new jobs. */
export async function runAutoCompoundTickIfEnabled(
  disabled: boolean,
  execute: () => Promise<void>,
): Promise<void> {
  if (!autoCompoundStatus(disabled).executionEnabled) return;
  await execute();
}
