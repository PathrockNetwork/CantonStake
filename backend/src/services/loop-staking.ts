import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { canton, TEMPLATES, type ActiveContract } from "../canton.js";
import { prisma } from "../db.js";
import { redisConnection } from "../reward-rounds.js";
import { LOOP_STAKING_CHAINS, LOOP_NATIVE_NETWORK, verifyLoopNativeOwnership, type LoopNativeChain } from "./loop-native-ownership.js";
import { readCosmosUnbondReceipt } from "./cosmos-unbond-receipt.js";
import { readSuiUnbondReceipt } from "./sui-unbond-receipt.js";
import type { CosmosChain } from "./native-network.js";
import { normalizeWalletAddress, sameWalletAddress } from "./wallet-address.js";
import { readSolanaUnbondReceipt } from "./solana-unbond-receipt.js";
import { canonicalAptosAddress } from "./aptos-events.js";
import { readAptosUnbondReceipt } from "./aptos-unbond-receipt.js";
import { readPolkadotUnbondReceipt } from "./polkadot-unbond-receipt.js";
import { parsePolkadotPoolKey } from "./polkadot-rpc.js";
import { loopWorkflowGate, loopDeployment } from "./loop-deployment.js";
export { loopWorkflowGate, loopDeployment } from "./loop-deployment.js";

const TTL_SECONDS = 1800;
const KEY_PREFIX = "cantonstake:loop-testnet:intent:";
const PARTY = /^[^\s:]+::[a-f0-9]{68}$/;

export class LoopWorkflowError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

/** Existing native-backed positions must remain observable before new creates.
 * Missing configuration is not permission to abandon the old participant. */
export async function loopPreservationGate(): Promise<string | null> {
  const mirrors = await prisma.stakingPosition.findMany({
    where: { status: { in: ["Bonded", "Unbonding"] } },
    select: { contractId: true, evmAddress: true, amountPol: true },
  });
  if (!mirrors.length) return null;
  const active = await canton.activeContracts(TEMPLATES.StakingPosition, AbortSignal.timeout(10000));
  const covered = mirrors.every(mirror => active.some(contract => contract.contractId === mirror.contractId &&
    sameWalletAddress(String(contract.argument.evmAddress), mirror.evmAddress) &&
    decimalEqual(String(contract.argument.amountPol), mirror.amountPol)));
  return covered ? null : "Existing active positions are missing from the configured Canton ledger view; preserve/reconcile the pre-cutover source before enabling new Loop stakes";
}

