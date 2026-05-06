/**
 * Loop SDK reverse proxy.
 *
 *   ANY  /loop-proxy/api/v1/.connect/pair/tickets   → POST upstream
 *   ANY  /loop-proxy/api/v1/.connect/pair/account   → GET upstream
 *   ANY  /loop-proxy/api/v1/...                     → forwarded
 *   WS   /loop-proxy/api/v1/.connect/pair/ws/{tid}  → upgraded + piped
 *
 * Why: Loop's devnet edge (Cloudflare-fronted) returns 403 + missing
 * `Access-Control-Allow-Origin` for browser origins that aren't on its
 * allowlist (dev IPs, free DDNS hostnames, etc.). Routing through our
 * backend bypasses the browser's same-origin check entirely — the
 * browser sees a same-origin response from our domain, while we make
 * the upstream request server-to-server (no CORS).
 *
 * The frontend opts in by overriding `apiUrl` in the Loop SDK init.
 * `walletUrl` stays pointed at cantonloop.com because that's where the
 * user navigates for the QR / wallet popup (no CORS concern there).
 *
 * Auth pass-through: `Authorization: Bearer ...` headers from the
 * browser flow through to upstream untouched.
 */

import type { FastifyPluginAsync } from "fastify";
import fastifyHttpProxy from "@fastify/http-proxy";
import { config } from "../config.js";

const loopProxyRoutes: FastifyPluginAsync = async (app) => {
  if (!config.loopProxyEnabled) {
    app.log.info("[loop-proxy] disabled (LOOP_PROXY_ENABLED=false)");
    return;
  }

  await app.register(fastifyHttpProxy, {
    upstream: config.loopProxyUpstream,
    prefix: "/loop-proxy",
    rewritePrefix: "",
    websocket: true,
    http2: false,
    // Forward the upstream's response headers untouched so the SDK can
    // read auth/cookie/etc. The CORS layer at the top of index.ts adds
    // Access-Control-Allow-Origin for the BROWSER, not for upstream.
    replyOptions: {
      rewriteRequestHeaders: (_req, headers) => {
        // Strip the Origin header — we're acting as a server-side client
        // here, not a browser. Loop's allowlist only fires when Origin
        // is set; absent it accepts the request.
        const out = { ...headers };
        delete out.origin;
        delete out.referer;
        return out;
      },
    },
  });

  app.log.info(
    `[loop-proxy] mounted at /loop-proxy → ${config.loopProxyUpstream}`
  );
};

export default loopProxyRoutes;
