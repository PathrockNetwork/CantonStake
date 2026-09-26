"use client";

import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useCallback, useRef, useState } from "react";
import { aptosNetwork } from "./network";
import type { UnsignedTx } from "../chains/types";
import { assertWalletOwner } from "../wallet-binding";

export function useAptosWallet() {
  const wallet = useWallet();
  const [error, setError] = useState<string | null>(null);
  const address = wallet.account?.address.toStringLong() ?? null;
  const liveWallet = useRef({ address, connected: wallet.connected, network: wallet.network });
  liveWallet.current = { address, connected: wallet.connected, network: wallet.network };

  const assertNetwork = useCallback(async () => {
    const current = liveWallet.current;
    if (!current.connected || !current.address) throw new Error("Aptos wallet not connected");
    if (current.network?.chainId !== aptosNetwork.chainId || current.network.name !== aptosNetwork.name) {
      throw new Error(`Switch your Aptos wallet to ${aptosNetwork.name} before staking.`);
    }
    const response = await fetch(`${aptosNetwork.rest}/v1`);
    if (!response.ok) throw new Error("Aptos fullnode is unavailable");
    const info = await response.json() as { chain_id?: number };
    if (info.chain_id !== aptosNetwork.chainId) throw new Error("Aptos fullnode network does not match this deployment");
  }, []);

  const connect = useCallback((name: string) => {
    setError(null);
    try { wallet.connect(name); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [wallet]);

  const signAndSubmit = useCallback(async (tx: UnsignedTx, expectedAddress: string): Promise<{ hash: string }> => {
    if (tx.kind !== "aptos") throw new Error("Expected an Aptos transaction");
    await assertNetwork();
    assertWalletOwner("Aptos", liveWallet.current.address, expectedAddress, true);
    const submitted = await wallet.signAndSubmitTransaction({
      data: { function: tx.function, typeArguments: [], functionArguments: tx.args },
    });
    for (let attempt = 0; attempt < 45; attempt++) {
      const response = await fetch(`${aptosNetwork.rest}/v1/transactions/by_hash/${submitted.hash}`);
      if (response.ok) {
        const receipt = await response.json() as { type?: string; success?: boolean; vm_status?: string };
        if (receipt.type !== "pending_transaction") {
          if (receipt.success !== true) throw new Error(`Aptos transaction failed: ${receipt.vm_status ?? "unknown VM error"}`);
          return { hash: submitted.hash };
        }
      } else if (response.status !== 404) {
        throw new Error(`Aptos transaction lookup returned ${response.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(`Aptos transaction ${submitted.hash} was submitted but not confirmed within 45 seconds. Check the explorer before retrying.`);
  }, [wallet, assertNetwork]);

  return {
    address,
    isConnected: wallet.connected && !!address,
    isConnecting: wallet.isLoading,
    name: wallet.wallet?.name ?? null,
    network: wallet.network,
    wallets: wallet.wallets.map((item) => ({ name: item.name })),
    error,
    connect,
    disconnect: wallet.disconnect,
    assertNetwork,
    signAndSubmit,
  };
}