export async function verifyLoopSession(authorization: string | undefined, expectedParty: string): Promise<void> {
  const gate = loopWorkflowGate();
  if (gate) throw new LoopWorkflowError(503, gate);
  if (!authorization || !/^Bearer [^\s]{1,8192}$/.test(authorization) || !PARTY.test(expectedParty)) {
    throw new LoopWorkflowError(401, "A verified Loop TestNet wallet session is required");
  }
  let response: Response;
  try {
    // Fixed origin: never send a user's Loop bearer token to a body-supplied
    // endpoint, arbitrary proxy upstream or redirect.
    response = await fetch("https://testnet.cantonloop.com/api/v1/.connect/pair/account", {
      headers: { Authorization: authorization, Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new LoopWorkflowError(503, "Loop TestNet session verification is unavailable");
  }
  if ([400, 401, 403, 404].includes(response.status)) throw new LoopWorkflowError(401, "Loop session expired or was rejected; reconnect your wallet");
  if (!response.ok) throw new LoopWorkflowError(503, "Loop TestNet session verification is unavailable");
  let account: { party_id?: string; public_key?: string };
  try { account = await response.json(); } catch { throw new LoopWorkflowError(503, "Loop returned an invalid account response"); }
  if (account.party_id !== expectedParty || !account.public_key) throw new LoopWorkflowError(403, "The verified Loop party does not match this staking intent");
}

export interface PreparedLoopIntent {
  id: string;
  delegator: string;
  evmAddress: string;
  chain: LoopNativeChain;
  validator: string;
  amountPol: string;
  requestedAt: string;
  expiresAt: number;
  packageId: string;
  appProvider: string;
  synchronizerId: string;
  stakeAccountAddress?: string;
  stakeRentLamports?: string;
}

// Use the existing Redis connection; do not add another container/connection.
// A lost Redis connection must not leave HTTP requests hanging indefinitely.
async function boundedRedis<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LoopWorkflowError(503, "Staking intent storage is unavailable")), 5000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export function nativeIntentMessage(intent: PreparedLoopIntent): string {
  return ["CantonStake: authorize one Canton TestNet staking intent", "This signature does not transfer funds.",
    "Link this native wallet to the Loop party below for this request only.",
    "Existing identities, positions and rewards are not reassigned.",
    `Intent: ${intent.id}`, `Loop party: ${intent.delegator}`, `Native wallet: ${intent.evmAddress}`,
    `Native chain: ${intent.chain}`, `Validator: ${intent.validator}`, `Amount: ${intent.amountPol}`,
    `Native network: ${LOOP_NATIVE_NETWORK[intent.chain]}`,
    ...(intent.chain === "solana" ? [`Stake account: ${intent.stakeAccountAddress}`, `Stake-account rent (lamports): ${intent.stakeRentLamports}`] : []),
    `Provider: ${intent.appProvider}`, `Package: ${intent.packageId}`, `Synchronizer: ${intent.synchronizerId}`,
    `Requested at: ${intent.requestedAt}`, `Expires at: ${new Date(intent.expiresAt).toISOString()}`].join("\n");
}

export async function prepareLoopIntent(input: Pick<PreparedLoopIntent, "delegator" | "evmAddress" | "chain" | "validator" | "amountPol" | "stakeAccountAddress" | "stakeRentLamports">) {
  if (input.chain === "solana" && (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.stakeAccountAddress ?? "") ||
      !/^[1-9]\d*$/.test(input.stakeRentLamports ?? "") || input.stakeAccountAddress === input.evmAddress ||
      input.stakeAccountAddress === input.validator)) throw new LoopWorkflowError(400, "Solana intent requires the checked stake account and rent");
  canton.assertCanSubmit();
  await canton.probe(AbortSignal.timeout(3000));
  const preservationBlocker = await loopPreservationGate();
  if (preservationBlocker) throw new LoopWorkflowError(409, preservationBlocker);
  const wallet = normalizeWalletAddress(input.evmAddress);
  const requests = await canton.activeContracts(TEMPLATES.StakingRequest, AbortSignal.timeout(10000));
  if (requests.some(request => request.argument.delegator === input.delegator &&
      sameWalletAddress(String(request.argument.evmAddress), wallet))) {
    throw new LoopWorkflowError(409, "This Loop wallet has a pending Canton request. Reconcile or cancel it before preparing another stake");
  }
  const intent: PreparedLoopIntent = { ...input, evmAddress: wallet, id: randomUUID(),
    requestedAt: new Date().toISOString(), expiresAt: Date.now() + TTL_SECONDS * 1000,
    packageId: config.cantonPackageId, appProvider: config.cantonAppProviderParty, synchronizerId: config.cantonSynchronizerId };
  if (redisConnection.status !== "ready") throw new LoopWorkflowError(503, "Staking intent storage is unavailable");
  const stored = await boundedRedis(redisConnection.set(KEY_PREFIX + intent.id, JSON.stringify(intent), "EX", TTL_SECONDS, "NX"));
  if (stored !== "OK") throw new LoopWorkflowError(503, "Unable to prepare staking intent");
  return { intentId: intent.id, expiresAt: intent.expiresAt, nativeOwnershipMessage: nativeIntentMessage(intent),
    ...(intent.chain === "solana" ? { stakeAccountAddress: intent.stakeAccountAddress, stakeRentLamports: intent.stakeRentLamports } : {}),
    deployment: loopDeployment(), action: { kind: "create-request" as const, delegator: intent.delegator,
      evmAddress: intent.evmAddress, amount: intent.amountPol, requestedAt: intent.requestedAt } };
}

async function loadIntent(id: string): Promise<PreparedLoopIntent> {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new LoopWorkflowError(400, "Invalid prepared intent ID");
  if (redisConnection.status !== "ready") throw new LoopWorkflowError(503, "Staking intent storage is unavailable");
  const raw = await boundedRedis(redisConnection.get(KEY_PREFIX + id));
  if (!raw) throw new LoopWorkflowError(410, "Prepared intent expired; reconcile any Canton request before starting another");
  const intent = JSON.parse(raw) as PreparedLoopIntent;
  if (intent.id !== id || intent.expiresAt <= Date.now() || intent.packageId !== config.cantonPackageId ||
      !LOOP_STAKING_CHAINS.includes(intent.chain) ||
      intent.appProvider !== config.cantonAppProviderParty || intent.synchronizerId !== config.cantonSynchronizerId) {
    throw new LoopWorkflowError(409, "Prepared intent no longer matches this deployment; reconcile before retrying");
  }
  return intent;
}

export async function authorizeLoopIntent(id: string, delegator: string, signature: string, authorization?: string) {
  await verifyLoopSession(authorization, delegator);
  const intent = await loadIntent(id);
  if (intent.delegator !== delegator) throw new LoopWorkflowError(403, "Prepared intent belongs to another Loop party");
  if (!await verifyLoopNativeOwnership(intent.chain, intent.evmAddress, nativeIntentMessage(intent), signature)) {
    throw new LoopWorkflowError(403, "Native wallet ownership signature is invalid or this account type is unsupported");
  }
  return intent;
}

export async function adoptLoopIntent(intent: PreparedLoopIntent) {
  // Query as the app provider, not as the Loop user. The delegator's signature
  // is enforced by Canton; the wallet's receipt is not sufficient evidence.
  const active = await canton.activeContracts(TEMPLATES.StakingRequest, AbortSignal.timeout(10000));
  const matches = active.filter(contract => contract.templateId === `${intent.packageId}:CantonStake.Staking:StakingRequest` &&
    contract.argument.delegator === intent.delegator && contract.argument.appProvider === intent.appProvider &&
    sameWalletAddress(String(contract.argument.evmAddress), intent.evmAddress) &&
    decimalEqual(String(contract.argument.amountPol), intent.amountPol) && contract.argument.requestedAt === intent.requestedAt);
  if (matches.length !== 1) throw new LoopWorkflowError(409, matches.length ? "Ambiguous Canton requests; reconcile before staking"
    : "Loop request is not independently visible on Canton; do not send native stake or create another request yet");
  const contractId = matches[0]!.contractId;
  return prisma.$transaction(async tx => {
    const old = await tx.stakingIntent.findUnique({ where: { requestContractId: contractId } });
    if (old) {
      const owner = old.userId ? await tx.user.findUnique({ where: { id: old.userId } }) : null;
      if (owner?.cantonPartyId !== intent.delegator || old.evmAddress !== intent.evmAddress || old.chain !== intent.chain ||
          old.validatorAddress !== intent.validator || old.amountPol !== intent.amountPol ||
          (intent.chain === "solana" && (old.stakeAccountAddress !== intent.stakeAccountAddress || old.stakeRentLamports !== intent.stakeRentLamports))) {
        throw new LoopWorkflowError(409, "Canton request is already bound to another staking intent");
      }
      if (old.acceptedAt || old.acceptedTxHash) throw new LoopWorkflowError(409, "This staking intent already has a native stake being processed or accepted; check your positions instead of staking again");
      return adoptedResponse(intent, contractId);
    }
    // Both wallets have been verified before adoption: the Loop bearer session
    // and the native signature bind this exact request. StakingIntent records
    // the association; User.evmAddress remains an unchanged legacy primary.
    const [byParty, byWallet] = await Promise.all([
      tx.user.findUnique({ where: { cantonPartyId: intent.delegator } }),
      tx.user.findUnique({ where: { evmAddress: intent.evmAddress } }),
    ]);
    const duplicate = await tx.stakingIntent.findFirst({ where: {
      chain: intent.chain, evmAddress: intent.evmAddress, validatorAddress: intent.validator,
      acceptedAt: null, requestContractId: { in: active.map(c => c.contractId) },
    } });
    if (duplicate) throw new LoopWorkflowError(409, "Another request is pending for this wallet and validator; cancel or settle it first");
    const user = byParty ?? await tx.user.create({ data: {
      cantonPartyId: intent.delegator, evmAddress: byWallet ? null : intent.evmAddress,
    } });
    await tx.stakingIntent.create({ data: { requestContractId: contractId, userId: user.id,
      chain: intent.chain, evmAddress: intent.evmAddress, amountPol: intent.amountPol, validatorAddress: intent.validator,
      stakeAccountAddress: intent.chain === "solana" ? intent.stakeAccountAddress : null,
      stakeRentLamports: intent.chain === "solana" ? intent.stakeRentLamports : null } });
    return adoptedResponse(intent, contractId);
  }, { isolationLevel: "Serializable" });
}

function adoptedResponse(intent: PreparedLoopIntent, contractId: string) {
  return { ok: true, requestContractId: contractId, transactionId: null, delegator: intent.delegator, chain: intent.chain,
    ...(intent.chain === "solana" ? { stakeAccountAddress: intent.stakeAccountAddress, stakeRentLamports: intent.stakeRentLamports } : {}) };
}

function ownsLoopRequest(contract: ActiveContract, delegator: string): boolean {
  return contract.templateId === `${config.cantonPackageId}:CantonStake.Staking:StakingRequest` &&
    contract.argument.delegator === delegator && contract.argument.appProvider === config.cantonAppProviderParty;
}

function requireContractId(contractId: string): void {
  if (!/^[a-f0-9]{2,512}$/.test(contractId) || contractId.length % 2 !== 0) {
    throw new LoopWorkflowError(400, "Invalid Canton request contract ID");
  }
}

/** Recover actual requests even when the prepared Redis nonce/browser state expired. */
export async function pendingLoopRequests(delegator: string) {
  const active = await canton.activeContracts(TEMPLATES.StakingRequest, AbortSignal.timeout(10000));
  const owned = active.filter(contract => ownsLoopRequest(contract, delegator));
  const intents = await prisma.stakingIntent.findMany({ where: { requestContractId: { in: owned.map(c => c.contractId) } } });
  const user = await prisma.user.findUnique({ where: { cantonPartyId: delegator } });
  return { requests: owned.map(contract => {
    const intent = intents.find(row => row.requestContractId === contract.contractId);
    const validBinding = intent && user && intent.userId === user.id &&
      sameWalletAddress(String(contract.argument.evmAddress), intent.evmAddress) &&
      decimalEqual(intent.amountPol, String(contract.argument.amountPol));
    const binding = !intent ? "unbound" : !validBinding ? "conflict"
      : intent.acceptedAt || intent.acceptedTxHash ? "processing" : "adopted";
    return { contractId: contract.contractId, delegator, evmAddress: String(contract.argument.evmAddress),
      amount: String(contract.argument.amountPol), requestedAt: String(contract.argument.requestedAt), binding,
      // The on-ledger request has no chain field. Do not guess Polygon for an unadopted request.
      chain: validBinding ? intent.chain : null, validator: validBinding ? intent.validatorAddress : null,
      canCancel: binding !== "processing" && binding !== "conflict" };
  }) };
}

/** Only the real Loop user signs Cancel; the provider never acts as that party. */
export async function prepareLoopCancellation(delegator: string, contractId: string) {
  requireContractId(contractId);
  const { requests } = await pendingLoopRequests(delegator);
  const request = requests.find(row => row.contractId === contractId);
  if (!request) throw new LoopWorkflowError(409, "Request is no longer pending for this Loop party; refresh your positions");
  if (!request.canCancel) throw new LoopWorkflowError(409, "Request is already processing or has conflicting metadata; wait for reconciliation");
  return { deployment: loopDeployment(), action: { kind: "cancel-request" as const, delegator, contractId }, request };
}

/** Independent cancellation proof, including recovery after a wallet timeout. */
export async function observeLoopCancellation(delegator: string, contractId: string) {
  requireContractId(contractId);
  const history = await canton.contractHistory(contractId, TEMPLATES.StakingRequest, AbortSignal.timeout(10000));
  const created = history?.created;
  if (!created || created.synchronizerId !== config.cantonSynchronizerId ||
      !ownsLoopRequest({ ...created.createdEvent, argument: created.createdEvent.createArgument }, delegator) ||
      created.createdEvent.contractId !== contractId) {
    throw new LoopWorkflowError(404, "This request is not independently observable for the connected Loop party");
  }
  const archived = history?.archived;
  if (!archived) return { status: "pending" as const, contractId };
  if (archived.synchronizerId !== config.cantonSynchronizerId || archived.archivedEvent.contractId !== contractId ||
      archived.archivedEvent.templateId !== `${config.cantonPackageId}:CantonStake.Staking:StakingRequest`) {
    throw new LoopWorkflowError(409, "Request archive does not match the reviewed deployment");
  }
  const transaction = await canton.transactionAtOffset(archived.archivedEvent.offset, TEMPLATES.StakingRequest, AbortSignal.timeout(10000));
  const event = transaction?.events?.map(row => row.ExercisedEvent).find(row => row?.contractId === contractId &&
    row.templateId === `${config.cantonPackageId}:CantonStake.Staking:StakingRequest` && row.consuming === true);
  if (!transaction?.updateId || transaction.synchronizerId !== config.cantonSynchronizerId || !event) {
    throw new LoopWorkflowError(409, "Request archive is visible, but its consuming choice is not confirmed; do not retry blindly");
  }
  if (event.choice === "StakingRequest_Cancel" && event.actingParties?.length === 1 && event.actingParties[0] === delegator) {
    return { status: "cancelled" as const, contractId, updateId: transaction.updateId,
      evmAddress: String(created.createdEvent.createArgument.evmAddress), requestedAt: String(created.createdEvent.createArgument.requestedAt) };
  }
  if (event.choice === "StakingRequest_Accept" && event.actingParties?.includes(config.cantonAppProviderParty)) {
    return { status: "accepted" as const, contractId, updateId: transaction.updateId };
  }
  throw new LoopWorkflowError(409, "Request was archived through a different choice; reconcile before taking further action");
}

/** Build a user-controlled unbond intent only for a provider-observed bonded position. */
export async function prepareLoopUnbond(delegator: string, contractId: string) {
  requireContractId(contractId);
  const active = await canton.activeContracts(TEMPLATES.StakingPosition, AbortSignal.timeout(10000));
  const contract = active.find(row => row.contractId === contractId &&
    row.templateId === `${config.cantonPackageId}:CantonStake.Staking:StakingPosition` &&
    row.argument.appProvider === config.cantonAppProviderParty && row.argument.delegator === delegator);
  if (!contract || contract.argument.status !== "Bonded") {
    throw new LoopWorkflowError(409, "This Loop party has no matching bonded position on the reviewed TestNet deployment");
  }
  const [mirror, user] = await Promise.all([
    prisma.stakingPosition.findUnique({ where: { contractId } }),
    prisma.user.findUnique({ where: { cantonPartyId: delegator } }),
  ]);
  if (!mirror || !user || mirror.userId !== user.id || !LOOP_STAKING_CHAINS.includes(mirror.chain as LoopNativeChain) ||
      !sameWalletAddress(String(contract.argument.evmAddress), mirror.evmAddress) ||
      !decimalEqual(mirror.amountPol, String(contract.argument.amountPol)) || !mirror.validatorAddress) {
    throw new LoopWorkflowError(409, "Position ownership and native chain metadata cannot be independently verified");
  }
  const proof = contract.argument.lastBondProof as { blockNumber?: number; validatorShare?: string } | null;
  if (mirror.chain === "sui" && (!/^0x[a-f0-9]{64}$/.test(mirror.suiStakedObjectId ?? "") ||
      !/^0x[a-f0-9]{64}$/.test(mirror.validatorShare ?? "") || proof?.validatorShare !== mirror.validatorShare ||
      !Number.isSafeInteger(Number(proof?.blockNumber)) || Number(proof?.blockNumber) <= 0)) {
    throw new LoopWorkflowError(409, "Sui unbond requires the verified receipt object, pool and original bond checkpoint");
  }
  if (mirror.chain === "solana" && (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mirror.validatorShare ?? "") ||
      proof?.validatorShare !== mirror.validatorShare || !Number.isSafeInteger(Number(proof?.blockNumber)) || Number(proof?.blockNumber) <= 0)) {
    throw new LoopWorkflowError(409, "Solana unbond requires the verified stake account and original bond slot");
  }
  if (mirror.chain === "aptos" && (!canonicalAptosAddress(mirror.validatorShare) ||
      canonicalAptosAddress(mirror.validatorShare) !== canonicalAptosAddress(mirror.validatorAddress) ||
      canonicalAptosAddress(proof?.validatorShare) !== canonicalAptosAddress(mirror.validatorShare) ||
      !Number.isSafeInteger(Number(proof?.blockNumber)) || Number(proof?.blockNumber) <= 0)) {
    throw new LoopWorkflowError(409, "Aptos unbond requires the verified delegation pool and original bond version");
  }
  if (mirror.chain === "polkadot" && (parsePolkadotPoolKey(mirror.validatorShare ?? "") === null ||
      mirror.validatorShare !== mirror.validatorAddress || proof?.validatorShare !== mirror.validatorShare ||
      !Number.isSafeInteger(Number(proof?.blockNumber)) || Number(proof?.blockNumber) <= 0)) {
    throw new LoopWorkflowError(409, "Polkadot unbond requires the verified nomination pool and original bond height");
  }
  return { deployment: loopDeployment(), action: { kind: "request-unbond" as const, delegator, contractId },
    position: { contractId, evmAddress: mirror.evmAddress, amount: String(contract.argument.amountPol),
      chain: mirror.chain, validator: mirror.validatorAddress, validatorShare: mirror.validatorShare,
      suiStakedObjectId: mirror.suiStakedObjectId,
      bondHeight: Number(proof?.blockNumber) } };
}

