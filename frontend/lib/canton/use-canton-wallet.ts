"use client";

import { useCallback, useEffect, useState } from "react";
import { getActiveProvider } from "./index";

export interface UseCantonWalletReturn {
  isConnected: boolean;
  partyId: string | null;
  displayName: string | null;
  isConnecting: boolean;
  error: string | null;
  connect: (displayName?: string, evmAddress?: string) => Promise<string | null>;
  disconnect: () => void;
}

interface State {
  isConnected: boolean;
  partyId: string | null;
  displayName: string | null;
  isConnecting: boolean;
  error: string | null;
}

const initialState: State = {
  isConnected: false,
  partyId: null,
  displayName: null,
  isConnecting: false,
  error: null,
};

export function useCantonWallet(): UseCantonWalletReturn {
  const provider = getActiveProvider();
  const [state, setState] = useState<State>(initialState);

  useEffect(() => {
    const sync = () => {
      const stored = provider.getStoredIdentity();
      setState((prev) => ({
        ...prev,
        isConnected: stored !== null,
        partyId: stored?.partyId ?? null,
        displayName: stored?.displayName ?? null,
        isConnecting: false,
        error: null,
      }));
    };
    sync();
    return provider.subscribe(sync);
  }, [provider]);

  const connect = useCallback(
    async (displayName?: string, evmAddress?: string) => {
      setState((prev) => ({ ...prev, isConnecting: true, error: null }));
      try {
        const identity = await provider.connect({ displayName, evmAddress });
        return identity.partyId;
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isConnecting: false,
          error: err instanceof Error ? err.message : "Connection failed",
        }));
        return null;
      }
    },
    [provider],
  );

  const disconnect = useCallback(() => {
    void provider.disconnect();
  }, [provider]);

  return { ...state, connect, disconnect };
}
