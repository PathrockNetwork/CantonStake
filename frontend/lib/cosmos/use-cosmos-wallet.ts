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
const providerStorageKey = (chain: CosmosChainKey) => `cantonstake_${networkMode}_${chain}_provider`;

type CosmosProviderId = "keplr" | "leap";

interface KeplrLike {
  enable(chainId: string | string[]): Promise<void>;
  experimentalSuggestChain?: (config: unknown) => Promise<void>;
  getKey(chainId: string): Promise<{
    bech32Address: string;
    name?: string;
  }>;
  getOfflineSigner(chainId: string): unknown;
  getOfflineSignerAuto?(chainId: string): Promise<unknown>;
  signArbitrary?(chainId: string, signer: string, data: string): Promise<{
    pub_key: { type: string; value: string }; signature: string;
  }>;
}

declare global {
  interface Window {
    keplr?: KeplrLike;
    leap?: KeplrLike;
  }
}

function getCosmosProviders(): Array<{ id: CosmosProviderId; name: string; provider: KeplrLike }> {
  if (typeof window === "undefined") return [];
  const providers: Array<{ id: CosmosProviderId; name: string; provider: KeplrLike }> = [];
  if (window.keplr) providers.push({ id: "keplr", name: "Keplr", provider: window.keplr });
  if (window.leap && window.leap !== window.keplr) providers.push({ id: "leap", name: "Leap Wallet", provider: window.leap });
  return providers;
}

function getKeplrLike(preferred?: string | null): KeplrLike | null {
  const providers = getCosmosProviders();
  return providers.find((item) => item.id === preferred)?.provider ?? providers[0]?.provider ?? null;
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
  wallets: Array<{ id: CosmosProviderId; name: string }>;
  connect: (walletId?: string) => Promise<void>;
  disconnect: () => void;
  signAndBroadcast: (args: {
    typeUrl: string;
    value: Record<string, unknown>;
  }, options?: {
    expectedWallet?: string;
    onBeforeBroadcast?: (hash: string) => void;
  }) => Promise<{ txHash: string }>;
  signOwnership: (message: string, expectedWallet: string) => Promise<string>;
}

