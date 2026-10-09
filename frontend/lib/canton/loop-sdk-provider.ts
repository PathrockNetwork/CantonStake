/**
 * Real Loop wallet provider — wraps @fivenorth/loop-sdk.
 *
 * Exposes the ICantonProvider shape so the rest of the app doesn't need to
 * change. The connect flow:
 *
 *   1. loop.init({ appName, network, onAccept, onReject }) — once on first use.
 *   2. loop.connect() — opens the SDK's QR modal. The SDK shows its own UI.
 *   3. onAccept verifies the Provider's party and key with the real account API.
 *   4. We keep the verified identity in memory. Wallet linking is separate.
 *
 * The SDK is browser-only; isAvailable() returns false during SSR. On the
 * client it becomes the highest-priority provider once the SDK initialises.
 */

import { isLoopStakingNetwork, loopSessionScope, resolveLoopNetwork, scopeLoopSession } from "./loop-network";
import { approveLoopStakingAction } from "./loop-transactions";
import type { LoopStakingAction, LoopStakingDeployment, LoopTransactionSigner } from "./loop-transactions";
import type {
  CantonConnectOptions,
  CantonIdentity,
  CantonNetwork,
  ICantonProvider,
} from "./types";

const CHANGE_EVENT = "cantonstake-loop-sdk-change";
const LOOP_SDK_STORAGE_KEY = "loop_connect";

interface LoopProviderLike extends LoopTransactionSigner {
  public_key: string;
  getAccount(): Promise<{ party_id: string; public_key: string }>;
  getAuthToken(): string;
}

interface LoopSdkLike {
  init: (opts: {
    appName: string;
    network?: CantonNetwork;
    walletUrl?: string;
    apiUrl?: string;
    onAccept?: (provider: LoopProviderLike) => void;
    onReject?: () => void;
  }) => void;
  autoConnect: () => Promise<void>;
  connect: () => Promise<void>;
  logout: () => void;
}

let sdkPromise: Promise<LoopSdkLike | null> | null = null;
let loadedSdk: LoopSdkLike | null = null;
let sdkInitialised = false;
let initialising: Promise<LoopSdkLike | null> | null = null;
let verifiedProvider: LoopProviderLike | null = null;
let verifiedIdentity: CantonIdentity | null = null;
let currentResolve: ((identity: CantonIdentity) => void) | null = null;
let currentReject: ((err: Error) => void) | null = null;
let pendingDisplayName: string | null = null;
// A delayed account read must not reconnect a logged-out wallet or invalidate
// another account that connected while the first read was in flight.
let identityGeneration = 0;
let acceptsEnabled = true;
let connectionRequestGeneration = 0;

async function verifiedAccount(provider: LoopProviderLike) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const account = await Promise.race([provider.getAccount(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Loop account verification timed out. Reconnect your wallet.")), 8000);
    })]);
    if (!/^[^\s:]+::[a-f0-9]{68}$/.test(provider.party_id) || account?.party_id !== provider.party_id ||
        typeof provider.public_key !== "string" || !provider.public_key || account.public_key !== provider.public_key) {
      throw new Error("Loop account or public key does not match this session. Reconnect your wallet.");
    }
    return account;
  } finally { if (timer) clearTimeout(timer); }
}

function readStored(): CantonIdentity | null {
  if (typeof window === "undefined") return null;
  return verifiedIdentity;
}

