"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import { CCRoundTicker } from "@/components/chrome/CCRoundTicker";
import { PriceTape } from "@/components/chrome/PriceTape";
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
import { useLoopWallet } from "@/lib/loop-wallet";

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
 * `useLoopWallet()` and `useAccount()` so the chrome is honest the
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
  { href: "/rewards", label: "Rewards", icon: <IconCoin size={11} /> },
  { href: "/analytics", label: "Analytics", icon: <IconChart /> },
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
}: {
  label: string;
  value: string;
  showDot?: boolean;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        border: `1px solid ${tokens.hairline}`,
        borderRadius: 0,
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
    </div>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const { address, isConnected } = useAccount();
  const { partyId, isConnected: loopConnected } = useLoopWallet();

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
                border: `1px solid ${tokens.neon}`,
                color: tokens.neon,
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: tokens.neon,
                  animation: "pulse-dot 2s infinite",
                }}
              />
              Candidate · Devnet
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
          />
          <IdentityChip
            label="EVM WALLET"
            value={isConnected && address ? truncateAddr(address) : "not connected"}
          />
        </div>
      </div>
      <PriceTape />
    </header>
  );
}
