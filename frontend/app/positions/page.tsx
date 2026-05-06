"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt, useSwitchChain } from "wagmi";
import { parseEther } from "viem";
import { Btn } from "@/components/primitives/Btn";
import { Card } from "@/components/primitives/Card";
import { Chip } from "@/components/primitives/Chip";
import { EmptyState } from "@/components/primitives/EmptyState";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import {
  fetchPositions,
  sweepNativeRewards,
  type PositionRow,
} from "@/lib/api";
import { liveChains, chainById } from "@/lib/chains";
import { adapterFor } from "@/lib/chains/index";
import { chainFromAddress } from "@/lib/chains";
import { fmt } from "@/lib/format";
import { lookupPositionMeta, lookupPositionChain } from "@/lib/position-chain-map";
import { useCosmosWallet } from "@/lib/cosmos/use-cosmos-wallet";
import { useSuiWallet } from "@/lib/sui/use-sui-wallet";
import { tokens } from "@/lib/tokens";

/**
 * Positions — staking lifecycle view with Unbond and Claim actions.
 *
 * Each position moves through: Pending → Bonded → Unbonding → Released
 *
 * Actions available:
 * - Bonded: Sweep (claim native rewards), Unbond (start unstaking)
 * - Unbonding: Claim (withdraw after unbonding period expires)
 * - Released: No actions (lifecycle complete)
 */

type Lifecycle = "bonded" | "unbonding" | "released" | "cancelled" | "pending";

const STATUS_TO_LIFECYCLE: Record<string, Lifecycle> = {
  Bonded: "bonded",
  Unbonding: "unbonding",
  Released: "released",
  Cancelled: "cancelled",
  Pending: "pending",
};

function lifecycleColor(l: Lifecycle): string {
  switch (l) {
    case "bonded":
      return tokens.neon;
    case "unbonding":
      return tokens.warning;
    case "released":
      return tokens.ink[300];
    case "cancelled":
      return tokens.ink[500];
    case "pending":
      return tokens.warning;
  }
}

function relativeTime(iso?: string): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function shortContract(id: string): string {
  if (id.length <= 18) return id;
  return `${id.slice(0, 12)}...${id.slice(-4)}`;
}

function positionChain(p: PositionRow) {
  const hint = lookupPositionChain(
    p.argument.evmAddress,
    p.argument.amountPol,
  );
  return chainFromAddress(p.argument.evmAddress, hint);
}

export default function PositionsPage() {
  const { address, isConnected } = useAccount();
  const cosmos = useCosmosWallet();
  const sui = useSuiWallet();
  const { switchChainAsync } = useSwitchChain();

  const { data: positions = [], isLoading } = useQuery({
    queryKey: ["positions", address],
    queryFn: () => (address ? fetchPositions(address) : Promise.resolve([])),
    enabled: !!address,
    refetchInterval: 5000,
  });

  const counts = positions.reduce(
    (acc, p) => {
      const l = STATUS_TO_LIFECYCLE[p.argument.status];
      if (l === "bonded") acc.bonded += 1;
      else if (l === "unbonding") acc.unbonding += 1;
      else if (l === "released") acc.released += 1;
      else if (l === "cancelled") acc.cancelled += 1;
      return acc;
    },
    { bonded: 0, unbonding: 0, released: 0, cancelled: 0 },
  );

  const focused =
    positions.find((p) => p.argument.status === "Unbonding") ?? positions[0];

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 22px 80px" }}>
      <SectionLabel>§ POSITIONS · LIVE</SectionLabel>
      <h1
        className="display"
        style={{ fontSize: 42, margin: "4px 0 12px", color: tokens.ink[100] }}
      >
        State machine, on-ledger.
      </h1>
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.6,
          color: tokens.ink[300],
          maxWidth: 680,
          margin: "0 0 24px",
        }}
      >
        Each position moves through a Canton-recorded lifecycle: requested,
        bonded, unbonding, released, or cancelled.
      </p>

      {!isConnected ? (
        <EmptyState
          tone="warn"
          title="Connect your wallet"
          subtitle="Positions are scoped to your EVM address. Connect both Loop and EVM to see your live staking lifecycle."
        />
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: 1,
              background: tokens.hairline,
              marginBottom: 24,
            }}
          >
            {[
              { l: "Bonded", s: "Currently earning", v: counts.bonded, a: tokens.neon },
              { l: "Unbonding", s: "Exit in progress", v: counts.unbonding, a: tokens.warning },
              { l: "Released", s: "Lifecycle complete", v: counts.released, a: tokens.ink[300] },
              { l: "Cancelled", s: "Request closed", v: counts.cancelled, a: tokens.ink[500] },
            ].map((s) => (
              <div
                key={s.l}
                style={{ background: tokens.ink[900], padding: "18px 22px" }}
              >
                <SectionLabel>{s.l}</SectionLabel>
                <div
                  className="display tabular"
                  style={{ fontSize: 36, color: s.a, marginTop: 6 }}
                >
                  {s.v}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 10, color: tokens.ink[400], marginTop: 6 }}
                >
                  {s.s}
                </div>
              </div>
            ))}
          </div>

          <Card padding={0} style={{ marginBottom: 24 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 1fr 1fr 1fr 0.8fr 140px",
                padding: "10px 22px",
                borderBottom: `1px solid ${tokens.hairline}`,
                gap: 12,
              }}
            >
              {["Contract id", "Staked", "Lifecycle", "Bonded since", "Markers", "Actions"].map(
                (h) => (
                  <SectionLabel key={h}>{h}</SectionLabel>
                ),
              )}
            </div>
            {isLoading ? (
              <div
                className="mono"
                style={{ padding: "40px 22px", color: tokens.ink[400], textAlign: "center" }}
              >
                loading positions…
              </div>
            ) : positions.length === 0 ? (
              <div style={{ padding: 22 }}>
                <EmptyState
                  title="No positions yet"
                  subtitle="Open the staking console to bond your first position on any supported chain."
                />
              </div>
            ) : (
              positions.map((p) => (
                <Row
                  key={p.contractId}
                  p={p}
                  cosmos={cosmos}
                  sui={sui}
                  switchChainAsync={switchChainAsync}
                />
              ))
            )}
          </Card>

          {focused && <Timeline p={focused} />}
        </>
      )}
    </div>
  );
}

