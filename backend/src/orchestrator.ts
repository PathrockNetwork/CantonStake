/**
 * Canton-side transition handlers for real Polygon PoS staking events.
 *
 * Flow (real ValidatorShare):
 *   1. User submits a StakingRequest on Canton (frontend -> JSON API).
 *   2. User approves the StakeManager to move POL, then calls
 *      buyVoucher() on THAT VALIDATOR'S ValidatorShare — on Ethereum L1
 *      (Sepolia for Amoy), not on Bor.
 *   3. The shared StakingInfo logger emits
 *      ShareMinted(validatorId, user, amount, tokens).
 *   4. `multichain-watcher.ts` catches it, matches it to the pending
 *      StakingRequest by EVM address + amount, resolves the per-validator
 *      ValidatorShare address, and exercises StakingRequest_Accept.
 *   5. User later calls sellVoucher_new() -> ShareBurnedWithId ->
 *      handlePolygonUnbondEvent exercises StakingPosition_ConfirmUnbond with
 *      the REAL checkpoint-derived ready time.
 *   6. Release only fires once the on-chain unbond record proves the
 *      delegator actually claimed — see startReleaseChecker.
 *
 */
import { formatEther, type Address } from "viem";
import { config } from "./config.js";
import { canton, TEMPLATES } from "./canton.js";
import { prisma } from "./db.js";
import { getUnbond } from "./services/validator-share.js";

/**
 * Returns the FeaturedAppRight CID to pass into Accept / ConfirmUnbond, or
 * `null` to skip legacy marker emission.
 *
 * CIP-0104 (live since ~Mar 2026) replaces FeaturedAppActivityMarker with
 * traffic-attribution from sequencer/mediator data. The legacy path is kept
 * only for backwards compat during the staged rollout: it fires only when
 * USE_LEGACY_MARKERS=true AND a structurally valid CID is configured.
 */
export function featuredRightCidForDaml(): string | null {
  if (config.networkMode === "testnet" && config.loopStakingEnabled) return null;
  if (!config.useLegacyMarkers) return null;
  if (!/^[a-f0-9]{2,512}$/.test(config.featuredAppRightCid) || config.featuredAppRightCid.length % 2 !== 0) {
    return null;
  }
  return config.featuredAppRightCid;
}

/**
 * CIP-0104 traffic-attribution beacon. Called after each Bond / Unbond /
 * Release transition. The orchestrator silently no-ops when
 * BENEFICIARY_SPLIT_CID is unset (keeps demos working without a configured
 * split contract).
 */
export async function recordStakeEvent(args: {
  positionContractId: string;
  eventKind: "Bond" | "Unbond" | "Release";
  txProof: { txHash: string; blockNumber: number; validatorShare: string } | null;
  occurredAt: string;
}): Promise<void> {
  if (config.networkMode === "testnet" && config.loopStakingEnabled) {
    // Per-user Loop beneficiary splits/CC claims are a later verified rollout.
    // Never reuse the shared hosted test-delegator split for a real Loop user.
    return;
  }
  if (!config.beneficiarySplitCid) {
    console.log(
      `  [RecordStake] skipped (BENEFICIARY_SPLIT_CID unset) kind=${args.eventKind}`
    );
    return;
  }
  try {
    const result = await canton.exerciseChoice({
      templateId: TEMPLATES.StakingPosition,
      contractId: args.positionContractId,
      choice: "StakingPosition_RecordStake",
      argument: {
        eventKind: args.eventKind,
        splitCid: config.beneficiarySplitCid,
        txProof: args.txProof,
        occurredAt: args.occurredAt,
      },
    });
    console.log(
      `  [RecordStake] kind=${args.eventKind} OnchainEvent created tx=${result.transactionId}`
    );
  } catch (err) {
    console.error(`  [RecordStake] failed kind=${args.eventKind}:`, err);
  }
}

/**
 * Extract the createdEvent.contractId from a submit-and-wait response.
 * The JSON Ledger API returns events as an array of CreatedEvent / ArchivedEvent objects.
 */
