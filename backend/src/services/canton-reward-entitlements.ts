import type { CantonClient } from "./canton-ledger-client.js";

/** Stable API package verified installed/vetted on the TestNet node. The ACS
 * filter uses its package name; returned views must use this reviewed hash. */
export const REWARD_ASSIGNMENT_INTERFACE = "#splice-api-reward-assignment-v1:Splice.Api.RewardAssignmentV1:RewardCoupon";
const VERIFIED_INTERFACE = "6f7b72361bc2039369651b4195315a2a5849babafec67b3c96e66ea6e560ec35:Splice.Api.RewardAssignmentV1:RewardCoupon";
const TESTNET_SYNCHRONIZER = "global-domain::1220f22a8b8f2d813c25b9a684dc4dd52b532a0174d8e73a13cdf2baabfff7518337";
const TESTNET_DSO = "DSO::1220f22a8b8f2d813c25b9a684dc4dd52b532a0174d8e73a13cdf2baabfff7518337";
const PARTY = /^[^\s:]+::[a-f0-9]{68}$/;
const SCALE = 10n ** 10n;

function numeric10(value: unknown): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,27})(?:\.\d{1,10})?$/.test(value)) throw new Error("Reward coupon amount is not an exact nonnegative Daml Decimal");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * SCALE + BigInt(fraction.padEnd(10, "0"));
}

function decimal(value: bigint): string {
  const fraction = (value % SCALE).toString().padStart(10, "0").replace(/0+$/, "");
  return `${value / SCALE}${fraction ? `.${fraction}` : ""}`;
}

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
  if (!PARTY.test(provider)) throw new Error("Reward observation requires the actual configured provider party");
  const snapshot = await ledger.activeInterfaceSnapshot(REWARD_ASSIGNMENT_INTERFACE, AbortSignal.timeout(12000));
  const observedAt = new Date();
  const coupons = snapshot.contracts.map((contract): ObservedRewardCoupon => {
    const value = contract.view;
    if (contract.interfaceId !== VERIFIED_INTERFACE || contract.synchronizerId !== TESTNET_SYNCHRONIZER ||
        !/^[a-f0-9]{64}:Splice\.Amulet:RewardCouponV2$/.test(contract.templateId) ||
        !/^[a-f0-9]{2,512}$/.test(contract.contractId) || contract.contractId.length % 2 !== 0 ||
        value.dso !== TESTNET_DSO || contract.signatories.length !== 1 || contract.signatories[0] !== TESTNET_DSO ||
        !PARTY.test(String(value.provider)) || (value.beneficiary !== null && !PARTY.test(String(value.beneficiary))) ||
        typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt)) ||
        typeof value.maxNumNewBeneficiaries !== "string" || !/^(?:0|[1-9]\d*)$/.test(value.maxNumNewBeneficiaries) ||
        BigInt(value.maxNumNewBeneficiaries) > 10000n) throw new Error("Reward coupon is not a verified TestNet DSO-issued minting entitlement");
    const amount = numeric10(value.amount);
    if (amount <= 0n) throw new Error("Reward coupon does not have a positive minting entitlement");
    return { contractId: contract.contractId, templateId: contract.templateId, beneficiary: value.beneficiary as string | null,
      amount: decimal(amount), expiresAt: value.expiresAt, expired: Date.parse(value.expiresAt) <= observedAt.getTime(),
      maxNewBeneficiaries: Number(value.maxNumNewBeneficiaries) };
  });
  // Keep per-provider scope even if the service identity has additional readAs
  // rights. Other providers' visible coupons cannot be allocated by this app.
  const own = coupons.filter((_, index) => snapshot.contracts[index]!.view.provider === provider);
  return { network: "testnet" as const, source: "canton-reward-assignment-interface" as const,
    ledgerOffset: snapshot.offset, observedAt: observedAt.toISOString(), provider, coupons: own };
}

export async function observeLoopRewardEntitlements(ledger: Pick<CantonClient, "activeInterfaceSnapshot">, provider: string, beneficiary: string) {
  if (!PARTY.test(beneficiary)) throw new Error("Reward observation requires the verified Loop party");
  const snapshot = await observeProviderRewardEntitlements(ledger, provider);
  const own = snapshot.coupons.filter(coupon => coupon.beneficiary === beneficiary || (coupon.beneficiary === null && provider === beneficiary));
  const coupons = own.map(coupon => ({ contractId: coupon.contractId, amount: coupon.amount, expiresAt: coupon.expiresAt,
    expired: coupon.expired, status: "minting_entitlement" as const }));
  const total = own.filter(coupon => !coupon.expired).reduce((sum, coupon) => sum + numeric10(coupon.amount), 0n);
  return { network: snapshot.network, source: snapshot.source, beneficiary, ledgerOffset: snapshot.ledgerOffset,
    observedAt: snapshot.observedAt, observedUnexpiredAmount: decimal(total), coupons,
    paymentsEnabled: false as const, paymentStatus: "unverified" as const,
    coverage: "provider-visible-active-coupons-only" as const };
}
