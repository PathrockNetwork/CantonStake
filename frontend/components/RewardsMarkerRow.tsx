type RewardsMarkerRowProps = {
  event: string;
  description: string;
  count: number;
  cipRef: string;
  triggered: boolean;
  excluded?: boolean;
};

export function RewardsMarkerRow({
  event,
  description,
  count,
  cipRef,
  triggered,
  excluded = false,
}: RewardsMarkerRowProps) {
  return (
    <div
      className={`grid grid-cols-12 gap-4 items-center px-6 py-5 ${
        excluded ? "opacity-40" : ""
      }`}
    >
      <div className="col-span-3">
        <div className="font-display text-2xl">{event}</div>
        <div className="font-mono text-xxs text-ink-400 mt-1">{description}</div>
      </div>
      <div className="col-span-4 font-mono text-xxs uppercase tracking-wider text-ink-300">
        {cipRef}
      </div>
      <div className="col-span-3">
        {excluded ? (
          <span className="chip chip-dot text-ink-500 border-transparent">
            excluded
          </span>
        ) : triggered ? (
          <span className="chip chip-dot text-amber-bright border-transparent">
            emitted
          </span>
        ) : (
          <span className="chip chip-dot text-ink-400 border-transparent">
            pending
          </span>
        )}
      </div>
      <div className="col-span-2 text-right font-mono tabular text-2xl">
        {excluded ? "—" : count}
      </div>
    </div>
  );
}
