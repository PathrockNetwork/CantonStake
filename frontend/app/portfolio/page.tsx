import Link from "next/link";
import { Card } from "@/components/Card";
import { ConnectGate } from "@/components/ConnectGate";
import { Dashboard } from "@/components/Dashboard";

export default function PortfolioPage() {
  return (
    <ConnectGate fallback={<PortfolioFallback />}>
      <Dashboard />
    </ConnectGate>
  );
}

function PortfolioFallback() {
  return (
    <div className="py-8">
      <Card padding={32} className="mx-auto max-w-3xl text-center">
        <p className="font-mono text-xxs uppercase tracking-[0.18em] text-neon">
          Portfolio
        </p>
        <h1 className="mt-3 font-sans text-4xl font-semibold tracking-tight text-ink-100">
          Connect your wallet to view staking positions.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-ink-400">
          Portfolio shows your active stakes, native rewards, Canton Coin
          earnings, and blended APY once an EVM wallet is connected.
        </p>
        <Link
          href="/stake"
          className="mt-6 inline-flex rounded-xl bg-neon px-5 py-3 font-sans text-sm font-semibold text-neon-text transition hover:bg-neon/90"
        >
          Open staking console
        </Link>
      </Card>
    </div>
  );
}
