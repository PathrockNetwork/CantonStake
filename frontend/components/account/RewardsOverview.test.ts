import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { RewardsOverview } from "./RewardsOverview";
import type { RewardHistoryEvent } from "@/lib/api";

vi.mock("@/components/WalletPickerProvider", () => ({ useWalletPicker: () => ({ openPicker: vi.fn() }) }));
const payout: RewardHistoryEvent = { id: "pol", kind: "native", time: "2026-09-30T12:00:00Z", amount: "1.25", symbol: "POL",
  chain: "polygon", positionId: "polygon-position", roundNumber: null, transactionId: "receipt", status: "Recorded" };
const props = (): React.ComponentProps<typeof RewardsOverview> => ({ history: [], connected: true, available: true, loading: false, failed: false, partial: false, days: 30 });
const render = (p = props()) => renderToStaticMarkup(React.createElement(RewardsOverview, p));
beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

describe("unified rewards overview", () => {
  it("uses one panel and table for Canton and multiple network payout rows", () => {
    const p = props(); p.history = [payout, { ...payout, id: "mon", chain: "monad", symbol: "MON", amount: "3" },
      { ...payout, id: "cc", kind: "cc", symbol: "CC", amount: "0.75" }];
    const html = render(p);
    expect(html.match(/<section /g)).toHaveLength(1);
    expect(html.match(/<table /g)).toHaveLength(1);
    expect(html.match(/data-reward-kind="native"/g)).toHaveLength(2);
    expect(html).toContain("1.25 POL"); expect(html).toContain("3.00 MON"); expect(html).toContain("0.75 CC");
    expect(html).not.toContain("4.25 POL");
    expect(html).not.toContain("account-reward-stream");
    expect(html).toContain("/networks/monad.svg");
  });
  it("has no empty POL row or estimated yield when there are no native payout records", () => {
    const html = render();
    expect(html).toContain("0 CC");
    expect(html).not.toContain("0 POL");
    expect(html).not.toContain('data-reward-kind="native"');
    expect(html).toContain("Staked balances and unmeasured yield are excluded.");
  });
  it("totals beneficiary allocations only from the selected period's events", () => {
    const p = props(); p.days = 7; p.history = [
      { ...payout, kind: "cc", symbol: "CC", amount: "0.75" },
      { ...payout, kind: "cc", symbol: "CC", amount: "0.25" },
    ];
    expect(render(p)).toContain("1.00 CC");
    expect(render(p)).toContain("last 7 days");
  });
  it("does not expose cached totals when disconnected", () => {
    const p = props(); p.connected = false; p.history = [payout];
    expect(render(p)).toContain("Connect your wallet");
    expect(render(p)).not.toContain("1.25 POL");
    expect(render(p)).not.toContain("<table");
  });
  it("shows unavailable totals, not fake zeros or old native payouts, on history failure", () => {
    const p = props(); p.failed = true; p.history = [payout];
    expect(render(p)).toContain("Reward totals are temporarily unavailable.");
    expect(render(p)).not.toContain("1.25 POL");
    expect(render(p)).not.toContain("0 CC");
    expect(render(p)).toContain("—");
  });
  it("shows loading without assuming that unavailable history is empty", () => {
    const p = props(); p.available = false; p.loading = true;
    expect(render(p)).toContain("Loading recorded rewards…");
    expect(render(p)).not.toContain("0 CC");
  });
  it("marks capped history totals as displayed amounts rather than full-period totals", () => {
    const p = props(); p.partial = true; p.history = [payout];
    expect(render(p)).toContain("Displayed allocations and payouts");
    expect(render(p)).toContain("latest displayed events, not the full period");
  });
  it("does not replace an invalid CC allocation with a fabricated zero", () => {
    const p = props(); p.history = [{ ...payout, kind: "cc", amount: "NaN" }];
    expect(render(p)).not.toContain("0 CC");
    expect(render(p)).not.toContain("NaN CC");
    expect(render(p)).toContain("—");
  });
});
