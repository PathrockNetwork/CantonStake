import { cryptoWaitReady, decodeAddress, encodeAddress, signatureVerify } from "@polkadot/util-crypto";

/** Verify the real extension's signRaw consent, not an extrinsic signature or
 * a browser's verification flag. The intent itself binds Westend Asset Hub's
 * genesis, wallet, pool, amount, Loop party and reviewed Canton deployment.
 * Only standard single-key ed25519/sr25519 accounts are supported. */
export async function verifyPolkadotConsent(wallet: string, message: string, signature: string): Promise<boolean> {
  if (!await cryptoWaitReady()) throw new Error("Polkadot signature verification is unavailable");
  try {
    if (!/^[1-9A-HJ-NP-Za-km-z]{47,49}$/.test(wallet) || !/^0x(?:00|01)[a-fA-F0-9]{128}$/.test(signature)) return false;
    const key = decodeAddress(wallet);
    if (key.length !== 32 || encodeAddress(key, 42) !== wallet) return false;
    const result = signatureVerify(new TextEncoder().encode(message), signature, key);
    return result.isValid && result.crypto === (signature.slice(2, 4) === "00" ? "ed25519" : "sr25519");
  } catch { return false; }
}
