/**
 * Slashing monitor — diffs validator-scoring snapshots round-over-round
 * and emits alerts for state changes that matter to delegators.
 *
 * Triggers:
 *   - validator.jailed     : went from active to jailed (highest urgency)
 *   - validator.unjailed   : returned to the active set
 *   - validator.score_drop : score dropped by ≥ ALERT_SCORE_DROP_THRESHOLD
 *
 * Idempotency: each emitted alert carries a deterministic dedupKey of
 * the form `<chain>:<validatorAddress>:<kind>:<asOfHourEpoch>`. Re-running
 * the monitor against the same snapshot pair is a no-op — the AlertEvent
 * unique index on dedupKey absorbs the duplicate.
 *
 * Scope: alerts fan out to ALL enabled NotificationChannels (no per-
 * validator subscriptions in v1). When a user has no channels, the
 * AlertEvent still persists for audit.
 */

import { config } from "../config.js";
import { emitAlert } from "./notifications.js";
import type {
  ChainScoreSnapshot,
  ScoredValidator,
  SupportedChain,
} from "./validator-scoring.js";

// In-memory snapshot cache: previous run's per-chain validator state,
// keyed on chain. Survives within the process; lost on restart, which
// is fine because dedupKey prevents duplicate alerts on rebuild.
const previousByChain = new Map<SupportedChain, Map<string, ScoredValidator>>();

function indexValidators(
  snapshot: ChainScoreSnapshot
): Map<string, ScoredValidator> {
  return new Map(snapshot.validators.map((v) => [v.address, v]));
}

function hourlyDedupSlot(): number {
  return Math.floor(Date.now() / (60 * 60 * 1000));
}

/**
 * Diff `current` against the previous snapshot for the same chain and
 * emit alerts for jailed flips + score drops above threshold. Updates
 * the in-memory previous-snapshot cache so subsequent calls have the
 * right baseline.
 */
export async function diffAndAlert(current: ChainScoreSnapshot): Promise<void> {
  if (config.alertsDisabled) return;
  if (current.source === "stub") return; // No reliable data — don't alert.

  const prev = previousByChain.get(current.chain);
  const next = indexValidators(current);

  // Update the cache up-front so a later call has the latest state, even
  // if alert emission throws halfway through.
  previousByChain.set(current.chain, next);

  if (!prev) {
    // First snapshot for this chain: no diff to compute, nothing to alert.
    console.log(
      `[slashing-monitor] baseline established for ${current.chain} (${next.size} validators)`
    );
    return;
  }

  const slot = hourlyDedupSlot();
  let alertCount = 0;

  for (const [address, val] of next) {
    const before = prev.get(address);
    if (!before) continue; // New validator — nothing to compare against.

    // 1. Jailed transitions
    if (!before.jailed && val.jailed) {
      await emitAlert({
        kind: "validator.jailed",
        chain: current.chain,
        validatorAddress: address,
        dedupKey: `${current.chain}:${address}:jailed:${slot}`,
        payload: {
          chain: current.chain,
          validatorAddress: address,
          name: val.name,
          score: val.score,
          previousScore: before.score,
          commissionPct: val.commissionPct,
        },
      });
      alertCount++;
      continue; // skip score-drop alert for the same validator this run
    }
    if (before.jailed && !val.jailed) {
      await emitAlert({
        kind: "validator.unjailed",
        chain: current.chain,
        validatorAddress: address,
        dedupKey: `${current.chain}:${address}:unjailed:${slot}`,
        payload: {
          chain: current.chain,
          validatorAddress: address,
          name: val.name,
          score: val.score,
          previousScore: before.score,
        },
      });
      alertCount++;
      continue;
    }

    // 2. Score drop above threshold (when not jailed-related)
    const delta = val.score - before.score;
    if (delta <= -config.alertScoreDropThreshold) {
      await emitAlert({
        kind: "validator.score_drop",
        chain: current.chain,
        validatorAddress: address,
        dedupKey: `${current.chain}:${address}:score_drop:${slot}`,
        payload: {
          chain: current.chain,
          validatorAddress: address,
          name: val.name,
          score: val.score,
          previousScore: before.score,
          delta,
          reason: deriveDropReason(before, val),
        },
      });
      alertCount++;
    }
  }

  if (alertCount > 0) {
    console.log(
      `[slashing-monitor] ${current.chain}: emitted ${alertCount} alert(s)`
    );
  }
}

function deriveDropReason(
  before: ScoredValidator,
  after: ScoredValidator
): string {
  if (after.commissionPct > before.commissionPct + 1) {
    return `commission raised from ${before.commissionPct}% to ${after.commissionPct}%`;
  }
  if (after.uptimePct < before.uptimePct - 1) {
    return `uptime fell from ${before.uptimePct.toFixed(2)}% to ${after.uptimePct.toFixed(2)}%`;
  }
  if (after.slashCount > before.slashCount) {
    return `${after.slashCount - before.slashCount} new slashing event(s)`;
  }
  if (after.stakeSharePct > before.stakeSharePct + 1) {
    return `stake concentration up from ${before.stakeSharePct.toFixed(2)}% to ${after.stakeSharePct.toFixed(2)}%`;
  }
  return "composite of multiple factors";
}
