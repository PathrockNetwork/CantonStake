"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Cosmos wallet hook — Keplr / Leap browser extension on
 * theta-testnet (Cosmos Hub testnet, chain id `theta-testnet-001`).
 *
 * The shape mirrors wagmi's `useAccount` so the stake page can branch
 * on `selectedChain.id === "cosmos"` and use the same UX.
 *
 * Keplr is preferred when present; Leap and Cosmostation also expose
 * a `window.keplr`-compatible API. We attempt experimentalSuggestChain
 * once on connect so users without theta-testnet pre-configured don't
 * have to add it manually.
 */

// Defaults target Cosmos Hub theta-testnet. Each can be overridden via
// NEXT_PUBLIC_COSMOS_* env vars at build time so a different testnet
// (e.g. provider, mainnet) can be slotted in without code changes.
const CHAIN_ID =
  process.env.NEXT_PUBLIC_COSMOS_CHAIN_ID ?? "theta-testnet-001";
const CHAIN_NAME =
  process.env.NEXT_PUBLIC_COSMOS_CHAIN_NAME ?? "Cosmos Hub Theta Testnet";
const RPC =
  process.env.NEXT_PUBLIC_COSMOS_RPC ??
  "https://rpc.sentry-01.theta-testnet.polypore.xyz";
const REST =
  process.env.NEXT_PUBLIC_COSMOS_REST ??
  "https://rest.sentry-01.theta-testnet.polypore.xyz";
const COIN_DENOM = process.env.NEXT_PUBLIC_COSMOS_COIN_DENOM ?? "ATOM";
const COIN_MINIMAL_DENOM =
  process.env.NEXT_PUBLIC_COSMOS_COIN_MINIMAL_DENOM ?? "uatom";
const COIN_DECIMALS = Number(
  process.env.NEXT_PUBLIC_COSMOS_COIN_DECIMALS ?? "6",
);
const COIN_TYPE = Number(process.env.NEXT_PUBLIC_COSMOS_COIN_TYPE ?? "118");
const STORAGE_KEY = "cantonstake_cosmos_address";

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

async function suggestThetaTestnet(keplr: KeplrLike): Promise<void> {
  if (!keplr.experimentalSuggestChain) return;
  try {
    await keplr.experimentalSuggestChain({
      chainId: CHAIN_ID,
      chainName: CHAIN_NAME,
      rpc: RPC,
      rest: REST,
      bip44: { coinType: COIN_TYPE },
      bech32Config: {
        bech32PrefixAccAddr: "cosmos",
        bech32PrefixAccPub: "cosmospub",
        bech32PrefixValAddr: "cosmosvaloper",
        bech32PrefixValPub: "cosmosvaloperpub",
        bech32PrefixConsAddr: "cosmosvalcons",
        bech32PrefixConsPub: "cosmosvalconspub",
      },
      currencies: [
        {
          coinDenom: COIN_DENOM,
          coinMinimalDenom: COIN_MINIMAL_DENOM,
          coinDecimals: COIN_DECIMALS,
        },
      ],
      feeCurrencies: [
        {
          coinDenom: COIN_DENOM,
          coinMinimalDenom: COIN_MINIMAL_DENOM,
          coinDecimals: COIN_DECIMALS,
          gasPriceStep: { low: 0.005, average: 0.025, high: 0.04 },
        },
      ],
      stakeCurrency: {
        coinDenom: COIN_DENOM,
        coinMinimalDenom: COIN_MINIMAL_DENOM,
        coinDecimals: COIN_DECIMALS,
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

export function useCosmosWallet(): UseCosmosWalletReturn {
  const [address, setAddress] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore the connected address on mount so the chip persists across reloads.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setAddress(stored);
  }, []);

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
      await suggestThetaTestnet(keplr);
      await keplr.enable(CHAIN_ID);
      const key = await keplr.getKey(CHAIN_ID);
      setAddress(key.bech32Address);
      setName(key.name ?? null);
      localStorage.setItem(STORAGE_KEY, key.bech32Address);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setName(null);
    if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
  }, []);

  const signAndBroadcast = useCallback(
    async (msg: { typeUrl: string; value: Record<string, unknown> }) => {
      const keplr = getKeplrLike();
      if (!keplr || !address) {
        throw new Error("Cosmos wallet not connected");
      }

      // Lazy-import @cosmjs/stargate to keep the initial bundle small.
      const { SigningStargateClient, GasPrice } = await import(
        "@cosmjs/stargate"
      );
      const offlineSigner = (
        keplr.getOfflineSignerAuto
          ? await keplr.getOfflineSignerAuto(CHAIN_ID)
          : keplr.getOfflineSigner(CHAIN_ID)
      ) as Parameters<typeof SigningStargateClient.connectWithSigner>[1];

      const client = await SigningStargateClient.connectWithSigner(
        RPC,
        offlineSigner,
        { gasPrice: GasPrice.fromString(`0.025${COIN_MINIMAL_DENOM}`) },
      );

      try {
        const result = await client.signAndBroadcast(
          address,
          [msg],
          "auto",
          "CantonStake delegate",
        );
        if (result.code !== 0) {
          throw new Error(`broadcast failed: code=${result.code} log=${result.rawLog ?? ""}`);
        }
        return { txHash: result.transactionHash };
      } finally {
        client.disconnect();
      }
    },
    [address],
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

export const cosmosChainId = CHAIN_ID;
