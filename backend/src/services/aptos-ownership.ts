import { createHash } from "node:crypto";
import { Ed25519, sha256 } from "@cosmjs/crypto";
import { fromHex, toHex, toUtf8 } from "@cosmjs/encoding";
import { rpcUrls } from "./rpc-registry.js";

/** The nonce and both accepted wrappers are reconstructed server-side, never
 * accepted as arbitrary browser-provided signed text. The consent itself binds
 * wallet, chain ID, validator, amount, Loop party, intent, expiry and deployment.
 * Petra: https://petra.app/docs/signing-a-message
 */
export function aptosConsentMessages(message: string) {
  const nonce = toHex(sha256(toUtf8(message)));
  return { nonce, "nonce-first": `APTOS\nnonce: ${nonce}\nmessage: ${message}`,
    "message-first": `APTOS\nmessage: ${message}\nnonce: ${nonce}` };
}

export function aptosEd25519AuthenticationKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error("Aptos Ed25519 public key must have 32 bytes");
  return `0x${createHash("sha3-256").update(publicKey).update(Uint8Array.of(0)).digest("hex")}`;
}

/** Real Ed25519 account only. Current on-chain authentication_key, not the
 * original account address, is authoritative after key rotation. RPC failures
 * propagate as unavailable; they are not reported as an invalid signature.
 */
export async function verifyAptosConsent(wallet: string, message: string, wire: string): Promise<boolean> {
  if (!/^0x[a-f0-9]{64}$/.test(wallet) || wire.length > 1024) return false;
  let consent: { publicKey?: string; signature?: string; layout?: string };
  try { consent = JSON.parse(wire); } catch { return false; }
  if (!consent || !/^0x[a-f0-9]{64}$/.test(consent.publicKey ?? "") ||
      !/^0x[a-f0-9]{128}$/.test(consent.signature ?? "") ||
      !["nonce-first", "message-first"].includes(consent.layout ?? "")) return false;
  const messages = aptosConsentMessages(message);
  const fullMessage = consent.layout === "nonce-first" ? messages["nonce-first"] : messages["message-first"];
  const publicKey = fromHex(consent.publicKey!.slice(2));
  if (!await Ed25519.verifySignature(fromHex(consent.signature!.slice(2)), toUtf8(fullMessage), publicKey)) return false;
  const get = async (path: string) => {
    const response = await fetch(`${rpcUrls.aptos}${path}`, { signal: AbortSignal.timeout(10000), redirect: "error" });
    if (!response.ok) throw new Error("Aptos ownership RPC is unavailable");
    return response.json();
  };
  const ledger = await get("/v1") as { chain_id?: number };
  if (ledger.chain_id !== 2) throw new Error("Aptos ownership RPC is not TestNet");
  const account = await get(`/v1/accounts/${wallet}`) as { authentication_key?: string };
  if (!/^0x[a-fA-F0-9]{64}$/.test(account.authentication_key ?? "")) throw new Error("Aptos account authentication key is unavailable");
  // SDK AuthenticationKeyScheme.Ed25519 = 0; SHA3-256(publicKey || 0).
  const authenticationKey = aptosEd25519AuthenticationKey(publicKey);
  return account.authentication_key!.toLowerCase() === authenticationKey;
}
