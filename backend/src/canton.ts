import { config } from "./config.js";
import { CantonClient } from "./services/canton-ledger-client.js";
import { CantonCutoverClient } from "./services/canton-cutover-client.js";
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

export const cantonPrimary = new CantonClient(
  config.cantonJsonApiUrl,
  config.cantonAuthToken,
  config.cantonAppProviderParty,
  { userId: config.cantonUserId, synchronizerId: config.cantonSynchronizerId,
    packageId: config.cantonPackageId, eventFormat: config.cantonModernEventFormat,
    writeAccessProtected: config.cantonWriteAccessProtected },
);

function legacyPreservationClient(): CantonClient | null {
  if (config.networkMode !== "testnet" || !config.loopStakingEnabled || !config.cantonLegacyJsonApiUrl) return null;
  const endpoint = new URL(config.cantonLegacyJsonApiUrl);
  if (!["localhost", "127.0.0.1", "[::1]", "host.docker.internal"].includes(endpoint.hostname) ||
      !["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
      !/^[^\s:]+::[a-f0-9]{68}$/.test(config.cantonLegacyProviderParty) ||
      !/^[a-f0-9]{64}$/.test(config.cantonLegacyPackageId) ||
      config.cantonLegacyProviderParty === config.cantonAppProviderParty ||
      config.cantonLegacyJsonApiUrl.replace(/\/$/, "") === config.cantonJsonApiUrl.replace(/\/$/, "")) {
    throw new Error("Legacy preservation requires a distinct, explicitly configured existing LocalNet provider and package");
  }
  return new CantonClient(config.cantonLegacyJsonApiUrl, config.cantonLegacyAuthToken, config.cantonLegacyProviderParty,
    { packageId: config.cantonLegacyPackageId });
}

export const cantonLegacy = legacyPreservationClient();
export const canton = cantonLegacy ? new CantonCutoverClient(cantonPrimary, cantonLegacy) : cantonPrimary;
// LiquidBalance belongs to its separate existing DAR, not the new remote package.
export const liquidCanton = cantonLegacy ?? cantonPrimary;
export const liquidProviderParty = cantonLegacy ? config.cantonLegacyProviderParty : config.cantonAppProviderParty;

export const cantonDelegator = new CantonClient(
  config.cantonDelegatorJsonApiUrl || urlWithPort(config.cantonJsonApiUrl, "2975"),
  config.cantonDelegatorAuthToken,
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
