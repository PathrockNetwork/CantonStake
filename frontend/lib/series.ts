export function makeActivitySeries(base: number, length = 24) {
  const floor = Math.max(base, 0.001);
  return Array.from({ length }, (_, index) => {
    const wave = 1 + Math.sin(index / 2.2) * 0.08 + index * 0.002;
    return floor * wave;
  });
}
