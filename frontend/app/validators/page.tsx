"use client";

import { useState } from "react";
import { Card } from "@/components/Card";
import { ChainBadge } from "@/components/ChainBadge";
import { EmptyState } from "@/components/EmptyState";
import { StakeFlowModal } from "@/components/StakeFlowModal";
import { StatusDot } from "@/components/StatusDot";
import { chainById, type ChainConfig } from "@/lib/chains";
import { validatorsForChain } from "@/lib/validators";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_FAKE_POSITIONS === "true";
const VISIBLE_CHAINS = ["polygon", "moonbeam", "monad"] as const;

type VisibleChainId = (typeof VISIBLE_CHAINS)[number];

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function validatorBadge(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function activeTabStyle(chain: ChainConfig) {
  return {
    backgroundColor: `${chain.color}26`,
    borderColor: `${chain.color}4d`,
  };
}

export default function ValidatorsPage() {
  const [activeChainId, setActiveChainId] = useState<VisibleChainId>("polygon");
  const [selected, setSelected] = useState<{
    chainId: VisibleChainId;
    validator: `0x${string}`;
  } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const visibleIds: VisibleChainId[] = DEMO_MODE ? [...VISIBLE_CHAINS] : ["polygon"];
  const visibleChains = visibleIds
    .map((id) => ({ id, chain: chainById(id) }))
    .filter((item): item is { id: VisibleChainId; chain: ChainConfig } => Boolean(item.chain));
  const activeChain = chainById(activeChainId) ?? chainById("polygon")!;
  const validators = validatorsForChain(activeChainId);

  function onDelegate(address: `0x${string}`) {
    if (activeChain.phase !== "live") {
      window.alert(`Demo mode: ${activeChain.name} staking goes live in Phase 2`);
      return;
    }
    setSelected({ chainId: activeChainId, validator: address });
    setModalOpen(true);
  }

  return (
    <div className="space-y-8 py-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-3">
            <p className="font-mono text-xxs uppercase tracking-widest text-amber-bright">
              VALIDATORS
            </p>
            {DEMO_MODE && (
              <span className="rounded-full border border-amber/30 bg-amber/10 px-2 py-0.5 font-mono text-xxs uppercase tracking-widest text-amber-bright">
                DEMO MODE
              </span>
            )}
          </div>
          <h1 className="font-display text-5xl">Browse validators</h1>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {visibleChains.map(({ id, chain }) => {
          const active = id === activeChainId;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => setActiveChainId(id)}
              className={`flex items-center gap-2 rounded-full border px-3 py-2 transition-colors ${
                active
                  ? "text-ink-100"
                  : "border-ink-700 text-ink-300 hover:text-ink-100"
              }`}
              style={active ? activeTabStyle(chain) : undefined}
            >
              <ChainBadge chain={chain} className="[&>span:first-child]:h-5 [&>span:first-child]:w-5 [&>span:first-child]:text-[8px] [&>span:last-child]:text-xxs" />
              <span className="font-mono text-xs uppercase tracking-wider">
                {chain.name}
              </span>
            </button>
          );
        })}
      </div>

      {validators.length === 0 ? (
        <EmptyState
          title="No validators configured"
          body="No validators configured for this chain yet."
        />
      ) : (
        <Card padding={0} className="overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[40px_1.5fr_1fr_0.7fr_0.7fr_0.8fr_120px] gap-3 border-b border-ink-700 px-5 py-3 font-mono text-xxs uppercase tracking-widest text-ink-400">
                <div>#</div>
                <div>Validator</div>
                <div>Total stake</div>
                <div>Commission</div>
                <div>Uptime</div>
                <div>Status</div>
                <div />
              </div>
              {validators.map((validator, index) => (
                <div
                  key={`${activeChainId}-${validator.address}`}
                  className="grid grid-cols-[40px_1.5fr_1fr_0.7fr_0.7fr_0.8fr_120px] items-center gap-3 border-b border-ink-700 px-5 py-4 text-sm transition-colors last:border-b-0 hover:bg-ink-800/30"
                >
                  <div className="font-mono text-xs text-ink-400">
                    {(index + 1).toString().padStart(2, "0")}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="grid h-8 w-8 place-items-center rounded-sm border border-ink-700 bg-ink-900 font-mono text-[11px] font-semibold text-ink-100">
                      {validatorBadge(validator.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-medium text-ink-100">
                        <span>{validator.name}</span>
                        {validator.recommended && (
                          <span className="rounded-full border border-neon/30 bg-neon/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-neon">
                            REC
                          </span>
                        )}
                      </div>
                      <div className="mt-1 font-mono text-xxs text-ink-400">
                        {shortAddress(validator.address)}
                      </div>
                    </div>
                  </div>
                  <div className="font-mono text-xs text-ink-200">
                    {validator.totalStaked ?? "-"}
                  </div>
                  <div className="font-mono text-xs text-ink-200">
                    {validator.commission}%
                  </div>
                  <div
                    className={`font-mono text-xs ${
                      validator.uptime >= 99.95 ? "text-neon" : "text-ink-200"
                    }`}
                  >
                    {validator.uptime.toFixed(2)}%
                  </div>
                  <div className="flex items-center gap-2 font-mono text-xs text-ink-300">
                    <StatusDot status="active" />
                    active
                  </div>
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => onDelegate(validator.address)}
                      className="bg-neon px-4 py-2 font-mono text-xxs font-semibold uppercase tracking-wider text-neon-text transition-colors hover:bg-neon/90"
                    >
                      Delegate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      <StakeFlowModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        presetChain={selected?.chainId}
        presetValidator={selected?.validator}
      />
    </div>
  );
}
