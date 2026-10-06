/** Async bearer source for Ledger APIs whose tokens expire (e.g. Auth0 M2M, 24 h). */
export type TokenSource = (signal?: AbortSignal) => Promise<string>;

export interface ClientCredentials {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  audience: string;
  scope?: string;
}

/** Renew this long before `exp` so an in-flight command never carries a dying token. */
const RENEW_BEFORE_MS = 5 * 60_000;

/**
 * OAuth2 client-credentials token source with in-memory caching and a single
 * in-flight request. The secret is only ever sent to the configured HTTPS
 * token endpoint; tokens and secrets are never logged.
 */
export function clientCredentialsTokenSource(creds: ClientCredentials,
  fetchImpl: typeof fetch = (...args) => fetch(...args), now = () => Date.now()): TokenSource {
  if (new URL(creds.tokenUrl).protocol !== "https:") throw new Error("Canton OAuth token URL must use HTTPS");
  if (!creds.clientId || !creds.clientSecret || !creds.audience) {
    throw new Error("Canton OAuth requires client ID, client secret and audience");
  }
  let cached: { token: string; renewAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  async function fetchToken(): Promise<string> {
    const res = await fetchImpl(creds.tokenUrl, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: creds.clientId,
        client_secret: creds.clientSecret, audience: creds.audience,
        ...(creds.scope ? { scope: creds.scope } : {}) }),
    });
    // Never echo the response body: identity providers may reflect credentials.
    if (!res.ok) throw new Error(`Canton OAuth token request failed (${res.status})`);
    const json = await res.json() as { access_token?: unknown; expires_in?: unknown };
    const token = typeof json.access_token === "string" ? json.access_token : "";
    const expiresIn = Number(json.expires_in);
    if (!token || /\s/.test(token) || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error("Canton OAuth token response is malformed");
    }
    cached = { token, renewAt: now() + Math.max(expiresIn * 1000 - RENEW_BEFORE_MS, expiresIn * 500) };
    return token;
  }

  return async () => {
    if (cached && now() < cached.renewAt) return cached.token;
    inflight ??= fetchToken().finally(() => { inflight = null; });
    return inflight;
  };
}
