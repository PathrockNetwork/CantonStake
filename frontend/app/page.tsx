import { ConnectGate } from "@/components/ConnectGate";
import { Dashboard } from "@/components/Dashboard";
import { MarketingHero } from "@/components/MarketingHero";

export default function HomePage() {
  return (
    <ConnectGate fallback={<MarketingHero />}>
      <Dashboard />
    </ConnectGate>
  );
}
