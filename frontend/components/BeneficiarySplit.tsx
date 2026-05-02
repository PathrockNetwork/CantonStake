type BeneficiarySplitProps = {
  userPct: number;
  treasuryPct: number;
  showCopy?: boolean;
};

function pct(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function BeneficiarySplit({
  userPct,
  treasuryPct,
  showCopy = true,
}: BeneficiarySplitProps) {
  const user = pct(userPct);
  const treasury = pct(treasuryPct);

  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-ink-800">
        <div className="bg-neon transition-all" style={{ width: `${user * 100}%` }} />
        <div className="bg-cc transition-all" style={{ width: `${treasury * 100}%` }} />
      </div>
      <div className="mt-3 flex justify-between gap-4 font-mono text-xxs uppercase tracking-wider text-ink-400">
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-neon" aria-hidden="true" />
          {Math.round(user * 100)}% your Loop wallet
        </span>
        <span className="inline-flex items-center gap-2 text-right">
          <span className="h-2 w-2 rounded-full bg-cc" aria-hidden="true" />
          {Math.round(treasury * 100)}% app treasury
        </span>
      </div>
      {showCopy && (
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-ink-300">
          The split is defined in the Daml contract itself - not by a backend
          process. Each FeaturedAppActivityMarker carries two
          AppRewardBeneficiary entries whose weights sum to 1.0. Super
          Validator automation handles the coupon conversion trustlessly.
        </p>
      )}
    </div>
  );
}
