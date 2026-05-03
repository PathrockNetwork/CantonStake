"use client";

import { useAccount } from "wagmi";
import { LifecycleDiagram } from "@/components/diagrams/LifecycleDiagram";
import { IconArrowRight } from "@/components/icons";
import { Banner } from "@/components/primitives/Banner";
import { Btn } from "@/components/primitives/Btn";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { tokens } from "@/lib/tokens";
import { useLoopWallet } from "@/lib/loop-wallet";

/**
 * Marketing landing — ported from
 * handoff/prototype/redesign/screens.jsx (`MarketingLanding`).
 *
 * The wallet-not-connected banner is wired to real hooks: it shows
 * when EITHER Loop or EVM is disconnected. Click "Connect wallets"
 * routes to /stake (PORT_GUIDE §8: wallet flow lives on Stake).
 *
 * Copy is verbatim from COPY_DECK.md / the prototype. System status
 * indicators are static — wire to real health probes when those exist.
 */
export default function HomePage() {
  const { isConnected: evmConnected } = useAccount();
  const { isConnected: loopConnected } = useLoopWallet();
  const showWalletBanner = !(evmConnected && loopConnected);

  return (
    <div
      style={{
        maxWidth: 1280,
        margin: "0 auto",
        padding: "56px 22px 80px",
        position: "relative",
      }}
    >
      <div
        className="grid-bg"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          opacity: 0.6,
        }}
        aria-hidden="true"
      />
      <div style={{ position: "relative", zIndex: 1 }}>
        {showWalletBanner && (
          <Banner
            tone="warn"
            kind="WALLET NOT CONNECTED"
            message="CantonStake uses two identities: Loop for Canton party and CC rewards. Your EVM wallet for Polygon staking signatures. CantonStake never holds your private keys or funds."
            action={
              <Btn href="/stake" size="sm">
                Connect wallets
              </Btn>
            }
          />
        )}

        <div
          className="mono"
          style={{
            fontSize: 10.5,
            letterSpacing: ".18em",
            color: tokens.amberBright,
            textTransform: "uppercase",
            marginBottom: 24,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 24,
              height: 1,
              background: tokens.amberBright,
            }}
          />
          canton network · featured app candidate · devnet mvp
        </div>

        <h1
          className="display"
          style={{
            fontSize: 88,
            lineHeight: 0.95,
            letterSpacing: "-.02em",
            margin: "0 0 32px",
            color: tokens.ink[100],
            maxWidth: 900,
          }}
        >
          Stake on Polygon.
          <br />
          <span style={{ fontStyle: "italic", color: tokens.ink[300] }}>
            Earn on Canton.
          </span>
        </h1>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr",
            gap: 32,
            alignItems: "start",
            marginBottom: 64,
          }}
        >
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.6,
              color: tokens.ink[200],
              maxWidth: 640,
              margin: 0,
            }}
          >
            Delegate POL from your own wallet. Canton records the staking
            lifecycle, emits reward markers at each economic transition, and
            routes Canton Coin through an on-ledger beneficiary split every 10
            minutes.
          </p>
          <div
            style={{
              padding: "18px 20px",
              background: tokens.ink[900],
              border: `1px solid ${tokens.hairline}`,
            }}
          >
            <SectionLabel>System status</SectionLabel>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: "10px 16px",
                marginTop: 14,
                fontSize: 11.5,
              }}
            >
              <span className="mono" style={{ color: tokens.ink[300] }}>
                Canton participant
              </span>
              <span className="mono" style={{ color: tokens.neon }}>
                ● OK
              </span>
              <span className="mono" style={{ color: tokens.ink[300] }}>
                Polygon Amoy
              </span>
              <span className="mono" style={{ color: tokens.neon }}>
                ● OK · 42ms
              </span>
              <span className="mono" style={{ color: tokens.ink[300] }}>
                Demo validator
              </span>
              <span className="mono" style={{ color: tokens.amberBright }}>
                ● ACTIVE
              </span>
              <span className="mono" style={{ color: tokens.ink[300] }}>
                CIP-47 markers
              </span>
              <span className="mono" style={{ color: tokens.neon }}>
                ● ENABLED
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 80 }}>
          <Btn href="/stake" size="lg" iconRight={<IconArrowRight />}>
            Open staking console
          </Btn>
          <Btn href="/positions" size="lg" variant="ghost">
            Inspect positions
          </Btn>
        </div>

        <SectionLabel style={{ marginBottom: 14 }}>
          § 01 · state machine
        </SectionLabel>
        <h2
          className="display"
          style={{ fontSize: 42, margin: "0 0 12px", color: tokens.ink[100] }}
        >
          One lifecycle. Two ledgers.
        </h2>
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.6,
            color: tokens.ink[300],
            maxWidth: 720,
            margin: "0 0 28px",
          }}
        >
          Polygon handles the staking transaction. Canton records the
          lifecycle state and emits reward markers at the economic transitions.
        </p>
        <LifecycleDiagram />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 2fr",
            gap: 48,
            marginTop: 80,
          }}
        >
          <div>
            <SectionLabel style={{ marginBottom: 14 }}>
              § 02 · why canton
            </SectionLabel>
            <h2
              className="display"
              style={{
                fontSize: 38,
                margin: 0,
                color: tokens.ink[100],
                lineHeight: 1.05,
              }}
            >
              Rewards that
              <br />
              track real activity.
            </h2>
          </div>
          <div
            style={{
              display: "grid",
              gap: 18,
              fontSize: 15,
              lineHeight: 1.65,
              color: tokens.ink[200],
            }}
          >
            <p style={{ margin: 0 }}>
              CIP-47 activity markers let an approved app attest on-ledger that
              an economically meaningful event happened — a bond or an unbond.
              Super Validator automation converts each marker into an{" "}
              <em style={{ color: tokens.cc }}>AppRewardCoupon</em>, which
              mints Canton Coin during the next 10-minute round.
            </p>
            <p style={{ margin: 0, color: tokens.ink[300] }}>
              The beneficiary split is encoded in Daml:{" "}
              <span style={{ color: tokens.neon }}>75%</span> direct to the
              delegator&rsquo;s Loop party,{" "}
              <span style={{ color: tokens.cc }}>25%</span> to the app
              treasury. The app does not collect rewards before distribution.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
