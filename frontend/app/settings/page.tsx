"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Btn } from "@/components/primitives/Btn";
import { Card } from "@/components/primitives/Card";
import { Chip } from "@/components/primitives/Chip";
import { EmptyState } from "@/components/primitives/EmptyState";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { PageMasthead } from "@/components/primitives/PageMasthead";
import {
  createAutoCompoundPermit,
  disableAutoCompoundPermit,
  disableNotificationChannel,
  fetchUserByEvm,
  upsertUser,
  listAutoCompoundPermits,
  listNotificationChannels,
  sendTestNotification,
  upsertNotificationChannel,
} from "@/lib/api";
import { CHAINS } from "@/lib/chains";
import { tokens } from "@/lib/tokens";
import { useCantonWallet } from "@/lib/canton";
import { useWalletPicker } from "@/components/WalletPickerProvider";
import { shortId } from "@/lib/account-view";
import { AccountEmpty, AccountIcon, AccountLink, AccountPanel, PrivacyPanel, StatusBadge, WalletNotice } from "@/components/account/AccountUI";

const CHAIN_NAME: Record<string, string> = Object.fromEntries(
  CHAINS.map((c) => [c.id, c.name]),
);

type CompoundChain =
  | "polygon"
  | "monad"
  | "cosmos"
  | "celestia"
  | "osmosis"
  | "sui"
  | "aptos"
  | "polkadot"
  | "bnb"
  | "solana";

const COMPOUND_CHAINS: readonly CompoundChain[] = ["polygon"];
/* Additional keeper adapters remain in the codebase but are deliberately
   not exposed until they complete production validation on both modes. */
const DEFERRED_COMPOUND_CHAINS = [
  "monad",
  "cosmos",
  "celestia",
  "osmosis",
  "sui",
  "aptos",
  "polkadot",
  "bnb",
  "solana",
] as const;
void DEFERRED_COMPOUND_CHAINS;

const NOTIFY_KINDS = [
  { id: "telegram", label: "Telegram", placeholder: "@your_chat_id or numeric" },
  { id: "email", label: "Email", placeholder: "you@example.com" },
  { id: "discord", label: "Discord", placeholder: "https://discord.com/api/webhooks/..." },
] as const;

const SETTINGS_SECTIONS = [
  { id: "profile", title: "Profile", detail: "Identity & profile settings", icon: "user" },
  { id: "wallets", title: "Wallets", detail: "Connected wallets & permissions", icon: "wallet" },
  { id: "notifications", title: "Notifications", detail: "Alerts & updates", icon: "bell" },
  { id: "privacy", title: "Privacy & security", detail: "Permissions & reward controls", icon: "shield" },
  { id: "preferences", title: "Preferences", detail: "Display & experience", icon: "settings" },
  { id: "integrations", title: "Integrations", detail: "Connected networks & services", icon: "link" },
] as const;

