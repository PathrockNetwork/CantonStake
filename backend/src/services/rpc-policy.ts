import { getOperationAST, parse } from "graphql";
import type { RpcCheck, RpcRequest, RpcResult } from "./rpc-pool.js";

export type RpcProtocol = "evm" | "cosmos" | "cosmos-rest" | "aptos" | "aptos-indexer" | "solana" | "polkadot" | "sui";
export type RpcIdentity = { protocol: RpcProtocol; chainId: string };
const jsonRpc = (method: string, params: unknown[] = []): RpcRequest => ({ body: { jsonrpc: "2.0", id: 1, method, params } });

export function identityCheck(identity: RpcIdentity): RpcCheck {
  return async (request) => {
    let response: RpcResult;
    let actual: unknown;
    switch (identity.protocol) {
      case "evm": {
        response = await request(jsonRpc("eth_chainId"));
        const result = (response.body as { result?: string }).result;
        actual = typeof result === "string" && /^0x[0-9a-f]+$/i.test(result) ? BigInt(result).toString() : undefined;
        break;
      }
      case "cosmos": {
        response = await request({ path: "/status", method: "GET" });
        const status = response.body as { result?: { node_info?: { network?: string }; sync_info?: { catching_up?: boolean } } };
        if (status.result?.sync_info?.catching_up !== false) throw new Error("RPC not synced");
        actual = status.result?.node_info?.network;
        break;
      }
      case "cosmos-rest": {
        response = await request({ path: "/cosmos/base/tendermint/v1beta1/node_info", method: "GET" });
        actual = (response.body as { default_node_info?: { network?: string } }).default_node_info?.network;
        break;
      }
      case "aptos": {
        response = await request({ path: "/v1", method: "GET" });
        actual = (response.body as { chain_id?: number }).chain_id;
        break;
      }
      case "aptos-indexer": {
        response = await request({ body: { query: "{ ledger_infos(limit: 1) { chain_id } }" } });
        actual = (response.body as { data?: { ledger_infos?: Array<{ chain_id?: number }> } }).data?.ledger_infos?.[0]?.chain_id;
        break;
      }
      case "solana":
        response = await request(jsonRpc("getGenesisHash"));
        actual = (response.body as { result?: string }).result;
        break;
      case "polkadot":
        response = await request(jsonRpc("chain_getBlockHash", [0]));
        actual = (response.body as { result?: string }).result;
        break;
      case "sui":
        response = await request({ body: { query: "{ chainIdentifier }" } });
        actual = (response.body as { data?: { chainIdentifier?: string } }).data?.chainIdentifier;
        break;
    }
    if (response.status !== 200 || actual === undefined || String(actual) !== identity.chainId) {
      throw new Error("RPC identity mismatch or unavailable");
    }
  };
}

/** Returns read-only status; throws for unsupported/admin/signing operations. */
export function classifyRpcRequest(protocol: RpcProtocol, request: RpcRequest): boolean {
  const method = request.method ?? "POST";
  const path = (request.path ?? "").split("?")[0]!.replace(/\/$/, "");
  if (protocol === "cosmos-rest") {
    if (!/^\/(cosmos|ibc|cosmwasm)\//.test(path)) throw new Error("Unsupported REST path");
    if (method === "GET") return true;
    if (path === "/cosmos/tx/v1beta1/simulate") return true;
    if (path === "/cosmos/tx/v1beta1/txs") return false;
    throw new Error("Unsupported REST operation");
  }
  if (protocol === "aptos") {
    if (!/^\/v1(?:\/|$)/.test(path)) throw new Error("Unsupported Aptos path");
    if (method === "GET") return true;
    if (/^\/v1\/(view|tables\/[^/]+\/(item|raw_item)|transactions\/(simulate|encode_submission))$/.test(path)) return true;
    if (/^\/v1\/transactions(?:\/batch)?$/.test(path)) return false;
    throw new Error("Unsupported Aptos operation");
  }
  if (protocol === "sui" || protocol === "aptos-indexer") {
    if (method !== "POST" || path) throw new Error("GraphQL requires POST");
    const body = request.body as { query?: unknown; operationName?: unknown } | undefined;
    if (typeof body?.query !== "string" || body.query.length > 100_000) throw new Error("Invalid GraphQL query");
    const operation = getOperationAST(parse(body.query, { maxTokens: 10_000 }), typeof body.operationName === "string" ? body.operationName : undefined);
    if (!operation || operation.operation === "subscription") throw new Error("Unsupported GraphQL operation");
    if (operation.operation === "query") return true;
    if (protocol === "sui") return false; // Includes simulation; conservative, no mutation replay.
    throw new Error("Indexer writes are not permitted");
  }
  if (protocol === "cosmos" && method === "GET") {
    const action = path.slice(1);
    if (/^(status|abci_info|abci_query|block|block_results|block_search|blockchain|commit|consensus_params|genesis|health|tx|tx_search|validators)$/.test(action)) return true;
    if (/^broadcast_tx_(sync|async|commit)$/.test(action)) return false;
    throw new Error("Unsupported Cosmos RPC path");
  }
  if (method !== "POST" || path) throw new Error("JSON-RPC requires POST");
  const items = Array.isArray(request.body) ? request.body : [request.body];
  if (items.length === 0 || items.length > 50) throw new Error("Invalid RPC batch size");
  const states = items.map((item: unknown) => {
    const body = item as { jsonrpc?: unknown; method?: unknown } | undefined;
    if (body?.jsonrpc !== "2.0" || typeof body.method !== "string") throw new Error("Invalid JSON-RPC request");
    const name = body.method;
    switch (protocol) {
      case "evm":
        if (/^(eth_(get[A-Z]\w*|call|estimateGas|chainId|blockNumber|gasPrice|maxPriorityFeePerGas|feeHistory|syncing)|net_version|web3_clientVersion)$/.test(name)) return true;
        if (name === "eth_sendRawTransaction") return false;
        break;
      case "cosmos":
        if (/^(status|abci_info|abci_query|block|block_results|block_search|blockchain|commit|consensus_params|genesis|health|tx|tx_search|validators)$/.test(name)) return true;
        if (/^broadcast_tx_(sync|async|commit)$/.test(name)) return false;
        break;
      case "solana":
        if (/^(get[A-Z]\w*|isBlockhashValid|minimumLedgerSlot|simulateTransaction)$/.test(name)) return true;
        if (name === "sendTransaction") return false;
        break;
      case "polkadot":
        if (/^(chain_get\w+|state_(get\w+|queryStorageAt|call)|system_(chain|chainType|name|version|properties|health|accountNextIndex)|rpc_methods|payment_(queryInfo|queryFeeDetails))$/.test(name)) return true;
        if (name === "author_submitExtrinsic") return false;
        break;
    }
    throw new Error("Unsupported RPC method");
  });
  if (Array.isArray(request.body) && states.some((readOnly) => !readOnly)) throw new Error("Transaction submission batches are not permitted");
  return states.every(Boolean);
}
