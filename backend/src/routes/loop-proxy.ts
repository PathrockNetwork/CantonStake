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
    replyOptions: {
      rewriteRequestHeaders: (_req, headers) => {
        // Strip the Origin / Referer headers before forwarding upstream.
        // Loop's Cloudflare allowlist only fires when Origin is set; absent
        // it the upstream treats us as a normal server-to-server client.
        const out = { ...headers };
        delete out.origin;
        delete out.referer;
        // Force a generic User-Agent so Cloudflare bot detection can't
        // single us out for being a Node fetch client.
        out["user-agent"] =
          "Mozilla/5.0 (compatible; CantonStakeProxy/1.0; +https://github.com/)";
        return out;
      },
      // Strip upstream's CORS headers from the response so our own
      // `@fastify/cors` layer (which already returned the right value
      // matching the request Origin) is what reaches the browser.
      rewriteHeaders: (headers) => {
        const out: Record<string, string | string[] | undefined> = {
          ...headers,
        };
        delete out["access-control-allow-origin"];
        delete out["access-control-allow-credentials"];
        delete out["access-control-allow-headers"];
        delete out["access-control-allow-methods"];
        delete out["access-control-expose-headers"];
        delete out["access-control-max-age"];
        return out as Record<string, string | string[]>;
      },
    },
  });

  app.log.info(
    `[loop-proxy] mounted at /loop-proxy → ${config.loopProxyUpstream}`
  );
};

export default loopProxyRoutes;
