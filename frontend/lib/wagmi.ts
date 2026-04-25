"use client";

import { http, createConfig } from "wagmi";
import { polygonAmoy } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

export const wagmiConfig = createConfig({
  chains: [polygonAmoy],
  connectors: [
    injected(),
    // WalletConnect v2 connector — supports Ledger Hardware Wallets
    // via the Ledger Live mobile app and WalletConnect protocol.
    // Users scan a QR code with Ledger Live; all signing happens on-device.
    ...(projectId
      ? [
          walletConnect({
            projectId,
            metadata: {
              name: "CantonStake",
              description:
                "Self-custodial cross-chain staking with Canton Coin rewards",
              url: "https://cantonstake.app",
              icons: ["https://cantonstake.app/icon.png"],
            },
            showQrModal: true,
          }),
        ]
      : []),
  ],
  transports: {
    [polygonAmoy.id]: http(),
  },
  ssr: true,
});