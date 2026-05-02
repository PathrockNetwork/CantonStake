"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect } from "wagmi";
import { CcPriceChip } from "@/components/CcPriceChip";
import { LoopWalletPill } from "@/components/LoopWalletPill";
import { NotificationButton } from "@/components/NotificationButton";
import { polygonChain } from "@/lib/chains";
import { useLoopWallet } from "@/lib/loop-wallet";

function truncate(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function connectorLabel(connector: { name: string; uid: string }): string {
  const name = connector.name.toLowerCase();
  if (name.includes("walletconnect") || name.includes("wc")) return "Ledger / WalletConnect";
  if (name.includes("meta mask") || name.includes("metamask")) return "MetaMask";
  if (name.includes("injected") || name.includes("browser")) return "Browser Wallet";
  return connector.name;
}

type NavIconType = "home" | "coin" | "chart" | "shield" | "gear";

function NavIcon({ type }: { type: NavIconType }) {
  if (type === "coin") {
    return <span className="inline-block h-3 w-3 rounded-full bg-cc" aria-hidden="true" />;
  }

  const common = "h-4 w-4 text-current";
  if (type === "home") {
    return (
      <svg className={common} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 7.2 8 2.8l5.5 4.4v6a.7.7 0 0 1-.7.7H10V9.5H6v4.4H3.2a.7.7 0 0 1-.7-.7v-6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "chart") {
    return (
      <svg className={common} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 12.5h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="m3 10 3-3 2.2 2.1L13 4.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "shield") {
    return (
      <svg className={common} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 2.2 13 4v3.2c0 3-1.9 5.2-5 6.6-3.1-1.4-5-3.6-5-6.6V4l5-1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className={common} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.9 2.4h2.2l.4 1.5c.4.1.8.3 1.1.5l1.4-.8 1.1 1.9-1.1 1.1c.1.4.1.8 0 1.2l1.1 1.1-1.1 1.9-1.4-.8c-.3.2-.7.4-1.1.5l-.4 1.5H6.9l-.4-1.5c-.4-.1-.8-.3-1.1-.5l-1.4.8-1.1-1.9L4 7.8a4.6 4.6 0 0 1 0-1.2L2.9 5.5 4 3.6l1.4.8c.3-.2.7-.4 1.1-.5l.4-1.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <circle cx="8" cy="7.6" r="1.8" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const activeChain = polygonChain();
  const activeWagmiChain = activeChain.wagmiChain!;
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
    register: registerLoop,
    refreshBalance,
    isConnecting: loopConnecting,
  } = useLoopWallet();

  const nav: Array<{ label: string; href: string; icon: NavIconType }> = [
    { label: "Dashboard", href: "/", icon: "home" },
    { label: "CC Rewards", href: "/rewards", icon: "coin" },
    { label: "Analytics", href: "/analytics", icon: "chart" },
    { label: "Validators", href: "/validators", icon: "shield" },
    { label: "Settings", href: "/settings", icon: "gear" },
  ];
  const wrongNetwork = isConnected && chainId !== activeWagmiChain.id;

  const handleConnect = () => {
    if (connectors.length === 1) {
      connect({ connector: connectors[0] });
      return;
    }
    setShowPicker(true);
  };

  useEffect(() => {
    if (!loopConnected || !partyId || !address) return;

    void registerLoop(address);
    void refreshBalance(address);
    const id = window.setInterval(() => {
      void refreshBalance(address);
    }, 10_000);

    return () => window.clearInterval(id);
  }, [address, loopConnected, partyId, refreshBalance, registerLoop]);

  return (
    <header className="hairline-b sticky top-0 z-50 bg-ink-950/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-5 px-6">
        <div className="flex min-w-0 items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              className="grid h-7 w-7 place-items-center bg-amber-bright font-mono text-[10px] font-bold text-ink-950"
              style={{
                clipPath:
                  "polygon(25% 6%, 75% 6%, 100% 50%, 75% 94%, 25% 94%, 0 50%)",
              }}
              aria-hidden="true"
            >
              CS
            </span>
            <span className="font-display text-xl italic">CantonStake</span>
            <span className="rounded-full border border-neon/30 bg-neon/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-neon">
              Featured
            </span>
          </Link>

          <nav className="hidden min-w-0 items-center gap-1 text-sm md:flex">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                    active
                      ? "bg-ink-800 text-ink-100"
                      : "text-ink-400 hover:text-ink-100"
                  }`}
                >
                  <NavIcon type={item.icon} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <CcPriceChip />
          <NotificationButton />

          {loopConnected && partyId ? (
            <LoopWalletPill
              partyId={partyId}
              ccBalance={ccBalance}
              onDisconnect={disconnectLoop}
            />
          ) : (
            <button
              type="button"
              onClick={() => connectLoop(undefined, address)}
              disabled={loopConnecting}
              className="hairline rounded-full px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-neon transition-colors hover:text-neon/80 disabled:opacity-50"
            >
              {loopConnecting ? "Connecting..." : "Connect Loop"}
            </button>
          )}

          <span className="mx-1 h-6 w-px bg-ink-700" aria-hidden="true" />

          {wrongNetwork && (
            <span className="chip chip-dot text-danger">
              WRONG NETWORK · SWITCH TO {activeChain.name.toUpperCase()}
            </span>
          )}

          <div className="relative">
            {isConnected ? (
              <button
                type="button"
                onClick={() => disconnect()}
                className="hairline flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-300 transition-colors hover:text-ink-100"
                title={activeConnector?.name}
              >
                <span className="text-ink-500">
                  {activeConnector?.name === "WalletConnect" ? "WC" : "EVM"}
                </span>
                <span>{truncate(address!)}</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={isPending}
                  className="bg-neon px-4 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-neon-text transition-colors hover:bg-neon/90 disabled:opacity-50"
                >
                  {isPending ? "Connecting..." : "Connect"}
                </button>

                {showPicker && (
                  <div className="absolute right-0 top-10 z-50 min-w-[240px] rounded-sm border border-ink-700 bg-ink-900 shadow-lg">
                    <div className="border-b border-ink-700 px-4 py-2">
                      <span className="font-mono text-xxs uppercase tracking-widest text-ink-400">
                        Select Wallet
                      </span>
                    </div>
                    {connectors.map((connector) => (
                      <button
                        key={connector.uid}
                        type="button"
                        onClick={() => {
                          connect({ connector });
                          setShowPicker(false);
                        }}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-800"
                      >
                        <span className="text-sm text-ink-100">
                          {connectorLabel(connector)}
                        </span>
                        <span className="ml-auto font-mono text-xxs text-ink-400">
                          {connector.name.toLowerCase().includes("walletconnect")
                            ? "Hardware"
                            : "Software"}
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setShowPicker(false)}
                      className="w-full border-t border-ink-700 px-4 py-2 text-left text-xs text-ink-400 hover:text-ink-200"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
