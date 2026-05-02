"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { BeneficiarySplit } from "@/components/BeneficiarySplit";
import { Card } from "@/components/Card";
import { useLoopWallet } from "@/lib/loop-wallet";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_FAKE_POSITIONS === "true";

type CopyKey = "party" | "address";

function short(value: string, head = 12, tail = 6) {
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function LinkIcon() {
  return (
    <svg className="h-4 w-4 text-neon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.6 4.5 8 3.1a3 3 0 1 1 4.2 4.2l-1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="m9.4 11.5-1.4 1.4a3 3 0 0 1-4.2-4.2l1.5-1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="m6.5 9.5 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="h-4 w-4 text-neon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.2 13 4v3.2c0 3-1.9 5.2-5 6.6-3.1-1.4-5-3.6-5-6.6V4l5-1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.2 5.2h6.1v7.1H5.2z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.2 10.4V3.7h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function CopyValue({
  value,
  empty,
  copied,
  onCopy,
}: {
  value: string | null | undefined;
  empty: string;
  copied: boolean;
  onCopy: () => void;
}) {
  if (!value) {
    return <div className="font-mono text-sm text-ink-500">{empty}</div>;
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate font-mono text-sm text-ink-100" title={value}>
        {short(value)}
      </span>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-ink-700 text-ink-400 transition-colors hover:border-neon/50 hover:text-neon"
        aria-label="Copy value"
        title={copied ? "Copied" : "Copy"}
      >
        <CopyIcon />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { address, connector } = useAccount();
  const { partyId } = useLoopWallet();
  const [copied, setCopied] = useState<CopyKey | null>(null);

  async function copyValue(key: CopyKey, value?: string | null) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1200);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 py-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-3">
            <p className="font-mono text-xxs uppercase tracking-widest text-amber-bright">
              SETTINGS
            </p>
            {DEMO_MODE && (
              <span className="rounded-full border border-amber/30 bg-amber/10 px-2 py-0.5 font-mono text-xxs uppercase tracking-widest text-amber-bright">
                DEMO MODE
              </span>
            )}
          </div>
          <h1 className="font-display text-5xl">Account & preferences</h1>
        </div>
      </header>

      <Card padding={28} className="space-y-6">
        <div>
          <h2 className="font-display text-2xl">Identity</h2>
          <p className="mt-1 text-sm text-ink-400">
            Loop hosts your Canton party. Ledger signs your staking transactions.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-sm border border-ink-700 bg-ink-900/50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <LinkIcon />
              <span className="font-mono text-xxs uppercase tracking-widest text-ink-400">
                LOOP PARTY
              </span>
            </div>
            <CopyValue
              value={partyId}
              empty="Loop not connected"
              copied={copied === "party"}
              onCopy={() => void copyValue("party", partyId)}
            />
            <div className="mt-2 font-mono text-xxs text-ink-500">
              FiveNorth Super Validator
            </div>
          </div>

          <div className="rounded-sm border border-ink-700 bg-ink-900/50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <ShieldIcon />
              <span className="font-mono text-xxs uppercase tracking-widest text-ink-400">
                LEDGER ADDRESS
              </span>
            </div>
            <CopyValue
              value={address}
              empty="EVM wallet not connected"
              copied={copied === "address"}
              onCopy={() => void copyValue("address", address)}
            />
            <div className="mt-2 font-mono text-xxs text-ink-500">
              {address ? `${connector?.name ?? "Nano X"} - Ethereum 1.10.4` : "Connect an EVM wallet"}
            </div>
          </div>
        </div>
      </Card>

      <Card padding={28} className="space-y-6">
        <div>
          <h2 className="font-display text-2xl">Beneficiary split</h2>
          <p className="mt-1 text-sm text-ink-400">
            How CC rewards are distributed. Sums to 1.0 (audited via Daml).
          </p>
        </div>
        <BeneficiarySplit userPct={0.75} treasuryPct={0.25} showCopy={false} />
      </Card>
    </div>
  );
}
