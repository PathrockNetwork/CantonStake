"use client";

import { DAppKitProvider } from "@mysten/dapp-kit-react";
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { Network } from "@aptos-labs/ts-sdk";
import { ConnectionProvider as SolanaConnectionProvider, WalletProvider as SolanaWalletProvider } from "@solana/wallet-adapter-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ComponentType, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { WalletPickerProvider } from "@/components/WalletPickerProvider";
import { wagmiConfig } from "@/lib/wagmi";
import { suiDAppKit } from "@/lib/sui/dapp-kit";
import { aptosNetwork } from "@/lib/aptos/network";
import { solanaNetwork } from "@/lib/solana/network";
import { PolkadotWalletProvider } from "@/lib/polkadot/use-polkadot-wallet";

// The Solana adapter's optional React Native peer pulls React 19 types into
// its nested node_modules. Runtime React remains 18; bridge only this JSX
// declaration mismatch until the upstream dependency dedupes its types.
const SolanaConnection = SolanaConnectionProvider as unknown as ComponentType<{ endpoint: string; children: ReactNode }>;
const SolanaWallet = SolanaWalletProvider as unknown as ComponentType<{ wallets: []; autoConnect: boolean; children: ReactNode }>;

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <DAppKitProvider dAppKit={suiDAppKit}>
          <AptosWalletAdapterProvider autoConnect dappConfig={{ network: aptosNetwork.chainId === 1 ? Network.MAINNET : Network.TESTNET }}>
            <SolanaConnection endpoint={solanaNetwork.rpc}>
              <SolanaWallet wallets={[]} autoConnect>
                <PolkadotWalletProvider>
                  <WalletPickerProvider>{children}</WalletPickerProvider>
                </PolkadotWalletProvider>
              </SolanaWallet>
            </SolanaConnection>
          </AptosWalletAdapterProvider>
        </DAppKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
