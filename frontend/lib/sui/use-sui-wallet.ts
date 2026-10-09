"use client";

import { useCurrentAccount, useCurrentClient, useDAppKit, useWalletConnection, useWallets } from "@mysten/dapp-kit-react";
import { SlushWallet } from "@mysten/slush-wallet";
import { getWalletForHandle } from "@wallet-standard/ui-registry";
import { Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import { useCallback, useState } from "react";
import { assertWalletOwner } from "../wallet-binding";
import { assertSuiNetworkIdentifier, suiNetwork } from "./network";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { verifyTransactionSignature } from "@mysten/sui/verify";

/**
 * Sui wallet hook — wraps `@mysten/dapp-kit-react`'s primitives into the same
 * connect/sign/disconnect shape used by useWagmi / useCosmosWallet so
 * the stake page can branch on chain id without bespoke per-wallet code.
 */

export interface UseSuiWalletReturn {
  address: string | null;
  isConnected: boolean;
  networkSupported: boolean;
  isConnecting: boolean;
  error: string | null;
  wallets: ReturnType<typeof useWallets>;
  detectedWalletNames: string[];
  connect: (walletName?: string) => Promise<void>;
  disconnect: () => void;
  assertNetwork: () => Promise<void>;
  signOwnership: (message: string, expectedWallet: string) => Promise<string>;
  /**
   * Build + sign + execute a request_add_stake move call. Returns the
   * tx digest on success.
   */
  delegate: (args: {
    validator: string;
    amountMist: bigint;
    expectedWallet: string;
  }) => Promise<{ digest: string }>;
  /**
   * Build + sign + execute a request_withdraw_stake move call. Returns the
   * tx digest on success.
   */
  undelegate: (args: { stakedSuiId: string; expectedWallet: string; onBeforeBroadcast?: (digest: string) => void }) => Promise<{ digest: string }>;
}

const SUI_SYSTEM_STATE = "0x5";
const SUI_SYSTEM_MODULE = "0x3::sui_system";
export function useSuiWallet(): UseSuiWalletReturn {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const dAppKit = useDAppKit();
  const wallets = useWallets();
  const connection = useWalletConnection();
  const [error, setError] = useState<string | null>(null);

  const assertSuiNetwork = useCallback(async () => {
    const result = await client.query<{ chainIdentifier?: string }>({ query: "{ chainIdentifier }", variables: {} });
    if (result.errors?.length) throw new Error("Sui GraphQL chain identity is unavailable.");
    assertSuiNetworkIdentifier(result.data?.chainIdentifier);
  }, [client]);

  const connect = useCallback(async (walletName?: string) => {
    setError(null);
    const selectedWallet = wallets.find((wallet) => wallet.name === walletName) ?? (walletName ? null : wallets[0]);
    if (!selectedWallet) {
      setError(
        "No Sui wallet detected. Install Slush, Suiet, or another Sui wallet extension.",
      );
      return;
    }
    try {
      await dAppKit.connectWallet({ wallet: selectedWallet });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [wallets, dAppKit]);

  const signOwnership = useCallback(async (message: string, expectedWallet: string) => {
    await assertSuiNetwork();
    const signingAccount = dAppKit.stores.$connection.get().account;
    assertWalletOwner("Sui", signingAccount?.address, expectedWallet, true);
    if (!signingAccount?.chains.includes(`sui:${suiNetwork.name}`)) throw new Error(`Switch your Sui wallet to ${suiNetwork.name} before signing consent.`);
    const bytes = new TextEncoder().encode(message);
    const result = await dAppKit.signPersonalMessage({ message: bytes, account: signingAccount, network: suiNetwork.name });
    assertWalletOwner("Sui", dAppKit.stores.$connection.get().account?.address, expectedWallet, true);
    if (toBase64(fromBase64(result.bytes)) !== toBase64(bytes) || !result.signature) throw new Error("Sui wallet signed different ownership consent.");
    // The backend verifies the personal-message intent and derived address.
    return result.signature;
  }, [assertSuiNetwork, dAppKit]);

  const delegate = useCallback(
    async (args: { validator: string; amountMist: bigint; expectedWallet: string }) => {
      if (!account) throw new Error("Sui wallet not connected");
      if (!account.chains.includes(`sui:${suiNetwork.name}`)) {
        throw new Error(`Switch your Sui wallet to ${suiNetwork.name} before staking.`);
      }
      await assertSuiNetwork();
      const signingAccount = dAppKit.stores.$connection.get().account;
      assertWalletOwner("Sui", signingAccount?.address, args.expectedWallet, true);
      if (!signingAccount) throw new Error("Sui wallet not connected");

      const tx = new Transaction();
      const [stakeCoin] = tx.splitCoins(tx.gas, [args.amountMist]);
      tx.moveCall({
        target: `${SUI_SYSTEM_MODULE}::request_add_stake`,
        arguments: [
          tx.object(SUI_SYSTEM_STATE),
          stakeCoin!,
          tx.pure.address(args.validator),
        ],
      });

      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx, account: signingAccount });
      if (result.$kind !== "Transaction") throw new Error("Sui stake transaction failed");
      // Wait for finalisation so the next caller can rely on the
      // staked-balance read seeing the new position.
      await client.waitForTransaction({ digest: result.Transaction.digest });
      return { digest: result.Transaction.digest };
    },
    [account, dAppKit, client, assertSuiNetwork],
  );

  const undelegate = useCallback(
    async (args: { stakedSuiId: string; expectedWallet: string; onBeforeBroadcast?: (digest: string) => void }) => {
      if (!account) throw new Error("Sui wallet not connected");
      if (!account.chains.includes(`sui:${suiNetwork.name}`)) {
        throw new Error(`Switch your Sui wallet to ${suiNetwork.name} before unstaking.`);
      }
      await assertSuiNetwork();
      const signingAccount = dAppKit.stores.$connection.get().account;
      assertWalletOwner("Sui", signingAccount?.address, args.expectedWallet, true);
      if (!signingAccount) throw new Error("Sui wallet not connected");

      const tx = new Transaction();
      tx.moveCall({
        target: `${SUI_SYSTEM_MODULE}::request_withdraw_stake`,
        arguments: [
          tx.object(SUI_SYSTEM_STATE),
          tx.object(args.stakedSuiId),
        ],
      });

      if (args.onBeforeBroadcast) {
        // Resolve the actual unsigned transaction through the verified RPC.
        // Sign separately so its digest can be saved before any network send.
        tx.setSender(args.expectedWallet);
        const expectedBytes = await tx.build({ client });
        const signed = await dAppKit.signTransaction({ transaction: Transaction.from(expectedBytes), account: signingAccount, network: suiNetwork.name });
        const signedBytes = fromBase64(signed.bytes);
        if (toBase64(signedBytes) !== toBase64(expectedBytes)) throw new Error("Sui wallet changed the reviewed unstake transaction.");
        await verifyTransactionSignature(signedBytes, signed.signature, { address: args.expectedWallet.toLowerCase() });
        assertWalletOwner("Sui", dAppKit.stores.$connection.get().account?.address, args.expectedWallet, true);
        await assertSuiNetwork();
        const digest = TransactionDataBuilder.getDigestFromBytes(signedBytes);
        args.onBeforeBroadcast(digest); // Storage failure prevents broadcast.
        const result = await client.core.executeTransaction({ transaction: signedBytes, signatures: [signed.signature] });
        if (result.$kind !== "Transaction" || result.Transaction.digest !== digest) throw new Error(`Sui unstake ${digest} was not confirmed; reconcile its saved receipt before retrying.`);
        await client.waitForTransaction({ digest });
        return { digest };
      }
      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx, account: signingAccount });
      if (result.$kind !== "Transaction") throw new Error("Sui unstake transaction failed");
      await client.waitForTransaction({ digest: result.Transaction.digest });
      return { digest: result.Transaction.digest };
    },
    [account, client, dAppKit, assertSuiNetwork],
  );

  return {
    address: account?.address ?? null,
    isConnected: !!account,
    networkSupported: !!account?.chains.includes(`sui:${suiNetwork.name}`),
    isConnecting: connection.isConnecting,
    error,
    wallets,
    detectedWalletNames: wallets.filter((wallet) => {
      try { return !(getWalletForHandle(wallet) instanceof SlushWallet); }
      catch { return false; }
    }).map((wallet) => wallet.name),
    connect,
    disconnect: () => { void dAppKit.disconnectWallet(); },
    assertNetwork: assertSuiNetwork,
    signOwnership,
    delegate,
    undelegate,
  };
}