export function extractCreatedContractId(events: unknown[]): string | null {
  for (const ev of events) {
    const event = ev as Record<string, unknown>;
    const nestedEvent = event.event as Record<string, unknown> | undefined;
    const created =
      (event?.CreatedEvent as Record<string, unknown> | undefined) ??
      (event?.createdEvent as Record<string, unknown> | undefined) ??
      (nestedEvent?.CreatedEvent as Record<string, unknown> | undefined) ??
      (nestedEvent?.createdEvent as Record<string, unknown> | undefined);
    if (created?.contractId) return created.contractId as string;
    // Some API versions nest it differently
    const archived =
      (event?.ArchivedEvent as Record<string, unknown> | undefined) ??
      (event?.archivedEvent as Record<string, unknown> | undefined) ??
      (nestedEvent?.ArchivedEvent as Record<string, unknown> | undefined) ??
      (nestedEvent?.archivedEvent as Record<string, unknown> | undefined);
    if (archived?.contractId) continue; // archived, not created
  }
  // Try flat array format
  for (const ev of events) {
    if (typeof ev === "object" && ev !== null && "contractId" in ev) {
      return (ev as Record<string, unknown>).contractId as string;
    }
  }
  return null;
}

// --- Event handlers ---

/**
 * StakingPosition_ConfirmUnbond, driven by a real
 * `ShareBurnedWithId(validatorId, user, amount, tokens, nonce)` from the
 * StakingInfo logger.
 *
 * The contract records `unbonds_new[user][nonce] = (shares, withdrawEpoch)` and refuses to
 * pay out until
 *     withdrawEpoch + StakeManager.withdrawalDelay() <= StakeManager.epoch()
 * Checkpoints are not on a fixed schedule, so the wall-clock ready time we
 * write to Canton is an ESTIMATE derived from the measured checkpoint cadence
 * — the epoch numbers persisted alongside it are the authoritative condition,
 * and startReleaseChecker verifies against them rather than against the clock.
 */
