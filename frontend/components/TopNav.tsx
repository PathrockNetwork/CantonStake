"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useChainId } from "wagmi";
import { polygonAmoy } from "wagmi/chains";

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function TopNav() {
  const pathname = usePathname();
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();

  const nav = [
    { label: "Stake", href: "/stake" },
    { label: "Positions", href: "/positions" },
    { label: "Rewards", href: "/rewards" },
  ];

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
          {isConnected ? (
            <button
              onClick={() => disconnect()}
              className="font-mono text-xs uppercase tracking-wider text-ink-300 hover:text-ink-100 hairline px-3 py-1.5"
            >
              {truncate(address!)}
            </button>
          ) : (
            <button
              onClick={() =>
                connect({ connector: connectors[0] })
              }
              className="font-mono text-xs uppercase tracking-wider bg-amber hover:bg-amber-bright transition-colors text-ink-950 px-4 py-1.5 font-semibold"
            >
              Connect
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
