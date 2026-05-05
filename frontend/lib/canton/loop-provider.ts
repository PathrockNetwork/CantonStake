import { upsertUser } from "@/lib/api";
import type {
  CantonConnectOptions,
  CantonIdentity,
  ICantonProvider,
} from "./types";

const STORAGE_KEY = "cantonstake_loop_wallet";
const CHANGE_EVENT = "cantonstake-loop-wallet-change";

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

function generatePartyId(displayName: string): string {
  const configured = process.env.NEXT_PUBLIC_MOCK_LOOP_PARTY_ID;
  if (configured) return configured;
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${displayName}::1220${hex}`;
}

/**
 * Loop provider — passkey/biometric identity flow on Canton.
 *
 * This is the mock implementation. Swap point for the real SDK is
 * documented in references/loop-sdk/README.md (loop.init / loop.connect).
 * When swapping: keep this file's exported shape; replace the body of
 * connect/disconnect with the SDK calls.
 */
export const loopProvider: ICantonProvider = {
  id: "loop",
  displayName: "Loop Wallet",

  isAvailable() {
    return true;
  },

  getStoredIdentity() {
    return readStored();
  },

  async connect({ displayName, evmAddress }: CantonConnectOptions) {
    await new Promise((r) => setTimeout(r, 800));
    const name = displayName ?? "Delegator";
    const identity: CantonIdentity = {
      partyId: generatePartyId(name),
      displayName: name,
    };

    writeStored(identity);

    try {
      await upsertUser({
        cantonPartyId: identity.partyId,
        displayName: identity.displayName,
        evmAddress,
      });
    } catch (err) {
      console.warn("[loop-provider] backend registration failed:", err);
    }

    return identity;
  },

  async disconnect() {
    clearStored();
  },

  subscribe(cb: () => void) {
    if (typeof window === "undefined") return () => {};
    window.addEventListener(CHANGE_EVENT, cb);
    return () => window.removeEventListener(CHANGE_EVENT, cb);
  },
};