export async function handlePolygonUnbondEvent(args: {
  user: Address;
  amount: bigint;
  shares: bigint;
  nonce: bigint;
  validatorId: number;
  validatorShare: Address;
  txHash: string;
  blockNumber: number;
}): Promise<void> {
  console.log(
    `[ShareBurnedWithId] validator=${args.validatorId} user=${args.user} ` +
      `amount=${formatEther(args.amount)} nonce=${args.nonce} tx=${args.txHash}`
  );

  const active = await canton.activeContracts(TEMPLATES.StakingPosition);
  const bonded = active.filter((p) => {
    const arg = p.argument as { evmAddress?: string; status?: string };
    return arg.evmAddress?.toLowerCase() === args.user.toLowerCase() && arg.status === "Bonded";
  });
  const mirrors = await prisma.stakingPosition.findMany({
    where: { contractId: { in: bonded.map((p) => p.contractId) }, chain: "polygon" },
  });
  const matching = bonded.filter((p) => mirrors.some((m) =>
    m.contractId === p.contractId &&
    m.validatorShare?.toLowerCase() === args.validatorShare.toLowerCase() &&
    m.amountShares === args.shares.toString(),
  ));
  if (matching.length !== 1) {
    console.warn(`  expected one Polygon bonded position for ${args.user} / ${args.validatorShare} / ${args.shares} shares; found ${matching.length}`);
    return;
  }
  const position = matching[0]!;

  try {
    const unbond = await getUnbond(args.validatorShare, args.user, args.nonce);
    const unbondingReadyAt = new Date(unbond.readyAtEstimate * 1_000);
    console.log(
      `  unbond nonce=${args.nonce} withdrawEpoch=${unbond.withdrawEpoch} ` +
        `claimableAtEpoch=${unbond.claimableAtEpoch} currentEpoch=${unbond.currentEpoch} ` +
        `(${unbond.epochsRemaining} checkpoints, ~${Math.round(unbond.etaSeconds / 3600)}h)`
    );

    const result = await canton.exerciseChoice({
      templateId: TEMPLATES.StakingPosition,
      contractId: position.contractId,
      choice: "StakingPosition_ConfirmUnbond",
      argument: {
        proof: {
          txHash: args.txHash,
          blockNumber: args.blockNumber,
          validatorShare: args.validatorShare,
        },
        unbondingReadyEpoch: unbond.readyAtEstimate,
        featuredRightCid: featuredRightCidForDaml(),
      },
    });
    console.log(`  -> unbonding confirmed. tx=${result.transactionId}`);

    const newPositionCid = extractCreatedContractId(result.events);
    if (!newPositionCid) throw new Error("Canton confirmed unbond but returned no new StakingPosition CID");
    const updated = await prisma.stakingPosition.updateMany({
      where: { contractId: position.contractId, chain: "polygon" },
      data: {
        contractId: newPositionCid,
        status: "Unbonding",
        evmTxHash: args.txHash,
        cantonTxId: result.transactionId,
        unbondingReadyAt,
        validatorShare: args.validatorShare,
        validatorId: args.validatorId,
        unbondNonce: args.nonce.toString(),
        unbondWithdrawEpoch: unbond.withdrawEpoch.toString(),
      },
    });
    if (updated.count !== 1) throw new Error("Polygon unbond position mirror was not updated");
    console.log(`  -> mirrored Unbonding position to Postgres`);

    // CIP-0104 traffic attribution beacon for the Unbond transition. Note
    // that ConfirmUnbond archives the old position CID and creates a new
    // one; RecordStake fires on the *new* CID extracted from the result.
    await recordStakeEvent({
      positionContractId: newPositionCid,
      eventKind: "Unbond",
      txProof: {
        txHash: args.txHash,
        blockNumber: args.blockNumber,
        validatorShare: args.validatorShare,
      },
      occurredAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`  failed to confirm unbond:`, err);
    throw err;
  }
}

/** Release only the nonce-specific position named by a settled EventsHub claim. */
export async function handlePolygonClaimEvent(args: {
  user: Address;
  amount: bigint;
  nonce: bigint;
  validatorId: number;
  validatorShare: Address;
  txHash: string;
  blockNumber: number;
}): Promise<void> {
  const active = await canton.activeContracts(TEMPLATES.StakingPosition);
  const unbonding = active.filter((p) => {
    const arg = p.argument as { evmAddress?: string; status?: string };
    return arg.evmAddress?.toLowerCase() === args.user.toLowerCase() && arg.status === "Unbonding";
  });
  const mirrors = await prisma.stakingPosition.findMany({
    where: { contractId: { in: unbonding.map((p) => p.contractId) }, chain: "polygon", status: "Unbonding" },
  });
  const matching = unbonding.filter((p) => mirrors.some((m) =>
    m.contractId === p.contractId &&
    m.validatorShare?.toLowerCase() === args.validatorShare.toLowerCase() &&
    m.validatorId === args.validatorId &&
    m.unbondNonce === args.nonce.toString(),
  ));
  if (matching.length !== 1) {
    console.warn(`[polygon-claim] expected one unbonding position for ${args.user} / nonce ${args.nonce}; found ${matching.length}`);
    return;
  }

  const position = matching[0]!;
  const proof = {
    txHash: args.txHash,
    blockNumber: args.blockNumber,
    validatorShare: args.validatorShare,
  };
  try {
    const result = await canton.exerciseChoice({
      templateId: TEMPLATES.StakingPosition,
      contractId: position.contractId,
      choice: "StakingPosition_Release",
      argument: { proof },
    });
    const newPositionCid = extractCreatedContractId(result.events);
    if (!newPositionCid) throw new Error("Canton released Polygon stake but returned no new position CID");
    const updated = await prisma.stakingPosition.updateMany({
      where: { contractId: position.contractId, chain: "polygon", status: "Unbonding" },
      data: {
        contractId: newPositionCid,
        status: "Released",
        evmTxHash: args.txHash,
        cantonTxId: result.transactionId,
        releasedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw new Error("Polygon claimed position mirror was not updated");
    await recordStakeEvent({
      positionContractId: newPositionCid,
      eventKind: "Release",
      txProof: proof,
      occurredAt: new Date().toISOString(),
    });
    console.log(`[polygon-claim] released ${position.contractId} via ${args.txHash}`);
  } catch (err) {
    console.error(`[polygon-claim] failed to release nonce ${args.nonce}:`, err);
    throw err;
  }
}

/** Releases are event-driven; no position is released by a wall-clock timer. */
export function startReleaseChecker(): void {
  console.log("[release-checker] waiting for verified chain claim/withdraw events");
}

export async function recordNativeSweep(args: {
  positionId: string;
  grossWei: bigint;
  feeWei: bigint;
  netWei: bigint;
  txHash: string;
}): Promise<string> {
  const position = await prisma.stakingPosition.findFirst({
    where: { OR: [{ id: args.positionId }, { contractId: args.positionId }] },
  });
  if (!position) throw new Error(`position not found for native sweep: ${args.positionId}`);

  const result = await canton.exerciseChoice({
    templateId: TEMPLATES.StakingPosition,
    contractId: position.contractId,
    choice: "StakingPosition_RecordNativeSweep",
    argument: {
      grossWei: args.grossWei.toString(),
      feeWei: args.feeWei.toString(),
      netWei: args.netWei.toString(),
      evmTxHash: args.txHash,
      sweptAt: new Date().toISOString(),
    },
  });
  return result.transactionId;
}
