"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useChainId } from "wagmi";
import { polygonAmoy } from "wagmi/chains";
import { useState } from "react";
import { useLoopWallet } from "@/lib/loop-wallet";

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function truncateParty(partyId: string) {
  // Party IDs are like "Name::1220hash..." — show first segment + truncated hash
  const parts = partyId.split("::");
  if (parts.length >= 2) {
    return `${parts[0]}::${parts[1].slice(0, 8)}…`;
  }
  return `${partyId.slice(0, 10)}…`;
}

/** Human-readable labels for wagmi connector types. */
function connectorLabel(connector: { name: string; uid: string }): string {
  const n = connector.name.toLowerCase();
  if (n.includes("walletconnect") || n.includes("wc")) return "Ledger / WalletConnect";
  if (n.includes("meta mask") || n.includes("metamask")) return "MetaMask";
  if (n.includes("injected") || n.includes("browser")) return "Browser Wallet";
  return connector.name;
}

export function TopNav() {
  const pathname = usePathname();
  const { address, isConnected, connector: activeConnector } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const [showPicker, setShowPicker] = useState(false);
  const {
    partyId,
    isConnected: loopConnected,
    ccBalance,
    connect: connectLoop,
    disconnect: disconnectLoop,
    isConnecting: loopConnecting,
  } = useLoopWallet();

  const nav = [
    { label: "Stake", href: "/stake" },
    { label: "Positions", href: "/positions" },
    { label: "Rewards", href: "/rewards" },
  ];

  const handleConnect = () => {
    // If only one connector available, connect directly
    if (connectors.length === 1) {
      connect({ connector: connectors[0] });
      return;
    }
    // Otherwise show the picker
    setShowPicker(true);
  };

  return (
    <header className="hairline-b bg-ink-950/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-xl italic">CantonStake</span>
          <span className="font-mono text-xxs uppercase tracking-widest text-ink-400">
            v0.1 · amoy
          </span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
                  active
                    ? "text-amber-bright"
                    : "text-ink-300 hover:text-ink-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          {isConnected && chainId !== polygonAmoy.id && (
            <span className="chip chip-dot text-danger">wrong network</span>
          )}

          {/* Loop wallet (Canton identity) */}
          {loopConnected && partyId ? (
            <button
              onClick={() => disconnectLoop()}
              className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-ink-300 hover:text-ink-100 hairline px-3 py-1.5"
              title={`Loop: ${partyId}`}
            >
              <span className="text-amber-bright">◎</span>
              <span>{truncateParty(partyId)}</span>
              {ccBalance !== null && ccBalance > 0 && (
                <span className="text-amber-bright ml-1">
                  {ccBalance.toFixed(2)} CC
                </span>
              )}
            </button>
          ) : (
            <button
              onClick={() => connectLoop()}
              disabled={loopConnecting}
              className="font-mono text-xs uppercase tracking-wider hairline px-3 py-1.5 text-amber-bright hover:text-amber-glow disabled:opacity-50"
            >
              {loopConnecting ? "Connecting…" : "Connect Loop"}
            </button>
          )}

          {/* Divider between wallet types */}
          <span className="text-ink-600">|</span>

          {/* EVM wallet */}
          {isConnected ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xxs text-ink-400">
                {activeConnector?.name === "WalletConnect" ? "🔐" : "🦊"}
              </span>
              <button
                onClick={() => disconnect()}
                className="font-mono text-xs uppercase tracking-wider text-ink-300 hover:text-ink-100 hairline px-3 py-1.5"
              >
                {truncate(address!)}
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={handleConnect}
                disabled={isPending}
                className="font-mono text-xs uppercase tracking-wider bg-amber hover:bg-amber-bright transition-colors text-ink-950 px-4 py-1.5 font-semibold disabled:opacity-50"
              >
                {isPending ? "Connecting…" : "Connect"}
              </button>

              {/* Wallet picker dropdown */}
              {showPicker && (
                <div className="absolute top-14 right-6 bg-ink-900 border border-ink-700 rounded shadow-lg z-50 min-w-[240px]">
                  <div className="px-4 py-2 border-b border-ink-700">
                    <span className="font-mono text-xxs uppercase tracking-widest text-ink-400">
                      Select Wallet
                    </span>
                  </div>
                  {connectors.map((c) => (
                    <button
                      key={c.uid}
                      onClick={() => {
                        connect({ connector: c });
                        setShowPicker(false);
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-ink-800 transition-colors flex items-center gap-3"
                    >
                      <span className="text-sm text-ink-100">
                        {connectorLabel(c)}
                      </span>
                      <span className="ml-auto font-mono text-xxs text-ink-400">
                        {c.name.toLowerCase().includes("walletconnect")
                          ? "Hardware"
                          : "Software"}
                      </span>
                    </button>
                  ))}
                  <button
                    onClick={() => setShowPicker(false)}
                    className="w-full text-left px-4 py-2 text-xs text-ink-400 hover:text-ink-200 border-t border-ink-700"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}