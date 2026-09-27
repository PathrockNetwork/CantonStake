import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChainBadge, NETWORK_LOGOS } from "./ChainBadge";
import { CHAINS } from "@/lib/chains";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

describe("network logos", () => {
  it("ships a safe, local SVG for every configured network", () => {
    expect(Object.keys(NETWORK_LOGOS).sort()).toEqual(CHAINS.map(c => c.id).sort());
    for (const chain of CHAINS) {
      const src = NETWORK_LOGOS[chain.id];
      const svg = readFileSync(path.join(process.cwd(), "public", src), "utf8");
      expect(svg).toMatch(/<svg[\s>]/);
      expect(svg).toContain("viewBox=");
      expect(svg).not.toMatch(/<script\b|<foreignObject\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?!#)|<!ENTITY/i);
      const html = renderToStaticMarkup(<ChainBadge chainId={chain.id} symbol={chain.symbol} label={chain.name} />);
      expect(html).toContain(`src="${src}"`);
      expect(html).toContain('alt=""');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(chain.name);
    }
  });

  it("resolves testnet token aliases and preserves a text fallback for unknown tokens", () => {
    expect(renderToStaticMarkup(<ChainBadge symbol="WND" label="Westend" />)).toContain("/networks/polkadot.svg");
    expect(renderToStaticMarkup(<ChainBadge symbol="tBNB" label="BNB Testnet" />)).toContain("/networks/bnb.svg");
    const unknown = renderToStaticMarkup(<ChainBadge symbol="XYZ" label="Future network" />);
    expect(unknown).not.toContain("<img");
    expect(unknown).toContain("Future network");
  });

  it("uses explicit chain identity ahead of a token symbol", () => {
    expect(renderToStaticMarkup(<ChainBadge chainId="polkadot" symbol="POL" />)).toContain("/networks/polkadot.svg");
  });
});
