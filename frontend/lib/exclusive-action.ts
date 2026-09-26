/** One wallet flow at a time, including the interval before React renders a
 * disabled button. A rejected prompt always releases the action for retry. */
export function createExclusiveAction() {
  let pending = false;
  return async function run<T>(execute: () => Promise<T>): Promise<T | undefined> {
    if (pending) return;
    pending = true;
    try {
      return await execute();
    } finally {
      pending = false;
    }
  };
}
