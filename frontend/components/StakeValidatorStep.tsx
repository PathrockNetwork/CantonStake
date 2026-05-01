"use client";

import type { ValidatorRow } from "@/lib/validators";

type StakeValidatorStepProps = {
  validators: ValidatorRow[];
  selected?: ValidatorRow | null;
  onSelect: (validator: ValidatorRow) => void;
  onBack: () => void;
};

function short(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

export function StakeValidatorStep({
  validators,
  selected,
  onSelect,
  onBack,
}: StakeValidatorStepProps) {
  if (validators.length === 0) {
    return (
      <div className="space-y-5">
        <div className="hairline p-5 text-sm text-ink-300">
          No validators configured for this chain yet.
        </div>
        <button
          type="button"
          onClick={onBack}
          className="font-mono text-xs uppercase tracking-wider text-ink-400 hover:text-ink-100"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {validators.map((item) => (
          <button
            key={item.address}
            type="button"
            onClick={() => onSelect(item)}
            className={`w-full border p-4 text-left transition-colors ${
              selected?.address === item.address
                ? "border-neon bg-neon/10"
                : "border-ink-700 bg-ink-900/40 hover:bg-ink-800/40"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-100">
                  {item.name}
                  {item.recommended && (
                    <span className="chip border-transparent text-neon">
                      RECOMMENDED
                    </span>
                  )}
                </div>
                <div className="mt-1 font-mono text-xxs text-ink-400">
                  {short(item.address)} · APR {item.apr.toFixed(1)}%
                </div>
              </div>
              <div className="text-right font-mono text-xxs text-ink-300">
                <div>{item.commission}% commission</div>
                <div className="mt-1 text-neon">{item.uptime.toFixed(2)}% uptime</div>
              </div>
            </div>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onBack}
        className="font-mono text-xs uppercase tracking-wider text-ink-400 hover:text-ink-100"
      >
        Back
      </button>
    </div>
  );
}
