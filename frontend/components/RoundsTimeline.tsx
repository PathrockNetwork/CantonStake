"use client";

import type { RewardEventRow } from "@/lib/api/contracts";
import { useCcRound } from "@/lib/use-cc-round";

type RoundsTimelineProps = {
  events: RewardEventRow[];
  userCcEta?: number;
};

function formatCc(value: number) {
  return value.toFixed(3);
}

function formatTime(ts: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

export function RoundsTimeline({ events, userCcEta = 0 }: RoundsTimelineProps) {
  const { formatted } = useCcRound();
  const eta = userCcEta > 0 ? `+${userCcEta.toFixed(3)} CC` : "+0 CC";
  const grid = "grid grid-cols-[110px_1fr_90px_110px_110px] items-center gap-3";

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div
          className={`${grid} px-5 py-3 font-mono text-xxs uppercase tracking-widest text-ink-400`}
        >
          <div>Round</div>
          <div>Time &middot; activity</div>
          <div className="text-right">Treasury</div>
          <div className="text-right">Your CC</div>
          <div className="text-right">Status</div>
        </div>

        <div className={`${grid} border-b border-ink-700 bg-neon/10 px-5 py-4`}>
          <div className="font-mono text-xs font-semibold tracking-wider text-neon">
            NEXT &middot; {formatted}
          </div>
          <div className="font-mono text-xs text-ink-300">
            accumulating activity weight&hellip;
          </div>
          <div className="text-right font-mono text-xs text-ink-400">&mdash;</div>
          <div className="text-right font-mono text-xs text-ink-400">&mdash;</div>
          <div className="text-right font-mono text-xs font-semibold text-cc">
            {eta}
          </div>
        </div>

        {events.length === 0 ? (
          <div className="border-b border-ink-700 px-5 py-6 font-mono text-xs text-ink-400">
            Awaiting next round &mdash; rewards will appear here as RewardEvent rows are written.
          </div>
        ) : (
          events.map((event) => (
            <div
              key={`${event.round}-${event.ts}`}
              className={`${grid} border-b border-ink-700 px-5 py-4 font-mono text-xs tabular transition-colors hover:bg-ink-800/40`}
            >
              <div className="text-ink-300">#{event.round.toLocaleString()}</div>
              <div className="text-ink-400">
                {formatTime(event.ts)}
                <span className="ml-3 text-ink-500">
                  &middot; {event.txns ?? 1} activity events
                </span>
              </div>
              <div className="text-right text-ink-300">{formatCc(event.ccTreasury)}</div>
              <div className="text-right font-semibold text-cc">
                +{formatCc(event.ccUser)} CC
              </div>
              <div className="text-right">
                <span className="chip chip-dot border-transparent text-neon">
                  DELIVERED
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
