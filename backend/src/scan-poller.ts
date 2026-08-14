/**
 * Scan API poller — CIP-0104 attribution data for the CC visualizer.
 *
 * Once per round-tick, this service fetches AppActivityRecords from the
 * Canton network Scan and upserts them into Postgres keyed on
 * (roundNumber, party, eventId). The reward processor reads from this
 * table to compute per-user CC distribution.
 *
 * Endpoint shape (verified against the LocalNet Scan, 2026-08-14):
 *   POST ${SCAN_API_URL}/v0/events  body {"page_size": N}
 *   → { events: [{ update: {update_id, record_time, ...},
 *                  traffic_summary: {...},
 *                  app_activity_records: {round_number,
 *                                         records: [{party, weight}]} | null }] }
 *
 * Network rounds are longer than this app's 10-minute reward rounds, so
 * each tick ingests the most recent network round whose records mention
 * this app's provider party, attributed to the current app round. A
 * network round is ingested at most once (Redis marker), and the
 * (roundNumber, party, eventId) unique constraint makes re-polling
 * idempotent.
 *
 * The party set and per-party weights are real sequencer-derived data.
 * The LocalNet Scan does not publish a per-round CC mint pool, so the
 * gross CC distributed per round is a configured constant
 * (SCAN_ROUND_CC_POOL) — labelled, not fabricated traffic.
 */

import IORedis from "ioredis";
import { config } from "./config.js";
import { prisma } from "./db.js";

const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

// --- Types ---

export interface ScanActivityRecord {
  party: string;
  eventId: string;
  trafficShare: number;
  ccAttributed: number;
  onchainEventCid?: string;
}

// --- Real Scan API call ---

/** Raw /v0/events entry — only the fields the poller reads. */
interface ScanEvent {
  update: { update_id: string };
  app_activity_records: {
    round_number: number;
    records: Array<{ party: string; weight: number | string }>;
  } | null;
}

/**
 * Fetch all Scan events and return the AppActivityRecord set for the most
 * recent network round that has records mentioning our provider party.
 * Returns null when no network round qualifies (honest empty attribution).
 */
async function fetchScanRecords(): Promise<{
  networkRound: number;
  records: ScanActivityRecord[];
} | null> {
  if (!config.scanApiUrl) return null;

  const res = await fetch(`${config.scanApiUrl.replace(/\/$/, "")}/v0/events`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ page_size: config.scanPageSize }),
  });
  if (!res.ok) {
    throw new Error(`Scan API /v0/events returned ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as { events?: ScanEvent[] };
  const events = body.events ?? [];

  // Group record sets by network round, newest first. Records are
  // attributed to the app whose FeaturedAppRight keyed the wallet
  // transfer that generated them — filter to our provider party, keeping
  // the rest of the round's weighting intact so shares still sum to 1.
  const byRound = new Map<
    number,
    Array<{ party: string; weight: number; updateId: string }>
  >();
  for (const ev of events) {
    // Some Scan events carry no update payload (e.g. record-only entries)
    // — they cannot originate attribution records.
    if (!ev?.update?.update_id) continue;
    const aar = ev.app_activity_records;
    if (!aar) continue;
    const list = byRound.get(aar.round_number) ?? [];
    for (const rec of aar.records) {
      list.push({
        party: rec.party,
        weight: Number(rec.weight),
        updateId: ev.update.update_id,
      });
    }
    byRound.set(aar.round_number, list);
  }

  const rounds = [...byRound.keys()].sort((a, b) => b - a);
  for (const networkRound of rounds) {
    const roundRecords = byRound.get(networkRound) ?? [];
    const ours = roundRecords.filter(
      (r) => r.party === config.cantonAppProviderParty
    );
    if (ours.length === 0) continue;

    // Traffic share is our weight relative to the whole network round's
    // weight — the sequencer-derived CIP-0104 attribution share.
    const totalWeight = roundRecords.reduce((s, r) => s + r.weight, 0);
    const pool = config.scanRoundCcPool;
    return {
      networkRound,
      records: ours.map((r) => ({
        party: r.party,
        eventId: `net${networkRound}:${r.updateId}`,
        trafficShare: totalWeight > 0 ? r.weight / totalWeight : 0,
        ccAttributed: pool * (totalWeight > 0 ? r.weight / totalWeight : 0),
      })),
    };
  }

  return null;
}

// --- Persistence ---

async function persistRecords(
  roundNumber: number,
  records: ScanActivityRecord[],
  source: "scan"
): Promise<number> {
  let written = 0;
  for (const rec of records) {
    await prisma.appActivityRecord.upsert({
      where: {
        roundNumber_party_eventId: {
          roundNumber,
          party: rec.party,
          eventId: rec.eventId,
        },
      },
      update: {
        trafficShare: rec.trafficShare,
        ccAttributed: rec.ccAttributed.toFixed(8),
        onchainEventCid: rec.onchainEventCid,
        source,
      },
      create: {
        roundNumber,
        party: rec.party,
        eventId: rec.eventId,
        trafficShare: rec.trafficShare,
        ccAttributed: rec.ccAttributed.toFixed(8),
        onchainEventCid: rec.onchainEventCid,
        source,
      },
    });
    written += 1;
  }
  return written;
}

/**
 * Pull real activity records for an app reward round and persist
 * idempotently. Each network round is attributed to at most one app
 * round (Redis marker); within a round the (roundNumber, party, eventId)
 * unique constraint makes re-polls a no-op. Returns the number of
 * records written.
 */
export async function ingestRoundRecords(roundNumber: number): Promise<{
  source: "scan" | "skipped";
  networkRound?: number;
  records: number;
}> {
  if (!config.scanApiUrl) {
    return { source: "skipped", records: 0 };
  }

  try {
    const fetched = await fetchScanRecords();
    if (!fetched) {
      return { source: "scan", records: 0 };
    }

    // One-shot ingestion per network round: network rounds outlive the
    // 10-minute app tick, so without this marker every tick would
    // re-attribute the same network round's CC to a fresh app round.
    const markerKey = `scan:ingested-net-round:${fetched.networkRound}`;
    const seen = await redis.set(markerKey, String(roundNumber), "EX", 60 * 60 * 24 * 30, "NX");
    if (seen !== "OK") {
      return { source: "skipped", networkRound: fetched.networkRound, records: 0 };
    }

    const written = await persistRecords(roundNumber, fetched.records, "scan");
    console.log(
      `[scan-poller] app round #${roundNumber} ← network round ${fetched.networkRound}: ${written} record(s)`
    );
    return { source: "scan", networkRound: fetched.networkRound, records: written };
  } catch (err) {
    console.error(`[scan-poller] round #${roundNumber} fetch failed:`, err);
    return { source: "scan", records: 0 };
  }
}

/** Read the persisted records for a round (used by the reward processor). */
export async function recordsForRound(roundNumber: number) {
  return prisma.appActivityRecord.findMany({
    where: { roundNumber },
    orderBy: { party: "asc" },
  });
}
