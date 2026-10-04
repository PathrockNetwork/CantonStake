import { verifyMessage, type Address, type Hex } from "viem";
import { makeSignDoc, pubkeyToAddress, serializeSignDoc } from "@cosmjs/amino";
import { Ed25519, Secp256k1, Secp256k1Signature, sha256 } from "@cosmjs/crypto";
import { fromBase64, toBase64, toUtf8 } from "@cosmjs/encoding";
import { parseSerializedSignature } from "@mysten/sui/cryptography";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { fromBase58, toBase58 } from "@mysten/sui/utils";

export const LOOP_STAKING_CHAINS = ["polygon", "monad", "bnb", "cosmos", "celestia", "osmosis", "sui", "solana", "aptos", "polkadot"] as const;
export type LoopNativeChain = typeof LOOP_STAKING_CHAINS[number];
export const LOOP_NATIVE_NETWORK: Record<LoopNativeChain, string> = {
  polygon: "11155111", monad: "10143", bnb: "97",
  cosmos: "provider", celestia: "mocha-5", osmosis: "osmo-test-5",
  sui: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
  solana: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
  aptos: "2",
  polkadot: "0x67f9723393ef76214df0118c34bbbd3dbebc8ed46a10973a8c969d48fe7598c9",
};
const PREFIX = { cosmos: "cosmos", celestia: "celestia", osmosis: "osmo" } as const;

/** Verify the actual expiring consent, never a browser's verification result.
 * ADR-36 uses an empty chain_id, so the consent MUST include the native network.
 * https://docs.keplr.app/api/guide/sign-arbitrary
 * Only standard single-key Cosmos secp256k1 accounts are supported here. */
export async function verifyLoopNativeOwnership(
  chain: LoopNativeChain, wallet: string, message: string, wireSignature: string,
): Promise<boolean> {
  if (chain === "aptos") {
    const { verifyAptosConsent } = await import("./aptos-ownership.js");
    return verifyAptosConsent(wallet, message, wireSignature);
  }
  if (chain === "polkadot") {
    const { verifyPolkadotConsent } = await import("./polkadot-ownership.js");
    return verifyPolkadotConsent(wallet, message, wireSignature);
  }
  try {
    if (chain === "polygon" || chain === "monad" || chain === "bnb") {
      return /^0x[a-fA-F0-9]{130}$/.test(wireSignature) && await verifyMessage({
        address: wallet as Address, message, signature: wireSignature as Hex,
      });
    }
    if (wireSignature.length > 1024) return false;
    if (chain === "solana") {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return false;
      const publicKey = fromBase58(wallet);
      const signature = fromBase64(wireSignature);
      return publicKey.length === 32 && toBase58(publicKey) === wallet && signature.length === 64 &&
        toBase64(signature) === wireSignature && await Ed25519.verifySignature(signature, toUtf8(message), publicKey);
    }
    if (chain === "sui") {
      if (!/^0x[a-f0-9]{64}$/.test(wallet) || toBase64(fromBase64(wireSignature)) !== wireSignature) return false;
      const parsed = parseSerializedSignature(wireSignature);
      // zkLogin/passkeys/multisig need their own verified ownership policy.
      if (!["ED25519", "Secp256k1", "Secp256r1"].includes(parsed.signatureScheme)) return false;
      const key = await verifyPersonalMessageSignature(toUtf8(message), wireSignature, { address: wallet });
      return key.toSuiAddress() === wallet;
    }
    const signature = JSON.parse(wireSignature);
    if (signature?.pub_key?.type !== "tendermint/PubKeySecp256k1" ||
        typeof signature.pub_key.value !== "string" || typeof signature.signature !== "string") return false;
    const publicKey = fromBase64(signature.pub_key.value);
    const bytes = fromBase64(signature.signature);
    if (publicKey.length !== 33 || ![2, 3].includes(publicKey[0]!) || bytes.length !== 64 ||
        toBase64(publicKey) !== signature.pub_key.value || toBase64(bytes) !== signature.signature ||
        pubkeyToAddress(signature.pub_key, PREFIX[chain]) !== wallet) return false;
    const signDoc = makeSignDoc([{ type: "sign/MsgSignData", value: {
      signer: wallet, data: toBase64(toUtf8(message)),
    } }], { gas: "0", amount: [] }, "", "", "0", "0");
    return Secp256k1.verifySignature(Secp256k1Signature.fromFixedLength(bytes), sha256(serializeSignDoc(signDoc)), publicKey);
  } catch { return false; }
}
