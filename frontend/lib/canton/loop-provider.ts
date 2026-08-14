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

// The direct-connect provider can only attach to a party that already
// exists on the target ledger — it has no way to allocate one. The party
// must be pinned via env (e.g. the LocalNet app_user party); fabricating
// a random party id would produce an identity no ledger knows about.
function requireConfiguredPartyId(): string {
  const configured = process.env.NEXT_PUBLIC_MOCK_LOOP_PARTY_ID;
  if (configured && configured !== "PLACEHOLDER_READ_FROM_LOCALNET") {
    return configured;
  }
  throw new Error(
    "NEXT_PUBLIC_MOCK_LOOP_PARTY_ID is not set to a real ledger party — " +
      "use the Loop SDK provider (preferred) or pin the LocalNet party in env"
  );
}

/**
 * Direct-connect Loop provider — attaches to a pre-existing Canton party
 * without the SDK QR flow. Used where the real Loop SDK can't run (SSR,
 * LocalNet). Swap point for the real SDK is documented in
 * references/loop-sdk/README.md (loop.init / loop.connect).
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
      partyId: requireConfiguredPartyId(),
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