export async function observeLoopNativeUnbond(delegator: string, contractId: string, hash: string, blockHash?: string) {
  const prepared = await prepareLoopUnbond(delegator, contractId);
  const position = prepared.position;
  if (position.chain === "polkadot") {
    if (!blockHash) throw new LoopWorkflowError(400, "Polkadot recovery requires the finalized block hash from the native receipt");
    return { contractId, ...await readPolkadotUnbondReceipt({ wallet: position.evmAddress,
      pool: position.validator, hash, blockHash, bondHeight: position.bondHeight }) };
  }
  if (position.chain === "aptos") {
    return { contractId, ...await readAptosUnbondReceipt({ wallet: position.evmAddress,
      pool: position.validator, hash, bondHeight: position.bondHeight }) };
  }
  if (position.chain === "solana") {
    if (!position.validatorShare) throw new LoopWorkflowError(400, "Solana recovery requires the verified stake account");
    return { contractId, ...await readSolanaUnbondReceipt({ wallet: position.evmAddress,
      stakeAccount: position.validatorShare, signature: hash, bondHeight: position.bondHeight }) };
  }
  if (position.chain === "sui") {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(hash) || !position.suiStakedObjectId) throw new LoopWorkflowError(400, "Sui recovery requires the actual transaction digest and verified staking receipt object");
    return { contractId, ...await readSuiUnbondReceipt({ wallet: position.evmAddress, receiptId: position.suiStakedObjectId,
      digest: hash, bondHeight: position.bondHeight }) };
  }
  if (!/^[a-fA-F0-9]{64}$/.test(hash)) throw new LoopWorkflowError(400, "Enter the actual 64-character Cosmos transaction hash");
  if (!["cosmos", "celestia", "osmosis"].includes(position.chain)) throw new LoopWorkflowError(400, "Cosmos receipt recovery requires a Cosmos-family position");
  return { contractId, ...await readCosmosUnbondReceipt({ chain: position.chain as CosmosChain,
    wallet: position.evmAddress, validator: position.validator, amount: position.amount,
    hash, bondHeight: position.bondHeight }) };
}

