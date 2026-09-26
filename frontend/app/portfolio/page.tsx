"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Btn } from "@/components/primitives/Btn";
import { Card } from "@/components/primitives/Card";
import { Chip } from "@/components/primitives/Chip";
import { EmptyState } from "@/components/primitives/EmptyState";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { fetchPositions, type PositionRow } from "@/lib/api";
import { CHAINS } from "@/lib/chains";
import { accountChain, positionUsd } from "@/lib/account-view";
import { usePrices } from "@/lib/prices";
import { useCosmosWallet } from "@/lib/cosmos/use-cosmos-wallet";
import { useSuiWallet } from "@/lib/sui/use-sui-wallet";
import { useAptosWallet } from "@/lib/aptos/use-aptos-wallet";
import { useSolanaWallet } from "@/lib/solana/use-solana-wallet";
import { usePolkadotWallet } from "@/lib/polkadot/use-polkadot-wallet";
import { fmt, fmtUsd } from "@/lib/format";
import { tokens } from "@/lib/tokens";

/** Canton-recorded positions for every connected wallet family. The legacy
 * /api/portfolio endpoint has empty fetcher stubs for non-Polygon chains and
 * cannot represent their distinct wallet addresses. */

const CHAIN_COLOR: Record<string, string> = Object.fromEntries(
  CHAINS.map((c) => [c.id, c.color]),
);
const CHAIN_NAME: Record<string, string> = Object.fromEntries(
  CHAINS.map((c) => [c.id, c.name]),
);

function shortAddr(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}

