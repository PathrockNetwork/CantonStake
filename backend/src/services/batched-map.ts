/** Bound read bursts against shared RPCs. Results retain input order and a
 * failed batch prevents later batches from starting; errors are not hidden. */
export async function mapInBatches<T, R>(
  values: readonly T[],
  size: number,
  map: (value: T, index: number) => Promise<R>,
  pauseBetweenBatches?: () => Promise<void>,
): Promise<R[]> {
  if (!Number.isSafeInteger(size) || size < 1) throw new RangeError("Batch size must be a positive integer");
  const result: R[] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    if (offset > 0) await pauseBetweenBatches?.();
    result.push(...await Promise.all(values.slice(offset, offset + size).map((value, index) => map(value, offset + index))));
  }
  return result;
}
