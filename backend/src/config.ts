import "dotenv/config";

function required(key: string): string {
  const v = process.env[key];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
}

function optional(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const config = {
  port: Number(optional("PORT", "4000")),
  logLevel: optional("LOG_LEVEL", "info"),

  amoyRpcUrl: optional("AMOY_RPC_URL", "https://rpc-amoy.polygon.technology"),
  mockValidatorShare: required("MOCK_VALIDATOR_SHARE_ADDRESS"),

  cantonJsonApiUrl: optional("CANTON_JSON_API_URL", "http://localhost:2975"),
  cantonAppProviderParty: required("CANTON_APP_PROVIDER_PARTY"),
  cantonAuthToken: optional("CANTON_AUTH_TOKEN"),

  featuredAppRightCid: optional("FEATURED_APP_RIGHT_CID"),
} as const;