function writeStored(identity: CantonIdentity) {
  if (typeof window === "undefined") return;
  // An identity is connected only after Loop has verified the session.
  // A cached party string is neither a login nor wallet ownership evidence.
  verifiedIdentity = identity;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function clearStored() {
  if (typeof window === "undefined") return;
  identityGeneration++;
  verifiedProvider = null;
  verifiedIdentity = null;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * SDK releases before 0.13 stored tickets without the per-ticket auth token.
 * Those tickets cannot be resumed by the current Loop backend. Remove only
 * that legacy shape and let the SDK create a fresh session on the next connect.
 */
function clearLegacySdkSession() {
  if (typeof window === "undefined") return;

  const raw = localStorage.getItem(LOOP_SDK_STORAGE_KEY);
  if (!raw) return;

  try {
    const session = JSON.parse(raw) as {
      ticketId?: unknown;
      ticketAuthToken?: unknown;
    };
    if (session.ticketId && !session.ticketAuthToken) {
      localStorage.removeItem(LOOP_SDK_STORAGE_KEY);
    }
  } catch {
    localStorage.removeItem(LOOP_SDK_STORAGE_KEY);
  }
}

function resolveNetwork(): CantonNetwork {
  return resolveLoopNetwork(process.env.NEXT_PUBLIC_LOOP_NETWORK);
}

// When the backend is reverse-proxying Loop's API to bypass CORS, point
// the SDK at that proxy. We override `apiUrl` only — `walletUrl` stays at
// the real Loop host because the user navigates there directly (no
// CORS, just a normal page load).
function resolveApiUrl(): string | undefined {
  const explicit = process.env.NEXT_PUBLIC_LOOP_API_URL;
  if (explicit && explicit.length > 0) return explicit;
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL;
  const useProxy = process.env.NEXT_PUBLIC_LOOP_USE_BACKEND_PROXY === "true";
  if (useProxy && backend && backend.length > 0) {
    return `${backend.replace(/\/$/, "")}/loop-proxy`;
  }
  return undefined;
}

function resolveWalletUrl(): string | undefined {
  const explicit = process.env.NEXT_PUBLIC_LOOP_WALLET_URL;
  if (explicit && explicit.length > 0) return explicit;
  return undefined;
}

async function loadSdk(): Promise<LoopSdkLike | null> {
  if (typeof window === "undefined") return null;
  if (sdkPromise) return sdkPromise;

  scopeLoopSession(localStorage, loopSessionScope(resolveNetwork(), resolveWalletUrl(), resolveApiUrl()));
  clearLegacySdkSession();

  sdkPromise = (async () => {
    try {
      const mod = (await import("@fivenorth/loop-sdk")) as unknown as {
        loop: LoopSdkLike;
      };
      loadedSdk = mod.loop;
      return loadedSdk;
    } catch (err) {
      console.warn("[loop-sdk] dynamic import failed:", err);
      return null;
    }
  })();

  return sdkPromise;
}

async function initialiseSdk(): Promise<LoopSdkLike | null> {
  const sdk = await loadSdk();
  if (!sdk) return null;
  if (sdkInitialised) return sdk;

  sdk.init({
    appName: "CantonStake",
    network: resolveNetwork(),
    apiUrl: resolveApiUrl(),
    walletUrl: resolveWalletUrl(),
    onAccept: async (provider) => {
      if (!acceptsEnabled) { sdk.logout(); return; }
      clearStored();
      const generation = identityGeneration;
      const resolve = currentResolve, reject = currentReject;
      const displayName = pendingDisplayName;
      // The SDK's handshake carries an identity, but only its real account API
      // establishes a current session. Never display a cached public key as
      // verified, including when SDK autoConnect restores its saved ticket.
      try {
        await verifiedAccount(provider);
        if (generation !== identityGeneration) return;
        verifiedProvider = provider;
        const identity: CantonIdentity = {
          partyId: provider.party_id,
          displayName: displayName ?? deriveDisplayName(provider.party_id),
        };
        writeStored(identity);
        // Wallet linking still requires independent native ownership consent.
        resolve?.(identity);
        if (currentResolve === resolve) {
          currentResolve = null;
          currentReject = null;
          pendingDisplayName = null;
        }
      } catch {
        if (generation !== identityGeneration) return;
        clearStored();
        acceptsEnabled = false;
        connectionRequestGeneration++;
        sdk.logout();
        // Do not expose a server body, token or arbitrary SDK error details.
        reject?.(new Error("Loop account verification failed. Reconnect your wallet."));
        if (currentReject === reject) {
          currentResolve = null;
          currentReject = null;
          pendingDisplayName = null;
        }
      }
    },
    onReject: () => {
      acceptsEnabled = false;
      connectionRequestGeneration++;
      clearStored();
      currentReject?.(new Error("Loop wallet connection rejected."));
      currentResolve = null;
      currentReject = null;
      pendingDisplayName = null;
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

function ensureInitialised(): Promise<LoopSdkLike | null> {
  if (!initialising) initialising = initialiseSdk().catch((error) => {
    initialising = null;
    throw error;
  });
  return initialising;
}

/** Only a provider obtained from a verified Loop handshake may approve commands. */
export async function getConnectedLoopSigner(expectedParty: string): Promise<LoopTransactionSigner> {
  await ensureInitialised();
  if (!verifiedProvider || verifiedIdentity?.partyId !== expectedParty || verifiedProvider.party_id !== expectedParty) {
    throw new Error("Connect the correct Loop wallet before approving this transaction.");
  }
  // Revalidate immediately before signing; expired/revoked sessions must not
  // keep presenting a cached identity as authorized.
  const signer = verifiedProvider;
  const generation = identityGeneration;
  try {
    const account = await verifiedAccount(signer);
    if (account.party_id !== expectedParty) throw new Error("Loop account changed. Reconnect your wallet.");
    if (verifiedProvider !== signer || generation !== identityGeneration) throw new Error("Loop wallet disconnected during account verification.");
  } catch (error) {
    if (verifiedProvider === signer && generation === identityGeneration) clearStored();
    throw new Error("Loop session could not be reverified. Reconnect the correct wallet before continuing.");
  }
  return signer;
}

export async function approveConnectedLoopStake(deployment: LoopStakingDeployment, action: LoopStakingAction) {
  return approveLoopStakingAction(await getConnectedLoopSigner(action.delegator), resolveNetwork(), deployment, action);
}

/** Short-lived pass-through to our own backend only; never persist or log it. */
export async function connectedLoopAuthorization(expectedParty: string): Promise<string> {
  // Session authentication is also needed for profile edits. This does not
  // grant on-ledger staking permission; approveConnectedLoopStake stays gated.
  const signer = await getConnectedLoopSigner(expectedParty);
  if (signer !== verifiedProvider) throw new Error("Loop account changed; reconnect before staking.");
  const token = verifiedProvider.getAuthToken();
  if (!token || /\s/.test(token)) throw new Error("Loop session token is unavailable; reconnect your wallet.");
  return `Bearer ${token}`;
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
    if (!this.isAvailable()) return null;
    if (typeof window !== "undefined" && !initialising) void ensureInitialised().catch(() => {});
    return readStored();
  },

  async connect({ displayName }: CantonConnectOptions) {
    if (!this.isAvailable()) throw new Error("Loop SDK is disabled in this environment.");
    if (currentResolve) throw new Error("A Loop connection request is already open.");
    const requestGeneration = ++connectionRequestGeneration;
    acceptsEnabled = true;
    const sdk = await ensureInitialised();
    if (requestGeneration !== connectionRequestGeneration || !acceptsEnabled) {
      throw new Error("Loop connection was cancelled. Connect again when ready.");
    }
    if (!sdk) {
      throw new Error("Loop SDK is unavailable in this environment.");
    }

    if (currentResolve) throw new Error("A Loop connection request is already open.");

    pendingDisplayName = displayName ?? null;

    return new Promise<CantonIdentity>((resolve, reject) => {
      currentResolve = resolve;
      currentReject = reject;

      sdk.connect().catch((err) => {
        if (currentReject !== reject) return;
        currentResolve = null;
        currentReject = null;
        pendingDisplayName = null;
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  },

  async disconnect() {
    acceptsEnabled = false;
    connectionRequestGeneration++;
    currentReject?.(new Error("Loop wallet disconnected."));
    currentResolve = null;
    currentReject = null;
    pendingDisplayName = null;
    // Invalidate synchronously; SDK loading/logout must not leave a signing
    // window where the page still considers a disconnected party authorized.
    clearStored();
    // Once loaded, stop its socket and revoke the ticket before yielding.
    if (loadedSdk) { loadedSdk.logout(); return; }
    const generation = identityGeneration;
    const sdk = await loadSdk();
    if (generation === identityGeneration) sdk?.logout();
  },

  subscribe(cb: () => void) {
    if (typeof window === "undefined") return () => {};
    window.addEventListener(CHANGE_EVENT, cb);
    return () => window.removeEventListener(CHANGE_EVENT, cb);
  },
};
