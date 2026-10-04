"use client";

import { useAccount } from "wagmi";
import { useCosmosWallet } from "./cosmos/use-cosmos-wallet";
import { useSuiWallet } from "./sui/use-sui-wallet";
import { useAptosWallet } from "./aptos/use-aptos-wallet";
import { useSolanaWallet } from "./solana/use-solana-wallet";
import { usePolkadotWallet } from "./polkadot/use-polkadot-wallet";
import { nativeWalletScope } from "./native-wallet-addresses";

/** Only live connected wallet hooks. No default address or hosted identity. */
export function useConnectedNativeWallets() {
  const evm = useAccount();
  const cosmos = useCosmosWallet("cosmos"), celestia = useCosmosWallet("celestia"), osmosis = useCosmosWallet("osmosis");
  const sui = useSuiWallet(), aptos = useAptosWallet(), solana = useSolanaWallet(), polkadot = usePolkadotWallet();
  const addresses = nativeWalletScope([evm, cosmos, celestia, osmosis, sui, aptos, solana, polkadot]
    .flatMap(wallet => wallet.isConnected && wallet.address ? [wallet.address] : []));
  return { addresses, scope: JSON.stringify(addresses), isConnected: addresses.length > 0 };
}
