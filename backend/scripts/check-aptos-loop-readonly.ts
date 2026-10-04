/** Actual public Aptos TestNet receipts and BCS view calls. No wallet
 * generation/signing, API listening server, simulation or transaction writes.
 * This is native protocol evidence, not a Loop wallet integration test.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { parse } from "dotenv";
let phase = "load existing TestNet configuration and SDK";

async function main() {
  const actual = { ...parse(await readFile(new URL("../../.env", import.meta.url))),
    ...parse(await readFile(new URL("../../.env.testnet", import.meta.url))) };
  if (actual.NETWORK_MODE !== "testnet" || actual.BACKEND_PORT !== "4002") throw new Error("Existing TestNet deployment was not recognized");
  Object.assign(process.env, actual, { PORT: actual.BACKEND_PORT });
  // Reuse the installed real frontend SDK; no new dependency or wallet setup.
  const sdk = createRequire(import.meta.url)("../../frontend/node_modules/@aptos-labs/ts-sdk");
  const { rpcUrls, rpcDefinitions } = await import("../src/services/rpc-registry.js");
  const { RpcPool } = await import("../src/services/rpc-pool.js");
  const { identityCheck, classifyRpcRequest } = await import("../src/services/rpc-policy.js");
  const { decodeAptosDelegationActions, canonicalAptosAddress } = await import("../src/services/aptos-events.js");
  const { aptosUnbondSnapshot } = await import("../src/services/aptos-lifecycle.js");
  const { verifyLoopNativeOwnership } = await import("../src/services/loop-native-ownership.js");
  const { readAptosUnbondReceipt } = await import("../src/services/aptos-unbond-receipt.js");
  const { aptosEd25519AuthenticationKey } = await import("../src/services/aptos-ownership.js");
  const get = async (path: string) => {
    const response = await fetch(`${rpcUrls.aptos}${path}`, { signal: AbortSignal.timeout(15000), redirect: "error" });
    assert.equal(response.status, 200); return response.json();
  };
  const query = async (query: string, variables: object = {}) => {
    const response = await fetch(rpcUrls["aptos-indexer"], { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15000), redirect: "error" });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.ok(body.data && !body.errors?.length); assert.equal(Number(body.data.ledger_infos[0].chain_id), 2); return body.data;
  };
  assert.equal((await get("/v1")).chain_id, 2);
  phase = "read actual public unlock receipt";
  const indexed = await query(`{ ledger_infos(limit:1) { chain_id }
    delegated_staking_activities(where:{event_type:{_eq:"0x1::delegation_pool::UnlockStake"}},
      order_by:{transaction_version:desc},limit:1) { delegator_address pool_address transaction_version } }`);
  const row = indexed.delegated_staking_activities[0];
  assert.ok(row, "No public native unlock receipt was available");
  const receipt = await get(`/v1/transactions/by_version/${row.transaction_version}`);
  const unlock = decodeAptosDelegationActions(receipt).filter(action => action.kind === "unlock");
  assert.equal(unlock.length, 1);
  const action = unlock[0]!;
  assert.equal(action.delegator, canonicalAptosAddress(row.delegator_address));
  assert.equal(action.pool, canonicalAptosAddress(row.pool_address));
  assert.equal(receipt.signature.type, "ed25519_signature");
  const raw = new sdk.RawTransaction(sdk.AccountAddress.from(receipt.sender), BigInt(receipt.sequence_number),
    new sdk.TransactionPayloadEntryFunction(sdk.EntryFunction.build("0x1::delegation_pool", "unlock", [],
      [sdk.AccountAddress.from(receipt.payload.arguments[0]), new sdk.U64(BigInt(receipt.payload.arguments[1]))])),
    BigInt(receipt.max_gas_amount), BigInt(receipt.gas_unit_price), BigInt(receipt.expiration_timestamp_secs), new sdk.ChainId(2));
  const transaction = new sdk.SimpleTransaction(raw);
  phase = "verify actual native signature and signed transaction hash";
  const publicKey = new sdk.Ed25519PublicKey(receipt.signature.public_key);
  const signature = new sdk.Ed25519Signature(receipt.signature.signature);
  const authenticator = new sdk.AccountAuthenticatorEd25519(publicKey, signature);
  assert.ok(publicKey.verifySignature({ message: sdk.generateSigningMessageForTransaction(transaction), signature }));
  assert.equal(sdk.generateUserTransactionHash({ transaction, senderAuthenticator: authenticator }), receipt.hash);
  const authenticationKey = aptosEd25519AuthenticationKey(publicKey.toUint8Array());
  assert.equal(authenticationKey, publicKey.authKey().toString().toLowerCase());
  const account = await get(`/v1/accounts/${action.delegator}`);
  const receiptKeyIsCurrent = account.authentication_key.toLowerCase() === authenticationKey;
  phase = "reject transaction signature as ownership consent";
  assert.equal(await verifyLoopNativeOwnership("aptos", action.delegator,
    "CantonStake: real public receipt diagnostic, not staking authorization",
    JSON.stringify({ publicKey: receipt.signature.public_key, signature: receipt.signature.signature, layout: "nonce-first" })), false);
  phase = "read complete historical unlock state";
  const snapshot = await aptosUnbondSnapshot(rpcUrls.aptos, action);
  assert.ok(snapshot, "This actual receipt is not a complete historical position unlock");
  phase = "read actual prior native stake and recover its receipt";
  const previous = await query(`query PriorStake($wallet:String!, $pool:String!, $version:bigint!) {
    ledger_infos(limit:1) { chain_id }
    delegated_staking_activities(where:{delegator_address:{_eq:$wallet},pool_address:{_eq:$pool},
      transaction_version:{_lt:$version},event_type:{_eq:"0x1::delegation_pool::AddStake"}},
      order_by:{transaction_version:desc},limit:1) { transaction_version }
  }`, { wallet: action.delegator, pool: action.pool, version: action.version.toString() });
  let recovery = null;
  const priorRow = previous.delegated_staking_activities[0];
  if (priorRow) {
    const bond = await get(`/v1/transactions/by_version/${priorRow.transaction_version}`);
    assert.ok(decodeAptosDelegationActions(bond).some(stake => stake.kind === "stake" &&
      stake.delegator === action.delegator && stake.pool === action.pool));
    recovery = await readAptosUnbondReceipt({ wallet: action.delegator, pool: action.pool,
      hash: action.txHash, bondHeight: Number(bond.version) });
    assert.equal(recovery.status, "settled");
    await assert.rejects(readAptosUnbondReceipt({ wallet: canonicalAptosAddress("0x1")!, pool: action.pool,
      hash: action.txHash, bondHeight: Number(bond.version) }), /exact delegation pool/);
  }
  phase = "build read-only BCS view from real module ABI";
  const aptosConfig = new sdk.AptosConfig({ network: sdk.Network.TESTNET, fullnode: `${rpcUrls.aptos}/v1` });
  const view = await sdk.generateViewFunctionPayload({ aptosConfig, function: "0x1::delegation_pool::get_stake",
    typeArguments: [], functionArguments: [action.pool, action.delegator] });
  const serializer = new sdk.Serializer();
  view.serialize(serializer);
  const input = { method: "POST" as const, path: `/v1/view?ledger_version=${action.version}`,
    headers: { "content-type": "application/x.aptos.view_function+bcs" }, body: Buffer.from(serializer.toUint8Array()) };
  assert.equal(classifyRpcRequest("aptos", input), true);
  assert.equal(classifyRpcRequest("aptos", { ...input, path: "/v1/transactions" }), false);
  // Source client only, using real verified configured upstreams. No transport
  // mocks or listening server; the deployed gateway still predates BCS support.
  const definition = rpcDefinitions.aptos;
  const client = new RpcPool("aptos-readonly", [definition.primary, ...definition.backups], identityCheck(definition));
  phase = "forward read-only BCS view to real verified upstream";
  const binaryView = await client.request(input, true);
  assert.equal(binaryView.status, 200); assert.ok(Array.isArray(binaryView.body));
  assert.equal(binaryView.body[0], "0");
  assert.equal(BigInt(binaryView.body[1] as string) + BigInt(binaryView.body[2] as string), snapshot.amountOcta);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), writesPerformed: 0, generatedWallets: 0,
    network: "aptos:testnet", publicUnlockHash: action.txHash, ledgerVersion: action.version.toString(),
    actualNativeSignatureVerified: true, actualSignedTransactionHashVerified: true,
    authenticationKeyDerivationMatchesRealSdk: true, publicReceiptKeyStillCurrentOnChain: receiptKeyIsCurrent,
    transactionSignatureRejectedAsPersonalConsent: true, completeHistoricalUnlockRead: true,
    receiptRecovery: recovery, realBcsViewForwardingVerified: true, signedBcsSubmissionNotClassifiedAsRead: true,
    signedBcsSubmissionVerified: false, deployed: false, loopWalletRoundTripVerified: false,
    personalConsentWalletFlowVerified: false }, null, 2));
}

main().catch(() => {
  console.error("Read-only Aptos protocol verification failed; no wallet was generated or transaction submitted.");
  console.error(`Failed stage: ${phase}`);
  process.exitCode = 1;
});