export default function PortfolioPage() {
  const { address } = useAccount();
  const cosmos = useCosmosWallet("cosmos");
  const celestia = useCosmosWallet("celestia");
  const osmosis = useCosmosWallet("osmosis");
  const sui = useSuiWallet();
  const aptos = useAptosWallet();
  const solana = useSolanaWallet();
  const polkadot = usePolkadotWallet();
  const { data: prices } = usePrices();
  const walletAddresses = [...new Set([address, cosmos.address, celestia.address, osmosis.address,
    sui.address, aptos.address, solana.address, polkadot.address].filter((value): value is string => !!value))];
  const connected = walletAddresses.length > 0;

  const { data, dataUpdatedAt, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["portfolio-positions", ...walletAddresses],
    queryFn: async () => {
      const batches = await Promise.all(walletAddresses.map(fetchPositions));
      return [...new Map(batches.flat().map(position => [position.contractId, position])).values()];
    },
    enabled: connected,
    refetchInterval: 30_000,
  });

  if (!connected) {
    return (
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 22px 80px" }}>
        <SectionLabel>§ PORTFOLIO</SectionLabel>
        <h1
          className="display"
          style={{ fontSize: 42, margin: "4px 0 24px", color: tokens.ink[100] }}
        >
          Cross-chain portfolio.
        </h1>
        <EmptyState
          tone="warn"
          title="Connect your wallet"
          subtitle="Connect an EVM, Cosmos, Sui, Aptos, Solana, or Polkadot wallet to see its Canton-recorded positions."
        />
      </div>
    );
  }

  const positions = (data ?? []).filter((p) => p.argument.status === "Bonded" || p.argument.status === "Unbonding");
  const byChain = new Map<string, PositionRow[]>();
  for (const p of positions) {
    const chain = accountChain(p).id;
    if (!byChain.has(chain)) byChain.set(chain, []);
    byChain.get(chain)!.push(p);
  }

  const values = positions.map((position) => positionUsd(position, prices));
  const totalUsd = data && !isError && values.every((value) => value !== null)
    ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const bondedCount = positions.filter((p) => p.argument.status === "Bonded").length;
  const unbondingCount = positions.filter((p) => p.argument.status === "Unbonding").length;

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 22px 80px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 24,
        }}
      >
        <div>
          <SectionLabel>§ PORTFOLIO</SectionLabel>
          <h1
            className="display"
            style={{ fontSize: 42, margin: "4px 0 6px", color: tokens.ink[100] }}
          >
            Cross-chain portfolio.
          </h1>
          <div
            className="mono"
            style={{ fontSize: 11, color: tokens.ink[400] }}
          >
            {dataUpdatedAt
              ? `last refreshed ${new Date(dataUpdatedAt).toLocaleTimeString()}`
              : "loading…"}
          </div>
        </div>
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </Btn>
      </div>

      {/* Aggregate stat row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 1,
          background: tokens.hairline,
          marginBottom: 24,
        }}
      >
        <div style={{ background: tokens.ink[900], padding: "22px 22px" }}>
          <SectionLabel>Total value</SectionLabel>
          <div
            className="display tabular"
            style={{ fontSize: 38, color: tokens.ink[100], marginTop: 8 }}
          >
            {totalUsd === null ? "—" : fmtUsd(totalUsd, 2)}
          </div>
          <div
            className="mono"
            style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 8 }}
          >
            {totalUsd === null ? "USD unavailable for one or more assets" : `across ${byChain.size} chain${byChain.size === 1 ? "" : "s"}`}
          </div>
        </div>
        <div style={{ background: tokens.ink[900], padding: "22px 22px" }}>
          <SectionLabel>Bonded</SectionLabel>
          <div
            className="display tabular"
            style={{ fontSize: 38, color: tokens.neon, marginTop: 8 }}
          >
            {bondedCount}
          </div>
          <div
            className="mono"
            style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 8 }}
          >
            active delegations
          </div>
        </div>
        <div style={{ background: tokens.ink[900], padding: "22px 22px" }}>
          <SectionLabel>Unbonding</SectionLabel>
          <div
            className="display tabular"
            style={{
              fontSize: 38,
              color: unbondingCount > 0 ? tokens.warning : tokens.ink[100],
              marginTop: 8,
            }}
          >
            {unbondingCount}
          </div>
          <div
            className="mono"
            style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 8 }}
          >
            cooling down
          </div>
        </div>
      </div>

      {/* Per-chain breakdown */}
      <Card padding={0}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.4fr 1fr 1fr 0.8fr",
            gap: 12,
            padding: "10px 22px",
            borderBottom: `1px solid ${tokens.hairline}`,
          }}
        >
          {["Chain", "Validator", "Amount", "Status", "Source"].map((h) => (
            <SectionLabel key={h}>{h}</SectionLabel>
          ))}
        </div>

        {isLoading ? (
          <div
            className="mono"
            style={{
              padding: 40,
              textAlign: "center",
              color: tokens.ink[400],
              fontSize: 11,
            }}
          >
            loading delegations…
          </div>
        ) : isError ? (
          <div style={{ padding: 22 }}><EmptyState tone="warn" title="Portfolio unavailable" subtitle="Could not load recorded positions. Try refreshing." /></div>
        ) : positions.length === 0 ? (
          <div style={{ padding: 22 }}>
            <EmptyState
              title="No delegations yet"
              subtitle="Stake on a supported chain and your Canton-recorded position will appear here."
            />
          </div>
        ) : (
          positions.map((position) => {
            const chain = accountChain(position);
            const status = position.argument.status;
            const validator = position.chainMeta?.validatorAddress ?? position.chainMeta?.validatorShare ?? "—";
            return (
            <div
              key={position.contractId}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1.4fr 1fr 1fr 0.8fr",
                gap: 12,
                padding: "14px 22px",
                borderBottom: `1px solid ${tokens.hairline}`,
                alignItems: "center",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: CHAIN_COLOR[chain.id] ?? tokens.ink[400],
                  }}
                />
                <span
                  className="mono"
                  style={{ fontSize: 12, color: tokens.ink[100] }}
                >
                  {CHAIN_NAME[chain.id] ?? chain.name}
                </span>
              </div>
              <div
                className="mono tabular"
                style={{ fontSize: 11, color: tokens.ink[200] }}
              >
                {shortAddr(validator)}
              </div>
              <div
                className="mono tabular"
                style={{ fontSize: 12, color: tokens.ink[100] }}
              >
                {fmt(Number(position.argument.amountPol), 4)} {chain.symbol}
              </div>
              <div>
                <Chip
                  color={
                    status === "Bonded"
                      ? tokens.neon
                      : status === "Unbonding"
                        ? tokens.warning
                        : tokens.ink[400]
                  }
                  dot
                >
                  {status.toUpperCase()}
                </Chip>
              </div>
              <div
                className="mono"
                style={{ fontSize: 10, color: tokens.ink[400] }}
              >
                Canton
              </div>
            </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
