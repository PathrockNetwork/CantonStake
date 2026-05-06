"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Btn } from "@/components/primitives/Btn";
import { Card } from "@/components/primitives/Card";
import { Chip } from "@/components/primitives/Chip";
import { EmptyState } from "@/components/primitives/EmptyState";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import {
  createAutoCompoundPermit,
  disableAutoCompoundPermit,
  disableNotificationChannel,
  fetchUserByEvm,
  listAutoCompoundPermits,
  listNotificationChannels,
  sendTestNotification,
  upsertNotificationChannel,
} from "@/lib/api";
import { CHAINS } from "@/lib/chains";
import { tokens } from "@/lib/tokens";

const CHAIN_NAME: Record<string, string> = Object.fromEntries(
  CHAINS.map((c) => [c.id, c.name]),
);

const COMPOUND_CHAINS = ["polygon", "moonbeam", "monad", "cosmos", "sui"] as const;
type CompoundChain = (typeof COMPOUND_CHAINS)[number];

const NOTIFY_KINDS = [
  { id: "telegram", label: "Telegram", placeholder: "@your_chat_id or numeric" },
  { id: "email", label: "Email", placeholder: "you@example.com" },
  { id: "discord", label: "Discord", placeholder: "https://discord.com/api/webhooks/..." },
] as const;

