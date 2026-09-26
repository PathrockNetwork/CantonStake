/** Existing BullMQ jobs can survive a configuration change. Disabled must
 * prevent execution too, not just scheduling of new jobs. */
export async function runAutoCompoundTickIfEnabled(
  disabled: boolean,
  execute: () => Promise<void>,
): Promise<void> {
  if (disabled) return;
  await execute();
}
