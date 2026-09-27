/** Read-only transport/contract preflight. This is NOT funded lifecycle approval.
 * Run: node --import tsx scripts/check-mainnet-routes.ts [mainnet-app-origin]
 * No wallet, secret, database connection, transaction submission, or env edit.
 */
import assert from "node:assert/strict";
import { createPublicClient, http, parseAbi } from "viem";
import { connectComet } from "@cosmjs/tendermint-rpc";
import { QueryClient, setupStakingExtension } from "@cosmjs/stargate";
import { decodeTxRaw } from "@cosmjs/proto-signing";
import { ApiPromise, HttpProvider } from "@polkadot/api";

const origin = new URL(process.argv[2] ?? "https://cantonstake.pathrocknetwork.org").origin;
const gateway = (pool: string) => `${origin}/api/rpc/mainnet/${pool}`;
const stringify = (value: unknown) => JSON.stringify(value, (_key, v) => typeof v === "bigint" ? v.toString() : v);
const results: Array<{ chain: string; readChecks: string; details: unknown }> = [];
async function json(url: string, body?: unknown): Promise<any> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: stringify(body) }),
    signal: AbortSignal.timeout(25_000),
  });
  assert.equal(response.status, 200, `${new URL(url).pathname}: HTTP ${response.status}`);
  const data = await response.json() as any;
  assert(!data.error && !data.errors?.length, stringify(data.error ?? data.errors));
  return data;
}
async function rpc(pool: string, method: string, params: unknown = []): Promise<any> {
  const data = await json(gateway(pool), { jsonrpc: "2.0", id: 1, method, params });
  assert(data.result !== undefined, `${pool}/${method}: missing result`);
  return data.result;
}
async function gql(pool: string, query: string): Promise<any> {
  return (await json(gateway(pool), { query })).data;
}
async function check(chain: string, read: (details: Record<string, unknown>) => Promise<void>) {
  const details: Record<string, unknown> = {};
  try {
    await read(details);
    results.push({ chain, readChecks: "PASS (not lifecycle approval)", details });
  } catch (error) {
    details.error = error instanceof Error ? error.message.split("\n")[0].slice(0, 250) : "Unknown read failure";
    results.push({ chain, readChecks: "FAIL", details });
  }
  console.log(stringify(results.at(-1)));
}
const tasks: Array<[string, (details: Record<string, unknown>) => Promise<void>]> = [];
tasks.push(["polygon", async (d) => {
  assert.equal(BigInt(await rpc("settlement", "eth_chainId")), 1n);
  const stats = await json(`${origin}/api/chains/stats`);
  d.validators = stats.chains.find((row: any) => row.chain === "polygon")?.validatorCount;
  assert(Number(d.validators) > 0);
  const watchers = await json(`${origin}/api/watchers`);
  d.watchers = watchers;
}]);
tasks.push(["monad", async (d) => {
  const client = createPublicClient({ transport: http(gateway("monad"), { retryCount: 0, timeout: 25_000 }) });
  assert.equal(await client.getChainId(), 143);
  d.chainId = 143;
  const address = "0x0000000000000000000000000000000000001000";
  const abi = parseAbi([
    "function getExecutionValidatorSet(uint32 startIndex) view returns (bool, uint32, uint64[])",
    "function getValidator(uint64 validatorId) view returns (address, uint64, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, bytes, bytes)",
    "function getEpoch() view returns (uint64, bool)",
  ]);
  const page = await client.readContract({ address, abi, functionName: "getExecutionValidatorSet", args: [0] });
  assert(page[2].length > 0);
  d.validatorPageSize = page[2].length;
  const validator = await client.readContract({ address, abi, functionName: "getValidator", args: [page[2][0]] });
  assert(validator[4] <= 10n ** 18n);
  d.sampleCommissionPct = Number(validator[4]) / 1e16;
  d.epoch = (await client.readContract({ address, abi, functionName: "getEpoch" }))[0];
  const tip = await client.getBlockNumber();
  d.logsIn50Blocks = (await client.getLogs({ address, fromBlock: tip - 61n, toBlock: tip - 12n })).length;
}]);
tasks.push(["bnb", async (d) => {
  const client = createPublicClient({ transport: http(gateway("bnb"), { retryCount: 0, timeout: 25_000 }) });
  assert.equal(await client.getChainId(), 56);
  d.chainId = 56;
  const address = "0x0000000000000000000000000000000000002002";
  const abi = parseAbi([
    "function getValidators(uint256 offset, uint256 limit) view returns (address[], address[], uint256)",
    "function minDelegationBNBChange() view returns (uint256)",
    "function unbondPeriod() view returns (uint256)",
    "function getValidatorBasicInfo(address operatorAddress) view returns (uint256, bool, uint256)",
  ]);
  const page = await client.readContract({ address, abi, functionName: "getValidators", args: [0n, 5n] });
  assert(page[0].length > 0 && page[0].length === page[1].length);
  d.validatorCount = page[2];
  d.minimumWei = await client.readContract({ address, abi, functionName: "minDelegationBNBChange" });
  d.unbondSeconds = await client.readContract({ address, abi, functionName: "unbondPeriod" });
  d.sampleJailed = (await client.readContract({ address, abi, functionName: "getValidatorBasicInfo", args: [page[0][0]] }))[1];
  const tip = await client.getBlockNumber();
  d.logsIn50Blocks = (await client.getLogs({ address, fromBlock: tip - 61n, toBlock: tip - 12n })).length;
}]);
for (const [chain, id] of [["cosmos", "cosmoshub-4"], ["celestia", "celestia"], ["osmosis", "osmosis-1"]]) {
  tasks.push([chain, async (d) => {
    const comet = await connectComet(gateway(chain));
    try {
      const status = await comet.status();
      assert.equal(status.nodeInfo.network, id);
      assert.equal(status.syncInfo.catchingUp, false);
      d.chainId = id;
      const query = QueryClient.withExtensions(comet, setupStakingExtension);
      const page = await query.staking.validators("BOND_STATUS_BONDED");
      assert(page.validators.length > 0);
      d.validatorPageSize = page.validators.length;
      const params = await query.staking.params();
      d.stakingParams = params.params;
      const tip = status.syncInfo.latestBlockHeight - 2;
      for (const kind of ["MsgDelegate", "MsgUndelegate"]) {
        const type = `/cosmos.staking.v1beta1.${kind}`;
        const txs = await rpc(chain, "tx_search", { query: `message.action='${type}' AND tx.height>=${tip - 99} AND tx.height<=${tip}`, page: "1", per_page: "1", order_by: "desc" });
        d[kind + "In100Blocks"] = txs.total_count;
        for (const tx of txs.txs ?? []) {
          const decoded = decodeTxRaw(Buffer.from(tx.tx, "base64"));
          assert(decoded.body.messages.some((message) => message.typeUrl === type));
        }
      }
      const blocks = await rpc(chain, "block_search", { query: `complete_unbonding.delegator EXISTS AND block.height>=${tip - 99} AND block.height<=${tip}`, page: "1", per_page: "1", order_by: "desc" });
      d.completionBlocks = blocks.total_count;
      const height = blocks.blocks?.[0]?.block?.header?.height ?? String(tip);
      const block = await rpc(chain, "block_results", { height });
      d.finalizeEventsAvailable = Array.isArray(block.finalize_block_events);
      if (Number(blocks.total_count) > 0) assert(block.finalize_block_events?.some((event: any) => event.type === "complete_unbonding"));
    } finally { comet.disconnect(); }
  }]);
}
tasks.push(["aptos", async (d) => {
  const ledger = await json(gateway("aptos") + "/v1");
  assert.equal(ledger.chain_id, 1);
  d.chainId = ledger.chain_id;
  d.oldestLedgerVersion = ledger.oldest_ledger_version;
  const data = await gql("aptos-indexer", `{ ledger_infos(limit: 1) { chain_id } current_delegated_staking_pool_balances(where: {total_coins: {_gt: "0"}}, order_by: {total_coins: desc}, limit: 5) { staking_pool_address operator_commission_percentage total_coins } }`);
  assert.equal(data.ledger_infos[0].chain_id, 1);
  assert(data.current_delegated_staking_pool_balances.length > 0);
  const pool = data.current_delegated_staking_pool_balances[0].staking_pool_address;
  const resource = await json(gateway("aptos") + "/v1/accounts/0x1/resource/0x1::stake::ValidatorSet");
  d.activeValidators = resource.data.active_validators.length;
  assert(resource.data.active_validators.some((v: any) => v.addr.toLowerCase() === pool.toLowerCase()));
  d.poolStake = await json(gateway("aptos") + "/v1/view", { function: "0x1::delegation_pool::get_delegation_pool_stake", type_arguments: [], arguments: [pool] });
  const module = await json(gateway("aptos") + "/v1/accounts/0x1/module/delegation_pool");
  for (const method of ["add_stake", "unlock", "withdraw"]) assert(module.abi.exposed_functions.some((fn: any) => fn.name === method && fn.is_entry));
  d.lifecycleEntryPoints = true;
}]);
tasks.push(["sui", async (d) => {
  const data = await gql("sui", `{ chainIdentifier epoch { validatorSet { activeValidators(first: 5) { nodes { contents { json } } } } } }`);
  assert.equal(data.chainIdentifier, "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S");
  d.chainIdentifier = data.chainIdentifier;
  d.validatorPageSize = data.epoch.validatorSet.activeValidators.nodes.length;
  assert(Number(d.validatorPageSize) > 0);
  for (const event of ["StakingRequestEvent", "UnstakingRequestEvent"]) {
    const events = await gql("sui", `{ events(last: 2, filter: {type: "0x3::validator::${event}"}) { edges { cursor node { sender { address } contents { json } timestamp transaction { digest sender { address } } } } } }`);
    d[event] = events.events.edges.map((entry: any) => ({ timestamp: entry.node.timestamp, hasSender: !!(entry.node.sender?.address || entry.node.transaction?.sender?.address), hasDigest: !!entry.node.transaction?.digest }));
  }
}]);
tasks.push(["solana", async (d) => {
  assert.equal(await rpc("solana", "getGenesisHash"), "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
  d.network = "mainnet-beta";
  const votes = await rpc("solana", "getVoteAccounts");
  d.activeValidators = votes.current.length;
  assert(votes.current.length > 0);
  d.minimumLamports = (await rpc("solana", "getStakeMinimumDelegation", [{ commitment: "finalized" }])).value;
  d.rentLamports = await rpc("solana", "getMinimumBalanceForRentExemption", [200]);
  d.epoch = (await rpc("solana", "getEpochInfo", [{ commitment: "finalized" }])).epoch;
  const signatures = await rpc("solana", "getSignaturesForAddress", ["Stake11111111111111111111111111111111111111", { limit: 1, commitment: "finalized" }]);
  assert(signatures.length > 0);
  const tx = await rpc("solana", "getTransaction", [signatures[0].signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" }]);
  assert(tx?.transaction);
  d.finalizedTransactionReadable = true;
}]);
tasks.push(["polkadot", async (d) => {
  const api = await ApiPromise.create({ provider: new HttpProvider(gateway("polkadot")), noInitWarn: true });
  try {
    assert.equal(api.genesisHash.toHex(), "0x68d56f15f85d3136970ec16946040bc1752654e906147f7e43e9d539d7c3de2f");
    assert.equal(api.registry.chainDecimals[0], 10);
    assert.equal(api.registry.chainTokens[0], "DOT");
    for (const method of ["join", "unbond", "withdrawUnbonded"]) assert(api.tx.nominationPools?.[method]);
    d.network = "Polkadot Asset Hub";
    d.minimumJoinPlanck = (await api.query.nominationPools.minJoinBond()).toString();
    const entries = await api.query.nominationPools.bondedPools.entries();
    const open = entries.filter(([, v]) => (v.toJSON() as any)?.state === "Open");
    assert(open.length > 0);
    d.openPools = open.length;
    d.samplePoolBalance = (await api.call.nominationPoolsApi.poolBalance(open[0][0].args[0])).toString();
    const hash = await api.rpc.chain.getFinalizedHead();
    const at = await api.at(hash);
    const events = (await at.query.system.events()).toJSON();
    assert(Array.isArray(events));
    d.finalizedEvents = events.length;
  } finally { await api.disconnect(); }
}]);

const deadline = setTimeout(() => { console.error("Read-only preflight exceeded 5 minutes"); process.exit(2); }, 300_000);
try {
  assert.equal((await json(`${origin}/api/health`)).networkMode, "mainnet");
  // Keep live gateway traffic bounded; never launch all SDKs simultaneously.
  let next = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (next < tasks.length) { const [chain, read] = tasks[next++]; await check(chain, read); }
  }));
  console.log(stringify({ checkedAt: new Date().toISOString(), summary: results, note: "Read-only only. Requires separate funded testnet lifecycle verification and production Canton approval before enabling new routes." }));
  process.exitCode = results.some((r) => r.readChecks === "FAIL") ? 1 : 0;
} finally { clearTimeout(deadline); }
