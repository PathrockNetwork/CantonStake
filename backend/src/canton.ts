import { config } from "./config.js";
import { CantonClient } from "./services/canton-ledger-client.js";
import { clientCredentialsTokenSource, type TokenSource } from "./services/canton-oauth.js";
export { CantonClient } from "./services/canton-ledger-client.js";
export type { ActiveContract, SubmitAndWaitResult, CantonClientOptions } from "./services/canton-ledger-client.js";

export function urlWithPort(rawUrl: string, port: string): string {
  try {
    const url = new URL(rawUrl);
    url.port = port;
    return url.toString().replace(/\/$/, "");
  } catch {
    return rawUrl.replace(/:\d+(?=\/|$)/, `:${port}`);
  }
}

/** A configured OAuth client replaces the static token; never mixes identities. */
function ledgerAuth(staticToken: string, clientId: string, clientSecret: string): string | TokenSource {
  if (!clientId) return staticToken;
  return clientCredentialsTokenSource({ tokenUrl: config.cantonOauthTokenUrl, clientId, clientSecret,
    audience: config.cantonOauthAudience, scope: config.cantonOauthScope });
}

export const canton = new CantonClient(
  config.cantonJsonApiUrl,
  ledgerAuth(config.cantonAuthToken, config.cantonOauthClientId, config.cantonOauthClientSecret),
  config.cantonAppProviderParty,
  { userId: config.cantonUserId, synchronizerId: config.cantonSynchronizerId,
    packageId: config.cantonPackageId, eventFormat: config.cantonModernEventFormat,
    writeAccessProtected: config.cantonWriteAccessProtected },
);

export const cantonDelegator = new CantonClient(
  config.cantonDelegatorJsonApiUrl || urlWithPort(config.cantonJsonApiUrl, "2975"),
  ledgerAuth(config.cantonDelegatorAuthToken, config.cantonDelegatorOauthClientId, config.cantonDelegatorOauthClientSecret),
  config.cantonDelegatorParty,
  { userId: config.cantonDelegatorUserId, synchronizerId: config.cantonSynchronizerId,
    packageId: config.cantonPackageId, eventFormat: config.cantonModernEventFormat,
    writeAccessProtected: config.cantonWriteAccessProtected },
);

// Canton 3.5 requires package-name identifiers in filters. Pin command
// interpretation through packageIdSelectionPreference, not an ACS hash filter.
export function stakingTemplates(packageId = "") {
  if (packageId && !/^[a-f0-9]{64}$/.test(packageId)) {
    throw new Error("CANTON_PACKAGE_ID must be a 64-character lowercase package hash");
  }
  const prefix = "#cantonstake:CantonStake.Staking";
  return {
    StakingRequest: `${prefix}:StakingRequest`,
    StakingPosition: `${prefix}:StakingPosition`,
    BeneficiarySplit: `${prefix}:BeneficiarySplit`,
    BeneficiarySplitUpdated: `${prefix}:BeneficiarySplitUpdated`,
    OnchainEvent: `${prefix}:OnchainEvent`,
  };
}
export const TEMPLATES = stakingTemplates(config.cantonPackageId);
