import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { rpcDefinitions, rpcPools, type RpcPoolName } from "../services/rpc-registry.js";
import { RpcUnavailable, type RpcRequest } from "../services/rpc-pool.js";
import { classifyRpcRequest } from "../services/rpc-policy.js";

const rpcRoutes: FastifyPluginAsync = async (app) => {
  // Bounded process-local limits supplement the edge proxy. Do not trust
  // arbitrary forwarded IPs and never forward browser auth/cookie headers.
  let windowStart = Date.now();
  let requests = 0;
  let inFlight = 0;
  app.get("/api/rpc/status", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return { networkMode: config.networkMode, pools: Object.values(rpcPools).map((pool) => pool.snapshot()) };
  });
  type Params = { mode: string; pool: string; "*"?: string };
  const handler = async (request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
      reply.header("cache-control", "no-store");
      if (request.params.mode !== config.networkMode) return reply.code(409).send({ error: "RPC network mode mismatch" });
      if (!Object.hasOwn(rpcPools, request.params.pool)) return reply.code(404).send({ error: "Unknown RPC pool" });
      if (Date.now() - windowStart > 60_000) { requests = 0; windowStart = Date.now(); }
      if (++requests > 6_000 || inFlight >= 64) return reply.code(429).send({ error: "RPC gateway capacity exceeded" });
      const name = request.params.pool as RpcPoolName;
      const prefix = `/api/rpc/${request.params.mode}/${name}`;
      const path = request.raw.url!.slice(prefix.length);
      const headers: Record<string, string> = {};
      // Keep the installed SDK's protocol-negotiation header, plus the
      // older GraphQL version/usage headers. Never forward cookies/API keys.
      for (const key of ["x-sui-client-protocol-version", "x-sui-rpc-version", "x-sui-rpc-show-usage"]) {
        const value = request.headers[key];
        if (typeof value === "string") headers[key] = value;
      }
      const input: RpcRequest = { method: request.method as "GET" | "POST", path, body: request.body, headers };
      let readOnly: boolean;
      try { readOnly = classifyRpcRequest(rpcDefinitions[name].protocol, input); }
      catch { return reply.code(400).send({ error: "Unsupported or invalid RPC request" }); }
      inFlight++;
      try {
        const result = await rpcPools[name].request(input, readOnly);
        for (const [key, value] of Object.entries(result.headers)) reply.header(key, value);
        return reply.code(result.status).send(result.body);
      } catch (error) {
        // No upstream URLs, keys, arbitrary provider errors or payloads in logs.
        const ambiguous = error instanceof RpcUnavailable && error.ambiguousSubmission;
        return reply.code(ambiguous ? 409 : 503).send({ error: new RpcUnavailable(ambiguous).message, ambiguousSubmission: ambiguous });
      } finally { inFlight--; }
  };
  for (const url of ["/api/rpc/:mode/:pool", "/api/rpc/:mode/:pool/*"]) {
    app.route<{ Params: Params }>({ method: ["GET", "POST"], url, bodyLimit: 256 * 1024, handler });
  }
};
export default rpcRoutes;
