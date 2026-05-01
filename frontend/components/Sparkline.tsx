type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
};

export function Sparkline({ data, width = 96, height = 28, color = "currentColor" }: SparklineProps) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const points =
    data.length > 1
      ? data
          .map((value, index) => {
            const x = (index / (data.length - 1)) * width;
            const y = height - ((value - min) / span) * height;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
          })
          .join(" ")
      : `0,${height / 2} ${width},${height / 2}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}
