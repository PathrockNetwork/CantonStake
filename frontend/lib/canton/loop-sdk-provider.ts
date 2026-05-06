/**
 * Real Loop wallet provider — wraps @fivenorth/loop-sdk.
 *
 * Exposes the same ICantonProvider shape as the mock provider so the rest
 * of the app doesn't need to change. The connect flow:
 *
 *   1. loop.init({ appName, network, onAccept, onReject }) — once on first use.
 *   2. loop.connect() — opens the SDK's QR modal. The SDK shows its own UI.
 *   3. onAccept fires with a Provider whose `party_id` becomes our partyId.
 *   4. We persist (partyId, displayName) and notify backend via upsertUser.
 *
 * The SDK is browser-only; isAvailable() returns false during SSR so the
 * mock loop-provider is used in that context. On the client, it becomes
 * the highest-priority provider once the SDK initialises.
 */

import { upsertUser } from "@/lib/api";
import type {
  CantonConnectOptions,
  CantonIdentity,
  CantonNetwork,
  ICantonProvider,
} from "./types";

const STORAGE_KEY = "cantonstake_loop_sdk_identity";
const CHANGE_EVENT = "cantonstake-loop-sdk-change";

interface LoopProviderLike {
  party_id: string;
}

interface LoopSdkLike {
  init: (opts: {
    appName: string;
    network?: CantonNetwork;
    onAccept?: (provider: LoopProviderLike) => void;
    onReject?: () => void;
  }) => void;
  autoConnect: () => Promise<void>;
  connect: () => Promise<void>;
  logout: () => void;
}

let sdkPromise: Promise<LoopSdkLike | null> | null = null;
let sdkInitialised = false;
let currentResolve: ((identity: CantonIdentity) => void) | null = null;
let currentReject: ((err: Error) => void) | null = null;
let pendingDisplayName: string | null = null;
let pendingEvmAddress: string | undefined;

function readStored(): CantonIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CantonIdentity) : null;
  } catch {
    return null;
  }
}

function writeStored(identity: CantonIdentity) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function clearStored() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function resolveNetwork(): CantonNetwork {
  const env = (
    process.env.NEXT_PUBLIC_LOOP_NETWORK ?? "devnet"
  ).toLowerCase() as CantonNetwork;
  if (env === "local" || env === "devnet" || env === "mainnet") return env;
  return "devnet";
}

async function loadSdk(): Promise<LoopSdkLike | null> {
  if (typeof window === "undefined") return null;
  if (sdkPromise) return sdkPromise;

  sdkPromise = (async () => {
    try {
      const mod = (await import("@fivenorth/loop-sdk")) as unknown as {
        loop: LoopSdkLike;
      };
      return mod.loop;
    } catch (err) {
      console.warn("[loop-sdk] dynamic import failed:", err);
      return null;
    }
  })();

  return sdkPromise;
}

async function ensureInitialised(): Promise<LoopSdkLike | null> {
  const sdk = await loadSdk();
  if (!sdk) return null;
  if (sdkInitialised) return sdk;

  sdk.init({
    appName: "CantonStake",
    network: resolveNetwork(),
    onAccept: async (provider) => {
      const identity: CantonIdentity = {
        partyId: provider.party_id,
        displayName: pendingDisplayName ?? deriveDisplayName(provider.party_id),
      };
      writeStored(identity);
      try {
        await upsertUser({
          cantonPartyId: identity.partyId,
          displayName: identity.displayName,
          evmAddress: pendingEvmAddress,
        });
      } catch (err) {
        console.warn("[loop-sdk-provider] backend registration failed:", err);
      }
      currentResolve?.(identity);
      currentResolve = null;
      currentReject = null;
      pendingDisplayName = null;
      pendingEvmAddress = undefined;
    },
    onReject: () => {
      currentReject?.(new Error("Loop wallet connection rejected."));
      currentResolve = null;
      currentReject = null;
      pendingDisplayName = null;
      pendingEvmAddress = undefined;
    },
  });

  sdkInitialised = true;

  try {
    await sdk.autoConnect();
  } catch (err) {
    // autoConnect failures are non-fatal — the user can still call connect().
    console.debug("[loop-sdk-provider] autoConnect skipped:", err);
  }

  return sdk;
}

function deriveDisplayName(partyId: string): string {
  const head = partyId.split("::")[0];
  return head && head.length > 0 ? head : "Loop User";
}

export const loopSdkProvider: ICantonProvider = {
  id: "loop-sdk",
  displayName: "Loop Wallet",

  isAvailable() {
    if (typeof window === "undefined") return false;
    return process.env.NEXT_PUBLIC_LOOP_SDK_ENABLED !== "false";
  },

  getStoredIdentity() {
    return readStored();
  },

  async connect({ displayName, evmAddress }: CantonConnectOptions) {
    const sdk = await ensureInitialised();
    if (!sdk) {
      throw new Error("Loop SDK is unavailable in this environment.");
    }

    pendingDisplayName = displayName ?? null;
    pendingEvmAddress = evmAddress;

    return new Promise<CantonIdentity>((resolve, reject) => {
      currentResolve = resolve;
      currentReject = reject;

      sdk.connect().catch((err) => {
        currentResolve = null;
        currentReject = null;
        pendingDisplayName = null;
        pendingEvmAddress = undefined;
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  },

  async disconnect() {
    const sdk = await loadSdk();
    sdk?.logout();
    clearStored();
  },

  subscribe(cb: () => void) {
    if (typeof window === "undefined") return () => {};
    window.addEventListener(CHANGE_EVENT, cb);
    return () => window.removeEventListener(CHANGE_EVENT, cb);
  },
};
