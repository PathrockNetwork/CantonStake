import { getPublicClient, signMessage } from "@wagmi/core";
import { wagmiConfig } from "../wagmi";
import { networkMode } from "../network";
import { approveConnectedLoopStake, connectedLoopAuthorization } from "./loop-sdk-provider";
import { resolveLoopNetwork } from "./loop-network";
import { LoopSubmissionUncertainError, type LoopStakingAction, type LoopStakingDeployment } from "./loop-transactions";
import { decodeFunctionData, parseAbi, parseEther, TransactionReceiptNotFoundError, type Address, type Hash } from "viem";
import { normalizedNativeWallet } from "../native-wallet-addresses";

interface StakeInput {
  evmAddress: string; amountPol: string; delegator: string;
  chain?: string; validator?: string; stakeAccountAddress?: string;
}
interface PreparedIntent {
  intentId: string;
  expiresAt: number;
  nativeOwnershipMessage: string;
  stakeAccountAddress?: string;
  stakeRentLamports?: string;
  deployment: LoopStakingDeployment;
  action: Extract<LoopStakingAction, { kind: "create-request" }>;
}
interface AdoptedIntent {
  ok: boolean; transactionId: string | null; requestContractId: string; delegator: string; chain: string;
  stakeAccountAddress?: string;
  stakeRentLamports?: string;
}

// Memory only, never a fabricated wallet or persisted bearer session. After an
// ambiguous submit, the next attempt reconciles this exact intent; it cannot
// create another contract simply because a wallet popup timed out.
const pending = new Map<string, { prepared: PreparedIntent; nativeSignature: string; submissionAttempted: boolean }>();
const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4001";

export interface PendingLoopRequest {
  contractId: string; delegator: string; evmAddress: string; amount: string; requestedAt: string;
  binding: "unbound" | "adopted" | "processing" | "conflict";
  chain: string | null; validator: string | null; canCancel: boolean;
}

/** Canton network the Loop staking deployment must match (built into this image). */
const stakingNetwork = resolveLoopNetwork(process.env.NEXT_PUBLIC_LOOP_NETWORK);

export interface LoopRewardEntitlements {
  network: "devnet" | "testnet";
  source: "canton-reward-assignment-interface";
  beneficiary: string;
  ledgerOffset: string;
  observedAt: string;
  observedUnexpiredAmount: string;
  coupons: Array<{ contractId: string; amount: string; expiresAt: string; expired: boolean; status: "minting_entitlement" }>;
  paymentsEnabled: false;
  paymentStatus: "unverified";
  coverage: "provider-visible-active-coupons-only";
}

interface CancellationObservation {
  status: "pending" | "cancelled" | "accepted"; contractId: string; updateId?: string;
  evmAddress?: string; requestedAt?: string;
}

type CancellationReference = Pick<PendingLoopRequest, "delegator" | "contractId">;
const cancellationKey = (request: CancellationReference) =>
  `cantonstake:loop-testnet:cancel:${request.delegator}:${request.contractId}`;

/** A retry-suppression marker only: never used as authentication or ledger proof. */
export function hasPendingLoopCancellation(request: CancellationReference): boolean {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(cancellationKey(request)) !== null; }
  catch { return true; } // Storage unavailable: reconcile, never sign another command.
}

/** Local unresolved attempts, not asserted active contracts or positions. */
export function unresolvedLoopCancellations(delegator: string): CancellationReference[] {
  if (typeof window === "undefined") return [];
  const prefix = `cantonstake:loop-testnet:cancel:${delegator}:`;
  const result: CancellationReference[] = [];
  try {
    for (let index = 0; index < localStorage.length && result.length < 100; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const contractId = key.slice(prefix.length);
      if (/^[a-f0-9]{2,512}$/.test(contractId) && contractId.length % 2 === 0) result.push({ delegator, contractId });
    }
  } catch { return []; }
  return result;
}

