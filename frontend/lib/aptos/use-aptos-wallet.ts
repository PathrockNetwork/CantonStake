"use client";

import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { getAptosWallets } from "@aptos-labs/wallet-standard";
import { isPetraWebWallet } from "@aptos-labs/wallet-adapter-core";
import { AccountAuthenticatorEd25519, Aptos, AptosConfig, Ed25519PublicKey, Ed25519Signature,
  generateSigningMessageForTransaction, generateUserTransactionHash, Network } from "@aptos-labs/ts-sdk";
import { sha256 } from "@cosmjs/crypto";
import { toHex, toUtf8 } from "@cosmjs/encoding";
import { useCallback, useRef, useState } from "react";
import { aptosNetwork, fullAptosAddress } from "./network";
import type { UnsignedTx } from "../chains/types";
import { assertWalletOwner } from "../wallet-binding";
import { networkMode } from "../network";

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

  const switchNetwork = useCallback(async () => {
    setError(null);
    try {
      await wallet.changeNetwork(aptosNetwork.name === "mainnet" ? Network.MAINNET : Network.TESTNET);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      throw new Error(message);
    }
  }, [wallet]);

  const assertAuthenticationKey = useCallback(async (publicKey: Ed25519PublicKey, expectedWallet: string) => {
    await assertNetwork();
    assertWalletOwner("Aptos", liveWallet.current.address, expectedWallet, true);
    const response = await fetch(`${aptosNetwork.rest}/v1/accounts/${expectedWallet}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Aptos account authentication key is unavailable.");
    const account = await response.json() as { authentication_key?: string };
    if (account.authentication_key?.toLowerCase() !== publicKey.authKey().toString().toLowerCase()) {
      throw new Error("Aptos wallet key does not match the current on-chain account authentication key.");
    }
  }, [assertNetwork]);

  const signOwnership = useCallback(async (message: string, expectedWallet: string) => {
    const publicKey = wallet.account?.publicKey;
    if (!(publicKey instanceof Ed25519PublicKey)) throw new Error("Loop ownership consent currently supports standard Aptos Ed25519 accounts only; keyless and multisig are not verified.");
    await assertAuthenticationKey(publicKey, expectedWallet);
    const nonce = toHex(sha256(toUtf8(message)));
    // Wallet/network/deployment are already in the server-prepared consent.
    // Disable optional wrapper fields to make server reconstruction exact.
    const signed = await wallet.signMessage({ message, nonce, address: false, application: false, chainId: false });
    assertWalletOwner("Aptos", liveWallet.current.address, expectedWallet, true);
    await assertAuthenticationKey(publicKey, expectedWallet);
    const layouts = { "nonce-first": `APTOS\nnonce: ${nonce}\nmessage: ${message}`,
      "message-first": `APTOS\nmessage: ${message}\nnonce: ${nonce}` };
    const layout = signed.fullMessage === layouts["nonce-first"] ? "nonce-first"
      : signed.fullMessage === layouts["message-first"] ? "message-first" : null;
    if (!layout || signed.prefix !== "APTOS" || signed.message !== message || signed.nonce !== nonce ||
        !(signed.signature instanceof Ed25519Signature) || !publicKey.verifySignature({ message: toUtf8(signed.fullMessage), signature: signed.signature })) {
      throw new Error("Aptos wallet did not sign the exact supported ownership consent.");
    }
    return JSON.stringify({ publicKey: publicKey.toString().toLowerCase(), signature: signed.signature.toString().toLowerCase(), layout });
  }, [wallet.account, wallet.signMessage, assertAuthenticationKey]);

  const signAndSubmit = useCallback(async (tx: UnsignedTx, expectedAddress: string,
    options?: { onBeforeBroadcast: (hash: string) => void }): Promise<{ hash: string }> => {
    if (tx.kind !== "aptos") throw new Error("Expected an Aptos transaction");
    await assertNetwork();
    assertWalletOwner("Aptos", liveWallet.current.address, expectedAddress, true);
    let submitted: { hash: string };
    if (options || (networkMode === "testnet" && process.env.NEXT_PUBLIC_LOOP_STAKING_FLOW === "external")) {
      const publicKey = wallet.account?.publicKey;
      if (!(publicKey instanceof Ed25519PublicKey)) throw new Error("Safe Loop Aptos signing currently requires a standard Ed25519 account.");
      await assertAuthenticationKey(publicKey, expectedAddress);
      const client = new Aptos(new AptosConfig({ network: Network.TESTNET, fullnode: `${aptosNetwork.rest}/v1` }));
      const transaction = await client.transaction.build.simple({ sender: expectedAddress,
        data: { function: tx.function, typeArguments: [], functionArguments: tx.args } });
      if (transaction.rawTransaction.chain_id.chainId !== aptosNetwork.chainId || transaction.feePayerAddress ||
          transaction.rawTransaction.sender.toStringLong() !== expectedAddress.toLowerCase()) throw new Error("Aptos transaction builder returned a different sender or network.");
      const rawBytes = toHex(transaction.rawTransaction.bcsToBytes());
      const signed = await wallet.signTransaction({ transactionOrPayload: transaction });
      if (toHex(signed.rawTransaction) !== rawBytes || toHex(transaction.rawTransaction.bcsToBytes()) !== rawBytes ||
          !(signed.authenticator instanceof AccountAuthenticatorEd25519) ||
          signed.authenticator.public_key.toString() !== publicKey.toString() ||
          !publicKey.verifySignature({ message: generateSigningMessageForTransaction(transaction), signature: signed.authenticator.signature })) {
        throw new Error("Aptos wallet changed the prepared transaction or returned invalid signatures.");
      }
      await assertAuthenticationKey(publicKey, expectedAddress);
      assertWalletOwner("Aptos", liveWallet.current.address, expectedAddress, true);
      const hash = generateUserTransactionHash({ transaction, senderAuthenticator: signed.authenticator });
      options?.onBeforeBroadcast(hash); // Storage failure prevents broadcast.
      submitted = await client.transaction.submit.simple({ transaction, senderAuthenticator: signed.authenticator });
      if (submitted.hash.toLowerCase() !== hash.toLowerCase()) throw new Error(`Aptos RPC returned a different hash; reconcile ${hash} before retrying.`);
    } else {
      submitted = await wallet.signAndSubmitTransaction({
        data: { function: tx.function, typeArguments: [], functionArguments: tx.args },
      });
    }
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const response = await fetch(`${aptosNetwork.rest}/v1/transactions/by_hash/${submitted.hash}`).catch(() => null);
      if (response?.ok) {
        const receipt = await response.json() as { type?: string; success?: boolean; vm_status?: string; hash?: string; sender?: string };
        if (receipt.type !== "pending_transaction") {
          if (receipt.type !== "user_transaction" || receipt.hash?.toLowerCase() !== submitted.hash.toLowerCase() ||
              fullAptosAddress(receipt.sender ?? "") !== fullAptosAddress(expectedAddress)) {
            throw new Error(`Aptos receipt does not match the submitted wallet transaction ${submitted.hash}. Check the explorer before retrying.`);
          }
          if (receipt.success !== true) throw new Error(`Aptos transaction failed: ${receipt.vm_status ?? "unknown VM error"}`);
          return { hash: submitted.hash };
        }
      } else if (response && ![404, 408, 429, 502, 503, 504].includes(response.status)) {
        throw new Error(`Aptos transaction ${submitted.hash} was submitted but lookup returned ${response.status}. Check the explorer before retrying.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(`Aptos transaction ${submitted.hash} was submitted but not confirmed within 90 seconds. Check the explorer before retrying.`);
  }, [wallet, assertNetwork, assertAuthenticationKey]);

  return {
    address,
    isConnected: wallet.connected && !!address,
    isConnecting: wallet.isLoading,
    name: wallet.wallet?.name ?? null,
    network: wallet.network,
    wallets: wallet.wallets.map((item) => ({ name: item.name, icon: item.icon,
      detected: typeof window !== "undefined" && !isPetraWebWallet(item, false) && getAptosWallets().aptosWallets.some((registered) => registered === item) })),
    error,
    connect,
    switchNetwork,
    disconnect: wallet.disconnect,
    assertNetwork,
    signOwnership,
    signAndSubmit,
  };
}
