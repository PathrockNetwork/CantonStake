"use client";

import { http, createConfig } from "wagmi";
import { moonbaseAlpha, monadTestnet, polygonAmoy } from "wagmi/chains";
import { coinbaseWallet, injected, safe, walletConnect } from "wagmi/connectors";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

const APP_METADATA = {
  name: "CantonStake",
  description:
    "Self-custodial cross-chain staking with Canton Coin rewards",
  url: "https://cantonstake.app",
  icons: ["https://cantonstake.app/icon.png"],
};

export const wagmiConfig = createConfig({
  // All EVM testnets the staking flow supports. The user's wallet handles
  // chain switching via wagmi's `useSwitchChain` when the stake page
  // selects a non-active chain.
  chains: [polygonAmoy, moonbaseAlpha, monadTestnet],
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
    [polygonAmoy.id]: http(),
    [moonbaseAlpha.id]: http(),
    [monadTestnet.id]: http(),
  },
  ssr: true,
});