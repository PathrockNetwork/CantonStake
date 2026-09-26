"use client";

import { useCurrentAccount, useCurrentClient, useDAppKit, useWalletConnection, useWallets } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { useCallback, useState } from "react";
import { assertWalletOwner } from "../wallet-binding";
import { assertSuiNetworkIdentifier } from "./network";

/**
 * Sui wallet hook — wraps `@mysten/dapp-kit-react`'s primitives into the same
 * connect/sign/disconnect shape used by useWagmi / useCosmosWallet so
 * the stake page can branch on chain id without bespoke per-wallet code.
 */

export interface UseSuiWalletReturn {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  assertNetwork: () => Promise<void>;
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
  undelegate: (args: { stakedSuiId: string; expectedWallet: string }) => Promise<{ digest: string }>;
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

  const connect = useCallback(async () => {
    setError(null);
    if (wallets.length === 0) {
      setError(
        "No Sui wallet detected. Install Slush, Suiet, or another Sui wallet extension.",
      );
      return;
    }
    try {
      // Pick the first available wallet — the user is then prompted by
      // their wallet's native UI to approve.
      await dAppKit.connectWallet({ wallet: wallets[0]! });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [wallets, dAppKit]);

  const delegate = useCallback(
    async (args: { validator: string; amountMist: bigint; expectedWallet: string }) => {
      if (!account) throw new Error("Sui wallet not connected");
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
    async (args: { stakedSuiId: string; expectedWallet: string }) => {
      if (!account) throw new Error("Sui wallet not connected");
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
    isConnecting: connection.isConnecting,
    error,
    connect,
    disconnect: () => { void dAppKit.disconnectWallet(); },
    assertNetwork: assertSuiNetwork,
    delegate,
    undelegate,
  };
}
