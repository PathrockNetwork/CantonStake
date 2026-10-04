"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { SubmittableExtrinsic } from "@polkadot/api/promise/types";
import type { SignerPayloadJSON, SignerResult } from "@polkadot/types/types";
import { polkadotApi, polkadotNetwork, waitForFinalizedPolkadotExtrinsic } from "./network";
import { networkMode } from "../network";

type WalletAccount = { address: string; name: string; source: string };
type BroadcastGuard = { onBeforeBroadcast: (hash: string) => void | Promise<void> };
const externalTestnet = networkMode === "testnet" && process.env.NEXT_PUBLIC_LOOP_STAKING_FLOW === "external";

function usePolkadotWalletState() {
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const liveWallet = useRef<WalletAccount | null>(null);

  const discover = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const [{ web3Enable, web3Accounts }, { decodeAddress, encodeAddress }] = await Promise.all([
        import("@polkadot/extension-dapp"), import("@polkadot/util-crypto"), polkadotApi(),
      ]);
      const extensions = await web3Enable("CantonStake");
      if (!extensions.length) throw new Error("Install Talisman, SubWallet, or Polkadot.js to connect a Polkadot account.");
      const found = await web3Accounts({ genesisHash: polkadotNetwork.genesis, ss58Format: polkadotNetwork.ss58 });
      const normalized = found.map((account) => ({
        address: encodeAddress(decodeAddress(account.address), polkadotNetwork.ss58),
        name: account.meta.name || account.address,
        source: account.meta.source,
      }));
      setAccounts(normalized);
      if (!normalized.length) throw new Error("No Polkadot accounts are available in the wallet extension.");
      return normalized;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      setConnecting(false);
    }
  }, []);

  const connect = useCallback(async (selected?: string) => {
    const available = await discover();
    const account = selected ? available.find((item) => item.address === selected) : available[0];
    if (!account) throw new Error("Selected Polkadot account is unavailable.");
    liveWallet.current = account;
    setAddress(account.address);
    setError(null);
  }, [discover]);

  useEffect(() => {
    const selected = liveWallet.current;
    if (!address || !selected) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void import("@polkadot/extension-dapp").then(async ({ web3AccountsSubscribe }) => {
      const stop = await web3AccountsSubscribe(found => {
        if (!active || liveWallet.current !== selected) return;
        if (!found.some(account => account.address === selected.address && account.meta.source === selected.source)) {
          liveWallet.current = null;
          setAddress(null);
          setAccounts([]);
          setError("The connected Polkadot account was removed or permission was revoked. Reconnect the owning wallet.");
        }
      }, { extensions: [selected.source], genesisHash: polkadotNetwork.genesis, ss58Format: polkadotNetwork.ss58 });
      if (active) unsubscribe = stop;
      else stop();
    }).catch(() => {
      // Operations still reread actual extension accounts before/after signing.
      if (active) setError("Polkadot account updates are unavailable. Signing will recheck wallet permission.");
    });
    return () => { active = false; unsubscribe?.(); };
  }, [address]);

  const assertOwner = useCallback(async (expectedWallet: string, standardOnly = false) => {
    const [{ web3Accounts, web3FromSource }, { decodeAddress, encodeAddress }] = await Promise.all([
      import("@polkadot/extension-dapp"), import("@polkadot/util-crypto"), polkadotApi(),
    ]);
    const selected = liveWallet.current;
    if (!selected || selected.address !== expectedWallet ||
        encodeAddress(decodeAddress(expectedWallet), polkadotNetwork.ss58) !== expectedWallet) {
      throw new Error("The connected Polkadot wallet changed. Reconnect the position's owning wallet.");
    }
    const available = await web3Accounts({ extensions: [selected.source], genesisHash: polkadotNetwork.genesis,
      ss58Format: polkadotNetwork.ss58 });
    const account = available.find(item => item.address === expectedWallet && item.meta.source === selected.source);
    if (!account || liveWallet.current !== selected) throw new Error("The owning Polkadot account is no longer available in the connected extension.");
    if (standardOnly && account.type && !["ed25519", "sr25519"].includes(account.type)) {
      throw new Error("Loop consent currently supports only standard Ed25519 or Sr25519 Polkadot accounts.");
    }
    const extension = await web3FromSource(selected.source);
    if (liveWallet.current !== selected) throw new Error("Polkadot wallet changed while its signer was being opened.");
    return { extension, source: selected.source };
  }, []);

  const signOwnership = useCallback(async (message: string, expectedWallet: string): Promise<string> => {
    const { extension, source } = await assertOwner(expectedWallet, true);
    if (!extension.signer.signRaw) throw new Error("This extension cannot sign Polkadot ownership consent. No substitute signer is available.");
    const { cryptoWaitReady, signatureVerify } = await import("@polkadot/util-crypto");
    if (!await cryptoWaitReady()) throw new Error("Polkadot signature verification is unavailable.");
    const bytes = new TextEncoder().encode(message);
    const data = `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
    const result = await extension.signer.signRaw({ address: expectedWallet, data, type: "bytes" });
    const current = await assertOwner(expectedWallet, true);
    if (current.source !== source || !/^0x(?:00|01)[a-fA-F0-9]{128}$/.test(result.signature)) {
      throw new Error("Polkadot consent signer changed or returned an unsupported signature.");
    }
    const verified = signatureVerify(bytes, result.signature, expectedWallet);
    if (!verified.isValid || verified.crypto !== (result.signature.slice(2, 4) === "00" ? "ed25519" : "sr25519")) {
      throw new Error("The extension's signature does not verify this exact ownership consent.");
    }
    return result.signature;
  }, [assertOwner]);

  const send = useCallback(async (tx: SubmittableExtrinsic, expectedWallet: string, guard?: BroadcastGuard) => {
    const { extension, source } = await assertOwner(expectedWallet, externalTestnet || !!guard);
    const api = await polkadotApi();
    const head = await api.rpc.chain.getFinalizedHead();
    const startHeight = (await api.rpc.chain.getHeader(head)).number.toNumber();
    let txHash: string;
    if (externalTestnet || guard) {
      if (!extension.signer.signPayload) throw new Error("This extension cannot sign a native extrinsic separately from broadcast.");
      const { cryptoWaitReady, ed25519Verify, sr25519Verify, blake2AsU8a } = await import("@polkadot/util-crypto");
      if (!await cryptoWaitReady()) throw new Error("Polkadot signature verification is unavailable.");
      const method = tx.method.toHex();
      let captured: { payload: SignerPayloadJSON; result: SignerResult } | undefined;
      const signed = await tx.signAsync(expectedWallet, { withSignedTransaction: false, signer: {
        signPayload: async payload => {
          if (captured || payload.address !== expectedWallet || payload.genesisHash !== polkadotNetwork.genesis || payload.method !== method) {
            throw new Error("Polkadot signer was asked to sign different wallet, network or call data.");
          }
          const original = JSON.stringify(payload);
          const result = await extension.signer.signPayload!(payload);
          if (JSON.stringify(payload) !== original || result.signedTransaction) throw new Error("Polkadot extension changed the prepared transaction.");
          captured = { payload: JSON.parse(original) as SignerPayloadJSON,
            result: { id: result.id, signature: result.signature } };
          return result;
        },
      } });
      if (!captured || !signed.isSigned || signed.method.toHex() !== method ||
          !/^0x(?:00|01)[a-fA-F0-9]{128}$/.test(captured.result.signature)) {
        throw new Error("Polkadot extension returned an unsupported or changed native transaction.");
      }
      const { decodeAddress, encodeAddress } = await import("@polkadot/util-crypto");
      if (encodeAddress(decodeAddress(signed.signer.toString()), polkadotNetwork.ss58) !== expectedWallet ||
          signed.signature.toHex().toLowerCase() !== `0x${captured.result.signature.slice(4).toLowerCase()}`) {
        throw new Error("Signed Polkadot transaction belongs to a different account or signature.");
      }
      const payload = api.registry.createType("ExtrinsicPayload", captured.payload, { version: captured.payload.version });
      const bytes = payload.toU8a({ method: true });
      const verify = captured.result.signature.slice(2, 4) === "00" ? ed25519Verify : sr25519Verify;
      if (!verify(bytes.length > 256 ? blake2AsU8a(bytes) : bytes,
        `0x${captured.result.signature.slice(4)}`, decodeAddress(expectedWallet))) {
        throw new Error("Polkadot native signature does not verify the prepared transaction.");
      }
      const current = await assertOwner(expectedWallet, true);
      if (current.source !== source) throw new Error("Polkadot signer changed during native signing.");
      const signedBytes = signed.toHex();
      txHash = signed.hash.toHex();
      // Storage failure prevents dispatch. After dispatch, an uncertain result
      // retains this exact hash; never automatically sign or send again.
      await guard?.onBeforeBroadcast(txHash);
      await assertOwner(expectedWallet, true);
      if (signed.toHex() !== signedBytes) throw new Error("Signed extrinsic changed before broadcast.");
      const submitted = await signed.send();
      if (submitted.toHex() !== txHash) throw new Error(`Polkadot submitted hash differed; reconcile recorded transaction ${txHash} before retrying.`);
    } else {
      const hash = await tx.signAndSend(expectedWallet, { signer: extension.signer });
      txHash = hash.toHex();
    }
    const blockHash = await waitForFinalizedPolkadotExtrinsic(api, txHash, startHeight);
    return { hash: txHash, blockHash };
  }, [assertOwner]);

  const stake = useCallback(async (poolId: number, amountPlanck: bigint, expectedWallet = address) => {
    if (!expectedWallet) throw new Error("Connect a Polkadot wallet first.");
    await assertOwner(expectedWallet, externalTestnet);
    const api = await polkadotApi();
    if (!Number.isSafeInteger(poolId) || poolId <= 0 || amountPlanck <= 0n) throw new Error("Invalid nomination-pool stake.");
    const member = await api.query.nominationPools.poolMembers(expectedWallet);
    if (member.toJSON() !== null) throw new Error("This account is already a nomination-pool member; use a fresh account for a CantonStake position.");
    const minJoin = BigInt((await api.query.nominationPools.minJoinBond()).toString());
    if (amountPlanck < minJoin) throw new Error(`Minimum join amount is ${Number(minJoin) / 10 ** polkadotNetwork.decimals} ${polkadotNetwork.symbol}.`);
    const pool = await api.query.nominationPools.bondedPools(poolId);
    if ((pool.toJSON() as { state?: string } | null)?.state !== "Open") throw new Error("Selected nomination pool is no longer open.");
    return send(api.tx.nominationPools.join(amountPlanck.toString(), poolId), expectedWallet);
  }, [address, assertOwner, send]);

  const unbond = useCallback(async (poolId: number, options?: BroadcastGuard & { expectedWallet: string }) => {
    const expectedWallet = options?.expectedWallet ?? address;
    if (!expectedWallet) throw new Error("Connect a Polkadot wallet first.");
    await assertOwner(expectedWallet, externalTestnet);
    const api = await polkadotApi();
    const member = await api.query.nominationPools.poolMembers(expectedWallet) as unknown as {
      isNone: boolean;
      unwrap(): { poolId: { toNumber(): number }; points: { toString(): string } };
    };
    if (member.isNone) throw new Error("Nomination-pool member no longer exists.");
    // Codec.toJSON() can turn large u128 pool points into an imprecise JS number.
    // Pass the exact chain value back to the unbond extrinsic.
    const state = member.unwrap();
    const points = state.points.toString();
    if (state.poolId.toNumber() !== poolId || BigInt(points) <= 0n) throw new Error("No bonded pool points remain for this position.");
    return send(api.tx.nominationPools.unbond(expectedWallet, points), expectedWallet, options);
  }, [address, assertOwner, send]);

  const withdraw = useCallback(async (poolId: number) => {
    if (!address) throw new Error("Connect a Polkadot wallet first.");
    const api = await polkadotApi();
    const member = await api.query.nominationPools.poolMembers(address);
    const state = member.toJSON() as { poolId?: number; points?: number | string; unbondingEras?: Record<string, number | string> } | null;
    if (!state) throw new Error("Nomination-pool member no longer exists.");
    if (state.poolId !== poolId || BigInt(String(state.points ?? 0)) !== 0n) throw new Error("All bonded pool points must be unbonded first.");
    const currentEra = await api.query.staking.currentEra();
    const eraValue = currentEra.toJSON();
    const era = eraValue === null ? -1 : Number(eraValue);
    const eras = Object.keys(state.unbondingEras ?? {}).map(Number);
    if (era < 0 || !eras.length || eras.some((item) => !Number.isSafeInteger(item) || item > era)) {
      throw new Error("Nomination-pool unbonding is not complete yet.");
    }
    return send(api.tx.nominationPools.withdrawUnbonded(address, 0), address);
  }, [address, send]);

  return {
    accounts, address, isConnected: !!address, isConnecting, error,
    discover, connect, disconnect: () => { liveWallet.current = null; setAddress(null); }, signOwnership, stake, unbond, withdraw,
  };
}

type PolkadotWalletState = ReturnType<typeof usePolkadotWalletState>;
const PolkadotWalletContext = createContext<PolkadotWalletState | null>(null);

export function PolkadotWalletProvider({ children }: { children: ReactNode }) {
  const wallet = usePolkadotWalletState();
  return createElement(PolkadotWalletContext.Provider, { value: wallet }, children);
}

export function usePolkadotWallet(): PolkadotWalletState {
  const wallet = useContext(PolkadotWalletContext);
  if (!wallet) throw new Error("PolkadotWalletProvider is missing");
  return wallet;
}
