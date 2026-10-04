/** Read-only TestNet handoff verification. Never submits commands or changes topology. */
import { readFile } from "node:fs/promises";
import { CantonClient } from "../src/services/canton-ledger-client.js";

const base = "https://api.canton.cttestnet.pathrocknetwork.org/api/json-api";
const synchronizerId = "global-domain::1220f22a8b8f2d813c25b9a684dc4dd52b532a0174d8e73a13cdf2baabfff7518337";
const participantId = "pathrocknetwork-validator-1::1220deef137801c81e0cfad972d4ca95467265ecf73eb311f67d205f8ecf23549b8f";
const partySuffix = participantId.slice(participantId.indexOf("::"));
const packageId = "23f7aa9deb68fc275ba97db0c173c9232b4b21315e1dbb8ee82a1a63428faf1e";
const roles = ["Provider", "Treasury", "Delegator"] as const;
const party = (role: typeof roles[number]) => `CantonStakeTestnet${role}${partySuffix}`;
// Dedicated TestNet credential only; never load the production .env here.
const token = process.env.CANTON_TESTNET_LEDGER_TOKEN ?? "";
const accessProtectionAttested = process.env.CANTON_TESTNET_WRITE_ACCESS_PROTECTED === "true";
const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

async function query(path: string, body?: object): Promise<any> {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET", headers, redirect: "error",
    signal: AbortSignal.timeout(10_000), ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`TestNet read-only check ${path} failed: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const receipt = JSON.parse(await readFile(new URL("../../.deploy-backups/canton-dar/1791062272252-testnet-85be2bd6-973c-4842-869e-ecddf5babc0c.json", import.meta.url), "utf8"));
  if (receipt.target?.network !== "testnet" || receipt.target?.jsonApiUrl !== base ||
      receipt.target?.synchronizerId !== synchronizerId || receipt.artifact?.packageId !== packageId ||
      !Array.isArray(receipt.artifact?.packageIds) || !receipt.artifact.packageIds.every((id: unknown) => typeof id === "string" && /^[0-9a-f]{64}$/.test(id))) {
    throw new Error("Local DAR receipt does not match the verified TestNet deployment");
  }
  const requiredPackages: string[] = receipt.artifact.packageIds;
  const [participant, packages, users] = await Promise.all([
    query("/v2/parties/participant-id"), query("/v2/packages"),
    Promise.all(roles.map(async role => {
      const userId = `cantonstake-testnet-${role.toLowerCase()}`;
      const [userResult, rightsResult, partyResult] = await Promise.all([
        query(`/v2/users/${userId}`), query(`/v2/users/${userId}/rights`),
        query(`/v2/parties/${encodeURIComponent(party(role))}`),
      ]);
      const rights = rightsResult.rights ?? [];
      const actAs = rights.flatMap((r: any) => r.kind?.CanActAs?.value?.party ? [r.kind.CanActAs.value.party] : []);
      const readAs = rights.flatMap((r: any) => r.kind?.CanReadAs?.value?.party ? [r.kind.CanReadAs.value.party] : []);
      const administrative = rights.some((r: any) => r.kind?.ParticipantAdmin || r.kind?.IdentityProviderAdmin);
      const matches = userResult.user?.id === userId && userResult.user?.primaryParty === party(role) &&
        userResult.user?.isDeactivated === false && partyResult.partyDetails?.some((p: any) => p.party === party(role) && p.isLocal === true) &&
        actAs.length === 1 && actAs[0] === party(role) && !administrative;
      return { role, userId, party: party(role), matches, actAs, readAs, administrative };
    })),
  ]);
  if (participant.participantId !== participantId) throw new Error("Participant identity does not match the TestNet handoff");
  const missingPackages = requiredPackages.filter(id => !packages.packageIds?.includes(id));
  const topology = await query("/v2/package-vetting/list", {
    packageMetadataFilter: { packageIds: requiredPackages },
    topologyStateFilter: { participantIds: [participantId], synchronizerIds: [synchronizerId] }, pageSize: 100,
  });
  const now = Date.now();
  const isCurrent = (p: any) =>
    (p.validFromInclusive == null || Date.parse(p.validFromInclusive) <= now) &&
    (p.validUntilExclusive == null || Date.parse(p.validUntilExclusive) > now);
  const vetted = new Set((topology.vettedPackages ?? []).filter((v: any) =>
    v.participantId === participantId && v.synchronizerId === synchronizerId,
  ).flatMap((v: any) => (v.packages ?? []).filter(isCurrent).map((p: any) => p.packageId)));
  const missingVetting = requiredPackages.filter(id => !vetted.has(id));
  const provider = new CantonClient(base, token, party("Provider"), { eventFormat: true });
  const template = (name: string) => `#cantonstake:CantonStake.Staking:${name}`;
  const [splits, requests, positions] = await Promise.all([
    provider.activeContracts(template("BeneficiarySplit")),
    provider.activeContracts(template("StakingRequest")),
    provider.activeContracts(template("StakingPosition")),
  ]);
  const splitReports = splits.map(c => {
    const weights = Array.isArray(c.argument.weights) ? c.argument.weights : [];
    const values = weights.map((w: any) => ({ party: w._1, weight: String(w._2) }));
    const matches = c.argument.operator === party("Provider") && values.length === 2 &&
      values.some(w => w.party === party("Delegator") && Number(w.weight) === 0.75) &&
      values.some(w => w.party === party("Treasury") && Number(w.weight) === 0.25);
    return { contractId: c.contractId, templateId: c.templateId, label: c.argument.label,
      version: c.argument.version, weights: values, matches };
  });
  const compatibleSplits = splitReports.filter(s => s.matches);
  const requestedSplitCid = process.env.CANTON_TESTNET_BENEFICIARY_SPLIT_CID?.trim();
  const selectedSplit = requestedSplitCid
    ? compatibleSplits.find(s => s.contractId === requestedSplitCid)
    : compatibleSplits.length === 1 ? compatibleSplits[0] : undefined;
  // Exercise the real modern history API without submitting a wallet command.
  // This validates response parsing, not a user's cancellation or unbond flow.
  let historyReadMatches = false;
  if (selectedSplit) {
    const history = await provider.contractHistory(selectedSplit.contractId, template("BeneficiarySplit"));
    const created = history?.created?.createdEvent;
    const transaction = created ? await provider.transactionAtOffset(created.offset, template("BeneficiarySplit")) : null;
    const byId = transaction?.updateId ? await provider.transactionById(transaction.updateId, template("BeneficiarySplit")) : null;
    historyReadMatches = history?.created?.synchronizerId === synchronizerId &&
      created?.contractId === selectedSplit.contractId && created?.createArgument.operator === party("Provider") &&
      transaction?.synchronizerId === synchronizerId && Boolean(transaction.updateId) &&
      Boolean(transaction.events?.some(row => row.CreatedEvent?.contractId === selectedSplit.contractId)) &&
      byId?.updateId === transaction?.updateId && byId?.synchronizerId === synchronizerId;
  }
  const providerReads = users.find(u => u.role === "Provider")?.readAs ?? [];
  const provisioningMatches = !missingPackages.length && !missingVetting.length && users.every(u => u.matches) &&
    roles.every(role => providerReads.includes(party(role))) && Boolean(selectedSplit);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), network: "testnet", jsonApiUrl: base,
    participantId, synchronizerId, packageId, packageCount: requiredPackages.length,
    missingPackages, missingVetting, vettingPaginationIncomplete: Boolean(topology.nextPageToken) && missingVetting.length > 0,
    users, splits: splitReports, selectedSplitCid: selectedSplit?.contractId ?? null,
    requestCount: requests.length, positionCount: positions.length,
    provisioningMatches, historyReadMatches,
    accessProtectionAttested,
    cutoverReady: false,
    blockers: [...(!accessProtectionAttested ? ["Operator must verify authenticated gateway or trusted-host allowlist before any command submission"] : []),
      "Retain or reconcile existing LocalNet positions and liquid tracking before participant cutover",
      "Verify an actual Canton TestNet wallet flow; Loop DevNet identities are not TestNet identities",
      ...(!selectedSplit ? [requestedSplitCid
        ? "The selected split is not an active matching 75/25 contract"
        : "Operator must identify the intended BeneficiarySplit CID; multiple matching active contracts exist"] : [])],
    appEarnedCcRewardsEnabled: false,
  }, null, 2));
  if (!provisioningMatches || !historyReadMatches) process.exitCode = 1;
}

main().catch(error => {
  // Do not echo tokens, request headers or arbitrary server response bodies.
  const message = error instanceof Error ? error.message : "TestNet provisioning check failed";
  console.error(message.replace(/^(Canton (?:ACS query|ledger-end) failed \(\d+\)).*/s, "$1"));
  process.exitCode = 1;
});
