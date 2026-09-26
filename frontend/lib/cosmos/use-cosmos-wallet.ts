"use client";

import { useCallback, useEffect, useState } from "react";
import { cosmosNetworks, type CosmosChainKey, type CosmosNetwork } from "./networks";
import { networkMode } from "../network";
import { assertWalletOwner } from "../wallet-binding";

/**
 * Cosmos wallet hook — Keplr / Leap browser extension on
 * Cosmos Hub provider testnet (chain id `provider`).
 *
 * The shape mirrors wagmi's `useAccount` so the stake page can branch
 * on `selectedChain.id === "cosmos"` and use the same UX.
 *
 * Keplr is preferred when present; Leap and Cosmostation also expose
 * a `window.keplr`-compatible API. We attempt experimentalSuggestChain
 * once on connect so users without the provider testnet pre-configured don't
 * have to add it manually.
 */

const walletEvent = "cantonstake:cosmos-wallet-change";
const storageKey = (chain: CosmosChainKey) => `cantonstake_${networkMode}_${chain}_address`;

interface KeplrLike {
  enable(chainId: string | string[]): Promise<void>;
  experimentalSuggestChain?: (config: unknown) => Promise<void>;
  getKey(chainId: string): Promise<{
    bech32Address: string;
    name?: string;
  }>;
  getOfflineSigner(chainId: string): unknown;
  getOfflineSignerAuto?(chainId: string): Promise<unknown>;
}

declare global {
  interface Window {
    keplr?: KeplrLike;
    leap?: KeplrLike;
  }
}

function getKeplrLike(): KeplrLike | null {
  if (typeof window === "undefined") return null;
  return window.keplr ?? window.leap ?? null;
}

async function suggestCosmosChain(keplr: KeplrLike, network: CosmosNetwork): Promise<void> {
  if (!keplr.experimentalSuggestChain) return;
  try {
    await keplr.experimentalSuggestChain({
      chainId: network.chainId,
      chainName: network.chainName,
      rpc: network.rpc,
      rest: network.rest,
      bip44: { coinType: network.coinType },
      bech32Config: {
        bech32PrefixAccAddr: network.prefix,
        bech32PrefixAccPub: `${network.prefix}pub`,
        bech32PrefixValAddr: `${network.prefix}valoper`,
        bech32PrefixValPub: `${network.prefix}valoperpub`,
        bech32PrefixConsAddr: `${network.prefix}valcons`,
        bech32PrefixConsPub: `${network.prefix}valconspub`,
      },
      currencies: [
        {
          coinDenom: network.symbol,
          coinMinimalDenom: network.denom,
          coinDecimals: network.decimals,
        },
      ],
      feeCurrencies: [
        {
          coinDenom: network.symbol,
          coinMinimalDenom: network.denom,
          coinDecimals: network.decimals,
          gasPriceStep: { low: network.gasPrice, average: network.gasPrice, high: network.gasPrice * 1.6 },
        },
      ],
      stakeCurrency: {
        coinDenom: network.symbol,
        coinMinimalDenom: network.denom,
        coinDecimals: network.decimals,
      },
    });
  } catch (err) {
    // The user may have rejected the suggest prompt; harmless if the
    // chain is already known to Keplr.
    console.debug("[cosmos-wallet] experimentalSuggestChain skipped:", err);
  }
}

export interface UseCosmosWalletReturn {
  address: string | null;
  name: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  signAndBroadcast: (args: {
    typeUrl: string;
    value: Record<string, unknown>;
  }) => Promise<{ txHash: string }>;
}

export function useCosmosWallet(chain: CosmosChainKey = "cosmos"): UseCosmosWalletReturn {
  const network = cosmosNetworks[chain];
  const [address, setAddress] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore the connected address on mount so the chip persists across reloads.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setAddress(localStorage.getItem(storageKey(chain)));
    sync();
    window.addEventListener(walletEvent, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(walletEvent, sync);
      window.removeEventListener("storage", sync);
    };
  }, [chain]);

  const connect = useCallback(async () => {
    setError(null);
    setIsConnecting(true);
    try {
      const keplr = getKeplrLike();
      if (!keplr) {
        throw new Error(
          "Keplr / Leap not detected. Install the Keplr extension from keplr.app and reload.",
        );
      }
      await suggestCosmosChain(keplr, network);
      await keplr.enable(network.chainId);
      const key = await keplr.getKey(network.chainId);
      if (!key.bech32Address.startsWith(`${network.prefix}1`)) {
        throw new Error(`Wallet returned an address for the wrong network; expected ${network.prefix}.`);
      }
      setAddress(key.bech32Address);
      setName(key.name ?? null);
      localStorage.setItem(storageKey(chain), key.bech32Address);
      window.dispatchEvent(new Event(walletEvent));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsConnecting(false);
    }
  }, [chain, network]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setName(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem(storageKey(chain));
      window.dispatchEvent(new Event(walletEvent));
    }
  }, [chain]);

  const signAndBroadcast = useCallback(
    async (msg: { typeUrl: string; value: Record<string, unknown> }) => {
      const keplr = getKeplrLike();
      if (!keplr || !address) {
        throw new Error("Cosmos wallet not connected");
      }
      const currentKey = await keplr.getKey(network.chainId);
      assertWalletOwner(network.chainName, currentKey.bech32Address, address);

      // Lazy-import @cosmjs/stargate to keep the initial bundle small.
      const { SigningStargateClient, GasPrice } = await import(
        "@cosmjs/stargate"
      );
      const offlineSigner = (
        keplr.getOfflineSignerAuto
          ? await keplr.getOfflineSignerAuto(network.chainId)
          : keplr.getOfflineSigner(network.chainId)
      ) as Parameters<typeof SigningStargateClient.connectWithSigner>[1];

      const client = await SigningStargateClient.connectWithSigner(
        network.rpc,
        offlineSigner,
        { gasPrice: GasPrice.fromString(`${network.gasPrice}${network.denom}`) },
      );

      try {
        const actualChainId = await client.getChainId();
        if (actualChainId !== network.chainId) {
          throw new Error(`RPC connected to ${actualChainId}, expected ${network.chainId}.`);
        }
        const result = await client.signAndBroadcast(
          address,
          [msg],
          "auto",
          `CantonStake ${chain} staking`,
        );
        if (result.code !== 0) {
          throw new Error(`broadcast failed: code=${result.code} log=${result.rawLog ?? ""}`);
        }
        return { txHash: result.transactionHash };
      } finally {
        client.disconnect();
      }
    },
    [address, chain, network],
  );

  return {
    address,
    name,
    isConnected: !!address,
    isConnecting,
    error,
    connect,
    disconnect,
    signAndBroadcast,
  };
}

export const cosmosChainId = cosmosNetworks.cosmos.chainId;
