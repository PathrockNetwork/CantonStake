"use client";

import { http, createConfig } from "wagmi";
import { coinbaseWallet, injected, safe, walletConnect } from "wagmi/connectors";
import { bnbEvmChain, monadEvmChain, polygonNativeChain, polygonSettlementChain } from "@/lib/chains";
import { rpcEndpoint } from "./rpc";
import { hoodi } from "wagmi/chains";
import { networkMode } from "./network";
import { HOODI_RPC } from "./lido";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

const APP_METADATA = {
  name: "CantonStake",
  description:
    "Self-custodial cross-chain staking with Canton Coin rewards",
  url: "https://cantonstake.app",
  icons: ["https://cantonstake.app/icon.png"],
};

export const wagmiConfig = createConfig({
  // All EVM chains the staking flow touches. Note the settlement chain
  // (Sepolia / Ethereum mainnet): Polygon PoS staking contracts live on L1,
  // so a POL delegation is signed there, while Bor/Amoy stays in the list for
  // POL balance reads and explorer links.
  chains: [polygonSettlementChain, polygonNativeChain, monadEvmChain, bnbEvmChain, ...(networkMode === "testnet" ? [hoodi] : [])],
  connectors: [
    // Browser-injected wallets — MetaMask, Rabby, Brave, Frame, etc.
    injected(),
    // Coinbase Wallet — desktop extension + mobile via deep link.
    coinbaseWallet({
      appName: APP_METADATA.name,
      appLogoUrl: APP_METADATA.icons[0],
    }),
    // Safe (Gnosis) — recognised when the dApp is loaded inside the Safe app.
    safe(),
    // WalletConnect v2 — mobile wallets, Ledger Live, Trust, Rainbow, etc.
    ...(projectId
      ? [
          walletConnect({
            projectId,
            metadata: APP_METADATA,
            showQrModal: true,
          }),
        ]
      : []),
  ],
  transports: {
    [hoodi.id]: http(HOODI_RPC, { timeout: 15000, retryCount: 1 }),
    [polygonSettlementChain.id]: http(rpcEndpoint("settlement"), { timeout: 16_000, retryCount: 0 }),
    [polygonNativeChain.id]: http(rpcEndpoint("polygon"), { timeout: 16_000, retryCount: 0 }),
    [monadEvmChain.id]: http(rpcEndpoint("monad"), { timeout: 16_000, retryCount: 0 }),
    [bnbEvmChain.id]: http(rpcEndpoint("bnb"), { timeout: 16_000, retryCount: 0 }),
  },
  ssr: true,
});
