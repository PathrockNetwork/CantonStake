/** Actual Westend Asset Hub reads only. No wallet generation, extension
 * substitutes, Loop environment, signing, simulation or transaction writes.
 * Protocol evidence is not proof of the real Loop wallet workflow. */
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { parse } from "dotenv";
import { cryptoWaitReady, blake2AsU8a, signatureVerify, decodeAddress, encodeAddress } from "@polkadot/util-crypto";
import { verifyLoopNativeOwnership } from "../src/services/loop-native-ownership.js";

let stage = "existing TestNet configuration";
async function main() {
  const actual = { ...parse(await readFile(new URL("../../.env", import.meta.url))),
    ...parse(await readFile(new URL("../../.env.testnet", import.meta.url))) };
  if (actual.NETWORK_MODE !== "testnet" || actual.BACKEND_PORT !== "4002") throw new Error("Existing TestNet deployment was not recognized");
  Object.assign(process.env, actual, { PORT: actual.BACKEND_PORT });
  const { polkadotApi, POLKADOT_ASSET_HUB } = await import("../src/services/polkadot-rpc.js");
  const { classifyRpcRequest } = await import("../src/services/rpc-policy.js");
  stage = "checked Westend RPC initialization";
  const api = await polkadotApi();
  try {
    assert.ok(await cryptoWaitReady());
    assert.equal(api.genesisHash.toHex(), POLKADOT_ASSET_HUB.testnet.genesis);
    const minJoin = (await api.query.nominationPools.minJoinBond()).toString();
    const head = await api.rpc.chain.getFinalizedHead();
    const height = (await api.rpc.chain.getHeader(head)).number.toNumber();
    stage = "bounded real finalized receipt inventory";
    let publicSignature: { hash: string; blockHash: string; height: number; crypto: string } | null = null;
    let decodedSigned = 0;
    let unsupportedDecode = 0;
    let fullUnbondCalls = 0;
    let inspectedBlocks = 0;
    // Inspect a bounded real chain window. Missing receipts are not replaced
    // by generated transactions, synthetic bond versions or latest state.
    for (let number = height; number > Math.max(0, height - 64); number--) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const blockHash = (await api.rpc.chain.getBlockHash(number)).toHex();
      const raw = await api.rpc.chain.getBlock.raw(blockHash) as any;
      assert.ok(raw?.block?.extrinsics);
      inspectedBlocks++;
      const parentHash = raw.block.header.parentHash;
      const parent = await api.at(parentHash);
      for (const encoded of raw.block.extrinsics as string[]) {
        let extrinsic;
        try { extrinsic = parent.registry.createType("Extrinsic", encoded); }
        catch { unsupportedDecode++; continue; }
        if (!extrinsic.isSigned || extrinsic.version !== 4) continue;
        decodedSigned++;
        assert.equal(extrinsic.hash.toHex(), api.registry.hash(Buffer.from(encoded.slice(2), "hex")).toHex());
        const wallet = encodeAddress(decodeAddress(extrinsic.signer.toString()), 42);
        if (extrinsic.method.section === "nominationPools" && extrinsic.method.method === "unbond" && extrinsic.method.args.length === 2) {
          const member = await parent.query.nominationPools.poolMembers(wallet) as any;
          if (!member.isNone && member.unwrap().points.toString() === extrinsic.method.args[1]!.toString()) fullUnbondCalls++;
        }
        // Metadata hash mode needs a separately verified Merkle metadata hash.
        // Do not silently substitute None to get a positive signature result.
        if (publicSignature || extrinsic.mode?.toString() === "1") continue;
        stage = "actual public native signature reconstruction";
        const checkpoint = extrinsic.era.isImmortalEra ? api.genesisHash.toHex()
          : (await api.rpc.chain.getBlockHash(extrinsic.era.asMortalEra.birth(number))).toHex();
        const runtime = await api.rpc.state.getRuntimeVersion(parentHash);
        const payload = parent.registry.createType("ExtrinsicPayload", {
          ...(extrinsic.inner.signature.toJSON() as object), method: extrinsic.method.toHex(),
          genesisHash: api.genesisHash.toHex(), blockHash: checkpoint, specVersion: runtime.specVersion,
          transactionVersion: runtime.transactionVersion,
        }, { version: extrinsic.version });
        const bytes = payload.toU8a({ method: true });
        const verified = signatureVerify(bytes.length > 256 ? blake2AsU8a(bytes) : bytes, extrinsic.signature.toHex(), wallet);
        // This is an actual committed receipt; don't alter its signature or
        // invent missing signed fields if reconstruction cannot verify it.
        if (!verified.isValid || !["ed25519", "sr25519"].includes(verified.crypto)) { stage = "bounded real finalized receipt inventory"; continue; }
        const signature = `0x${verified.crypto === "ed25519" ? "00" : "01"}${extrinsic.signature.toHex().slice(2)}`;
        assert.equal(await verifyLoopNativeOwnership("polkadot", wallet,
          "CantonStake: actual public receipt diagnostic, not staking authorization", signature), false);
        publicSignature = { hash: extrinsic.hash.toHex(), blockHash, height: number, crypto: verified.crypto };
        stage = "bounded real finalized receipt inventory";
      }
      if (number % 16 === 0) console.log(`Read-only Westend inventory: ${inspectedBlocks}/64 finalized blocks; no writes.`);
    }
    assert.equal(classifyRpcRequest("polkadot", { body: { jsonrpc: "2.0", method: "author_submitExtrinsic", params: [] } }), false);
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), writesPerformed: 0, generatedWallets: 0,
      network: "polkadot:westend-asset-hub", genesisVerified: true, nominationPoolCallsPresent: true,
      minJoinPlanck: minJoin, finalizedHeight: height, inspectedBlocks, decodedSigned, unsupportedDecode,
      actualPublicNativeSignature: publicSignature, transactionSignatureRejectedAsPersonalConsent: publicSignature !== null,
      fullUnbondCalls, positionBoundRecoveryVerified: false, submissionNotClassifiedAsRead: true,
      signedSubmissionVerified: false, personalConsentWalletFlowVerified: false, loopWalletRoundTripVerified: false,
      deployed: false }, null, 2));
  } finally { await api.disconnect(); }
}

main().catch(() => {
  console.error(`Read-only Polkadot verification failed during ${stage}; no wallet was created or transaction submitted.`);
  process.exitCode = 1;
});