function Row({
  p,
  cosmos,
  sui,
  switchChainAsync,
}: {
  p: PositionRow;
  cosmos: ReturnType<typeof useCosmosWallet>;
  sui: ReturnType<typeof useSuiWallet>;
  switchChainAsync: ReturnType<typeof useSwitchChain>["switchChainAsync"];
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const { address } = useAccount();
  const { sendTransaction } = useSendTransaction();
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({
    hash: undefined, // Will be set during unbond/claim
  });

  const lifecycle = STATUS_TO_LIFECYCLE[p.argument.status] ?? "pending";
  const color = lifecycleColor(lifecycle);
  const chain = positionChain(p);

  // Get position metadata (chain + validator)
  const meta = lookupPositionMeta(p.argument.evmAddress, p.argument.amountPol);
  const chainId = meta?.chainId ?? chain.id;
  const validator = meta?.validator;

  // Determine available actions
  const canSweep = lifecycle === "bonded";
  const canUnbond = lifecycle === "bonded" && !!validator;
  const canClaim =
    lifecycle === "unbonding" &&
    !!p.argument.unbondingReadyAt &&
    new Date(p.argument.unbondingReadyAt) <= new Date();
  const hasActions = canSweep || canUnbond || canClaim;

  // Sweep mutation (claim native rewards)
  const sweepMut = useMutation({
    mutationFn: () => sweepNativeRewards(p.contractId),
    onSuccess: (res) => {
      const native =
        res &&
        typeof res === "object" &&
        "sweep" in res &&
        res.sweep &&
        typeof res.sweep === "object" &&
        "userPayoutPol" in res.sweep
          ? (res.sweep as { userPayoutPol: number }).userPayoutPol
          : null;
      setOkMsg(
        native !== null
          ? `swept ${native.toFixed(4)} ${chain.symbol}`
          : "sweep recorded",
      );
      setError(null);
      void qc.invalidateQueries({ queryKey: ["positions"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-rewards"] });
      setTimeout(() => setOkMsg(null), 3000);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : String(err)),
  });

  // Unbond handler
  const handleUnbond = async () => {
    if (!address || !validator) return;
    setError(null);
    setOkMsg(null);

    try {
      const adapter = adapterFor(chainId);
      const amountWei = parseEther(p.argument.amountPol);

      // Check chain type
      const isCosmos = chainId === "cosmos";
      const isSui = chainId === "sui";
      const isEvm = !!chain.wagmiChain;

      if (isCosmos) {
        if (!cosmos.isConnected || !cosmos.address) {
          setError("Connect Keplr wallet first");
          return;
        }
        const tx = await adapter.buildUndelegateTx({
          validator,
          amount: amountWei,
          delegator: cosmos.address,
        });
        if (tx.kind !== "cosmos") {
          throw new Error("Unexpected tx kind");
        }
        const result = await cosmos.signAndBroadcast({
          typeUrl: tx.typeUrl,
          value: tx.value,
        });
        setOkMsg(`Unbonding... tx: ${result.txHash.slice(0, 10)}...`);
        setTimeout(() => setOkMsg(null), 3000);
        // Refresh positions after a delay
        setTimeout(() => qc.invalidateQueries({ queryKey: ["positions"] }), 5000);
      } else if (isSui) {
        if (!sui.isConnected || !sui.address) {
          setError("Connect Sui wallet first");
          return;
        }
        const result = await sui.undelegate({ validator, amountMist: amountWei });
        setOkMsg(`Unbonding... tx: ${result.digest.slice(0, 10)}...`);
        setTimeout(() => setOkMsg(null), 3000);
        setTimeout(() => qc.invalidateQueries({ queryKey: ["positions"] }), 5000);
      } else if (isEvm) {
        // Switch to the correct chain first
        const wagmiChain = chain.wagmiChain;
        if (wagmiChain) {
          await switchChainAsync({ chainId: wagmiChain.id });
        }

        const tx = await adapter.buildUndelegateTx({
          validator,
          amount: amountWei,
          delegator: address,
        });
        if (tx.kind !== "evm") {
          throw new Error("Unexpected tx kind");
        }

        sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value ?? 0n,
          gas: tx.gas,
        });
        setOkMsg("Confirming unbond...");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Claim handler
  const handleClaim = async () => {
    if (!address || !validator) return;
    setError(null);
    setOkMsg(null);

    try {
      const adapter = adapterFor(chainId);
      const isCosmos = chainId === "cosmos";
      const isSui = chainId === "sui";
      const isEvm = !!chain.wagmiChain;

      if (isCosmos) {
        if (!cosmos.isConnected || !cosmos.address) {
          setError("Connect Keplr wallet first");
          return;
        }
        const tx = await adapter.buildClaimTx({
          validator,
          delegator: cosmos.address,
        });
        if (tx.kind !== "cosmos") {
          throw new Error("Unexpected tx kind");
        }
        const result = await cosmos.signAndBroadcast({
          typeUrl: tx.typeUrl,
          value: tx.value,
        });
        setOkMsg(`Claimed! tx: ${result.txHash.slice(0, 10)}...`);
        setTimeout(() => setOkMsg(null), 3000);
        setTimeout(() => qc.invalidateQueries({ queryKey: ["positions"] }), 5000);
      } else if (isSui) {
        if (!sui.isConnected || !sui.address) {
          setError("Connect Sui wallet first");
          return;
        }
        const result = await sui.withdraw({ validator });
        setOkMsg(`Claimed! tx: ${result.digest.slice(0, 10)}...`);
        setTimeout(() => setOkMsg(null), 3000);
        setTimeout(() => qc.invalidateQueries({ queryKey: ["positions"] }), 5000);
      } else if (isEvm) {
        const wagmiChain = chain.wagmiChain;
        if (wagmiChain) {
          await switchChainAsync({ chainId: wagmiChain.id });
        }

        const tx = await adapter.buildClaimTx({
          validator,
          delegator: address,
        });
        if (tx.kind !== "evm") {
          throw new Error("Unexpected tx kind");
        }

        sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value ?? 0n,
          gas: tx.gas,
        });
        setOkMsg("Confirming claim...");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const isPending = sweepMut.isPending;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.4fr 1fr 1fr 1fr 0.8fr 140px",
        padding: "14px 22px",
        borderBottom: `1px solid ${tokens.hairline}`,
        alignItems: "center",
        gap: 12,
      }}
    >
      <div className="mono tabular" style={{ fontSize: 11.5, color: tokens.ink[100] }}>
        {shortContract(p.contractId)}
      </div>
      <div className="mono tabular" style={{ fontSize: 13, color: tokens.ink[100] }}>
        {fmt(parseFloat(p.argument.amountPol), 2)} {chain.symbol}
      </div>
      <Chip color={color} dot={lifecycle === "bonded" || lifecycle === "unbonding"}>
        {lifecycle}
      </Chip>
      <div className="mono" style={{ fontSize: 11, color: tokens.ink[300] }}>
        {relativeTime(p.argument.bondedAt)}
      </div>
      <div className="mono tabular" style={{ fontSize: 11, color: tokens.cc }}>
        {p.argument.markersEmitted}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {hasActions ? (
          <div style={{ display: "flex", gap: 4 }}>
            {canSweep && (
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => sweepMut.mutate()}
                disabled={isPending}
              >
                {isPending ? "Sweeping…" : "Sweep"}
              </Btn>
            )}
            {canUnbond && (
              <Btn
                size="sm"
                variant="ghost"
                onClick={handleUnbond}
                disabled={isPending}
                style={{ color: tokens.warning }}
              >
                Unbond
              </Btn>
            )}
            {canClaim && (
              <Btn
                size="sm"
                variant="ghost"
                onClick={handleClaim}
                disabled={isPending}
                style={{ color: tokens.neon }}
              >
                Claim
              </Btn>
            )}
          </div>
        ) : (
          <span
            className="mono"
            style={{ fontSize: 10, color: tokens.ink[500] }}
          >
            —
          </span>
        )}
        {okMsg ? (
          <span
            className="mono"
            style={{ fontSize: 9, color: tokens.neon }}
          >
            {okMsg}
          </span>
        ) : error ? (
          <span
            className="mono"
            style={{ fontSize: 9, color: tokens.danger }}
          >
            {error.slice(0, 30)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Timeline({ p }: { p: PositionRow }) {
  const events: Array<{
    id: string;
    label: string;
    detail: string;
    t: string;
    done: boolean;
    kind: "CANTON" | "POLYGON" | "MARKER";
  }> = [
    {
      id: "request",
      label: "Request created",
      detail: "Canton contract created for this staking intent.",
      t: relativeTime(p.argument.bondedAt),
      done: true,
      kind: "CANTON",
    },
    {
      id: "bond",
      label: "Bonded",
      detail: `${positionChain(p).symbol} delegation confirmed on ${positionChain(p).name} · contract ${shortContract(p.contractId)}`,
      t: relativeTime(p.argument.bondedAt),
      done: !!p.argument.bondedAt,
      kind: "POLYGON",
    },
    {
      id: "marker",
      label: "Marker emitted",
      detail: `${p.argument.markersEmitted} Canton activity marker${
        p.argument.markersEmitted === 1 ? "" : "s"
      } recorded for Featured App reward accounting.`,
      t: p.argument.markersEmitted > 0 ? "after bond" : "—",
      done: p.argument.markersEmitted > 0,
      kind: "MARKER",
    },
    {
      id: "unbond",
      label: "Unbonding",
      detail: "Exit started · withdrawal delay applies before release.",
      t: relativeTime(p.argument.unbondingStartedAt),
      done: !!p.argument.unbondingStartedAt,
      kind: "POLYGON",
    },
    {
      id: "release",
      label: "Released",
      detail: "Withdrawal claimed; lifecycle closed.",
      t: relativeTime(p.argument.releasedAt),
      done: !!p.argument.releasedAt,
      kind: "CANTON",
    },
  ];
  const lifecycle = STATUS_TO_LIFECYCLE[p.argument.status] ?? "pending";
  return (
    <Card padding={0}>
      <div
        style={{
          padding: "16px 22px",
          borderBottom: `1px solid ${tokens.hairline}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <div>
          <SectionLabel>§ Lifecycle proof · {shortContract(p.contractId)}</SectionLabel>
          <div
            className="display"
            style={{ fontSize: 24, color: tokens.ink[100], marginTop: 2 }}
          >
            Lifecycle timeline.
          </div>
          <div
            className="mono"
            style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 2 }}
          >
            {fmt(parseFloat(p.argument.amountPol), 2)} {positionChain(p).symbol} · {p.argument.status}
          </div>
        </div>
        <Chip color={lifecycleColor(lifecycle)} dot>
          {lifecycle}
        </Chip>
      </div>
      <div style={{ padding: "24px 22px" }}>
        <div style={{ position: "relative", paddingLeft: 24 }}>
          <div
            style={{
              position: "absolute",
              left: 6,
              top: 6,
              bottom: 6,
              width: 1,
              background: tokens.hairline,
            }}
          />
          {events.map((e, i) => {
            const k =
              e.kind === "CANTON"
                ? tokens.neon
                : e.kind === "POLYGON"
                ? tokens.amberBright
                : tokens.cc;
            return (
              <div
                key={e.id}
                style={{
                  position: "relative",
                  marginBottom: i === events.length - 1 ? 0 : 18,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: -22,
                    top: 4,
                    width: 11,
                    height: 11,
                    borderRadius: "50%",
                    background: e.done ? k : tokens.ink[900],
                    border: `1.5px solid ${k}`,
                    boxShadow: e.done ? "none" : `inset 0 0 0 2px ${tokens.ink[900]}`,
                    animation: e.done ? "none" : "pulse-dot 2s infinite",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 12,
                  }}
                >
                  <div>
                    <span
                      className="mono"
                      style={{
                        fontSize: 9.5,
                        color: k,
                        letterSpacing: ".12em",
                        marginRight: 8,
                      }}
                    >
                      {e.kind}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 12, color: tokens.ink[100] }}
                    >
                      {e.label}
                    </span>
                  </div>
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: tokens.ink[400] }}
                  >
                    {e.t}
                  </span>
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 3 }}
                >
                  {e.detail}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
