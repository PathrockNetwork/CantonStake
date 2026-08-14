/**
 * Canton-side transition handlers for real Polygon PoS staking events.
 *
 * Flow (Phase 2 — real ValidatorShare, no mock):
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
 * The old MockValidatorShare poller that used to live here has been removed:
 * it watched a single global contract on Amoy, which is not how Polygon
 * staking works. The mock now only exists as a local E2E fixture
 * (`evm/contracts/MockValidatorShare.sol`) and is off the live path.
 */
import { formatEther, type Address } from "viem";
import { config } from "./config.js";
import { canton, TEMPLATES, type ActiveContract } from "./canton.js";
import { prisma } from "./db.js";
import { getUnbond } from "./services/validator-share.js";

/**
 * Returns the FeaturedAppRight CID to pass into Accept / ConfirmUnbond, or
 * `null` to skip legacy marker emission.
 *
 * CIP-0104 (live since ~Mar 2026) replaces FeaturedAppActivityMarker with
 * traffic-attribution from sequencer/mediator data. The legacy path is kept
 * only for backwards compat during the staged rollout: it fires only when
 * USE_LEGACY_MARKERS=true AND a real CID is configured (the `demo-stub`
 * sentinel always returns null).
 */
export function featuredRightCidForDaml(): string | null {
  if (!config.useLegacyMarkers) return null;
  if (!config.featuredAppRightCid || config.featuredAppRightCid === "demo-stub") {
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

// --- Matching logic ---

function normalizeDecimal(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n.toFixed(12).replace(/\.?0+$/, "");
}

/**
 * Find a pending StakingRequest for a given EVM address + amount.
 * We match by normalized amount (1:1) since the mock is 1:1 shares:POL.
 */
async function findPendingRequest(
  evmAddress: string,
  amountPol: bigint
): Promise<ActiveContract | undefined> {
  const requests = await canton.activeContracts(TEMPLATES.StakingRequest);
  const amountDecimal = normalizeDecimal(formatEther(amountPol));
  return requests.find((r) => {
    const arg = r.argument as { evmAddress?: string; amountPol?: string | number };
    return (
      arg.evmAddress?.toLowerCase() === evmAddress.toLowerCase() &&
      normalizeDecimal(arg.amountPol) === amountDecimal
    );
  });
}

/**
 * Find a Bonded StakingPosition for a given EVM address.
 */
async function findBondedPosition(
  evmAddress: string
): Promise<ActiveContract | undefined> {
  const positions = await canton.activeContracts(TEMPLATES.StakingPosition);
  return positions.find((p) => {
    const arg = p.argument as { evmAddress?: string; status?: string };
    return (
      arg.evmAddress?.toLowerCase() === evmAddress.toLowerCase() &&
      arg.status === "Bonded"
    );
  });
}

/**
 * Find an Unbonding StakingPosition for a given EVM address.
 */
async function findUnbondingPosition(
  evmAddress: string
): Promise<ActiveContract | undefined> {
  const positions = await canton.activeContracts(TEMPLATES.StakingPosition);
  return positions.find((p) => {
    const arg = p.argument as { evmAddress?: string; status?: string };
    return (
      arg.evmAddress?.toLowerCase() === evmAddress.toLowerCase() &&
      arg.status === "Unbonding"
    );
  });
}

// --- Postgres mirror helpers ---

async function upsertUserByEvm(evmAddress: string, partyId: string) {
  const normalizedAddress = evmAddress.toLowerCase();

  const existingByParty = await prisma.user.findUnique({
    where: { cantonPartyId: partyId },
  });
  if (existingByParty) {
    return prisma.user.update({
      where: { id: existingByParty.id },
      data: { evmAddress: normalizedAddress },
    });
  }

  const existingByAddress = await prisma.user.findUnique({
    where: { evmAddress: normalizedAddress },
  });
  if (existingByAddress) {
    return prisma.user.update({
      where: { id: existingByAddress.id },
      data: { cantonPartyId: partyId },
    });
  }

  return prisma.user.create({
    data: { evmAddress: normalizedAddress, cantonPartyId: partyId },
  });
}

export async function mirrorPosition(args: {
  contractId: string;
  evmAddress: string;
  partyId: string;
  amountPol: string;
  status: "Pending" | "Bonded" | "Unbonding" | "Released";
  evmTxHash?: string;
  cantonTxId?: string;
  unbondingReadyAt?: Date;
  // Polygon: which validator this position is delegated to. The
  // ValidatorShare address is per-validator, so it has to be persisted per
  // position — there is no single deployment-wide address to fall back on.
  chain?: string;
  validatorAddress?: string;
  validatorShare?: string;
  validatorId?: number;
  amountShares?: string;
  unbondNonce?: string;
  unbondWithdrawEpoch?: string;
}) {
  const user = await upsertUserByEvm(args.evmAddress, args.partyId);
  const validatorFields = {
    ...(args.chain !== undefined ? { chain: args.chain } : {}),
    ...(args.validatorAddress !== undefined
      ? { validatorAddress: args.validatorAddress.toLowerCase() }
      : {}),
    ...(args.validatorShare !== undefined
      ? { validatorShare: args.validatorShare }
      : {}),
    ...(args.validatorId !== undefined ? { validatorId: args.validatorId } : {}),
    ...(args.amountShares !== undefined ? { amountShares: args.amountShares } : {}),
    ...(args.unbondNonce !== undefined ? { unbondNonce: args.unbondNonce } : {}),
    ...(args.unbondWithdrawEpoch !== undefined
      ? { unbondWithdrawEpoch: args.unbondWithdrawEpoch }
      : {}),
  };

  return prisma.stakingPosition.upsert({
    where: { contractId: args.contractId },
    update: {
      status: args.status,
      cantonTxId: args.cantonTxId,
      evmTxHash: args.evmTxHash,
      unbondingReadyAt: args.unbondingReadyAt,
      ...validatorFields,
    },
    create: {
      contractId: args.contractId,
      userId: user.id,
      evmAddress: args.evmAddress.toLowerCase(),
      amountPol: args.amountPol,
      status: args.status,
      cantonTxId: args.cantonTxId,
      evmTxHash: args.evmTxHash,
      unbondingReadyAt: args.unbondingReadyAt,
      ...validatorFields,
    },
  });
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
 * The mock used to hardcode a 60-second unbonding period. The real contract
 * records `unbonds_new[user][nonce] = (shares, withdrawEpoch)` and refuses to
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

  const position = await findBondedPosition(args.user);
  if (!position) {
    console.warn(`  no matching Bonded StakingPosition for ${args.user}`);
    return;
  }

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

    const posArg = position.argument as {
      evmAddress?: string;
      delegator?: string;
      amountPol?: string;
    };
    await mirrorPosition({
      contractId: position.contractId,
      evmAddress: posArg.evmAddress || args.user,
      partyId: posArg.delegator || "unknown",
      amountPol: posArg.amountPol || formatEther(args.amount),
      status: "Unbonding",
      evmTxHash: args.txHash,
      cantonTxId: result.transactionId,
      unbondingReadyAt,
      chain: "polygon",
      validatorShare: args.validatorShare,
      validatorId: args.validatorId,
      unbondNonce: args.nonce.toString(),
      unbondWithdrawEpoch: unbond.withdrawEpoch.toString(),
    });
    console.log(`  -> mirrored Unbonding position to Postgres`);

    // CIP-0104 traffic attribution beacon for the Unbond transition. Note
    // that ConfirmUnbond archives the old position CID and creates a new
    // one; RecordStake fires on the *new* CID extracted from the result.
    const newPositionCid = extractCreatedContractId(result.events) || position.contractId;
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
  }
}

function readyAtMillis(value: string): number {
  if (/^\d+$/.test(value)) {
    const epoch = Number(value);
    return epoch < 1_000_000_000_000 ? epoch * 1_000 : epoch;
  }
  return new Date(value).getTime();
}

/**
 * Polling-based release checker.
 *
 * The mock version released a position as soon as a 60-second wall-clock
 * timer elapsed. On real Polygon that is wrong twice over: the delay is
 * checkpoint-based, and the stake is not actually returned until the
 * delegator themselves calls `unstakeClaimTokens_new`.
 *
 * So for a Polygon position (one that carries a resolved ValidatorShare and
 * an unbond nonce) we release only when the chain says so:
 *
 *   - `unbonds_new[user][nonce].shares == 0` means the record was deleted,
 *     i.e. the delegator's claim landed. That is the release signal.
 *   - Still-existing-but-not-yet-claimable records are skipped with the real
 *     remaining checkpoint count logged.
 *   - Existing-and-claimable records are also skipped: the funds are still
 *     on the ValidatorShare until the user claims. We never fabricate a
 *     Released position for stake the user still has to withdraw.
 *
 * Positions with no on-chain unbond metadata (non-Polygon chains, or
 * pre-migration rows) keep the old timestamp behaviour so this change stays
 * scoped to Polygon.
 */
export function startReleaseChecker(): void {
  setInterval(async () => {
    try {
      const positions = await canton.activeContracts(TEMPLATES.StakingPosition);
      const now = Date.now();
      for (const p of positions) {
        const arg = p.argument as {
          status?: string;
          unbondingReadyAt?: string;
          evmAddress?: string;
        };
        if (arg.status !== "Unbonding") continue;

        const mirrored = await prisma.stakingPosition.findUnique({
          where: { contractId: p.contractId },
        });

        // Daml's StakingPosition_Release takes a required EvmProof, so this
        // is always populated before the exercise.
        let releaseProof: {
          txHash: string;
          blockNumber: number;
          validatorShare: string;
        };

        if (mirrored?.validatorShare && mirrored.unbondNonce) {
          // Real Polygon position — ask the chain, not the clock.
          let unbond;
          try {
            unbond = await getUnbond(
              mirrored.validatorShare as Address,
              (arg.evmAddress ?? mirrored.evmAddress) as Address,
              BigInt(mirrored.unbondNonce)
            );
          } catch (err) {
            console.warn(
              `[release-checker] unbond read failed for ${p.contractId}:`,
              err
            );
            continue;
          }

          if (unbond.exists) {
            if (!unbond.claimable) {
              console.log(
                `[release-checker] ${arg.evmAddress} still unbonding: ` +
                  `${unbond.epochsRemaining} checkpoints to go ` +
                  `(epoch ${unbond.currentEpoch}/${unbond.claimableAtEpoch})`
              );
            } else {
              console.log(
                `[release-checker] ${arg.evmAddress} unbond is claimable ` +
                  `(epoch ${unbond.currentEpoch} >= ${unbond.claimableAtEpoch}) ` +
                  `— waiting for the delegator to call unstakeClaimTokens_new`
              );
            }
            continue;
          }

          releaseProof = {
            txHash: mirrored.evmTxHash ?? "claimed",
            blockNumber: 0,
            validatorShare: mirrored.validatorShare,
          };
        } else {
          // Non-Polygon / legacy position: fall back to the recorded ready
          // timestamp. Phase 3 replaces this for the other chains.
          if (!arg.unbondingReadyAt) continue;
          const readyAt = readyAtMillis(arg.unbondingReadyAt);
          if (!Number.isFinite(readyAt)) continue;
          if (now < readyAt) continue;
          releaseProof = {
            txHash: mirrored?.evmTxHash ?? "auto-release",
            blockNumber: 0,
            // Deliberately not an address: nothing on-chain was verified on
            // this path. Phase 3 replaces it with a real per-chain identifier.
            validatorShare: `${mirrored?.chain ?? "unknown"}::timer-release`,
          };
        }

        console.log(`[release-checker] releasing position for ${arg.evmAddress}`);
        try {
          const result = await canton.exerciseChoice({
            templateId: TEMPLATES.StakingPosition,
            contractId: p.contractId,
            choice: "StakingPosition_Release",
            argument: { proof: releaseProof },
          });

          // Mirror to Postgres: update position to Released
          const posArg = p.argument as { evmAddress?: string; delegator?: string; amountPol?: string };
          await mirrorPosition({
            contractId: p.contractId,
            evmAddress: posArg.evmAddress || "unknown",
            partyId: posArg.delegator || "unknown",
            amountPol: posArg.amountPol || "0",
            status: "Released",
            cantonTxId: result.transactionId,
          });
          console.log(`  -> mirrored Released position to Postgres`);

          // CIP-0104 traffic attribution beacon for the Release transition.
          const newReleasedCid = extractCreatedContractId(result.events) || p.contractId;
          await recordStakeEvent({
            positionContractId: newReleasedCid,
            eventKind: "Release",
            txProof: null,
            occurredAt: new Date().toISOString(),
          });
        } catch (err) {
          console.error(`  release failed:`, err);
        }
      }
    } catch (err) {
      console.error("[release-checker]", err);
    }
  }, 15_000);
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

// Re-exported for the HTTP API.
export { findPendingRequest, findBondedPosition, findUnbondingPosition };
