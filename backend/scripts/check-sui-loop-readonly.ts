/** Real public Sui TestNet receipts only. No wallet generation or signing.
 * Checks SDK decoding and receipt recovery, not Loop/user-wallet integration.
 */
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { parse } from "dotenv";
import { Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import { fromBase64, normalizeSuiAddress } from "@mysten/sui/utils";
import { verifyTransactionSignature } from "@mysten/sui/verify";
import { verifyLoopNativeOwnership } from "../src/services/loop-native-ownership.js";

async function main() {
  const actual = { ...parse(await readFile(new URL("../../.env", import.meta.url))),
    ...parse(await readFile(new URL("../../.env.testnet", import.meta.url))) };
  if (actual.NETWORK_MODE !== "testnet" || actual.BACKEND_PORT !== "4002") throw new Error("Existing TestNet deployment was not recognized");
  // Existing values stay in this process; nothing is written or logged.
  Object.assign(process.env, actual, { PORT: actual.BACKEND_PORT });
  const { readSuiUnbondReceipt } = await import("../src/services/sui-unbond-receipt.js");
  const { rpcUrls } = await import("../src/services/rpc-registry.js");
  const query = async (query: string, variables: object = {}) => {
    const response = await fetch(rpcUrls.sui, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15000), redirect: "error" });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.ok(!body.errors?.length && body.data);
    return body.data;
  };
  const latest = await query(`{ chainIdentifier events(last: 5, filter: {type: "0x3::validator::UnstakingRequestEvent"}) {
    nodes { transaction { digest transactionBcs sender { address } signatures { signatureBytes }
      effects { status checkpoint { sequenceNumber } } } }
  } }`);
  assert.equal(latest.chainIdentifier, "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD");
  const candidate = latest.events.nodes.map((event: any) => event.transaction).find((transaction: any) => {
    if (transaction?.effects?.status !== "SUCCESS" || !transaction.transactionBcs) return false;
    const data = Transaction.from(fromBase64(transaction.transactionBcs)).getData();
    return data.commands.length === 1 && data.commands[0]?.MoveCall?.function === "request_withdraw_stake";
  });
  assert.ok(candidate, "No recent single-call public unstake receipt was available");
  const bytes = fromBase64(candidate.transactionBcs);
  assert.equal(TransactionDataBuilder.getDigestFromBytes(bytes), candidate.digest);
  const data = Transaction.from(bytes).getData();
  const call = data.commands[0]!.MoveCall!;
  const receiptArgument = call.arguments[1]!;
  assert.equal(receiptArgument.$kind, "Input");
  const receiptId = data.inputs[receiptArgument.Input!]!.Object!.ImmOrOwnedObject!.objectId;
  assert.equal(data.sender, candidate.sender.address);
  const previous = await query(`query($digest: String!) { transaction(digest: $digest) {
    effects { objectChanges(first: 50) { nodes { address idDeleted
      inputState { previousTransaction { effects { checkpoint { sequenceNumber } } }
        asMoveObject { contents { type { repr } } } }
    } } }
  } }`, { digest: candidate.digest });
  const object = previous.transaction.effects.objectChanges.nodes.find((change: any) => change.idDeleted &&
    change.address === receiptId && change.inputState?.asMoveObject?.contents?.type?.repr?.endsWith("::staking_pool::StakedSui"));
  assert.ok(object, "Historical input staking receipt was not available");
  const bondHeight = Number(object.inputState.previousTransaction.effects.checkpoint.sequenceNumber);
  const receipt = await readSuiUnbondReceipt({ wallet: data.sender!, receiptId, digest: candidate.digest, bondHeight });
  assert.equal(receipt.status, "settled");
  const signature = candidate.signatures[0]?.signatureBytes;
  assert.ok(signature);
  const key = await verifyTransactionSignature(bytes, signature, { address: data.sender! });
  assert.equal(key.toSuiAddress(), data.sender);
  assert.equal(await verifyLoopNativeOwnership("sui", data.sender!, "CantonStake: public receipt diagnostic, not staking authorization", signature), false);
  // Use the real system object to show that a different object cannot clear
  // a staking-receipt guard. No fabricated transaction or wallet is involved.
  await assert.rejects(readSuiUnbondReceipt({ wallet: data.sender!, receiptId: normalizeSuiAddress("0x5"),
    digest: candidate.digest, bondHeight }), /does not withdraw/);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), writesPerformed: 0, generatedWallets: 0,
    network: "sui:testnet", publicUnstakeDigest: candidate.digest, checkpoint: candidate.effects.checkpoint.sequenceNumber,
    historicalStakingReceiptRead: true, rawBytesDigestMatches: true, actualNativeSignatureVerified: true,
    transactionSignatureRejectedAsPersonalConsent: true, wrongReceiptObjectRejected: true,
    deployed: false, loopWalletRoundTripVerified: false, personalConsentWalletFlowVerified: false }, null, 2));
}

main().catch(() => {
  console.error("Read-only Sui receipt verification failed; no wallet was created or transaction submitted.");
  process.exitCode = 1;
});
