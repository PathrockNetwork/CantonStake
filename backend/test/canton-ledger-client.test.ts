import assert from "node:assert/strict";
import test from "node:test";
import { CantonClient } from "../src/services/canton-ledger-client.js";
import { stakingTemplates } from "../src/canton.js";

const remoteOptions = {
  userId: "cantonstake-testnet-provider", synchronizerId: "global-domain::testnet",
  packageId: "a".repeat(64), eventFormat: true, writeAccessProtected: true,
};
const remote = () => new CantonClient("https://ledger.example/api/json-api/", "", "provider", remoteOptions);
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test("remote create includes service identity and explicit synchronizer, and encodes Daml numbers", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://ledger.example/api/json-api/v2/commands/submit-and-wait-for-transaction");
    assert.equal(init?.redirect, "error");
    assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.commands.userId, remoteOptions.userId);
    assert.equal(body.commands.synchronizerId, remoteOptions.synchronizerId);
    assert.equal(body.commands.domainId, undefined);
    assert.deepEqual(body.commands.packageIdSelectionPreference, [remoteOptions.packageId]);
    assert.deepEqual(body.commands.actAs, ["provider"]);
    assert.deepEqual(body.commands.commands[0].CreateCommand.createArguments, { amount: "1.25", proof: { block: "42" } });
    return Response.json({ transaction: { updateId: "update-1", offset: 7, events: [{ CreatedEvent: { contractId: "cid" } }] } });
  };
  const result = await remote().createContract({ templateId: "template", argument: { amount: 1.25, proof: { block: 42n } } });
  assert.equal(result.transactionId, "update-1");
  assert.equal(result.completionOffset, "7");
  assert.equal(result.events.length, 1);
});

test("delegator submission uses its own endpoint, identity, token and party", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://delegator.example/json-api/v2/commands/submit-and-wait-for-transaction");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-token");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.commands.userId, "delegator-user");
    assert.deepEqual(body.commands.actAs, ["delegator"]);
    assert.equal(body.commands.commands[0].ExerciseCommand.choiceArgument.featuredRightCid, null);
    return Response.json({ transaction: { updateId: "update", events: [] } });
  };
  const client = new CantonClient("https://delegator.example/json-api", "test-token", "delegator", { ...remoteOptions, userId: "delegator-user" });
  await client.exerciseChoice({ templateId: "template", contractId: "cid", choice: "choice", argument: { featuredRightCid: null } });
});

test("3.5 ACS uses eventFormat, numeric offset and the configured party filter", async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("ledger-end")) return Response.json({ offset: 2134812 });
    const body = JSON.parse(String(init?.body));
    assert.equal(body.filter, undefined);
    assert.equal(body.activeAtOffset, 2134812);
    assert.ok(body.eventFormat.filtersByParty.provider);
    assert.equal(body.eventFormat.filtersByParty.provider.cumulative[0].identifierFilter.TemplateFilter.value.templateId, "#cantonstake:CantonStake.Staking:StakingPosition");
    return Response.json([{ contractEntry: { JsActiveContract: { createdEvent: { contractId: "cid", templateId: "template", createArgument: { status: "Bonded" } } } } }]);
  };
  assert.deepEqual(await remote().activeContracts("#cantonstake:CantonStake.Staking:StakingPosition"), [{ contractId: "cid", templateId: "template", argument: { status: "Bonded" } }]);
});

test("legacy LocalNet remains usable without new service-user settings", async () => {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.commands.userId, undefined);
    assert.equal(body.commands.synchronizerId, undefined);
    return Response.json({ transactionId: "legacy", events: [] });
  };
  const client = new CantonClient("http://host.docker.internal:3975", "", "local-provider");
  assert.equal((await client.createContract({ templateId: "template", argument: {} })).transactionId, "legacy");
});

test("unprotected remote writes fail before any fetch, including with a bearer token", async () => {
  globalThis.fetch = async () => { assert.fail("must not send a command"); };
  for (const token of ["", "some-token"]) {
    const client = new CantonClient("https://ledger.example/api/json-api", token, "provider", { ...remoteOptions, writeAccessProtected: false });
    await assert.rejects(client.createContract({ templateId: "template", argument: {} }), /secure the Ledger API/);
    await assert.rejects(client.exerciseChoice({ templateId: "template", contractId: "cid", choice: "choice", argument: {} }), /secure the Ledger API/);
  }
});

test("remote writes reject HTTP and missing service-user or synchronizer identity", () => {
  assert.throws(() => new CantonClient("http://ledger.example", "", "provider", remoteOptions).assertCanSubmit(), /HTTPS/);
  for (const opts of [{ ...remoteOptions, userId: "" }, { ...remoteOptions, synchronizerId: "" }]) {
    assert.throws(() => new CantonClient("https://ledger.example", "", "provider", opts).assertCanSubmit(), /service user and synchronizer/);
  }
});

test("read-only inspection remains possible while writes are blocked", async () => {
  globalThis.fetch = async () => Response.json({ offset: 123 });
  await new CantonClient("https://ledger.example", "", "provider").probe();
});

test("an unsafe offset cannot silently select a rounded ACS snapshot", async () => {
  globalThis.fetch = async () => Response.json({ offset: "9007199254740993" });
  await assert.rejects(remote().activeContracts("template"), /safe nonnegative integer/);
});

test("non-success ledger responses are propagated, not treated as successful submissions", async () => {
  globalThis.fetch = async () => new Response("permission denied", { status: 403 });
  await assert.rejects(remote().createContract({ templateId: "template", argument: {} }), /403.*permission denied/);
});

test("configured package hashes do not become unsupported Canton 3.5 template filters", () => {
  const expected = "#cantonstake:CantonStake.Staking:StakingPosition";
  assert.equal(stakingTemplates().StakingPosition, expected);
  assert.equal(stakingTemplates("a".repeat(64)).StakingPosition, expected);
  assert.throws(() => stakingTemplates("not-a-package-hash"), /64-character/);
});
