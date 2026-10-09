import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { assertIdentityBinding, identityOwnershipMessage, stakingOwnershipMessage, validOwnershipWindow } from "../src/services/identity-policy.js";
import frontendConsent from "../../frontend/lib/canton/request-ownership.js";
import { verifyLoopNativeOwnership } from "../src/services/loop-native-ownership.js";
import { verifyLoopIdentitySession } from "../src/services/loop-session.js";

const wallet = `0x${"a".repeat(40)}`;
const { identityOwnershipMessage: frontendIdentityMessage, stakingOwnershipMessage: frontendStakeMessage } = frontendConsent;
test("identity linking never detaches another account or changes a primary wallet", () => {
  assert.throws(() => assertIdentityBinding(null, { id: "victim" }, wallet), /already linked/);
  assert.throws(() => assertIdentityBinding({ id: "caller", evmAddress: null }, { id: "victim" }, wallet), /already linked/);
  assert.throws(() => assertIdentityBinding({ id: "caller", evmAddress: `0x${"b".repeat(40)}` }, null, wallet), /different primary/);
  assert.doesNotThrow(() => assertIdentityBinding({ id: "caller", evmAddress: wallet }, { id: "caller" }, wallet));
  assert.doesNotThrow(() => assertIdentityBinding(null, null, wallet));
  assert.doesNotThrow(() => assertIdentityBinding({ id: "caller", evmAddress: `0x${"b".repeat(40)}` }, null, wallet, true));
  assert.throws(() => assertIdentityBinding({ id: "caller", evmAddress: null }, { id: "victim" }, wallet, true), /already linked/);
});

test("missing/malformed Loop credentials fail without a wallet or staking activation", async () => {
  for (const authorization of [undefined, "", "Basic credentials", "Bearer token with spaces"]) {
    await assert.rejects(verifyLoopIdentitySession(authorization, "invalid-party"), /verified Loop wallet session/);
  }
});

test("consent expires and rejects future timestamps or invalid nonces", () => {
  const body = { delegator: "party", evmAddress: wallet, amountPol: "1", ownershipNonce: "12345678-1234-4123-8123-123456789abc", ownershipSignedAt: 1_000_000 };
  assert(validOwnershipWindow(body, 1_000_000));
  assert(!validOwnershipWindow(body, 1_300_001));
  assert(!validOwnershipWindow(body, 969_999));
  assert(!validOwnershipWindow({ ...body, ownershipNonce: "not-a-nonce" }, 1_000_000));
});

test("frontend/backend consent agrees; real cryptographic verification rejects edited recipients or request fields", async () => {
  // Fixed, unfunded cryptographic test vector. No Loop signer/session is fabricated.
  const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
  const body = { delegator: `Recipient::${"a".repeat(68)}`, evmAddress: account.address, amountPol: "1", chain: "monad",
    validator: "validator", clientNetworkMode: "testnet", ownershipNonce: "12345678-1234-4123-8123-123456789abc", ownershipSignedAt: 1_000_000 };
  assert.equal(frontendStakeMessage(body), stakingOwnershipMessage(body));
  assert.equal(frontendIdentityMessage(body), identityOwnershipMessage(body));
  const message = stakingOwnershipMessage(body);
  const signature = await account.signMessage({ message });
  assert(await verifyLoopNativeOwnership("monad", account.address, message, signature));
  for (const change of [{ amountPol: "2" }, { delegator: "Other" }, { clientNetworkMode: "mainnet" }, { validator: "other" }, { ownershipNonce: "other" }]) {
    assert(!await verifyLoopNativeOwnership("monad", account.address, stakingOwnershipMessage({ ...body, ...change }), signature));
  }
  assert(!await verifyLoopNativeOwnership("monad", account.address, identityOwnershipMessage(body), signature));
});
