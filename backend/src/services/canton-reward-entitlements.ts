import type { CantonClient } from "./canton-ledger-client.js";
import { config } from "../config.js";
import { dsoPartyFor, isCantonParty, isContractId } from "./canton-network.js";
import { fromUnits, toUnits } from "./daml-decimal.js";

/** Stable Splice API package (same hash on every network running it). The ACS
 * filter uses its package name; returned views must use this reviewed hash. */
export const REWARD_ASSIGNMENT_INTERFACE = "#splice-api-reward-assignment-v1:Splice.Api.RewardAssignmentV1:RewardCoupon";
const VERIFIED_INTERFACE = "6f7b72361bc2039369651b4195315a2a5849babafec67b3c96e66ea6e560ec35:Splice.Api.RewardAssignmentV1:RewardCoupon";
export interface ObservedRewardCoupon {
  contractId: string;
  templateId: string;
  beneficiary: string | null;
  amount: string;
  expiresAt: string;
  expired: boolean;
  maxNewBeneficiaries: number;
}

/** Provider-visible minting rights only. No allocation formula, assignment,
 * claim, wallet transfer, write or payment inference from coupon archival.
 * An empty view means no currently observed coupons, NOT zero lifetime rewards.
 */
export async function observeProviderRewardEntitlements(ledger: Pick<CantonClient, "activeInterfaceSnapshot">, provider: string) {
  if (!isCantonParty(provider)) throw new Error("Reward observation requires the actual configured provider party");
  const synchronizer = config.cantonSynchronizerId, dso = dsoPartyFor(synchronizer);
  if (!dso) throw new Error("Reward observation requires the configured global synchronizer");
  const snapshot = await ledger.activeInterfaceSnapshot(REWARD_ASSIGNMENT_INTERFACE, AbortSignal.timeout(12000));
  const observedAt = new Date();
  const coupons = snapshot.contracts.map((contract): ObservedRewardCoupon => {
    const value = contract.view;
    if (contract.interfaceId !== VERIFIED_INTERFACE || contract.synchronizerId !== synchronizer ||
        !/^[a-f0-9]{64}:Splice\.Amulet:RewardCouponV2$/.test(contract.templateId) ||
        !isContractId(contract.contractId) ||
        value.dso !== dso || contract.signatories.length !== 1 || contract.signatories[0] !== dso ||
        !isCantonParty(value.provider) || (value.beneficiary !== null && !isCantonParty(value.beneficiary)) ||
        typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt)) ||
        typeof value.maxNumNewBeneficiaries !== "string" || !/^(?:0|[1-9]\d*)$/.test(value.maxNumNewBeneficiaries) ||
        BigInt(value.maxNumNewBeneficiaries) > 10000n) throw new Error(`Reward coupon is not a verified ${config.cantonNetworkInfo.label} DSO-issued minting entitlement`);
    const amount = toUnits(typeof value.amount === "string" ? value.amount : "");
    if (amount <= 0n) throw new Error("Reward coupon does not have a positive minting entitlement");
    return { contractId: contract.contractId, templateId: contract.templateId, beneficiary: value.beneficiary as string | null,
      amount: fromUnits(amount, { trim: true }), expiresAt: value.expiresAt, expired: Date.parse(value.expiresAt) <= observedAt.getTime(),
      maxNewBeneficiaries: Number(value.maxNumNewBeneficiaries) };
  });
  // Keep per-provider scope even if the service identity has additional readAs
  // rights. Other providers' visible coupons cannot be allocated by this app.
  const own = coupons.filter((_, index) => snapshot.contracts[index]!.view.provider === provider);
  return { network: config.cantonNetwork, source: "canton-reward-assignment-interface" as const,
    ledgerOffset: snapshot.offset, observedAt: observedAt.toISOString(), provider, coupons: own };
}

export async function observeLoopRewardEntitlements(ledger: Pick<CantonClient, "activeInterfaceSnapshot">, provider: string, beneficiary: string) {
  if (!isCantonParty(beneficiary)) throw new Error("Reward observation requires the verified Loop party");
  const snapshot = await observeProviderRewardEntitlements(ledger, provider);
  const own = snapshot.coupons.filter(coupon => coupon.beneficiary === beneficiary || (coupon.beneficiary === null && provider === beneficiary));
  const coupons = own.map(coupon => ({ contractId: coupon.contractId, amount: coupon.amount, expiresAt: coupon.expiresAt,
    expired: coupon.expired, status: "minting_entitlement" as const }));
  const total = own.filter(coupon => !coupon.expired).reduce((sum, coupon) => sum + toUnits(coupon.amount), 0n);
  return { network: snapshot.network, source: snapshot.source, beneficiary, ledgerOffset: snapshot.ledgerOffset,
    observedAt: snapshot.observedAt, observedUnexpiredAmount: fromUnits(total, { trim: true }), coupons,
    paymentsEnabled: false as const, paymentStatus: "unverified" as const,
    coverage: "provider-visible-active-coupons-only" as const };
}