async function post<T>(path: string, body: unknown, party: string): Promise<T> {
  if (networkMode !== "testnet" || process.env.NEXT_PUBLIC_LOOP_STAKING_FLOW !== "external") {
    throw new Error("The external Loop staking workflow is not enabled on this page.");
  }
  const authorization = await connectedLoopAuthorization(party);
  const response = await fetch(`${BACKEND.replace(/\/$/, "")}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: authorization },
    body: JSON.stringify(body), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Loop staking request failed.");
  return result as T;
}

/** Observe minting rights for the actual Loop party, never a default hosted
 * user. A coupon is not a minted/received CC balance or a staking allocation. */
export async function fetchLoopRewardEntitlements(beneficiary: string): Promise<LoopRewardEntitlements> {
  const result = await post<LoopRewardEntitlements>("/api/loop/rewards/entitlements", { delegator: beneficiary }, beneficiary);
  const amount = /^(?:0|[1-9]\d{0,27})(?:\.\d{1,10})?$/;
  if (result.network !== stakingNetwork || result.source !== "canton-reward-assignment-interface" || result.beneficiary !== beneficiary ||
      typeof result.ledgerOffset !== "string" || !/^\d+$/.test(result.ledgerOffset) || !Number.isFinite(Date.parse(result.observedAt)) ||
      typeof result.observedUnexpiredAmount !== "string" || !amount.test(result.observedUnexpiredAmount) ||
      result.paymentsEnabled !== false || result.paymentStatus !== "unverified" || result.coverage !== "provider-visible-active-coupons-only" ||
      !Array.isArray(result.coupons) || result.coupons.length > 10000 || result.coupons.some(coupon =>
        !/^[a-f0-9]{2,512}$/.test(coupon.contractId) || coupon.contractId.length % 2 !== 0 ||
        typeof coupon.amount !== "string" || !amount.test(coupon.amount) || !Number.isFinite(Date.parse(coupon.expiresAt)) ||
        typeof coupon.expired !== "boolean" || coupon.status !== "minting_entitlement")) {
    throw new Error("No verified reward entitlement snapshot was returned for the connected Loop party.");
  }
  return result;
}

export async function fetchPendingLoopRequests(delegator: string): Promise<PendingLoopRequest[]> {
  const result = await post<{ requests: PendingLoopRequest[] }>("/api/loop/staking/requests", { delegator }, delegator);
  if (!Array.isArray(result.requests) || result.requests.some(request => request.delegator !== delegator)) {
    throw new Error("Backend returned requests for a different Loop party.");
  }
  return result.requests;
}

export async function observePendingLoopCancellation(request: CancellationReference): Promise<CancellationObservation> {
  const result = await post<CancellationObservation>("/api/loop/staking/cancel/observe", {
    delegator: request.delegator, contractId: request.contractId,
  }, request.delegator);
  if (result.contractId !== request.contractId || !["pending", "cancelled", "accepted"].includes(result.status) ||
      (result.status !== "pending" && !result.updateId)) throw new Error("No matching Canton cancellation proof was returned.");
  if (result.status === "cancelled") {
    localStorage.removeItem(cancellationKey(request));
    // Allow a fresh attempt after verified cancellation of the exact create.
    for (const [key, attempt] of pending) {
      const action = attempt.prepared.action;
      if (action.delegator === request.delegator && result.evmAddress && normalizedNativeWallet(action.evmAddress) === normalizedNativeWallet(result.evmAddress) &&
          action.requestedAt === result.requestedAt) pending.delete(key);
    }
  } else if (result.status === "accepted") localStorage.removeItem(cancellationKey(request));
  return result;
}

export async function cancelPendingLoopRequest(request: PendingLoopRequest): Promise<CancellationObservation> {
  // Repeated clicks/reloads reconcile an uncertain submit instead of issuing
  // a new wallet command. No native transaction is sent by this workflow.
  if (hasPendingLoopCancellation(request)) return observePendingLoopCancellation(request);
  const prepared = await post<{ deployment: LoopStakingDeployment;
    action: Extract<LoopStakingAction, { kind: "cancel-request" }> }>("/api/loop/staking/cancel/prepare", {
    delegator: request.delegator, contractId: request.contractId,
  }, request.delegator);
  if (prepared.action?.kind !== "cancel-request" || prepared.action.delegator !== request.delegator ||
      prepared.action.contractId !== request.contractId || prepared.deployment?.network !== stakingNetwork) {
    throw new Error("Backend prepared a mismatched cancellation.");
  }
  localStorage.setItem(cancellationKey(request), "submission-attempted");
  try { await approveConnectedLoopStake(prepared.deployment, prepared.action); }
  catch (error) {
    if (!(error instanceof LoopSubmissionUncertainError)) {
      localStorage.removeItem(cancellationKey(request));
      throw error;
    }
  }
  return observePendingLoopCancellation(request);
}

export interface LoopUnbondPosition {
  contractId: string; delegator: string; evmAddress: string; amount: string; chain: string; validator: string;
  validatorShare?: string | null;
  suiStakedObjectId?: string | null;
}

export function loopUnbondRecoveryState(position: Pick<LoopUnbondPosition, "delegator" | "contractId">) {
  if (typeof window === "undefined") return { loop: null, native: null, nativeBlock: null, storageUnavailable: false };
  try { return {
    loop: localStorage.getItem(`cantonstake:loop-testnet:unbond:${position.delegator}:${position.contractId}`),
    native: localStorage.getItem(`cantonstake:loop-testnet:native-unbond:${position.delegator}:${position.contractId}`),
    nativeBlock: localStorage.getItem(`cantonstake:loop-testnet:native-unbond-block:${position.delegator}:${position.contractId}`),
    storageUnavailable: false,
  }; } catch { return { loop: null, native: null, nativeBlock: null, storageUnavailable: true }; }
}

async function verifiedLoopUnbondPosition(position: LoopUnbondPosition) {
  const prepared = await post<{ deployment: LoopStakingDeployment;
    action: Extract<LoopStakingAction, { kind: "request-unbond" }>;
    position: Omit<LoopUnbondPosition, "delegator"> }>("/api/loop/staking/unbond/prepare", {
    delegator: position.delegator, contractId: position.contractId,
  }, position.delegator);
  if (prepared.action?.kind !== "request-unbond" || prepared.action.contractId !== position.contractId ||
      prepared.action.delegator !== position.delegator || prepared.deployment?.network !== stakingNetwork ||
      prepared.position?.contractId !== position.contractId || prepared.position.chain !== position.chain ||
      normalizedNativeWallet(prepared.position.evmAddress) !== normalizedNativeWallet(position.evmAddress) ||
      normalizedNativeWallet(prepared.position.validator) !== normalizedNativeWallet(position.validator) ||
      prepared.position.amount !== position.amount ||
      (position.chain === "solana" && (!position.validatorShare || prepared.position.validatorShare !== position.validatorShare)) ||
      (position.chain === "polkadot" && (!position.validatorShare || prepared.position.validatorShare !== position.validatorShare)) ||
      (position.chain === "sui" && (!position.suiStakedObjectId || prepared.position.suiStakedObjectId !== position.suiStakedObjectId))) throw new Error("Backend prepared an unbond for different position metadata.");
  return prepared;
}

async function confirmedLoopUnbondUpdate(position: LoopUnbondPosition, updateId: string): Promise<void> {
  if (!/^[A-Za-z0-9._:#-]{1,255}$/.test(updateId)) throw new Error("Enter the actual Loop ledger update ID, not a command ID or transaction hash.");
  const observed = await post<{ ok: boolean; delegator: string; contractId: string; updateId: string }>("/api/loop/staking/unbond/observe", {
    delegator: position.delegator, contractId: position.contractId, updateId,
  }, position.delegator);
  if (!observed.ok || observed.contractId !== position.contractId || observed.delegator !== position.delegator ||
      observed.updateId !== updateId) throw new Error("Loop unbond intent was not independently confirmed. No native unstake should be sent.");
}

/** Reconcile an existing receipt through the backend; never open a signing popup. */
export async function recoverLoopUnbondUpdate(position: LoopUnbondPosition, updateId: string): Promise<void> {
  await confirmedLoopUnbondUpdate(position, updateId);
  localStorage.setItem(`cantonstake:loop-testnet:unbond:${position.delegator}:${position.contractId}`, updateId);
}

const recoveryAbis = {
  polygon: parseAbi(["function sellVoucher_new(uint256 claimAmount, uint256 maximumSharesToBurn)"]),
  monad: parseAbi(["function undelegate(uint64 validatorId, uint256 amount, uint8 withdrawId)"]),
  bnb: parseAbi(["function undelegate(address operatorAddress, uint256 shares)"]),
};

/** Read-only native receipt recovery. Browser metadata is never ledger proof. */
export async function recoverNativeLoopUnbond(position: LoopUnbondPosition, hash: string, blockHash?: string) {
  const cosmos = ["cosmos", "celestia", "osmosis"].includes(position.chain);
  const sui = position.chain === "sui";
  const solana = position.chain === "solana";
  const aptos = position.chain === "aptos";
  const polkadot = position.chain === "polkadot";
  const caseSensitive = sui || solana;
  if (!(solana ? /^[1-9A-HJ-NP-Za-km-z]{64,88}$/ : sui ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : cosmos ? /^[a-fA-F0-9]{64}$/ : /^0x[a-fA-F0-9]{64}$/).test(hash)) throw new Error("Enter the actual transaction hash, Solana signature or Sui digest for this native network.");
  const prepared = await verifiedLoopUnbondPosition(position);
  const key = `cantonstake:loop-testnet:native-unbond:${position.delegator}:${position.contractId}`;
  const guard = localStorage.getItem(key);
  if (!guard) throw new Error("No uncertain native unbond attempt is recorded for this position.");
  if (guard !== "submission-uncertain" && (caseSensitive ? guard !== hash : guard.toLowerCase() !== hash.toLowerCase())) {
    throw new Error("The supplied hash does not match the recorded native attempt. The guard was not cleared.");
  }
  if (cosmos || sui || solana || aptos || polkadot) {
    if (polkadot && !/^0x[a-fA-F0-9]{64}$/.test(blockHash ?? "")) throw new Error("Enter the finalized Westend block hash containing this extrinsic from your wallet or explorer.");
    const receipt = await post<{ contractId: string; hash: string; status: "pending" | "settled" | "reverted" }>(
      "/api/loop/staking/unbond/native-observe", { delegator: position.delegator, contractId: position.contractId, nativeHash: hash,
        ...(polkadot ? { nativeBlockHash: blockHash } : {}) }, position.delegator,
    );
    if (receipt.contractId !== position.contractId || (caseSensitive ? receipt.hash !== hash : receipt.hash.toUpperCase() !== hash.toUpperCase()) ||
        !["pending", "settled", "reverted"].includes(receipt.status)) throw new Error("No matching native unbond receipt was returned; the guard remains.");
    const retryAllowed = receipt.status === "reverted" && guard !== "submission-uncertain" && (caseSensitive ? guard === hash : guard.toUpperCase() === hash.toUpperCase());
    if (retryAllowed && localStorage.getItem(key) === guard) localStorage.removeItem(key);
    return { ...receipt, retryAllowed };
  }
  const chainId = ({ polygon: 11155111, monad: 10143, bnb: 97 } as Record<string, number>)[position.chain];
  if (!chainId) throw new Error("Native unbond recovery is not enabled for this network.");
  const client = getPublicClient(wagmiConfig, { chainId });
  if (!client || await client.getChainId() !== chainId) throw new Error("Native recovery RPC is on the wrong network.");
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash: hash as Hash }); }
  catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) return { status: "pending" as const, retryAllowed: false, hash };
    throw error;
  }
  const transaction = await client.getTransaction({ hash: hash as Hash });
  if (transaction.from.toLowerCase() !== position.evmAddress.toLowerCase() || transaction.value !== 0n ||
      receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new Error("Native receipt does not match the position's wallet or unbond call.");
  let matches = false;
  if (position.chain === "polygon") {
    const decoded = decodeFunctionData({ abi: recoveryAbis.polygon, data: transaction.input });
    const share = prepared.position.validatorShare;
    matches = !!share && transaction.to?.toLowerCase() === share.toLowerCase() &&
      decoded.functionName === "sellVoucher_new" && decoded.args[0] === parseEther(position.amount);
  } else if (position.chain === "monad") {
    const decoded = decodeFunctionData({ abi: recoveryAbis.monad, data: transaction.input });
    matches = transaction.to?.toLowerCase() === "0x0000000000000000000000000000000000001000" &&
      decoded.functionName === "undelegate" && decoded.args[0] === BigInt(position.validator) && decoded.args[1] > 0n;
  } else if (position.chain === "bnb") {
    const decoded = decodeFunctionData({ abi: recoveryAbis.bnb, data: transaction.input });
    matches = transaction.to?.toLowerCase() === "0x0000000000000000000000000000000000002002" &&
      decoded.functionName === "undelegate" && decoded.args[0].toLowerCase() === position.validator.toLowerCase() && decoded.args[1] > 0n;
  }
  if (!matches) throw new Error("Native transaction is not an unbond for this position's validator. The guard was not cleared.");
  if (receipt.status === "reverted") {
    // An arbitrary supplied reverted hash cannot disprove another, unknown
    // broadcast. Only a proved revert of the recorded exact hash allows retry.
    const retryAllowed = guard !== "submission-uncertain" && guard.toLowerCase() === hash.toLowerCase();
    if (retryAllowed && localStorage.getItem(key) === guard) localStorage.removeItem(key);
    return { status: "reverted" as const, retryAllowed, hash };
  }
  // Retain unknown-broadcast guards: a matching successful call is evidence
  // to wait for indexing, not permission to submit another unstake.
  return { status: "settled" as const, retryAllowed: false, hash };
}

/** No native unstake is allowed on a merely queued or uncertain Loop receipt. */
export async function approveLoopPositionUnbond(position: LoopUnbondPosition): Promise<void> {
  const prepared = await verifiedLoopUnbondPosition(position);
  const key = `cantonstake:loop-testnet:unbond:${position.delegator}:${position.contractId}`;
  let updateId = localStorage.getItem(key);
  if (updateId === "submission-uncertain") {
    throw new Error("Previous Loop unbond submission is uncertain. Reconcile its ledger receipt before retrying; no native unstake was sent.");
  }
  if (!updateId) {
    // Persist only a retry guard/receipt reference, never a signer or token.
    localStorage.setItem(key, "submission-uncertain");
    try {
      const receipt = await approveConnectedLoopStake(prepared.deployment, prepared.action);
      updateId = receipt.updateId;
      localStorage.setItem(key, updateId);
    } catch (error) {
      if (!(error instanceof LoopSubmissionUncertainError)) localStorage.removeItem(key);
      throw error;
    }
  }
  await confirmedLoopUnbondUpdate(position, updateId);
}

export async function createLoopStakingRequest(body: StakeInput,
  signNativeOwnership?: (message: string, expectedWallet: string) => Promise<string>,
): Promise<AdoptedIntent> {
  if (networkMode !== "testnet") throw new Error("This Loop staking flow is only available on the test deployment.");
  const chain = body.chain ?? "polygon";
  const cosmosFamily = ["cosmos", "celestia", "osmosis"].includes(chain);
  const nativeSignerRequired = cosmosFamily || chain === "sui" || chain === "solana" || chain === "aptos" || chain === "polkadot";
  if (!["polygon", "monad", "bnb", "sui", "solana", "aptos", "polkadot"].includes(chain) && !cosmosFamily) throw new Error("Real Loop/native wallet ownership integration is not enabled for this network yet.");
  if (nativeSignerRequired && !signNativeOwnership) throw new Error("A live native-wallet ownership signer is required; no substitute signer is available.");
  const context = JSON.stringify([body.delegator, normalizedNativeWallet(body.evmAddress), chain, body.validator, body.amountPol, body.stakeAccountAddress ?? null]);
  let attempt = pending.get(context);
  if (!attempt) {
    const prepared = await post<PreparedIntent>("/api/loop/staking/prepare", { ...body, chain, clientNetworkMode: networkMode }, body.delegator);
    if (prepared.deployment?.network !== stakingNetwork || prepared.action?.delegator !== body.delegator ||
        prepared.action.kind !== "create-request" ||
        normalizedNativeWallet(prepared.action.evmAddress) !== normalizedNativeWallet(body.evmAddress) ||
        (chain === "solana" && (prepared.stakeAccountAddress !== body.stakeAccountAddress || !/^[1-9]\d*$/.test(prepared.stakeRentLamports ?? ""))) ||
        parseEther(prepared.action.amount) !== parseEther(body.amountPol) || prepared.expiresAt <= Date.now()) {
      throw new Error("Backend prepared a mismatched or expired staking intent.");
    }
    const nativeSignature = nativeSignerRequired
      ? await signNativeOwnership!(prepared.nativeOwnershipMessage, body.evmAddress)
      : await signMessage(wagmiConfig, { account: body.evmAddress as Address, message: prepared.nativeOwnershipMessage });
    // Verify consent on the backend before creating any custom Canton contract.
    await post("/api/loop/staking/authorize", { intentId: prepared.intentId, delegator: body.delegator, nativeSignature }, body.delegator);
    attempt = { prepared, nativeSignature, submissionAttempted: false };
    pending.set(context, attempt);
  }
  if (attempt.prepared.expiresAt <= Date.now()) {
    throw new Error(`Loop intent ${attempt.prepared.intentId} expired. Reconcile/cancel its Canton request before starting another stake.`);
  }
  if (!attempt.submissionAttempted) {
    attempt.submissionAttempted = true;
    try {
      await approveConnectedLoopStake(attempt.prepared.deployment, attempt.prepared.action);
    } catch (error) {
      // No native stake on a failure. If the outcome is uncertain, only the
      // backend's independent ledger observation can allow us to continue.
      if (!(error instanceof LoopSubmissionUncertainError)) {
        // Pre-submit validation/session failures and an explicit failed Loop
        // receipt cannot be adopted. Permit a fresh prepare/consent/approval,
        // rather than leaving the next click stuck adopting a nonexistent
        // request. Never clear a newer attempt or an ambiguous submission.
        if (pending.get(context) === attempt) pending.delete(context);
        throw error;
      }
    }
  }
  const adopted = await post<AdoptedIntent>("/api/loop/staking/adopt", {
    intentId: attempt.prepared.intentId, delegator: body.delegator, nativeSignature: attempt.nativeSignature,
  }, body.delegator);
  if (adopted.ok !== true || adopted.delegator !== body.delegator || adopted.chain !== chain || !adopted.requestContractId ||
      (chain === "solana" && (adopted.stakeAccountAddress !== body.stakeAccountAddress || adopted.stakeRentLamports !== attempt.prepared.stakeRentLamports))) {
    throw new Error("Backend did not confirm the Loop request. No native stake should be sent.");
  }
  pending.delete(context);
  return adopted;
}
