/** Share concurrent reads for the same key, without retaining resolved values. */
export function createSingleFlight<K, V>() {
  const pending = new Map<K, Promise<V>>();
  return (key: K, read: () => Promise<V>): Promise<V> => {
    const existing = pending.get(key);
    if (existing) return existing;
    const result = Promise.resolve().then(read).finally(() => pending.delete(key));
    pending.set(key, result);
    return result;
  };
}
