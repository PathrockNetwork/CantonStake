import Link from "next/link";
import { polygonChain } from "@/lib/chains";

export function MarketingHero() {
  const activeChain = polygonChain();

  return (
    <div className="space-y-24 py-8">
      <section className="grid grid-cols-12 gap-6 items-start">
        <div className="col-span-12 md:col-span-8">
          <p className="font-mono text-xxs uppercase tracking-widest text-amber-bright mb-6">
            canton network · featured app candidate · hackathon mvp
          </p>
          <h1 className="font-display text-6xl md:text-7xl leading-[0.95] mb-8">
            Stake on Polygon.
            <br />
            <span className="italic text-ink-300">Earn on Canton.</span>
          </h1>
          <p className="text-ink-200 text-lg leading-relaxed max-w-xl">
            CantonStake is a Canton-native staking application. Users delegate
            POL to Polygon validators through their own wallet. Every
            economically meaningful transition — bond, unbond — emits an
            on-ledger Featured App activity marker, converting real-world
            staking activity into Canton Coin rewards.
          </p>
          <div className="flex items-center gap-4 mt-10">
            <Link
              href="/stake"
              className="font-mono text-xs uppercase tracking-wider bg-amber hover:bg-amber-bright transition-colors text-ink-950 px-6 py-3 font-semibold"
            >
              Open staking console →
            </Link>
            <Link
              href="/positions"
              className="font-mono text-xs uppercase tracking-wider text-ink-300 hover:text-ink-100 hairline px-6 py-3"
            >
              View positions
            </Link>
          </div>
        </div>
        <aside className="col-span-12 md:col-span-4 hairline p-6 bg-ink-900/40 space-y-5">
          <div>
            <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-2">
              chain
            </div>
            <div className="font-display text-2xl">{activeChain.name}</div>
            <div className="font-mono text-xs text-ink-300">
              chain id {activeChain.wagmiChain?.id} ·{" "}
              {activeChain.symbol.toLowerCase()}
            </div>
          </div>
          <div>
            <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-2">
              ledger
            </div>
            <div className="font-display text-2xl">Canton LocalNet</div>
            <div className="font-mono text-xs text-ink-300">
              daml 3.3 · splice · cip-47
            </div>
          </div>
          <div>
            <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-2">
              reward mechanics
            </div>
            <div className="font-display text-2xl">75 / 25 split</div>
            <div className="font-mono text-xs text-ink-300">
              delegator / app treasury
            </div>
          </div>
        </aside>
      </section>

      <section>
        <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-4">
          § 01 · state machine
        </div>
        <h2 className="font-display text-4xl mb-10">
          One lifecycle. Two ledgers.
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-ink-700">
          {[
            { phase: "pending", title: "Request", canton: "StakingRequest created", polygon: "—", marker: false },
            { phase: "bonded", title: "Bond", canton: "StakingPosition · Bonded", polygon: "buyVoucher → ShareMinted", marker: true },
            { phase: "unbonding", title: "Unbond", canton: "ConfirmUnbond · Unbonding", polygon: "sellVoucher_new → ShareBurned", marker: true },
            { phase: "released", title: "Release", canton: "Release · Released", polygon: "unstakeClaimTokens_new", marker: false },
          ].map((step, i) => (
            <div
              key={step.phase}
              className="bg-ink-950 p-6 hover:bg-ink-900 transition-colors"
            >
              <div className="flex items-baseline gap-2 mb-4">
                <span className="font-mono text-xxs text-ink-400">
                  0{i + 1}
                </span>
                <span className="font-mono text-xxs uppercase tracking-widest text-amber-bright">
                  {step.phase}
                </span>
              </div>
              <div className="font-display text-2xl mb-4">{step.title}</div>
              <div className="space-y-2 text-sm">
                <div>
                  <div className="font-mono text-xxs uppercase tracking-wider text-ink-400">
                    canton
                  </div>
                  <div className="text-ink-200">{step.canton}</div>
                </div>
                <div>
                  <div className="font-mono text-xxs uppercase tracking-wider text-ink-400">
                    polygon
                  </div>
                  <div className="text-ink-200 font-mono text-xs">
                    {step.polygon}
                  </div>
                </div>
                {step.marker && (
                  <div className="pt-3">
                    <span className="chip chip-dot text-amber-bright">
                      marker emitted
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-12 gap-8">
        <div className="col-span-12 md:col-span-4">
          <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-4">
            § 02 · why canton
          </div>
          <h2 className="font-display text-4xl leading-tight">
            Rewards that track real activity.
          </h2>
        </div>
        <div className="col-span-12 md:col-span-8 space-y-6 text-ink-200 leading-relaxed">
          <p>
            CIP-47 Featured Application Activity Markers let any approved app
            attest on-ledger that an economically meaningful event happened — a
            bond, an unbond, a settlement. Super Validator automation converts
            each marker into an <em>AppRewardCoupon</em>, which mints Canton
            Coin in the next 10-minute round.
          </p>
          <p>
            CantonStake uses markers only where the CIP-47 guidance permits:
            on state transitions that represent real value movement. We do not
            mark intermediate propose steps.
          </p>
          <p>
            The beneficiary split is defined in the Daml contract itself: 75%
            of each marker's reward weight flows directly to the delegator's
            Canton party, 25% to the app treasury. No custodial middleman, no
            off-ledger accounting.
          </p>
        </div>
      </section>
    </div>
  );
}
