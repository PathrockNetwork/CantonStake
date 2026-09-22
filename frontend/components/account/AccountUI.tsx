"use client";

import Link from "next/link";
import { useId, type CSSProperties, type ReactNode } from "react";
import { I, IconArrowRight, IconClock, IconExternal, IconGear, IconLock, IconShield } from "@/components/icons";
import { useWalletPicker } from "@/components/WalletPickerProvider";
import { useRoundCountdown } from "@/lib/use-round-countdown";
import type { PositionRow } from "@/lib/api";

export type AccountGlyph = "stack" | "coin" | "cube" | "clock" | "percent" | "activity" | "wallet" | "user" | "shield" | "link" | "settings" | "bell";
export function AccountIcon({ name, size = 30 }: { name: AccountGlyph; size?: number }) {
  const p = { size, strokeWidth: 1.25 };
  if (name === "clock") return <IconClock {...p} />;
  if (name === "shield") return <IconShield {...p} />;
  if (name === "settings") return <IconGear {...p} />;
  return <I {...p}>
    {name === "stack" && <><path d="m8 1 6 3-6 3-6-3 6-3ZM2 7l6 3 6-3M2 10l6 3 6-3M2 13l6 3 6-3" /></>}
    {name === "coin" && <><path d="m8 1 6 3.5v7L8 15l-6-3.5v-7L8 1Z" /><path d="M10 5.5a3 3 0 1 0 0 5" /></>}
    {name === "cube" && <><path d="m8 1 6 3.5v7L8 15l-6-3.5v-7L8 1ZM2 4.5l6 3.5 6-3.5M8 8v7" /></>}
    {name === "percent" && <><path d="m4 13 8-10" /><circle cx="4" cy="4" r="2" /><circle cx="12" cy="12" r="2" /></>}
    {name === "activity" && <path d="M1 9h3l2-6 3 10 2-6 1 2h3" />}
    {name === "wallet" && <><path d="M13 5V2L2 4v9h12V5H2" /><path d="M10 7h4v4h-4z" /></>}
    {name === "user" && <><circle cx="8" cy="4" r="3" /><path d="M2 15v-2a6 6 0 0 1 12 0v2H2Z" /></>}
    {name === "link" && <><path d="m6 10 4-4M5 8 3 10a2.8 2.8 0 0 0 4 4l2-2M7 4l2-2a2.8 2.8 0 0 1 4 4l-2 2" /></>}
    {name === "bell" && <><path d="M3 6a5 5 0 0 1 10 0v4l1 2H2l1-2V6ZM6 14h4" /></>}
  </I>;
}

export function AccountPanel({ title, description, icon = "stack", action, children, className = "", id }: {
  title: string; description?: ReactNode; icon?: AccountGlyph; action?: ReactNode; children: ReactNode; className?: string; id?: string;
}) {
  return <section className={`account-panel ${className}`} id={id}>
    <header className="account-panel__header"><span className="account-panel__icon" aria-hidden="true"><AccountIcon name={icon} /></span>
      <div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action && <div className="account-panel__action">{action}</div>}
    </header><div className="account-panel__body">{children}</div>
  </section>;
}

export function AccountMetric({ label, value, detail, icon = "stack", color = "var(--neon)", series }: {
  label: string; value: ReactNode; detail: ReactNode; icon?: AccountGlyph; color?: string; series?: number[];
}) {
  return <div className="account-metric" style={{ "--metric-color": color } as CSSProperties}>
    <span className="account-metric__icon" aria-hidden="true"><AccountIcon name={icon} size={42} /></span>
    <div><div className="account-metric__label mono">{label}</div><strong className="account-metric__value tabular">{value}</strong><p>{detail}</p></div>
    {series && series.length > 1 && <div className="account-metric__spark"><MiniChart values={series} color={color} compact /></div>}
  </div>;
}

export function WalletNotice({ connected, error, loading, onRetry }: { connected: boolean; error?: boolean; loading?: boolean; onRetry?: () => void }) {
  const { openPicker } = useWalletPicker();
  if (connected && !error && !loading) return null;
  return <div className={`account-notice${error ? " account-notice--error" : ""}`} role="status">
    <span>{!connected ? "Connect your wallet to see your balances, positions, and rewards." : error ? "Account data is unavailable. Please try again." : "Loading your account data…"}</span>
    {!connected ? <button className="account-button" onClick={openPicker}>Connect wallets <IconArrowRight /></button> : error && onRetry ? <button className="account-button" onClick={onRetry}>Retry</button> : null}
  </div>;
}

export function StatusBadge({ status }: { status: string }) {
  const kind = /fail|error|unreachable|unavailable|cancel/i.test(status) ? "bad"
    : /unbond|pending|waiting|unknown|loading/i.test(status) ? "wait"
    : /^(bonded|completed|confirmed|connected|healthy|ok|active|live|supported|selected|registered)$/i.test(status) ? "good" : "neutral";
  return <span className={`account-status account-status--${kind} mono`}><i />{status}</span>;
}

export function ChainBadge({ symbol = "POL", label = "Polygon PoS" }: { symbol?: string; label?: string }) {
  return <span className="account-chain"><span className="account-chain__mark" aria-hidden="true">{symbol === "POL" ? <I size={24}><path d="m8 5 3-2 3 2v4l-3 2-3-2V5L3 8v4l3 2 3-2M3 8 1 6" /></I> : symbol.slice(0, 1)}</span>{label}</span>;
}

