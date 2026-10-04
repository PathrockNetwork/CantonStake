import { config } from "../config.js";

const TESTNET_SYNC = "global-domain::1220f22a8b8f2d813c25b9a684dc4dd52b532a0174d8e73a13cdf2baabfff7518337";
const PARTY = /^[^\s:]+::[a-f0-9]{68}$/;

/** Configuration-only readiness: importing it must not start Redis workers. */
export function loopWorkflowGate(): string | null {
  if (config.networkMode !== "testnet") return "External Loop MainNet signing is not released. The MainNet provider handoff, exact-package approval and funded TestNet lifecycle must be verified before a separate MainNet rollout";
  if (!config.loopStakingEnabled) return "External Loop TestNet staking has not been enabled";
  if (!/^[a-f0-9]{64}$/.test(config.cantonPackageId) || config.loopReviewedPackageId !== config.cantonPackageId) {
    return "Awaiting Five North review and deployment of the exact CantonStake package";
  }
  if (config.loopProxyUpstream.replace(/\/$/, "") !== "https://testnet.cantonloop.com") return "Loop upstream is not Canton TestNet";
  if (config.cantonSynchronizerId !== TESTNET_SYNC || !config.cantonModernEventFormat ||
      !config.cantonUserId || !config.cantonWriteAccessProtected ||
      config.cantonJsonApiUrl.replace(/\/$/, "") !== "https://api.canton.cttestnet.pathrocknetwork.org/api/json-api" ||
      !PARTY.test(config.cantonAppProviderParty)) {
    return "The protected Canton TestNet provider endpoint, service user, package and synchronizer must be configured";
  }
  return null;
}

export function loopDeployment() {
  return { network: "testnet" as const, packageId: config.cantonPackageId,
    synchronizerId: config.cantonSynchronizerId, appProvider: config.cantonAppProviderParty,
    loopReviewedPackageId: config.loopReviewedPackageId || null };
}
