/** Bounded, chain-verified HTTP failover. Never retries a submitted write. */
export type RpcRequest = { path?: string; method?: "GET" | "POST"; body?: unknown; headers?: Record<string, string> };
export type RpcResult = { status: number; body: unknown; headers: Record<string, string> };
export type RpcCheck = (request: (input: RpcRequest) => Promise<RpcResult>) => Promise<void>;

export class RpcUnavailable extends Error {
  constructor(public readonly ambiguousSubmission = false) {
    super(ambiguousSubmission
      ? "RPC submission response unavailable. The transaction may already be submitted; check its hash before retrying."
      : "No verified RPC endpoint is currently available. Try again shortly.");
  }
}

export function endpointList(primary: string, backups: string[]): string[] {
  const urls = [primary, ...backups].filter(Boolean).map((value) => {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("Invalid RPC endpoint URL"); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash) {
      throw new Error("RPC endpoints must be HTTP(S) URLs without embedded credentials or fragments");
    }
    return url.toString().replace(/\/$/, "");
  });
  const result = [...new Set(urls)];
  if (!result.length || result.length > 5) throw new Error("Configure between one and five distinct RPC endpoints per pool");
  return result;
}

// Append paths, never resolve user input as an absolute URL. Keep API keys on
// the configured URL private and preserve historical ledger/height parameters.
export function upstreamUrl(endpoint: string, path = ""): string {
  if (path && (!path.startsWith("/") || path.startsWith("//") || /[\\#]/.test(path) || /%2e|%2f|%5c|(^|\/)\.\.?($|\/|\?)/i.test(path))) {
    throw new Error("Invalid RPC path");
  }
  const url = new URL(endpoint);
  const [pathname, query] = path.split("?", 2);
  url.pathname = url.pathname.replace(/\/$/, "") + pathname;
  for (const [key, value] of new URLSearchParams(query)) {
    // Callers cannot replace credentials carried in the endpoint query.
    if (url.searchParams.has(key)) throw new Error("Reserved RPC query parameter");
    url.searchParams.append(key, value);
  }
  return url.toString();
}

export function retryableResponse(result: RpcResult): boolean {
  if ([401, 403, 408, 429].includes(result.status) || result.status >= 500) return true;
  const bodies = Array.isArray(result.body) ? result.body : [result.body];
  return bodies.some((body) => {
    const error = (body as { error?: { code?: number; message?: string }; errors?: Array<{ message?: string; extensions?: { code?: string } }> } | null);
    if ([-32601, -32603, -32002, -32005, -32016].includes(error?.error?.code ?? 0)) return true;
    if (error?.errors?.some((item) => ["INTERNAL_SERVER_ERROR", "SERVICE_UNAVAILABLE", "RATE_LIMITED", "TOO_MANY_REQUESTS"].includes(item.extensions?.code ?? ""))) return true;
    const messages = [error?.error?.message, ...(error?.errors?.map((e) => e.message) ?? [])].filter(Boolean).join(" ");
    // Never classify reverts, insufficient funds, bad arguments or rejected
    // signatures as provider outages. Archive gaps may succeed elsewhere with
    // the EXACT SAME block/ledger version; never substitute latest state.
    return /rate.?limit|too many requests|temporarily unavailable|service unavailable|timed? out|timeout|missing trie node|historical state|archive (node|data)|node is (unhealthy|behind)|block not available/i.test(messages);
  });
}

type EndpointState = {
  url: string; failures: number; retryAt: number; verifiedAt: number;
  lastSuccessAt: number | null; lastFailure: string | null; probe?: Promise<void>;
};

export class RpcPool {
  private readonly endpoints: EndpointState[];
  private active = -1;
  private failovers = 0;
  constructor(
    readonly name: string,
    urls: string[],
    private readonly verify: RpcCheck,
    private readonly options: { fetch?: typeof fetch; now?: () => number; timeoutMs?: number; budgetMs?: number; writeTimeoutMs?: number; cooldownMs?: number; identityTtlMs?: number } = {},
  ) {
    this.endpoints = endpointList(urls[0] ?? "", urls.slice(1)).map((url) => ({
      url, failures: 0, retryAt: 0, verifiedAt: 0, lastSuccessAt: null, lastFailure: null,
    }));
  }
  private now(): number { return (this.options.now ?? Date.now)(); }
  snapshot() {
    return {
      pool: this.name, activeEndpoint: this.active < 0 ? null : this.active + 1,
      failovers: this.failovers, redundancy: this.endpoints.length > 1,
      endpoints: this.endpoints.map((entry, index) => ({
        endpoint: index + 1, host: new URL(entry.url).hostname,
        status: entry.retryAt > this.now() ? "cooldown" : entry.failures > 0 ? "retry_due"
          : entry.lastSuccessAt === null ? "unchecked" : this.now() - entry.lastSuccessAt > 60_000 ? "stale" : "ready",
        consecutiveFailures: entry.failures,
        lastSuccessAt: entry.lastSuccessAt === null ? null : new Date(entry.lastSuccessAt).toISOString(),
        retryAt: entry.retryAt > this.now() ? new Date(entry.retryAt).toISOString() : null,
        lastFailure: entry.lastFailure,
      })),
    };
  }
  private async exchange(endpoint: EndpointState, input: RpcRequest, deadline: number, timeoutMs = this.options.timeoutMs ?? 4_000): Promise<RpcResult> {
    const remaining = deadline - this.now();
    if (remaining <= 0) throw new RpcUnavailable();
    const signal = AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, remaining)));
    const response = await (this.options.fetch ?? fetch)(upstreamUrl(endpoint.url, input.path), {
      method: input.method ?? "POST", signal, redirect: "error",
      headers: { "content-type": "application/json", accept: "application/json", ...input.headers },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    // Keep the deadline in force through body consumption, not just headers.
    // Bound memory even if a remote returns a very large/malformed document.
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 32 * 1024 * 1024) throw new Error("RPC response exceeds limit");
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: unknown;
    try { body = JSON.parse(raw); } catch {
      // HTML error pages are outages, not usable chain responses.
      throw new Error("RPC returned invalid JSON");
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of response.headers) {
      if (/^x-aptos-/.test(key) || key === "x-sui-rpc-version") headers[key] = value;
    }
    return { status: response.status, body, headers };
  }
  async request(input: RpcRequest, readOnly: boolean): Promise<RpcResult> {
    // Validate before touching any endpoint/cooldown state.
    upstreamUrl(this.endpoints[0]!.url, input.path);
    const deadline = this.now() + (this.options.budgetMs ?? 14_000);
    // Keep primary preference. A cooldown prevents repeated latency on a dead
    // primary; it is automatically probed again once its cooldown has elapsed.
    for (const [index, endpoint] of this.endpoints.entries()) {
      if (endpoint.retryAt > this.now() || this.now() >= deadline) continue;
      let submitted = false;
      try {
        if (!endpoint.verifiedAt || this.now() - endpoint.verifiedAt >= (this.options.identityTtlMs ?? 30_000)) {
          endpoint.probe ??= this.verify((probe) => this.exchange(endpoint, probe, deadline))
            .then(() => { endpoint.verifiedAt = this.now(); })
            .finally(() => { endpoint.probe = undefined; });
          await endpoint.probe;
        }
        // A concurrent request may have marked this endpoint bad during probe.
        if (endpoint.retryAt > this.now()) continue;
        // Fail before dispatch if identity/failover consumed the probe budget.
        // Some protocols wait for execution inside their submission response;
        // give those ONE write its own deadline, never another submission.
        if (this.now() >= deadline) break;
        submitted = true;
        const writeTimeout = this.options.writeTimeoutMs ?? this.options.timeoutMs ?? 4_000;
        const response = readOnly
          ? await this.exchange(endpoint, input, deadline)
          : await this.exchange(endpoint, input, this.now() + writeTimeout, writeTimeout);
        if (retryableResponse(response)) throw new Error("RPC provider error");
        endpoint.failures = 0;
        endpoint.retryAt = 0;
        endpoint.lastFailure = null;
        endpoint.lastSuccessAt = this.now();
        if (this.active !== index && (this.active >= 0 || index > 0)) this.failovers++;
        this.active = index;
        return response;
      } catch {
        endpoint.failures++;
        endpoint.verifiedAt = 0;
        endpoint.lastFailure = submitted ? "request_failed" : "identity_or_connection_failed";
        endpoint.retryAt = this.now() + Math.min(120_000, (this.options.cooldownMs ?? 15_000) * 2 ** Math.min(endpoint.failures - 1, 3));
        if (!readOnly && submitted) throw new RpcUnavailable(true);
      }
    }
    throw new RpcUnavailable();
  }
}
