"use client";

import {
  useConnectWallet,
  useCurrentAccount,
  useDisconnectWallet,
  useSignAndExecuteTransaction,
  useSuiClient,
  useWallets,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { useCallback, useState } from "react";

/**
 * Sui wallet hook — wraps `@mysten/dapp-kit`'s primitives into the same
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
  /**
   * Build + sign + execute a request_add_stake move call. Returns the
   * tx digest on success.
   */
  delegate: (args: {
    validator: string;
    amountMist: bigint;
  }) => Promise<{ digest: string }>;
}

const SUI_SYSTEM_STATE = "0x5";
const SUI_SYSTEM_MODULE = "0x3::sui_system";

export function useSuiWallet(): UseSuiWalletReturn {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const wallets = useWallets();
  const { mutateAsync: connectWallet, isPending: connecting } =
    useConnectWallet();
  const { mutate: disconnectWallet } = useDisconnectWallet();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [error, setError] = useState<string | null>(null);

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
      await connectWallet({ wallet: wallets[0]! });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [wallets, connectWallet]);

  const delegate = useCallback(
    async (args: { validator: string; amountMist: bigint }) => {
      if (!account) throw new Error("Sui wallet not connected");

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

      const result = await signAndExecute({ transaction: tx });
      // Wait for finalisation so the next caller can rely on the
      // staked-balance read seeing the new position.
      await client.waitForTransaction({ digest: result.digest });
      return { digest: result.digest };
    },
    [account, signAndExecute, client],
  );

  return {
    address: account?.address ?? null,
    isConnected: !!account,
    isConnecting: connecting,
    error,
    connect,
    disconnect: () => disconnectWallet(),
    delegate,
  };
}