export default function SettingsPage() {
  const { address, isConnected } = useAccount();
  const { partyId, isConnected: loopConnected } = useCantonWallet();
  const { openPicker } = useWalletPicker();
  const qc = useQueryClient();
  const [section, setSection] = useState<string>("profile");
  const [displayName, setDisplayName] = useState("");
  const [density, setDensity] = useState("comfortable");
  const userQ = useQuery({ queryKey: ["user-by-evm", address], queryFn: () => fetchUserByEvm(address!), enabled: !!address, retry: false });
  const user = userQ.data;
  const unregistered = userQ.error?.message === "user not registered yet";
  useEffect(() => { setDisplayName(user?.displayName ?? ""); }, [user?.id, user?.displayName, address]);
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (SETTINGS_SECTIONS.some(item => item.id === hash)) setSection(hash);
    try { setDensity(localStorage.getItem("cantonstake:account-density") === "compact" ? "compact" : "comfortable"); } catch { /* Browser storage is optional. */ }
  }, []);
  const canEdit = isConnected && loopConnected && !!partyId && !!user && user.cantonPartyId === partyId;
  const profileMutation = useMutation({ mutationFn: () => {
    if (!canEdit || !user) throw new Error("Connect the wallets linked to this profile before saving.");
    return upsertUser({ cantonPartyId: user.cantonPartyId, evmAddress: address, displayName: displayName.trim() });
  }, onSuccess: () => { void qc.invalidateQueries({ queryKey: ["user-by-evm", address] }); } });
  const selected = SETTINGS_SECTIONS.find(item => item.id === section) ?? SETTINGS_SECTIONS[0];
  const requiresUser = <AccountEmpty>{!isConnected ? "Connect your wallets to manage account settings." : userQ.isLoading ? "Loading your Canton identity…" : unregistered ? "Connect your Loop wallet or create your first position to register your identity." : "Your identity could not be loaded."}<button className="account-button" onClick={openPicker}>Manage wallets</button></AccountEmpty>;
  function selectSection(id: string) { setSection(id); window.history.replaceState(null, "", `#${id}`); }
  function setDisplayDensity(value: string) {
    setDensity(value); document.documentElement.dataset.accountDensity = value;
    try { localStorage.setItem("cantonstake:account-density", value); } catch { /* Preference still applies for this visit. */ }
  }
  function exportProfile() {
    if (!user) return;
    const blob = new Blob([JSON.stringify({ displayName: user.displayName, evmAddress: user.evmAddress, cantonPartyId: user.cantonPartyId, createdAt: user.createdAt }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "cantonstake-profile.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const wallets = <AccountPanel title="Your connected wallets" icon="wallet" description="Manage the native wallet and Canton identity used for staking." action={<button className="account-button" onClick={openPicker}>+ Connect wallet</button>}>
    <div className="account-wallet-list">
      <div><span className="account-wallet-logo account-wallet-logo--loop" aria-hidden="true">∞</span><div><strong>Loop Wallet (Party ID)</strong><small title={partyId ?? ""}>{partyId ? shortId(partyId, 18) : "No Canton wallet connected"}</small><small>Native Canton identity · CC rewards</small></div><StatusBadge status={loopConnected ? "Connected" : "Disconnected"} /></div>
      <div><span className="account-wallet-logo" aria-hidden="true"><AccountIcon name="wallet" /></span><div><strong>EVM Wallet</strong><small title={address}>{address ? shortId(address, 12) : "No EVM wallet connected"}</small><small>Native staking · transaction signing</small></div><StatusBadge status={isConnected ? "Connected" : "Disconnected"} /></div>
    </div><button className="account-button" onClick={openPicker}>Manage connections</button>
  </AccountPanel>;

  return <div className="page-shell account-page">
    <PageMasthead index="06" section="Settings" title="Settings." accent="Manage your identity, wallets, and security." description="Your preferences keep you in control. Manage your profile, connected wallets, reward permissions, and alerts." />
    <WalletNotice connected={isConnected} error={userQ.isError && !unregistered} loading={isConnected && userQ.isLoading} onRetry={() => { void userQ.refetch(); }} />
    <div className="account-settings-layout">
      <aside className="account-stack"><nav className="account-settings-nav" aria-label="Settings sections">{SETTINGS_SECTIONS.map(item => <button key={item.id} aria-pressed={section === item.id} onClick={() => selectSection(item.id)}><AccountIcon name={item.icon} /><span><strong>{item.title}</strong><small>{item.detail}</small></span><span aria-hidden="true">›</span></button>)}</nav>
        <AccountPanel title="One identity. Many possibilities." icon="cube"><p className="account-muted">Your Canton party links your staking activity and recorded reward allocations.</p><AccountLink href="/dashboard">Open dashboard</AccountLink></AccountPanel>
      </aside>
      <div className="account-stack">
        <header className="account-settings-title"><div><h2>{selected.title}</h2><p>{selected.detail} for your CantonStake account.</p></div>{section === "profile" && <button className="account-button account-button--primary" type="submit" form="account-profile-form" disabled={!canEdit || profileMutation.isPending || displayName.trim() === (user?.displayName ?? "")}>{profileMutation.isPending ? "Saving…" : "Save changes"}</button>}</header>
        {section === "profile" && <>
          <div className="account-settings-columns">
            <AccountPanel title="Identity & profile" icon="user">
              <div className="account-profile-identity"><span className="account-profile-avatar" aria-hidden="true"><AccountIcon name="cube" size={46} /></span><div><h3>{user?.displayName || "Your Canton identity"}</h3><p>{user ? shortId(user.cantonPartyId, 14) : "Connect your registered wallets"}</p></div>{user && <StatusBadge status="Registered" />}</div>
              <form id="account-profile-form" onSubmit={event => { event.preventDefault(); profileMutation.mutate(); }}>
                <label><span className="account-field-label">Display name</span><input className="account-field" value={displayName} onChange={event => { setDisplayName(event.target.value); profileMutation.reset(); }} maxLength={80} autoComplete="nickname" disabled={!canEdit || profileMutation.isPending} placeholder="Your display name" /></label>
                <label><span className="account-field-label">Linked EVM address</span><input className="account-field mono" value={user?.evmAddress ?? address ?? ""} readOnly placeholder="Connect an EVM wallet" /></label>
                <p className="account-muted">{canEdit ? "Your display name is saved to your registered CantonStake profile." : "Connect the EVM and Loop wallets linked to this profile to edit it."}</p>
                {profileMutation.isSuccess && <p role="status" className="account-save-success">Profile saved.</p>}{profileMutation.isError && <p role="alert" className="account-save-error">{profileMutation.error.message}</p>}
              </form>
            </AccountPanel>
            {wallets}
            <AccountPanel title="Canton identity" icon="cube" description="Your staking activity, linked through one party."><p className="account-identity-heading">One identity. Native staking. Canton rewards.</p><p className="account-muted">Your Canton party records staking lifecycle events and beneficiary allocations. Your native tokens remain controlled by your wallet.</p><dl className="account-definition"><div><dt>Party ID</dt><dd title={user?.cantonPartyId ?? ""}>{shortId(user?.cantonPartyId, 20)}</dd></div><div><dt>Registered</dt><dd>{user ? new Date(user.createdAt).toLocaleDateString() : "—"}</dd></div></dl></AccountPanel>
            <PrivacyPanel />
          </div>
          <div className="account-settings-columns"><AccountPanel title="Account status" icon="shield"><p className="account-muted">{user ? `Registered since ${new Date(user.createdAt).toLocaleDateString()}.` : unregistered ? "Your identity has not been registered yet." : "Connect your registered wallets to view account status."}</p><StatusBadge status={user ? "Registered" : "Not connected"} /></AccountPanel><AccountPanel title="Quick actions" icon="activity"><div className="account-quick-actions"><button className="account-button" onClick={exportProfile} disabled={!user}>↓ Export profile data</button><AccountLink href="/analytics">View activity</AccountLink></div></AccountPanel></div>
        </>}
        {section === "wallets" && <>{wallets}<PrivacyPanel /></>}
        {section === "notifications" && <div className="account-existing-settings">{user ? <NotificationsCard userId={user.id} qc={qc} /> : requiresUser}</div>}
        {section === "privacy" && <><PrivacyPanel /><div className="account-existing-settings">{user ? <AutoCompoundCard userId={user.id} qc={qc} /> : requiresUser}</div></>}
        {section === "preferences" && <AccountPanel title="Display preferences" icon="settings" description="Saved in this browser for the account pages."><fieldset className="account-preference"><legend>Information density</legend><div className="account-tabs">{["comfortable", "compact"].map(value => <button key={value} type="button" aria-pressed={density === value} onClick={() => setDisplayDensity(value)}>{value === "comfortable" ? "Comfortable" : "Compact"}</button>)}</div></fieldset><dl className="account-definition"><div><dt>Color theme</dt><dd>Canton dark</dd></div><div><dt>Animation</dt><dd>Respects system reduced-motion preference</dd></div></dl><p className="account-muted">The homepage globe also has its own play and pause control.</p></AccountPanel>}
        {section === "integrations" && <><AccountPanel title="Connected services" icon="link"><dl className="account-definition"><div><dt>Loop Wallet</dt><dd><StatusBadge status={loopConnected ? "Connected" : "Disconnected"} /></dd></div><div><dt>EVM wallet</dt><dd><StatusBadge status={isConnected ? "Connected" : "Disconnected"} /></dd></div><div><dt>Supported staking chain</dt><dd>Polygon PoS</dd></div></dl><button className="account-button" onClick={openPicker}>Manage wallets</button></AccountPanel><AccountPanel title="Reward automation" icon="activity"><p className="account-muted">Manage scoped auto-compound permissions under Privacy & security, and delivery channels under Notifications.</p><div className="account-quick-actions"><button className="account-button" onClick={() => selectSection("privacy")}>Reward permissions</button><button className="account-button" onClick={() => selectSection("notifications")}>Alert channels</button></div></AccountPanel></>}
      </div>
    </div>
  </div>;
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
