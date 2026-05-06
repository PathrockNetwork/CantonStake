"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { CCRoundTicker } from "@/components/chrome/CCRoundTicker";
import { PriceTape } from "@/components/chrome/PriceTape";
import { useWalletPicker } from "@/components/WalletPickerProvider";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4001";

interface HealthDetail {
  demoMode?: boolean;
  featuredAppRight?: string;
  cantonJsonApi?: string;
  warnings?: string[];
}

// Detect whether the backend is running rewards in mock-seeded mode.
// Surfaced in the warnings array as the "MOCK_REWARDS=true: ..." line.
function isMockRewards(h: HealthDetail | undefined): boolean {
  return (
    h?.warnings?.some((w) => w.startsWith("MOCK_REWARDS=true")) ?? false
  );
}

async function fetchHealthDetail(): Promise<HealthDetail> {
  const res = await fetch(`${BACKEND_URL}/api/health/detail`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function deriveBadge(h: HealthDetail | undefined): {
  label: string;
  color: "neon" | "cc" | "warn";
} {
  if (!h) return { label: "Loading", color: "warn" };
  if (isMockRewards(h)) return { label: "Mock Rewards · Demo", color: "warn" };
  if (h.demoMode) return { label: "Demo · Devnet", color: "warn" };
  if (h.featuredAppRight === "configured")
    return { label: "Featured · Live", color: "neon" };
  return { label: "Candidate · Devnet", color: "cc" };
}
import {
  IconArrowRight,
  IconBolt,
  IconChart,
  IconCoin,
  IconHome,
  IconShield,
} from "@/components/icons";
import { Logo } from "@/components/primitives/Logo";
import { StatusDot } from "@/components/primitives/StatusDot";
import { tokens } from "@/lib/tokens";
import { useCantonWallet } from "@/lib/canton";

/**
 * Top navigation chrome — ported from
 * handoff/prototype/redesign/screens.jsx (`TopNav`).
 *
 * Six-route IA per the prototype: Home / Dashboard / Stake / Positions
 * / Rewards / Analytics. (Validators is folded into /stake; Settings
 * is out of scope per PORT_GUIDE §5.)
 *
 * Wallet integration deviates from the static prototype values
 * (`cs::1220ab9f...loop`, `0x7c3a...e91d`) — we wire real
 * `useCantonWallet()` and `useAccount()` so the chrome is honest the
 * moment it mounts. Empty states ("Connect Loop", "Connect EVM")
 * stay terse and are clickable links to /stake (PORT_GUIDE §8 ties
 * connect flow to the Stake page).
 *
 * NOT YET MOUNTED in app/layout.tsx — that swap happens in Step 6
 * to avoid breaking the still-old shipped pages.
 */

type Route = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

const NAV: Route[] = [
  { href: "/", label: "Home", icon: <IconHome /> },
  { href: "/dashboard", label: "Dashboard", icon: <IconBolt /> },
  { href: "/stake", label: "Stake", icon: <IconArrowRight /> },
  { href: "/positions", label: "Positions", icon: <IconShield /> },
  { href: "/portfolio", label: "Portfolio", icon: <IconChart /> },
  { href: "/rewards", label: "Rewards", icon: <IconCoin size={11} /> },
  { href: "/analytics", label: "Analytics", icon: <IconChart /> },
  { href: "/settings", label: "Settings", icon: <IconShield /> },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function truncateParty(partyId: string): string {
  const parts = partyId.split("::");
  if (parts.length >= 2) {
    return `${parts[0]}::${parts[1].slice(0, 8)}...`;
  }
  return `${partyId.slice(0, 12)}...`;
}

function truncateAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function IdentityChip({
  label,
  value,
  showDot,
  onClick,
  active,
}: {
  label: string;
  value: string;
  showDot?: boolean;
  onClick?: () => void;
  active?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        border: `1px solid ${active ? tokens.neon : tokens.hairline}`,
        borderRadius: 0,
        background: "transparent",
        color: tokens.ink[100],
        cursor: onClick ? "pointer" : "default",
        font: "inherit",
        transition: "border-color 120ms ease",
      }}
    >
      <span className="mono" style={{ fontSize: 10, color: tokens.ink[400] }}>
        {label}
      </span>
      <span
        className="mono tabular"
        style={{ fontSize: 11, color: tokens.ink[100] }}
      >
        {value}
      </span>
      {showDot ? <StatusDot /> : null}
    </Tag>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const { address, isConnected } = useAccount();
  const { partyId, isConnected: loopConnected } = useCantonWallet();
  const { openPicker } = useWalletPicker();
  const { data: health } = useQuery({
    queryKey: ["health-detail-topnav"],
    queryFn: fetchHealthDetail,
    refetchInterval: 60_000,
  });
  const badge = deriveBadge(health);
  const badgeColor =
    badge.color === "neon"
      ? tokens.neon
      : badge.color === "cc"
        ? tokens.cc
        : tokens.amberBright;

  return (
    <header
      style={{
        borderBottom: `1px solid ${tokens.hairline}`,
        background: "rgba(10,10,11,0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 32,
          height: 54,
          padding: "0 22px",
          maxWidth: 1440,
          margin: "0 auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24, flexShrink: 0 }}>
          {/* Brand cluster */}
          <Link
            href="/"
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <Logo size={28} />
            <span
              className="display"
              style={{
                fontSize: 21,
                fontStyle: "italic",
                color: tokens.ink[100],
              }}
            >
              CantonStake
            </span>
            <span
              className="mono"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 8px",
                fontSize: 9,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: ".1em",
                border: `1px solid ${badgeColor}`,
                color: badgeColor,
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: badgeColor,
                  animation: "pulse-dot 2s infinite",
                }}
              />
              {badge.label}
            </span>
          </Link>

          {/* Nav */}
          <nav style={{ display: "flex", gap: 2 }}>
            {NAV.map((it) => {
              const active = isActive(pathname ?? "/", it.href);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className="mono"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "7px 12px",
                    background: active ? tokens.ink[800] : "transparent",
                    color: active ? tokens.ink[100] : tokens.ink[400],
                    fontSize: 11.5,
                    fontWeight: 500,
                    letterSpacing: ".04em",
                    textTransform: "uppercase",
                    transition: "color 120ms ease, background 120ms ease",
                  }}
                >
                  {it.icon}
                  {it.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right cluster */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
            flexWrap: "nowrap",
          }}
        >
          <CCRoundTicker />
          <IdentityChip
            label="LOOP PARTY"
            value={
              loopConnected && partyId ? truncateParty(partyId) : "not connected"
            }
            showDot={loopConnected}
            onClick={openPicker}
            active={!loopConnected}
          />
          <IdentityChip
            label="EVM WALLET"
            value={isConnected && address ? truncateAddr(address) : "not connected"}
            onClick={openPicker}
            active={!isConnected}
          />
        </div>
      </div>
      <PriceTape />
    </header>
  );
}
