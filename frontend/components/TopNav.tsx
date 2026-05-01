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

  const nav = [
    { label: "Dashboard", href: "/" },
    { label: "Stake", href: "/stake" },
    { label: "Positions", href: "/positions" },
    { label: "Rewards", href: "/rewards" },
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
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-7">
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

          <nav className="hidden items-center gap-1 text-sm md:flex">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-sm px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
                    active
                      ? "bg-ink-800 text-ink-100"
                      : "text-ink-400 hover:text-ink-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
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
                  className="bg-amber px-4 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-ink-950 transition-colors hover:bg-amber-bright disabled:opacity-50"
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
