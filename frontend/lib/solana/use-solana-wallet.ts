"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { Authorized, Keypair, PublicKey, StakeProgram, Transaction } from "@solana/web3.js";
import { useCallback, useRef, useState } from "react";
import { toBase64 } from "@cosmjs/encoding";
import { toBase58 } from "@mysten/sui/utils";
import { networkMode } from "../network";
import { assertSolanaGenesis } from "./network";
import { readSolanaStakeActivation } from "./stake-activation";
import { waitForSolanaFinality } from "./confirmation";

const TRANSACTION_FEE_RESERVE = 10_000n;

export function useSolanaWallet() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const [error, setError] = useState<string | null>(null);
  const address = wallet.publicKey?.toBase58() ?? null;
  const liveWallet = useRef(wallet);
  liveWallet.current = wallet;
  const assertOwner = useCallback((expected: string) => {
    const current = liveWallet.current;
    if (!current.connected || current.publicKey?.toBase58() !== expected ||
        current.wallet?.adapter.publicKey?.toBase58() !== expected) throw new Error("Solana wallet changed; reconnect the original wallet before signing or broadcasting.");
  }, []);

  const assertNetwork = useCallback(async () => {
    if (!wallet.connected || !wallet.publicKey) throw new Error("Connect a Solana wallet first.");
    assertSolanaGenesis(await connection.getGenesisHash());
  }, [wallet.connected, wallet.publicKey, connection]);

  const connect = useCallback((name: string) => {
    setError(null);
    const selected = wallet.wallets.find((item) => item.adapter.name === name);
    if (!selected) { setError("Solana wallet is no longer available."); return; }
    if (wallet.wallet?.adapter.name === name) void wallet.connect().catch((cause) => setError(String(cause)));
    else wallet.select(name as WalletName);
  }, [wallet]);

  const signOwnership = useCallback(async (message: string, expectedWallet: string) => {
    await assertNetwork();
    assertOwner(expectedWallet);
    const sign = liveWallet.current.signMessage;
    if (!sign) throw new Error("This Solana wallet does not support message signing. Choose a wallet that can sign ownership consent.");
    const signature = await sign(new TextEncoder().encode(message));
    assertOwner(expectedWallet);
    await assertNetwork();
    if (signature.length !== 64) throw new Error("Solana wallet returned an invalid ownership signature.");
    return toBase64(signature); // Backend verifies Ed25519 over the exact UTF-8 consent.
  }, [assertNetwork, assertOwner]);

  const send = useCallback(async (tx: Transaction, signers: Keypair[] = [],
    options?: { expectedWallet: string; onBeforeBroadcast?: (signature: string) => void }) => {
    await assertNetwork();
    if (options) assertOwner(options.expectedWallet);
    tx.feePayer = wallet.publicKey!;
    const latest = await connection.getLatestBlockhash("finalized");
    tx.recentBlockhash = latest.blockhash;
    let signature: string;
    if (options?.onBeforeBroadcast || (networkMode === "testnet" && process.env.NEXT_PUBLIC_LOOP_STAKING_FLOW === "external")) {
      const owner = options?.expectedWallet ?? tx.feePayer.toBase58();
      assertOwner(owner);
      const sign = liveWallet.current.signTransaction;
      if (!sign) throw new Error("This Solana wallet cannot sign separately from broadcast; safe Loop transaction tracking is unavailable.");
      if (signers.length) tx.partialSign(...signers);
      const message = toBase64(tx.serializeMessage());
      const signed = await sign(tx);
      if (toBase64(signed.serializeMessage()) !== message || !signed.verifySignatures(true) || !signed.signature) {
        throw new Error("Solana wallet changed the prepared transaction or returned invalid signatures.");
      }
      assertOwner(owner);
      await assertNetwork();
      const bytes = signed.serialize();
      signature = toBase58(signed.signature);
      options?.onBeforeBroadcast?.(signature); // Storage failure prevents broadcast.
      const broadcast = await connection.sendRawTransaction(bytes, { preflightCommitment: "confirmed" });
      if (broadcast !== signature) throw new Error(`Solana RPC returned a different signature; reconcile ${signature} before retrying.`);
    } else {
      signature = await wallet.sendTransaction(tx, connection, { signers, preflightCommitment: "confirmed" });
    }
    await waitForSolanaFinality(connection, signature, latest.lastValidBlockHeight);
    return { signature };
  }, [assertNetwork, assertOwner, wallet, connection]);

  const prepareStake = useCallback(async (amountLamports: bigint) => {
    await assertNetwork();
    if (amountLamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("SOL stake amount exceeds the supported lamport range.");
    const [minimum, rent, balance] = await Promise.all([
      connection.getStakeMinimumDelegation({ commitment: "finalized" }),
      connection.getMinimumBalanceForRentExemption(StakeProgram.space),
      connection.getBalance(wallet.publicKey!, "finalized"),
    ]);
    if (amountLamports < BigInt(minimum.value)) throw new Error(`Minimum Solana delegation: ${minimum.value / 1e9} SOL.`);
    if (BigInt(balance) < amountLamports + BigInt(rent) + TRANSACTION_FEE_RESERVE) {
      throw new Error("Leave enough SOL for stake-account rent and the transaction fee.");
    }
    return { stakeAccount: Keypair.generate(), rentLamports: BigInt(rent) };
  }, [assertNetwork, connection, wallet.publicKey]);

  const stake = useCallback(async (voteAddress: string, amountLamports: bigint, rentLamports: bigint, stakeAccount: Keypair, expectedWallet: string) => {
    await assertNetwork();
    const owner = wallet.publicKey!;
    if (owner.toBase58() !== expectedWallet) throw new Error("Solana wallet changed after the Canton request; reconnect the original wallet before signing.");
    const lamports = amountLamports + rentLamports;
    if (lamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Stake-account funding exceeds the supported lamport range.");
    const create = StakeProgram.createAccount({
      fromPubkey: owner,
      stakePubkey: stakeAccount.publicKey,
      authorized: new Authorized(owner, owner),
      lamports: Number(lamports),
    });
    const delegate = StakeProgram.delegate({
      stakePubkey: stakeAccount.publicKey,
      authorizedPubkey: owner,
      votePubkey: new PublicKey(voteAddress),
    });
    return send(new Transaction().add(...create.instructions, ...delegate.instructions), [stakeAccount], { expectedWallet });
  }, [assertNetwork, wallet.publicKey, send]);

  const assertAuthority = useCallback(async (stakeAccount: string, type: "staker" | "withdrawer") => {
    await assertNetwork();
    const info = await connection.getParsedAccountInfo(new PublicKey(stakeAccount), "finalized");
    if (!info.value || !info.value.owner.equals(StakeProgram.programId) || !("parsed" in info.value.data)) {
      throw new Error("Solana stake account is missing or invalid.");
    }
    const data = info.value.data.parsed as { info?: { meta?: { authorized?: { staker?: string; withdrawer?: string } } } };
    if (data.info?.meta?.authorized?.[type] !== address) throw new Error(`Connected wallet is not this stake account's ${type} authority.`);
    return info.value;
  }, [assertNetwork, connection, address]);

  const deactivate = useCallback(async (stakeAccount: string, options?: { expectedWallet: string; onBeforeBroadcast: (signature: string) => void }) => {
    await assertAuthority(stakeAccount, "staker");
    const tx = StakeProgram.deactivate({ stakePubkey: new PublicKey(stakeAccount), authorizedPubkey: wallet.publicKey! });
    return send(tx, [], options);
  }, [assertAuthority, wallet.publicKey, send]);

  const withdraw = useCallback(async (stakeAccount: string) => {
    const info = await assertAuthority(stakeAccount, "withdrawer");
    const activation = await readSolanaStakeActivation(new PublicKey(stakeAccount));
    if (activation.state !== "inactive") throw new Error("Solana stake is still activating, active, or cooling down.");
    if (info.lamports <= 0 || !Number.isSafeInteger(info.lamports)) throw new Error("Stake-account balance is not safely withdrawable.");
    const tx = StakeProgram.withdraw({
      stakePubkey: new PublicKey(stakeAccount),
      authorizedPubkey: wallet.publicKey!,
      toPubkey: wallet.publicKey!,
      lamports: info.lamports,
    });
    return send(tx);
  }, [assertAuthority, connection, wallet.publicKey, send]);

  return {
    address, isConnected: wallet.connected && !!address, isConnecting: wallet.connecting,
    name: wallet.wallet?.adapter.name ?? null,
    wallets: wallet.wallets.map((item) => ({ name: item.adapter.name, icon: item.adapter.icon, detected: item.adapter.readyState === WalletReadyState.Installed })),
    error, connect, disconnect: wallet.disconnect, assertNetwork, signOwnership, prepareStake, stake, deactivate, withdraw,
    connection,
  };
}
