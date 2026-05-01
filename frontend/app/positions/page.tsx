"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { MultiChainRoadmap } from "@/components/MultiChainRoadmap";
import { PositionDashboardRow } from "@/components/PositionDashboardRow";
import { StatCell } from "@/components/StatCell";
import { StatusDot } from "@/components/StatusDot";
import { fetchPositions } from "@/lib/api";
import { polygonChain } from "@/lib/chains";

const POL_PRICE_USD = 0.42;
const statusStyles: Record<string, string> = {
  Pending: "text-ink-300",
  Bonded: "text-success",
  Unbonding: "text-warning",
  Released: "text-ink-400",
  Cancelled: "text-danger",
};

export default function PositionsPage() {
  const { address, isConnected } = useAccount();
  const polygon = polygonChain();

  const {
    data: positions,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["positions", address],
    queryFn: () => (address ? fetchPositions(address) : Promise.resolve([])),
    enabled: !!address,
    refetchInterval: 5000,
  });

  const totalBonded =
    positions
      ?.filter((p) => p.argument.status === "Bonded")
      .reduce((sum, p) => sum + Number(p.argument.amountPol), 0) ?? 0;
  const totalMarkers =
    positions?.reduce((sum, p) => sum + p.argument.markersEmitted, 0) ?? 0;
  const activeValidators = positions && positions.length > 0 ? 1 : 0;

  return (
    <div className="space-y-12 py-8">
      <header>
        <p className="font-mono text-xxs uppercase tracking-widest text-amber-bright mb-4">
          § 02 · positions
        </p>
        <h1 className="font-display text-5xl mb-3">Your delegations</h1>
        <p className="text-ink-300">
          Source of truth is the Canton ledger. Polygon is the settlement layer.
        </p>
      </header>

      {!isConnected && (
        <Card padding={32} className="text-center text-ink-300 font-mono text-sm">
          connect your wallet to view positions
        </Card>
      )}

      {isConnected && isLoading && (
        <Card padding={32} className="text-center text-ink-400 font-mono text-sm">
          loading positions...
        </Card>
      )}

      {isConnected && positions && (
        <>
          <Card padding={0} className="overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-b border-ink-700 px-5 py-4">
              <div>
                <div className="mb-2 flex items-center gap-2 font-mono text-xxs uppercase tracking-widest text-ink-400">
                  <StatusDot status="active" />
                  <span>ACTIVE LEDGER · CANTON</span>
                </div>
                <h2 className="font-display text-2xl">Your delegations</h2>
              </div>
              {/* slot: B3 user-switcher dropdown */}
              <div data-slot="user-switcher" />
            </div>
          </Card>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCell
              caption="Total bonded"
              value={`${totalBonded.toFixed(4)} ${polygon.symbol}`}
              subtitle={`${(totalBonded * POL_PRICE_USD).toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 2,
              })}`}
              accent="neon"
              padding={22}
            />
            <StatCell
              caption="Total markers"
              value={totalMarkers.toString()}
              subtitle={`across ${positions.length} positions`}
              padding={22}
            />
            <StatCell
              caption="Active validators"
              value={activeValidators.toString()}
              subtitle="delegated via orchestrator"
              padding={22}
            />
          </section>

          {positions.length === 0 ? (
            <EmptyState
              title="No positions yet"
              body="No positions yet — head to /stake to create your first delegation."
              actionHref="/stake"
              actionLabel="Open stake flow"
            />
          ) : (
            <Card padding={0} className="overflow-hidden">
              <div className="overflow-x-auto">
                <div className="min-w-[940px]">
                  <div className="grid grid-cols-[1.2fr_0.8fr_0.7fr_0.9fr_1.1fr_1.3fr] gap-3 border-b border-ink-700 px-5 py-3 font-mono text-xxs uppercase tracking-widest text-ink-400">
                    <div>Chain · Status</div>
                    <div>Amount</div>
                    <div>Markers</div>
                    <div>Bonded since</div>
                    <div>Status timeline</div>
                    <div className="text-right">Actions</div>
                  </div>
                  {positions.map((position) => (
                    <PositionDashboardRow
                      key={position.contractId}
                      position={position}
                      onActed={refetch}
                      statusStyles={statusStyles}
                    />
                  ))}
                </div>
              </div>
            </Card>
          )}

          <MultiChainRoadmap />
        </>
      )}
    </div>
  );
}
