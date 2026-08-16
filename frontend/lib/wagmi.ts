"use client";

import { http, createConfig } from "wagmi";
import { bscTestnet, monadTestnet, polygonAmoy } from "wagmi/chains";
import { coinbaseWallet, injected, safe, walletConnect } from "wagmi/connectors";
import { polygonSettlementChain } from "@/lib/chains";

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
  chains: [polygonSettlementChain, polygonAmoy, monadTestnet, bscTestnet],
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
    [polygonSettlementChain.id]: http(
      process.env.NEXT_PUBLIC_SETTLEMENT_RPC_URL ||
        "https://ethereum-sepolia-rpc.publicnode.com",
    ),
    [polygonAmoy.id]: http(
      process.env.NEXT_PUBLIC_AMOY_RPC_URL ||
        "https://polygon-amoy-bor-rpc.publicnode.com",
    ),
    [monadTestnet.id]: http(),
    [bscTestnet.id]: http(),
  },
  ssr: true,
});
