"use client";

import { useState } from "react";

type LoopWalletPillProps = {
  partyId: string;
  ccBalance: number | null;
  onDisconnect: () => void;
};

function truncateParty(partyId: string) {
  const parts = partyId.split("::");
  if (parts.length >= 2) return `${parts[0]}::${parts[1].slice(0, 8)}...`;
  return `${partyId.slice(0, 10)}...`;
}

export function LoopWalletPill({ partyId, ccBalance, onDisconnect }: LoopWalletPillProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="hairline flex items-center gap-2 rounded-full py-1 pl-1 pr-3 font-mono text-xs text-ink-300 transition-colors hover:text-ink-100"
        title={`Loop: ${partyId}`}
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-neon to-cc text-[11px] font-bold text-neon-text">
          {partyId[0]?.toUpperCase() ?? "L"}
        </span>
        <span>{truncateParty(partyId)}</span>
        {ccBalance !== null && (
          <span className="ml-1 text-cc">{ccBalance.toFixed(2)} CC</span>
        )}
        <svg className="h-3 w-3 text-ink-400" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 rounded-sm border border-ink-700 bg-ink-900 shadow-lg">
          <div className="border-b border-ink-700 px-4 py-3">
            <div className="font-mono text-xxs uppercase tracking-widest text-ink-400">
              Loop party
            </div>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(partyId)}
              className="mt-2 break-all text-left font-mono text-xs text-ink-200 hover:text-neon"
            >
              {partyId}
            </button>
          </div>
          <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3 font-mono text-xs">
            <span className="text-ink-400">CC balance</span>
            <span className="text-cc">
              {ccBalance !== null ? ccBalance.toFixed(4) : "0.0000"} CC
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onDisconnect();
            }}
            className="w-full px-4 py-3 text-left font-mono text-xs uppercase tracking-wider text-ink-300 hover:bg-ink-800 hover:text-ink-100"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
