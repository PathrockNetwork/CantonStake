/** Real provider read-side verification only. No wallet generation, Loop
 * substitute, database writes, command submission, assignments or claims. */
import { CantonClient } from "../src/services/canton-ledger-client.js";
import { observeProviderRewardEntitlements } from "../src/services/canton-reward-entitlements.js";

const base = "https://api.canton.cttestnet.pathrocknetwork.org/api/json-api";
const synchronizerId = "global-domain::1220f22a8b8f2d813c25b9a684dc4dd52b532a0174d8e73a13cdf2baabfff7518337";
const dso = "DSO::1220f22a8b8f2d813c25b9a684dc4dd52b532a0174d8e73a13cdf2baabfff7518337";
const participantId = "pathrocknetwork-validator-1::1220deef137801c81e0cfad972d4ca95467265ecf73eb311f67d205f8ecf23549b8f";
const provider = "CantonStakeTestnetProvider::1220deef137801c81e0cfad972d4ca95467265ecf73eb311f67d205f8ecf23549b8f";
const reviewedInterfacePackage = "6f7b72361bc2039369651b4195315a2a5849babafec67b3c96e66ea6e560ec35";
// Deliberately do not load any production .env or native signing keys.
const token = process.env.CANTON_TESTNET_LEDGER_TOKEN ?? "";
// Optional public party ID copied from the actual connected Loop TestNet wallet.
// No test-delegator default: hosted service parties cannot prove Loop hosting.
const loopParty = process.env.CANTON_TESTNET_LOOP_PARTY_ID?.trim();

interface VettedPackage {
  packageId: string; packageName?: string; packageVersion?: string;
  validFromInclusive?: string; validUntilExclusive?: string;
}
interface VettingPage {
  vettedPackages?: Array<{ participantId: string; synchronizerId: string; packages: VettedPackage[] }>;
  nextPageToken?: string;
}

async function read(path: string, body?: object): Promise<unknown> {
  const result = await fetch(`${base}${path}`, { method: body ? "POST" : "GET", redirect: "error",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000) });
  if (!result.ok) throw new Error(`Read-only Canton reward check failed (${path}, HTTP ${result.status})`);
  return result.json();
}

async function currentRewardPackages(): Promise<VettedPackage[]> {
  const packages: VettedPackage[] = [];
  const tokens = new Set<string>();
  let pageToken = "";
  for (let page = 0; page < 20; page++) {
    const result = await read("/v2/package-vetting/list", {
      packageMetadataFilter: { packageNamePrefixes: ["splice-amulet", "splice-api-reward-assignment-v1", "splice-wallet"] },
      topologyStateFilter: { participantIds: [participantId], synchronizerIds: [synchronizerId] },
      pageSize: 100, ...(pageToken ? { pageToken } : {}),
    }) as VettingPage;
    if (!Array.isArray(result.vettedPackages)) throw new Error("Reward package vetting inventory is malformed");
    for (const state of result.vettedPackages) {
      if (state.participantId !== participantId || state.synchronizerId !== synchronizerId || !Array.isArray(state.packages)) {
        throw new Error("Reward package vetting belongs to a different participant or synchronizer");
      }
      for (const entry of state.packages) {
        if (!/^[a-f0-9]{64}$/.test(entry.packageId)) throw new Error("Reward package ID is malformed");
        const now = Date.now();
        const from = entry.validFromInclusive ? Date.parse(entry.validFromInclusive) : -Infinity;
        const until = entry.validUntilExclusive ? Date.parse(entry.validUntilExclusive) : Infinity;
        if (Number.isNaN(from) || Number.isNaN(until)) throw new Error("Reward package vetting validity is malformed");
        if (from <= now && until > now && ["splice-amulet", "splice-api-reward-assignment-v1", "splice-wallet"].includes(entry.packageName ?? "")) packages.push(entry);
      }
    }
    if (!result.nextPageToken) return packages;
    if (typeof result.nextPageToken !== "string" || tokens.has(result.nextPageToken)) throw new Error("Reward package pagination did not advance");
    tokens.add(result.nextPageToken);
    pageToken = result.nextPageToken;
  }
  throw new Error("Reward package vetting pagination exceeded the read-only bound; inventory is incomplete");
}

