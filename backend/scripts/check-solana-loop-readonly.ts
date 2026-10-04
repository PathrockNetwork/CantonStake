/** Real public Solana TestNet receipts only. No generated wallets, signing,
 * listening server or transaction submission. Not a Loop integration test.
 */
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { parse } from "dotenv";
import { Ed25519 } from "@cosmjs/crypto";
import { fromBase64, toBase64 } from "@cosmjs/encoding";
import { fromBase58 } from "@mysten/sui/utils";
import { verifyLoopNativeOwnership } from "../src/services/loop-native-ownership.js";

async function main() {
  const actual = { ...parse(await readFile(new URL("../../.env", import.meta.url))),
    ...parse(await readFile(new URL("../../.env.testnet", import.meta.url))) };
  if (actual.NETWORK_MODE !== "testnet" || actual.BACKEND_PORT !== "4002") throw new Error("Existing TestNet deployment was not recognized");
  Object.assign(process.env, actual, { PORT: actual.BACKEND_PORT });
  const { solanaRpc, assertSolanaNetwork, SOLANA_STAKE_PROGRAM } = await import("../src/services/solana-rpc.js");
  const { readSolanaUnbondReceipt } = await import("../src/services/solana-unbond-receipt.js");
  const read = async <T>(method: string, params: unknown[] = []): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      // Keep diagnostics below public-provider rate limits alongside watchers.
      await new Promise(resolve => setTimeout(resolve, 400));
      try { return await solanaRpc<T>(method, params); }
      catch (error) {
        if (attempt >= 2 || !(error instanceof Error) || !/returned (429|503)/.test(error.message)) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  };
  await assertSolanaNetwork();
  // This actual public transaction uses a durable nonce followed by deactivate.
  // It must not satisfy our single-instruction retry-guard policy.
  const multiSignature = "2mLyXa3aApJrb3fkCH5xFU34mspgWu2aRhSLXaFsXmY1AXdcijNdi2xLC28JhyxNp2hJwRCk3mV3eB3ML17JNe6U";
  const parsed = await read<any>("getTransaction", [multiSignature,
    { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
  assert.ok(parsed && parsed.meta.err === null);
  const owner = parsed.transaction.message.accountKeys[0].pubkey;
  const deactivate = parsed.transaction.message.instructions.find((instruction: any) =>
    instruction.programId === SOLANA_STAKE_PROGRAM && instruction.parsed?.type === "deactivate");
  assert.ok(deactivate);
  const stakeAccount = deactivate.parsed.info.stakeAccount;
  const accountHistory = await read<any[]>("getSignaturesForAddress", [stakeAccount,
    { commitment: "finalized", before: multiSignature, limit: 20 }]);
  let originalBond: any;
  for (const row of accountHistory) {
    if (row.err !== null) continue;
    const transaction = await read<any>("getTransaction", [row.signature,
      { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
    if (transaction?.meta?.err === null && transaction.transaction.message.instructions.some((instruction: any) =>
        instruction.programId === SOLANA_STAKE_PROGRAM && instruction.parsed?.type === "delegate" &&
        instruction.parsed.info.stakeAccount === stakeAccount && instruction.parsed.info.stakeAuthority === owner)) {
      originalBond = transaction; break;
    }
  }
  assert.ok(originalBond, "Historical real stake delegation was not available");
  const raw = await read<any>("getTransaction", [multiSignature,
    { encoding: "base64", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
  const bytes = fromBase64(raw.transaction[0]);
  assert.equal(bytes[0], 1); // Actual receipt has one 64-byte native signature.
  assert.equal(toBase64(bytes.slice(1, 65)), toBase64(fromBase58(multiSignature)));
  assert.ok(await Ed25519.verifySignature(bytes.slice(1, 65), bytes.slice(65), fromBase58(owner)));
  assert.equal(await verifyLoopNativeOwnership("solana", owner,
    "CantonStake: public receipt diagnostic, not staking authorization", toBase64(bytes.slice(1, 65))), false);
  await assert.rejects(readSolanaUnbondReceipt({ wallet: owner, stakeAccount, signature: multiSignature,
    bondHeight: originalBond.slot }), /exact stake-account deactivation/);

  // Bounded inventory: find a real single-instruction deactivate, never build
  // or sign a synthetic transaction merely to obtain a positive assertion.
  const recent = await read<any[]>("getSignaturesForAddress", [SOLANA_STAKE_PROGRAM,
    { limit: 40, commitment: "finalized" }]);
  let singleReceipt: { signature: string; status: string } | null = null;
  for (const row of recent) {
    if (row.err !== null) continue;
    const transaction = await read<any>("getTransaction", [row.signature,
      { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
    const instruction = transaction?.transaction?.message?.instructions?.[0];
    if (transaction?.meta?.err !== null || transaction.transaction.message.instructions.length !== 1 ||
        instruction?.programId !== SOLANA_STAKE_PROGRAM || instruction.parsed?.type !== "deactivate") continue;
    const info = instruction.parsed.info;
    const history = await read<any[]>("getSignaturesForAddress", [info.stakeAccount,
      { before: row.signature, limit: 20, commitment: "finalized" }]);
    for (const previous of history) {
      if (previous.err !== null) continue;
      const bond = await read<any>("getTransaction", [previous.signature,
        { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
      if (bond?.meta?.err !== null || !bond.transaction.message.instructions.some((ix: any) =>
          ix.programId === SOLANA_STAKE_PROGRAM && ix.parsed?.type === "delegate" &&
          ix.parsed.info.stakeAccount === info.stakeAccount && ix.parsed.info.stakeAuthority === info.stakeAuthority)) continue;
      const receipt = await readSolanaUnbondReceipt({ wallet: info.stakeAuthority, stakeAccount: info.stakeAccount,
        signature: row.signature, bondHeight: bond.slot });
      assert.equal(receipt.status, "settled");
      await assert.rejects(readSolanaUnbondReceipt({ wallet: info.stakeAuthority,
        stakeAccount: "SysvarC1ock11111111111111111111111111111111", signature: row.signature, bondHeight: bond.slot }), /exact stake-account deactivation/);
      singleReceipt = { signature: row.signature, status: receipt.status }; break;
    }
    if (singleReceipt) break;
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), writesPerformed: 0, generatedWallets: 0,
    network: "solana:testnet", publicDeactivationSignature: multiSignature, bondSlot: originalBond.slot,
    realTransactionSignatureVerified: true, transactionSignatureRejectedAsPersonalConsent: true,
    durableNonceTransactionRejectedForRetryRecovery: true, singleInstructionReceipt: singleReceipt,
    deployed: false, loopWalletRoundTripVerified: false, personalConsentWalletFlowVerified: false }, null, 2));
}

main().catch((error: unknown) => {
  console.error("Read-only Solana receipt verification failed; no wallet was created or transaction submitted.");
  console.error(error instanceof Error ? error.message : "Unknown read error");
  process.exitCode = 1;
});
