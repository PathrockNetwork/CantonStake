type AreaSparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
};

function pointsFor(data: number[], width: number, height: number) {
  if (data.length <= 1) {
    const y = height / 2;
    return [
      { x: 0, y },
      { x: width, y },
    ];
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;

  return data.map((value, index) => ({
    x: (index / (data.length - 1)) * width,
    y: height - ((value - min) / span) * height,
  }));
}

export function AreaSparkline({
  data,
  width = 640,
  height = 120,
  color = "currentColor",
  className = "",
}: AreaSparklineProps) {
  const points = pointsFor(data, width, height);
  const polyline = points
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
  const areaPath = [
    `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`,
    ...points.slice(1).map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
    `L ${width} ${height}`,
    `L 0 ${height}`,
    "Z",
  ].join(" ");

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <path d={areaPath} fill={color} fillOpacity="0.14" />
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
    </svg>
  );
}
