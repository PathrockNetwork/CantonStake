"use client";

import { Card } from "@/components/Card";
import { useCcRound } from "@/lib/use-cc-round";

type CCRoundTickerProps = { compact?: boolean };

export function CCRoundTicker({ compact = false }: CCRoundTickerProps) {
  const { formatted, progress } = useCcRound();
  const radius = compact ? 18 : 26;
  const stroke = compact ? 3 : 4;
  const size = radius * 2 + stroke * 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  return (
    <Card
      padding={compact ? 8 : 12}
      className={`rounded-sm ${compact ? "gap-2" : "gap-4"} flex items-center`}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} aria-hidden>
          <circle
            className="text-ink-700"
            cx={radius + stroke}
            cy={radius + stroke}
            r={radius}
            stroke="currentColor"
            strokeWidth={stroke}
            fill="none"
          />
          <circle
            className="text-amber-bright"
            cx={radius + stroke}
            cy={radius + stroke}
            r={radius}
            stroke="currentColor"
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            fill="none"
            transform={`rotate(-90 ${radius + stroke} ${radius + stroke})`}
            style={{ transition: "stroke-dashoffset 1s linear" }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center font-mono text-xxs text-ink-400">
          CC
        </div>
      </div>
      <div>
        <div className="font-mono text-xxs uppercase tracking-widest text-ink-400">
          NEXT CC ROUND IN
        </div>
        <div
          className={`font-mono tabular font-semibold text-amber-bright ${
            compact ? "text-base" : "text-xl"
          }`}
        >
          {formatted}
        </div>
      </div>
    </Card>
  );
}