export function useCosmosWallet(chain: CosmosChainKey = "cosmos"): UseCosmosWalletReturn {
  const network = cosmosNetworks[chain];
  const [address, setAddress] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<CosmosProviderId | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A saved address is only a hint. Verify the live extension key before
  // reporting a connection, including after account changes or revocation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    let revision = 0;
    const sync = async () => {
      const currentRevision = ++revision;
      const saved = localStorage.getItem(storageKey(chain));
      const preferred = localStorage.getItem(providerStorageKey(chain));
      const extension = getKeplrLike(preferred);
      if (!saved || !extension) {
        if (active && currentRevision === revision) {
          setAddress(null);
          setName(null);
          setProviderId(null);
        }
        return;
      }
      try {
        const key = await extension.getKey(network.chainId);
        if (!key.bech32Address.startsWith(`${network.prefix}1`)) {
          throw new Error("Cosmos wallet key has the wrong prefix");
        }
        if (!active || currentRevision !== revision) return;
        setAddress(key.bech32Address);
        setName(key.name ?? null);
        setProviderId(preferred === "leap" ? "leap" : preferred === "keplr" ? "keplr" : window.leap && !window.keplr ? "leap" : "keplr");
        if (saved !== key.bech32Address) localStorage.setItem(storageKey(chain), key.bech32Address);
      } catch {
        if (!active || currentRevision !== revision) return;
        setAddress(null);
        setName(null);
        localStorage.removeItem(storageKey(chain));
      }
    };
    const onChange = () => { void sync(); };
    onChange();
    window.addEventListener(walletEvent, onChange);
    window.addEventListener("storage", onChange);
    window.addEventListener("keplr_keystorechange", onChange);
    window.addEventListener("leap_keystorechange", onChange);
    return () => {
      active = false;
      revision++;
      window.removeEventListener(walletEvent, onChange);
      window.removeEventListener("storage", onChange);
      window.removeEventListener("keplr_keystorechange", onChange);
      window.removeEventListener("leap_keystorechange", onChange);
    };
  }, [chain, network]);

  const connect = useCallback(async (walletId?: string) => {
    setError(null);
    setIsConnecting(true);
    try {
      const selected = getCosmosProviders().find((item) => item.id === walletId);
      const keplr = selected?.provider ?? getKeplrLike(providerId);
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
      const connectedProviderId = selected?.id ?? (window.leap && !window.keplr ? "leap" : providerId ?? "keplr");
      setProviderId(connectedProviderId);
      localStorage.setItem(storageKey(chain), key.bech32Address);
      localStorage.setItem(providerStorageKey(chain), connectedProviderId);
      window.dispatchEvent(new Event(walletEvent));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsConnecting(false);
    }
  }, [chain, network, providerId]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setName(null);
    setProviderId(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem(storageKey(chain));
      localStorage.removeItem(providerStorageKey(chain));
      window.dispatchEvent(new Event(walletEvent));
    }
  }, [chain]);

  const signAndBroadcast = useCallback(
    async (msg: { typeUrl: string; value: Record<string, unknown> }, options?: {
      expectedWallet?: string; onBeforeBroadcast?: (hash: string) => void;
    }) => {
      const keplr = getKeplrLike(providerId ?? (typeof window !== "undefined" ? localStorage.getItem(providerStorageKey(chain)) : null));
      if (!keplr || !address) {
        throw new Error("Cosmos wallet not connected");
      }
      const currentKey = await keplr.getKey(network.chainId);
      const expectedWallet = options?.expectedWallet ?? address;
      assertWalletOwner(network.chainName, address, expectedWallet);
      assertWalletOwner(network.chainName, currentKey.bech32Address, expectedWallet);

      // Lazy-import @cosmjs/stargate to keep the initial bundle small.
      const { SigningStargateClient, GasPrice, calculateFee } = await import(
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
        const memo = `CantonStake ${chain} staking`;
        if (networkMode !== "testnet" || process.env.NEXT_PUBLIC_LOOP_STAKING_FLOW !== "external") {
          // Preserve the established MainNet/legacy wallet transaction path.
          const result = await client.signAndBroadcast(expectedWallet, [msg], "auto", memo);
          if (result.code !== 0) throw new Error(`broadcast failed: code=${result.code} log=${result.rawLog ?? ""}`);
          return { txHash: result.transactionHash };
        }
        const [{ TxRaw, TxBody }, { sha256 }, { toHex }] = await Promise.all([
          import("cosmjs-types/cosmos/tx/v1beta1/tx"), import("@cosmjs/crypto"), import("@cosmjs/encoding"),
        ]);
        const estimatedGas = await client.simulate(expectedWallet, [msg], memo);
        if (!Number.isFinite(estimatedGas) || estimatedGas <= 0) throw new Error("Cosmos gas estimation is unavailable.");
        // Same 1.4 gas multiplier as CosmJS's default auto-fee path.
        const fee = calculateFee(Math.ceil(estimatedGas * 1.4), GasPrice.fromString(`${network.gasPrice}${network.denom}`));
        assertWalletOwner(network.chainName, (await keplr.getKey(network.chainId)).bech32Address, expectedWallet);
        const signed = await client.sign(expectedWallet, [msg], fee, memo);
        const signedMessages = TxBody.decode(signed.bodyBytes).messages;
        const expectedMessage = client.registry.encodeAsAny(msg);
        if (signedMessages.length !== 1 || signedMessages[0]!.typeUrl !== expectedMessage.typeUrl ||
            signedMessages[0]!.value.length !== expectedMessage.value.length ||
            !expectedMessage.value.every((byte, index) => signedMessages[0]!.value[index] === byte)) {
          throw new Error("The signed Cosmos transaction changed the requested staking message; nothing was broadcast.");
        }
        assertWalletOwner(network.chainName, (await keplr.getKey(network.chainId)).bech32Address, expectedWallet);
        if (await client.getChainId() !== network.chainId) throw new Error("Cosmos RPC changed networks; nothing was broadcast.");
        const bytes = TxRaw.encode(signed).finish();
        const hash = toHex(sha256(bytes)).toUpperCase();
        // Persist the genuine signed-byte hash before sending. A callback
        // failure (e.g. unavailable browser storage) prevents the broadcast.
        options?.onBeforeBroadcast?.(hash);
        const result = await client.broadcastTx(bytes);
        if (result.code !== 0) {
          throw new Error(`broadcast failed: code=${result.code} log=${result.rawLog ?? ""}`);
        }
        if (result.transactionHash.toUpperCase() !== hash) throw new Error("Cosmos broadcast returned a mismatched transaction hash; reconcile the signed transaction.");
        return { txHash: result.transactionHash };
      } finally {
        client.disconnect();
      }
    },
    [address, chain, network, providerId],
  );

  const signOwnership = useCallback(async (message: string, expectedWallet: string): Promise<string> => {
    const wallet = getKeplrLike(providerId ?? (typeof window !== "undefined" ? localStorage.getItem(providerStorageKey(chain)) : null));
    if (!wallet?.signArbitrary || !address) throw new Error("Connect a Keplr/Leap account supporting ADR-36 ownership signatures.");
    assertWalletOwner(network.chainName, address, expectedWallet);
    assertWalletOwner(network.chainName, (await wallet.getKey(network.chainId)).bech32Address, expectedWallet);
    const signature = await wallet.signArbitrary(network.chainId, expectedWallet, message);
    assertWalletOwner(network.chainName, (await wallet.getKey(network.chainId)).bech32Address, expectedWallet);
    if (signature.pub_key?.type !== "tendermint/PubKeySecp256k1" ||
        typeof signature.pub_key.value !== "string" || typeof signature.signature !== "string") {
      throw new Error("This Cosmos account type cannot provide a supported native ownership proof.");
    }
    return JSON.stringify(signature);
  }, [address, chain, network, providerId]);

  return {
    address,
    name,
    isConnected: !!address,
    isConnecting,
    error,
    wallets: getCosmosProviders().map(({ id, name }) => ({ id, name })),
    connect,
    disconnect,
    signAndBroadcast,
    signOwnership,
  };
}