async function main() {
  if (loopParty && (!/^[^\s:]+::[a-f0-9]{68}$/.test(loopParty) || loopParty.startsWith("CantonStakeTestnet"))) {
    throw new Error("Provide the public party ID from a real Loop TestNet wallet, not a hosted CantonStake service identity");
  }
  const identity = await read("/v2/parties/participant-id") as { participantId?: string };
  if (identity.participantId !== participantId) throw new Error("Reward observation endpoint is not the reviewed TestNet participant");
  const packages = await currentRewardPackages();
  const interfaceVetted = packages.some(p => p.packageId === reviewedInterfacePackage && p.packageName === "splice-api-reward-assignment-v1");
  if (!interfaceVetted) throw new Error("The reviewed reward-assignment interface is not currently installed and vetted");
  const ledger = new CantonClient(base, token, provider, { eventFormat: true, synchronizerId, userId: "cantonstake-testnet-provider" });
  const [entitlements, rights, partyDetails] = await Promise.all([
    observeProviderRewardEntitlements(ledger, provider),
    ledger.activeContracts("#splice-amulet:Splice.Amulet:FeaturedAppRight", AbortSignal.timeout(12000)),
    loopParty ? read(`/v2/parties/${encodeURIComponent(loopParty)}`) : Promise.resolve(null),
  ]);
  let locallyHosted: boolean | null = null;
  if (partyDetails !== null) {
    const details = (partyDetails as { partyDetails?: Array<{ party: string; isLocal: boolean }> }).partyDetails;
    if (!Array.isArray(details) || details.some(detail => detail.party !== loopParty || typeof detail.isLocal !== "boolean") || details.length > 1) {
      throw new Error("The Loop party hosting response is malformed or belongs to another party");
    }
    locallyHosted = details.some(detail => detail.party === loopParty && detail.isLocal);
  }
  const issuedPackages = new Set(packages.filter(p => p.packageName === "splice-amulet").map(p => p.packageId));
  const featured = rights.filter(right => right.argument.provider === provider && right.argument.dso === dso);
  if (featured.some(right => !issuedPackages.has(right.templateId.split(":")[0]!) ||
      right.templateId.split(":").slice(1).join(":") !== "Splice.Amulet:FeaturedAppRight")) {
    throw new Error("Provider FeaturedAppRight is not from an installed, currently vetted Splice package");
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), network: "testnet", jsonApiUrl: base,
    participantId, synchronizerId, provider, interfaceVetted, vettingPaginationComplete: true,
    packages, ledgerOffset: entitlements.ledgerOffset,
    featuredAppRightCount: featured.length,
    providerVisibleCoupons: entitlements.coupons,
    mintingHosting: { realLoopPartySupplied: Boolean(loopParty), locallyHosted,
      spliceWalletVetted: packages.some(p => p.packageName === "splice-wallet"),
      delegationVerified: false, automationVerified: false,
      note: "Delegated automation requires beneficiary hosting on the delegate's validator, explicit beneficiary consent and delegate acceptance" },
    unassignedCouponCount: entitlements.coupons.filter(c => c.beneficiary === null && !c.expired).length,
    positiveCouponViewVerified: entitlements.coupons.length > 0,
    writes: 0, generatedWallets: 0, loopWalletVerified: false, assignmentVerified: false,
    claimVerified: false, settlementVerified: false, cutoverReady: false,
    caveats: ["Read-only provider visibility is not full reward history or wallet payment evidence",
      ...(!featured.length ? ["No active provider FeaturedAppRight observed; CIP-0104 featured reward eligibility is not established"] : []),
      ...(!entitlements.coupons.length ? ["Empty active inventory verifies the query, not positive coupon decoding or zero lifetime rewards"] : []),
      "Exact custom-DAR approval and a real Loop wallet lifecycle remain required",
      "Beneficiary allocation policy and actual Loop coupon collection need verification before assignment"],
  }, null, 2));
}

main().catch(error => {
  // Never print credentials, arbitrary response bodies or wallet material.
  const message = error instanceof Error ? error.message : "Read-only Canton rewards check failed";
  console.error(message.replace(/^(Canton (?:ACS query|ledger-end) failed \(\d+\)).*/s, "$1"));
  process.exitCode = 1;
});
