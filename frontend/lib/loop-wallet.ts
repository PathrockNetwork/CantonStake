/**
 * Loop Wallet Mock / Connector
 *
 * In production, the @fivenorth/loop-sdk provides passkey/biometric login
 * and returns the user's Canton Party ID, which is used as the delegator
 * identity in StakingRequest contracts and as a beneficiary for CC rewards.
 *
 * Loop SDK handles: identity (Party ID), CC balance display, cross-dApp auth.
 * It does NOT interact with custom Daml contracts — those are managed by the
 * backend's CantonClient via the app party.
 *
 * This module provides:
 *   - A mock implementation for development / hackathon demo
 *   - The interface the real Loop SDK would implement
 *   - localStorage persistence of the "connected" Loop identity
 *
 * To swap to real Loop SDK:
 *   1. npm install @fivenorth/loop-sdk
 *   2. Replace LoopWalletConnector.connect() with loopSdk.connect()
 *   3. Replace .getPartyId() with loopSdk.getPartyId()
 */

"use client";

import { useState, useCallback, useEffect } from "react";

export interface LoopWalletState {
  isConnected: boolean;
  partyId: string | null;
  displayName: string | null;
  ccBalance: number | null;
  isConnecting: boolean;
  error: string | null;
}

const STORAGE_KEY = "cantonstake_loop_wallet";

function getStoredIdentity(): { partyId: string; displayName: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeIdentity(partyId: string, displayName: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ partyId, displayName }));
}

function clearStoredIdentity() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Generate a mock Canton Party ID.
 * Real format: "DisplayName::1220<hash>"
 * We generate a random hex suffix to simulate unique parties.
 */
function generateMockPartyId(displayName: string): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${displayName}::1220${hex}`;
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4001";

/**
 * React hook for Loop Wallet connection.
 *
 * In production this would use @fivenorth/loop-sdk.
 * For the hackathon it mocks the identity flow:
 *   - "Connect Loop Wallet" generates a random Party ID
 *   - Party ID is persisted in localStorage
 *   - On connect, registers identity with backend POST /api/users
 *   - CC balance fetched from backend rewards API
 */
export function useLoopWallet() {
  const [state, setState] = useState<LoopWalletState>({
    isConnected: false,
    partyId: null,
    displayName: null,
    ccBalance: null,
    isConnecting: false,
    error: null,
  });

  // Restore from localStorage on mount
  useEffect(() => {
    const stored = getStoredIdentity();
    if (stored) {
      setState({
        isConnected: true,
        partyId: stored.partyId,
        displayName: stored.displayName,
        ccBalance: 0,
        isConnecting: false,
        error: null,
      });
    }
  }, []);

  const connect = useCallback(async (displayName?: string) => {
    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      // Simulate network delay for passkey/biometric auth
      await new Promise((r) => setTimeout(r, 800));

      const name = displayName || "Delegator";
      const partyId = generateMockPartyId(name);

      storeIdentity(partyId, name);

      // Notify backend about the new Loop wallet identity
      try {
        await fetch(`${BACKEND_URL}/api/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cantonPartyId: partyId, displayName: name }),
        });
      } catch (e) {
        console.warn("[loop-wallet] failed to register with backend:", e);
      }

      setState({
        isConnected: true,
        partyId,
        displayName: name,
        ccBalance: 0,
        isConnecting: false,
        error: null,
      });

      return partyId;
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: err instanceof Error ? err.message : "Connection failed",
      }));
      return null;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearStoredIdentity();
    setState({
      isConnected: false,
      partyId: null,
      displayName: null,
      ccBalance: null,
      isConnecting: false,
      error: null,
    });
  }, []);

  /**
   * Refresh CC balance from the backend rewards API.
   * Uses totalUserShare (75% of totalCcEarned) as the displayed balance.
   */
  const refreshBalance = useCallback(async (evmAddress?: string) => {
    if (!state.partyId) return;
    try {
      if (evmAddress) {
        const res = await fetch(`${BACKEND_URL}/api/rewards/${evmAddress}`);
        if (res.ok) {
          const data = await res.json();
          setState((prev) => ({
            ...prev,
            ccBalance: data.totalUserShare ?? data.totalCcEarned ?? 0,
          }));
          return;
        }
      }
      // Fallback: keep current balance
    } catch {
      // silently fail
    }
  }, [state.partyId]);

  return {
    ...state,
    connect,
    disconnect,
    refreshBalance,
  };
}
