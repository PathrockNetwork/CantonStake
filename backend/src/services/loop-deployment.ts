import { config } from "../config.js";
import { dsoPartyFor, isCantonParty } from "./canton-network.js";

const { label, loopOrigin } = config.cantonNetworkInfo;

/** Configuration-only readiness: importing it must not start Redis workers. */
export function loopWorkflowGate(): string | null {
  if (config.networkMode !== "testnet") return "External Loop MainNet signing is not released. The MainNet provider handoff, exact-package approval and funded TestNet lifecycle must be verified before a separate MainNet rollout";
  if (!config.loopStakingEnabled) return `External Loop staking on ${label} has not been enabled`;
  if (!/^[a-f0-9]{64}$/.test(config.cantonPackageId) || config.loopReviewedPackageId !== config.cantonPackageId) {
    return "Awaiting Five North review and deployment of the exact CantonStake package";
  }
  if (config.loopProxyUpstream.replace(/\/$/, "") !== loopOrigin) return `Loop upstream is not ${label}`;
  if (!dsoPartyFor(config.cantonSynchronizerId) || !config.cantonModernEventFormat ||
      !config.cantonUserId || !config.cantonWriteAccessProtected ||
      !/^https:\/\/[^/\s]+\/\S*$/.test(config.cantonJsonApiUrl) ||
      !isCantonParty(config.cantonAppProviderParty)) {
    return `The protected ${label} provider endpoint, service user, package and synchronizer must be configured`;
  }
  return null;
}

export function loopDeployment() {
  return { network: config.cantonNetwork, packageId: config.cantonPackageId,
    synchronizerId: config.cantonSynchronizerId, appProvider: config.cantonAppProviderParty,
    loopReviewedPackageId: config.loopReviewedPackageId || null };
}