export async function observeLoopUnbond(delegator: string, contractId: string, updateId: string) {
  if (!/^[A-Za-z0-9._:#-]{1,255}$/.test(updateId)) throw new LoopWorkflowError(400, "Invalid Canton update ID");
  // Recheck current ownership/status; an old receipt for a consumed position
  // cannot authorize a native transaction against its successor contract.
  await prepareLoopUnbond(delegator, contractId);
  const transaction = await canton.transactionById(updateId, TEMPLATES.StakingPosition, AbortSignal.timeout(10000));
  // appProvider is the position signatory: even a pure non-consuming exercise
  // is visible to it in the ledger-effects view. Do not require a fabricated
  // marker/ACS change or sign/read as the Loop user to "confirm" approval.
  const event = transaction?.events?.map(row => row.ExercisedEvent).find(row => row?.contractId === contractId &&
    row.templateId === `${config.cantonPackageId}:CantonStake.Staking:StakingPosition` &&
    row.choice === "StakingPosition_RequestUnbond" && row.consuming === false &&
    row.actingParties?.length === 1 && row.actingParties[0] === delegator);
  if (!event || transaction?.updateId !== updateId || transaction.synchronizerId !== config.cantonSynchronizerId) {
    throw new LoopWorkflowError(409, "Loop unbond approval is not independently visible to the provider; no native unstake may be sent");
  }
  return { ok: true, contractId, updateId, delegator };
}

function decimalEqual(left: string, right: string): boolean {
  const canonical = (value: string) => {
    if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
    const [whole, fraction = ""] = value.split(".");
    return `${whole!.replace(/^0+(?=\d)/, "")}.${fraction.replace(/0+$/, "")}`;
  };
  return canonical(left) !== null && canonical(left) === canonical(right);
}
