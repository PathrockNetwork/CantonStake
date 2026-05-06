"use client";

import "@mysten/dapp-kit/dist/index.css";

import { SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { WalletPickerProvider } from "@/components/WalletPickerProvider";
import { wagmiConfig } from "@/lib/wagmi";

const SUI_NETWORK =
  (process.env.NEXT_PUBLIC_SUI_NETWORK as
    | "mainnet"
    | "testnet"
    | "devnet"
    | undefined) ?? "testnet";
const SUI_RPC_URL =
  process.env.NEXT_PUBLIC_SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443";

const SUI_NETWORKS = {
  [SUI_NETWORK]: new SuiJsonRpcClient({
    url: SUI_RPC_URL,
    network: SUI_NETWORK,
  }),
};

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SuiClientProvider networks={SUI_NETWORKS} defaultNetwork={SUI_NETWORK}>
          <WalletProvider autoConnect>
            <WalletPickerProvider>{children}</WalletPickerProvider>
          </WalletProvider>
        </SuiClientProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
