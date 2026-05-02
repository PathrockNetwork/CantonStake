export type DonutSlice = {
  id: string;
  value: number;
  color: string;
  label: string;
  sub?: string;
};

type DonutChartProps = {
  slices: DonutSlice[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerSub?: string;
};

export function DonutChart({
  slices,
  size = 180,
  strokeWidth = 28,
  centerLabel,
  centerSub,
}: DonutChartProps) {
  const safeSlices = slices.filter((slice) => slice.value > 0);
  const total = safeSlices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
      <circle
        cx={center}
        cy={center}
        r={radius}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-ink-800"
        fill="none"
      />
      {total > 0 &&
        safeSlices.map((slice) => {
          const arcLength = (slice.value / total) * circumference;
          const dashOffset = -offset;
          offset += arcLength;

          return (
            <circle
              key={slice.id}
              cx={center}
              cy={center}
              r={radius}
              stroke={slice.color}
              strokeWidth={strokeWidth}
              fill="none"
              strokeDasharray={`${arcLength} ${circumference - arcLength}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${center} ${center})`}
            />
          );
        })}
      {centerLabel && (
        <text
          x={center}
          y={centerSub ? center - 5 : center}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-ink-100 font-mono text-sm font-semibold"
        >
          {centerLabel}
        </text>
      )}
      {centerSub && (
        <text
          x={center}
          y={center + 16}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-ink-400 font-mono text-[10px]"
        >
          {centerSub}
        </text>
      )}
    </svg>
  );
}
