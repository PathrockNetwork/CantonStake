"use client";

import { createContext, createElement, useCallback, useContext, useState, type ReactNode } from "react";
import type { SubmittableExtrinsic } from "@polkadot/api/promise/types";
import { polkadotApi, polkadotNetwork, waitForFinalizedPolkadotExtrinsic } from "./network";

type WalletAccount = { address: string; name: string; source: string };

function usePolkadotWalletState() {
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discover = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const [{ web3Enable, web3Accounts }, { decodeAddress, encodeAddress }] = await Promise.all([
        import("@polkadot/extension-dapp"), import("@polkadot/util-crypto"), polkadotApi(),
      ]);
      const extensions = await web3Enable("CantonStake");
      if (!extensions.length) throw new Error("Install Talisman, SubWallet, or Polkadot.js to connect a Polkadot account.");
      const found = await web3Accounts();
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
    const available = accounts.length ? accounts : await discover();
    const account = selected ? available.find((item) => item.address === selected) : available[0];
    if (!account) throw new Error("Selected Polkadot account is unavailable.");
    setAddress(account.address);
    setError(null);
  }, [accounts, discover]);

  const send = useCallback(async (tx: SubmittableExtrinsic) => {
    if (!address) throw new Error("Connect a Polkadot wallet first.");
    const api = await polkadotApi();
    const head = await api.rpc.chain.getFinalizedHead();
    const startHeight = (await api.rpc.chain.getHeader(head)).number.toNumber();
    const { web3FromAddress } = await import("@polkadot/extension-dapp");
    const extension = await web3FromAddress(address);
    const hash = await tx.signAndSend(address, { signer: extension.signer });
    const txHash = hash.toHex();
    await waitForFinalizedPolkadotExtrinsic(api, txHash, startHeight);
    return { hash: txHash };
  }, [address]);

  const stake = useCallback(async (poolId: number, amountPlanck: bigint) => {
    if (!address) throw new Error("Connect a Polkadot wallet first.");
    const api = await polkadotApi();
    if (!Number.isSafeInteger(poolId) || poolId <= 0 || amountPlanck <= 0n) throw new Error("Invalid nomination-pool stake.");
    const member = await api.query.nominationPools.poolMembers(address);
    if (member.toJSON() !== null) throw new Error("This account is already a nomination-pool member; use a fresh account for a CantonStake position.");
    const minJoin = BigInt((await api.query.nominationPools.minJoinBond()).toString());
    if (amountPlanck < minJoin) throw new Error(`Minimum join amount is ${Number(minJoin) / 10 ** polkadotNetwork.decimals} ${polkadotNetwork.symbol}.`);
    const pool = await api.query.nominationPools.bondedPools(poolId);
    if ((pool.toJSON() as { state?: string } | null)?.state !== "Open") throw new Error("Selected nomination pool is no longer open.");
    return send(api.tx.nominationPools.join(amountPlanck.toString(), poolId));
  }, [address, send]);

  const unbond = useCallback(async (poolId: number) => {
    if (!address) throw new Error("Connect a Polkadot wallet first.");
    const api = await polkadotApi();
    const member = await api.query.nominationPools.poolMembers(address) as unknown as {
      isNone: boolean;
      unwrap(): { poolId: { toNumber(): number }; points: { toString(): string } };
    };
    if (member.isNone) throw new Error("Nomination-pool member no longer exists.");
    // Codec.toJSON() can turn large u128 pool points into an imprecise JS number.
    // Pass the exact chain value back to the unbond extrinsic.
    const state = member.unwrap();
    const points = state.points.toString();
    if (state.poolId.toNumber() !== poolId || BigInt(points) <= 0n) throw new Error("No bonded pool points remain for this position.");
    return send(api.tx.nominationPools.unbond(address, points));
  }, [address, send]);

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
    return send(api.tx.nominationPools.withdrawUnbonded(address, 0));
  }, [address, send]);

  return {
    accounts, address, isConnected: !!address, isConnecting, error,
    discover, connect, disconnect: () => setAddress(null), stake, unbond, withdraw,
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
