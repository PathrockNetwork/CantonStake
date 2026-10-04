import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StakeChainPicker } from "./StakeChainPicker";
import { CHAINS } from "@/lib/chains";
import type { WatcherStatus } from "@/lib/api";

vi.mock("@/components/account/AccountUI", async () => ({
  ChainBadge: (await import("@/components/account/ChainBadge")).ChainBadge,
  StatusBadge: ({ status }: { status: string }) => React.createElement("span", null, status),
}));
beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

const watchers: WatcherStatus[] = CHAINS.map(chain => ({
  chain: chain.id, status: "ok", lastError: null, lastSuccessAt: new Date().toISOString(), consecutiveFailures: 0,
}));
function render(overrides: Partial<React.ComponentProps<typeof StakeChainPicker>> = {}) {
  return renderToStaticMarkup(React.createElement(StakeChainPicker, {
    chains: CHAINS, selectedChainId: "polygon", enabledChainIds: CHAINS.map(chain => chain.id),
    watchers, busy: false, onSelect: vi.fn(), ...overrides,
  }));
}

describe("multichain staking picker", () => {
  it("renders every configured network with its token and selected state", () => {
    const html = render();
    expect((html.match(/class="account-chain-option"/g) ?? []).length).toBe(10);
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    for (const chain of CHAINS) {
      expect(html).toContain(chain.id === "polygon" ? "Polygon PoS" : chain.name);
      expect(html).toContain(chain.symbol);
      expect(html).toContain(`src="/networks/${chain.id}.svg"`);
    }
    expect(html).toContain("Search networks");
    expect(html).toContain("Watcher ready");
    expect(html).not.toContain("Supported");
    expect((html.match(/<img /g) ?? []).length).toBe(10);
  });

  it("allows inspecting unavailable networks without claiming they are stake-ready", () => {
    const html = render({ watchers: watchers.map(w => ({ ...w, status: "unreachable" })) });
    expect(html).toContain("Watcher unavailable");
    expect(html).not.toContain("disabled=\"\"");
    expect(html).toContain("Signing requires a ready watcher and Canton connection");
  });

  it("distinguishes loading, backend-disabled, and failed status checks", () => {
    expect(render({ enabledChainIds: undefined })).toContain("Checking");
    expect(render({ enabledChainIds: ["polygon"] })).toContain("Not enabled");
    const failed = render({ statusUnavailable: true });
    expect(failed).toContain("Status unavailable");
    expect(failed).not.toContain("Watcher ready");
  });

  it("locks network selection during an active transaction", () => {
    const html = render({ busy: true });
    expect((html.match(/<button[^>]*disabled=""/g) ?? []).length).toBe(11);
  });

  it("starts with a collapsed, labelled mobile network control", () => {
    const html = render();
    expect(html).toMatch(/class="account-chain-toggle" aria-expanded="false" aria-controls="[^"]+"/);
    expect(html).toContain("Change network ↓");
    expect(html).not.toContain("account-chain-picker__content is-expanded");
  });

  it("does not use the Sepolia watcher to label the Amoy liquid route", () => {
    const html = render({ polygonLiquid: true, watchers: watchers.map(w => ({ ...w, status: "unreachable" })) });
    expect(html).toContain("Liquid route · Amoy");
    expect(html).toContain("Each route checks its own readiness");
    expect(html).not.toContain("Signing requires a ready watcher and Canton connection");
    expect(html).toContain("Watcher unavailable");
  });
});
