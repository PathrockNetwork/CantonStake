"use client";

import { useState } from "react";
import type { ChainConfig } from "@/lib/chains";

export const NETWORK_LOGOS = {
  polygon: "/networks/polygon.svg", monad: "/networks/monad.svg",
  cosmos: "/networks/cosmos.svg", celestia: "/networks/celestia.svg",
  osmosis: "/networks/osmosis.svg", sui: "/networks/sui.svg",
  aptos: "/networks/aptos.svg", polkadot: "/networks/polkadot.svg",
  bnb: "/networks/bnb.svg", solana: "/networks/solana.svg",
} satisfies Record<ChainConfig["id"], string>;

const SYMBOL_CHAINS: Record<string, ChainConfig["id"] | undefined> = {
  POL: "polygon", MATIC: "polygon", MON: "monad", ATOM: "cosmos",
  TIA: "celestia", OSMO: "osmosis", SUI: "sui", APT: "aptos",
  DOT: "polkadot", WND: "polkadot", BNB: "bnb", TBNB: "bnb", SOL: "solana",
};

export function ChainBadge({ chainId, symbol = "POL", label = "Polygon PoS" }: {
  chainId?: ChainConfig["id"]; symbol?: string; label?: string;
}) {
  const chain = chainId ?? SYMBOL_CHAINS[symbol.toUpperCase()];
  const src = chain ? NETWORK_LOGOS[chain] : undefined;
  const [failedSrc, setFailedSrc] = useState<string>();
  return <span className="account-chain">
    <span className="account-chain__mark" data-network={chain} aria-hidden="true">
      {src && failedSrc !== src
        // Local SVGs have intrinsic dimensions; no image proxy is needed.
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={src} width={32} height={32} alt="" decoding="async" onError={() => setFailedSrc(src)} />
        : <span className="account-chain__fallback">{symbol.slice(0, 2)}</span>}
    </span>{label}
  </span>;
}