export default function SettingsPage() {
  const { address, isConnected } = useAccount();
  const qc = useQueryClient();

  const userQ = useQuery({
    queryKey: ["user-by-evm", address],
    queryFn: () => (address ? fetchUserByEvm(address) : null),
    enabled: !!address,
    retry: false,
  });
  const userId = userQ.data?.id ?? null;

  if (!isConnected) {
    return (
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 22px 80px" }}>
        <SectionLabel>§ SETTINGS</SectionLabel>
        <h1
          className="display"
          style={{ fontSize: 42, margin: "4px 0 24px", color: tokens.ink[100] }}
        >
          Settings.
        </h1>
        <EmptyState
          tone="warn"
          title="Connect your wallet"
          subtitle="Settings are scoped to your registered identity. Connect EVM + Loop to manage auto-compound permits and alert channels."
        />
      </div>
    );
  }

  if (userQ.isError || !userId) {
    return (
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 22px 80px" }}>
        <SectionLabel>§ SETTINGS</SectionLabel>
        <h1
          className="display"
          style={{ fontSize: 42, margin: "4px 0 24px", color: tokens.ink[100] }}
        >
          Settings.
        </h1>
        <EmptyState
          tone="warn"
          title="Identity not registered yet"
          subtitle="Stake at least once or connect your Loop wallet so the backend creates your User record. Then come back here to configure auto-compound and alerts."
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 22px 80px" }}>
      <SectionLabel>§ SETTINGS</SectionLabel>
      <h1
        className="display"
        style={{ fontSize: 42, margin: "4px 0 8px", color: tokens.ink[100] }}
      >
        Settings.
      </h1>
      <p
        className="mono"
        style={{
          fontSize: 11,
          color: tokens.ink[400],
          marginBottom: 28,
          maxWidth: 720,
          lineHeight: 1.6,
        }}
      >
        Auto-compound permits scope what the keeper can do on your behalf;
        signatures are bound to a single (chain, validator) pair and expire on
        their own. Alert channels deliver slashing + reward events.
      </p>

      <AutoCompoundCard userId={userId} qc={qc} />
      <div style={{ height: 24 }} />
      <NotificationsCard userId={userId} qc={qc} />
    </div>
  );
}

function AutoCompoundCard({
  userId,
  qc,
}: {
  userId: string;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const permitsQ = useQuery({
    queryKey: ["auto-compound-permits", userId],
    queryFn: () => listAutoCompoundPermits(userId),
    refetchInterval: 30_000,
  });

  const [chain, setChain] = useState<CompoundChain>("polygon");
  const [validator, setValidator] = useState("");
  const [maxPerRun, setMaxPerRun] = useState("");
  const [signature, setSignature] = useState("");
  const [signaturePayload, setSignaturePayload] = useState("");
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: createAutoCompoundPermit,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["auto-compound-permits", userId] });
      setValidator("");
      setMaxPerRun("");
      setSignature("");
      setSignaturePayload("");
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const disableMut = useMutation({
    mutationFn: disableAutoCompoundPermit,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["auto-compound-permits", userId] }),
  });

  const onSubmit = () => {
    if (!validator) {
      setError("validator is required");
      return;
    }
    const expiresAt = new Date(
      Date.now() + days * 24 * 60 * 60 * 1000,
    ).toISOString();
    createMut.mutate({
      userId,
      chain,
      validator: validator.trim(),
      expiresAt,
      maxPerRun: maxPerRun.trim() || undefined,
      signature: signature.trim() || undefined,
      signaturePayload: signaturePayload.trim() || undefined,
    });
  };

  const permits = permitsQ.data?.permits ?? [];
  const active = permits.filter((p) => p.enabled);

  return (
    <Card padding={0}>
      <div
        style={{
          padding: "18px 22px",
          borderBottom: `1px solid ${tokens.hairline}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <SectionLabel>§ Auto-compound permits</SectionLabel>
          <div
            className="display"
            style={{ fontSize: 22, color: tokens.ink[100], marginTop: 2 }}
          >
            {active.length} active permit{active.length === 1 ? "" : "s"}
          </div>
        </div>
        <Chip color={tokens.cc} dot={active.length > 0}>
          {active.length > 0 ? "ARMED" : "IDLE"}
        </Chip>
      </div>

      <div
        style={{
          padding: 22,
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 12,
        }}
      >
        <Field label="Chain">
          <select
            value={chain}
            onChange={(e) => setChain(e.target.value as CompoundChain)}
            style={selectStyle()}
          >
            {COMPOUND_CHAINS.map((c) => (
              <option key={c} value={c}>
                {CHAIN_NAME[c] ?? c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Validator">
          <input
            value={validator}
            onChange={(e) => setValidator(e.target.value)}
            placeholder={
              chain === "monad"
                ? "validator id (uint64)"
                : chain === "cosmos"
                  ? "cosmosvaloper1..."
                  : "0x..."
            }
            style={inputStyle()}
          />
        </Field>
        <Field label="Expires (days)">
          <input
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
            style={inputStyle()}
          />
        </Field>
        <Field label="Max per run (optional, chain-native units)">
          <input
            value={maxPerRun}
            onChange={(e) => setMaxPerRun(e.target.value)}
            placeholder={
              chain === "polygon"
                ? "wei"
                : chain === "cosmos"
                  ? "uatom"
                  : chain === "sui"
                    ? "mist"
                    : "smallest unit"
            }
            style={inputStyle()}
          />
        </Field>
        <Field label="Signature (EIP-712 / authz tx hash)">
          <input
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="0x..."
            style={inputStyle()}
          />
        </Field>
        <Field label="Signature payload (granter / typed-data digest)">
          <input
            value={signaturePayload}
            onChange={(e) => setSignaturePayload(e.target.value)}
            placeholder={
              chain === "cosmos" ? "granter cosmos1... address" : "raw signed bytes"
            }
            style={inputStyle()}
          />
        </Field>
      </div>

      <div
        style={{
          padding: "0 22px 22px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Btn
          onClick={onSubmit}
          disabled={createMut.isPending || !validator}
          size="md"
        >
          {createMut.isPending ? "Creating…" : "Create permit"}
        </Btn>
        {error ? (
          <span className="mono" style={{ fontSize: 11, color: tokens.danger }}>
            {error}
          </span>
        ) : (
          <span className="mono" style={{ fontSize: 10, color: tokens.ink[400] }}>
            Signature is verified per-chain at execution time. Without it the
            keeper will skip the run.
          </span>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr 0.6fr",
          gap: 12,
          padding: "10px 22px",
          borderTop: `1px solid ${tokens.hairline}`,
          borderBottom: `1px solid ${tokens.hairline}`,
        }}
      >
        {["Chain", "Validator", "Expires", "Status", ""].map((h) => (
          <SectionLabel key={h}>{h}</SectionLabel>
        ))}
      </div>

      {permits.length === 0 ? (
        <div
          className="mono"
          style={{
            padding: 28,
            textAlign: "center",
            fontSize: 11,
            color: tokens.ink[400],
          }}
        >
          no permits configured yet
        </div>
      ) : (
        permits.map((p) => (
          <div
            key={p.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr 0.6fr",
              gap: 12,
              padding: "12px 22px",
              borderBottom: `1px solid ${tokens.hairline}`,
              alignItems: "center",
            }}
          >
            <span
              className="mono"
              style={{ fontSize: 11.5, color: tokens.ink[100] }}
            >
              {CHAIN_NAME[p.chain] ?? p.chain}
            </span>
            <span
              className="mono tabular"
              style={{ fontSize: 11, color: tokens.ink[200] }}
            >
              {p.validator.length > 18
                ? `${p.validator.slice(0, 12)}…${p.validator.slice(-4)}`
                : p.validator}
            </span>
            <span className="mono" style={{ fontSize: 11, color: tokens.ink[300] }}>
              {new Date(p.expiresAt).toLocaleDateString()}
            </span>
            <span>
              <Chip color={p.enabled ? tokens.neon : tokens.ink[400]} dot={p.enabled}>
                {p.enabled ? "ENABLED" : "DISABLED"}
              </Chip>
            </span>
            {p.enabled ? (
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => disableMut.mutate(p.id)}
                disabled={disableMut.isPending}
              >
                Revoke
              </Btn>
            ) : (
              <span />
            )}
          </div>
        ))
      )}
    </Card>
  );
}

function NotificationsCard({
  userId,
  qc,
}: {
  userId: string;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const channelsQ = useQuery({
    queryKey: ["notification-channels", userId],
    queryFn: () => listNotificationChannels(userId),
    refetchInterval: 30_000,
  });

  const [kind, setKind] = useState<typeof NOTIFY_KINDS[number]["id"]>("telegram");
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: upsertNotificationChannel,
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["notification-channels", userId],
      });
      setTarget("");
      setLabel("");
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const disableMut = useMutation({
    mutationFn: disableNotificationChannel,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["notification-channels", userId] }),
  });

  const testMut = useMutation({
    mutationFn: () => sendTestNotification(userId),
    onSuccess: (res) => setTestStatus(`test alert sent · alertId=${res.alertId}`),
    onError: (err) =>
      setTestStatus(err instanceof Error ? err.message : String(err)),
  });

  const onSubmit = () => {
    if (!target.trim()) {
      setError("target is required");
      return;
    }
    createMut.mutate({
      userId,
      kind,
      target: target.trim(),
      label: label.trim() || undefined,
    });
  };

  const channels = channelsQ.data?.channels ?? [];
  const active = channels.filter((c) => c.enabled);
  const placeholder =
    NOTIFY_KINDS.find((k) => k.id === kind)?.placeholder ?? "target";

  return (
    <Card padding={0}>
      <div
        style={{
          padding: "18px 22px",
          borderBottom: `1px solid ${tokens.hairline}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <SectionLabel>§ Alert channels</SectionLabel>
          <div
            className="display"
            style={{ fontSize: 22, color: tokens.ink[100], marginTop: 2 }}
          >
            {active.length} active channel{active.length === 1 ? "" : "s"}
          </div>
        </div>
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => testMut.mutate()}
          disabled={testMut.isPending || active.length === 0}
        >
          {testMut.isPending ? "Sending…" : "Send test alert"}
        </Btn>
      </div>

      <div
        style={{
          padding: 22,
          display: "grid",
          gridTemplateColumns: "auto 1fr 1fr auto",
          gap: 12,
          alignItems: "end",
        }}
      >
        <Field label="Kind">
          <select
            value={kind}
            onChange={(e) =>
              setKind(e.target.value as typeof NOTIFY_KINDS[number]["id"])
            }
            style={selectStyle()}
          >
            {NOTIFY_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Target">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={placeholder}
            style={inputStyle()}
          />
        </Field>
        <Field label="Label (optional)">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="primary, work, etc."
            style={inputStyle()}
          />
        </Field>
        <Btn onClick={onSubmit} disabled={createMut.isPending || !target} size="md">
          {createMut.isPending ? "Adding…" : "Add channel"}
        </Btn>
      </div>

      {(error || testStatus) && (
        <div
          className="mono"
          style={{
            padding: "0 22px 16px",
            fontSize: 10.5,
            color: error ? tokens.danger : tokens.ink[300],
          }}
        >
          {error ?? testStatus}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "0.8fr 1.5fr 1fr 0.6fr 0.6fr",
          gap: 12,
          padding: "10px 22px",
          borderTop: `1px solid ${tokens.hairline}`,
          borderBottom: `1px solid ${tokens.hairline}`,
        }}
      >
        {["Kind", "Target", "Label", "Status", ""].map((h) => (
          <SectionLabel key={h}>{h}</SectionLabel>
        ))}
      </div>

      {channels.length === 0 ? (
        <div
          className="mono"
          style={{
            padding: 28,
            textAlign: "center",
            fontSize: 11,
            color: tokens.ink[400],
          }}
        >
          no channels configured yet
        </div>
      ) : (
        channels.map((c) => (
          <div
            key={c.id}
            style={{
              display: "grid",
              gridTemplateColumns: "0.8fr 1.5fr 1fr 0.6fr 0.6fr",
              gap: 12,
              padding: "12px 22px",
              borderBottom: `1px solid ${tokens.hairline}`,
              alignItems: "center",
            }}
          >
            <span
              className="mono"
              style={{ fontSize: 11.5, color: tokens.ink[100] }}
            >
              {c.kind}
            </span>
            <span
              className="mono tabular"
              style={{
                fontSize: 11,
                color: tokens.ink[200],
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {c.target}
            </span>
            <span className="mono" style={{ fontSize: 11, color: tokens.ink[300] }}>
              {c.label ?? "—"}
            </span>
            <span>
              <Chip color={c.enabled ? tokens.neon : tokens.ink[400]} dot={c.enabled}>
                {c.enabled ? "ON" : "OFF"}
              </Chip>
            </span>
            {c.enabled ? (
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => disableMut.mutate(c.id)}
                disabled={disableMut.isPending}
              >
                Disable
              </Btn>
            ) : (
              <span />
            )}
          </div>
        ))
      )}
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <SectionLabel style={{ marginBottom: 6 }}>{label}</SectionLabel>
      {children}
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    background: tokens.ink[800],
    border: `1px solid ${tokens.hairline}`,
    color: tokens.ink[100],
    fontFamily: "JetBrains Mono, ui-monospace, monospace",
    fontSize: 12,
    outline: "none",
    borderRadius: 0,
  };
}

function selectStyle(): React.CSSProperties {
  return {
    ...inputStyle(),
    appearance: "none" as const,
  };
}