export function SplitPanel({ compact = false }: { compact?: boolean }) {
  return <AccountPanel title="Beneficiary split" icon="percent" description={compact ? undefined : "Canton Coin rewards · weights recorded on-ledger"} className={compact ? "account-split--compact" : ""}>
    <div className="account-split__bar" role="img" aria-label="75 percent delegator, 25 percent app treasury"><span /><span /></div>
    <div className="account-split__labels"><div><strong>75%</strong> delegator</div><div><strong>25%</strong> app treasury</div></div>
    {!compact && <p className="account-muted">The beneficiary configuration allocates CC rewards to your Canton identity and the app treasury.</p>}
  </AccountPanel>;
}

export function LifecycleRail({ status }: { status?: PositionRow["argument"]["status"] }) {
  const active = status ? ({ Pending: 0, Bonded: 1, Unbonding: 2, Released: 3, Cancelled: -1 }[status]) : -1;
  return <ol className="account-lifecycle">{[
    ["Request", "Create a staking intent", "shield"], ["Bond", "Stake and earn rewards", "stack"], ["Unbond", "Wait for chain release", "clock"], ["Release", "Funds return to your wallet", "cube"],
  ].map(([name, text, icon], i) => <li key={name} className={active >= i ? "is-complete" : ""} aria-current={active === i ? "step" : undefined}>
    <span aria-hidden="true"><AccountIcon name={icon as AccountGlyph} size={26} /></span><div><strong>{name}</strong><small>{text}</small></div>
  </li>)}</ol>;
}

export function PrivacyPanel({ compact = false }: { compact?: boolean }) {
  return <AccountPanel title="Privacy & trust by design" icon="shield" className={compact ? "account-privacy--compact" : ""}>
    <div className="account-privacy">{[
      ["Your keys, your funds", "The app does not hold your private keys.", <AccountIcon key="wallet" name="wallet" />],
      ["Private Canton state", "Contracts are shared with authorized parties.", <IconLock key="lock" size={28} />],
      ["Multi-party consent", "You approve actions with your wallet.", <AccountIcon key="user" name="user" />],
      ["Verifiable activity", "Follow transactions on their native chain.", <IconExternal key="external" size={28} />],
    ].map(([title, copy, icon]) => <div key={String(title)}><span aria-hidden="true">{icon}</span><div><strong>{title}</strong>{!compact && <p>{copy}</p>}</div></div>)}</div>
  </AccountPanel>;
}

export function CadencePanel() {
  const { mm, ss, progress } = useRoundCountdown();
  return <AccountPanel title="Payout cadence" icon="clock" description="Canton Coin reward rounds run every 10 minutes.">
    <div className="account-cadence" role="progressbar" aria-label="Estimated progress to next scheduled round" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>{[0, 1, 2, 3, 4, 5].map(n => <span key={n} style={{ opacity: progress >= n / 6 ? 1 : .3 }}><IconClock size={16} /></span>)}</div>
    <p className="account-muted">Next scheduled round <strong className="mono">{mm}m {ss}s</strong></p>
    <small className="account-muted">Estimated cadence. Attribution depends on the completed round.</small>
  </AccountPanel>;
}

export function MiniChart({ values, color = "var(--neon)", compact = false, label = "Recorded activity", bars = false }: {
  values: number[]; color?: string; compact?: boolean; label?: string; bars?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  if (!values.length) return <div className="account-chart-empty">No recorded history available.</div>;
  const max = Math.max(...values.filter(Number.isFinite), 1);
  const points = values.map((v, i) => `${values.length === 1 ? 50 : i * 100 / (values.length - 1)},${94 - Math.max(0, v) / max * 84}`).join(" ");
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={compact ? "account-chart--small" : "account-chart"} role="img" aria-label={label}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".32" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
    {!compact && [10, 38, 66, 94].map(y => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="#7bb59b26" strokeWidth=".5" />)}
    {bars ? values.map((v, i) => <rect key={i} x={i * 100 / values.length + 1} y={94 - Math.max(0, v) / max * 84} width={Math.max(.5, 100 / values.length - 2)} height={Math.max(0, v) / max * 84} fill={color} opacity=".8" />) : <><polygon points={`0,100 ${points} 100,100`} fill={`url(#${id})`} /><polyline points={points} stroke={color} strokeWidth={compact ? 1.4 : 2} fill="none" vectorEffect="non-scaling-stroke" /></>}
  </svg>;
}

export function AccountEmpty({ children }: { children: ReactNode }) { return <div className="account-empty">{children}</div>; }
export function AccountLink({ href, children }: { href: string; children: ReactNode }) { return <Link className="account-text-link" href={href}>{children}<IconArrowRight /></Link>; }

export function AccountPagination({ page, count, size = 8, onChange }: { page: number; count: number; size?: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / size));
  if (pages === 1) return null;
  return <nav className="account-pagination" aria-label="Results pagination"><button className="account-button" disabled={page === 0} onClick={() => onChange(page - 1)}>Previous</button><span>Page {page + 1} of {pages}</span><button className="account-button" disabled={page >= pages - 1} onClick={() => onChange(page + 1)}>Next</button></nav>;
}
