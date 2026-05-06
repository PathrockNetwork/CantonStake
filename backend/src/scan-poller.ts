/**
 * Scan API poller — CIP-0104 attribution data for the CC visualizer.
 *
 * Once per round-tick, this service fetches AppActivityRecords for the
 * current round and upserts them into Postgres keyed on
 * (roundNumber, party, eventId). The reward processor reads from this
 * table to compute per-user CC distribution.
 *
 * Two modes:
 *
 *   - REAL (SCAN_API_URL set, MOCK_REWARDS=false): GETs
 *     `${SCAN_API_URL}/v0/events?app_activity_records=true&round=<n>` and
 *     filters records belonging to `appProvider`. The CIP-0104 traffic
 *     share is taken from the response payload.
 *
 *   - MOCK (MOCK_REWARDS=true): generates a deterministic seeded record
 *     stream so offline demos have predictable round outputs. Seeded
 *     from MOCK_REWARDS_SEED so the same round number always produces
 *     the same CC stream (great for rehearsing demo timing).
 *
 * Idempotency: upserts on the (roundNumber, party, eventId) unique
 * constraint, so re-polling a round (or replaying a mock seed) doesn't
 * duplicate rows.
 */

import { config } from "./config.js";
import { prisma } from "./db.js";

// --- Types ---

export interface ScanActivityRecord {
  party: string;
  eventId: string;
  trafficShare: number;
  ccAttributed: number;
  onchainEventCid?: string;
}

// --- Deterministic mock seed (mulberry32 — small, fast, reproducible) ---

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Mock seeded record generation ---

async function generateMockRecords(
  roundNumber: number
): Promise<ScanActivityRecord[]> {
  const rng = mulberry32(config.mockRewardsSeed + roundNumber);

  // Pull the bonded positions so the mock attribution mirrors who is
  // actually staking. If there are no bonded positions yet, synthesise a
  // single demo party so the visualiser has something to render.
  const bonded = await prisma.stakingPosition.findMany({
    where: { status: "Bonded" },
    include: { user: true },
  });

  const parties = bonded.length > 0
    ? bonded.map((p) => p.user.cantonPartyId)
    : ["DemoStaker::mock"];

  // Total CC for this round drifts gently around 100 to keep the
  // visualiser interesting without looking erratic. Seed-deterministic.
  const totalRoundCc = 90 + Math.floor(rng() * 25);  // 90..115

  // Distribute round CC across parties weighted by random shares that
  // sum to 1.0. mulberry32 is uniform so we get a believable spread.
  const rawWeights = parties.map(() => 0.5 + rng());
  const weightSum = rawWeights.reduce((s, w) => s + w, 0);

  return parties.map((party, idx) => {
    const share = rawWeights[idx]! / weightSum;
    return {
      party,
      eventId: `mock-r${roundNumber}-p${idx}`,
      trafficShare: share,
      ccAttributed: totalRoundCc * share,
    };
  });
}

// --- Real Scan API call ---

async function fetchScanRecords(
  roundNumber: number
): Promise<ScanActivityRecord[]> {
  if (!config.scanApiUrl) return [];

  const url = new URL("/v0/events", config.scanApiUrl);
  url.searchParams.set("app_activity_records", "true");
  url.searchParams.set("round", String(roundNumber));

  const res = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Scan API ${url.toString()} returned ${res.status} ${res.statusText}`
    );
  }

  // CIP-0104 response shape (subject to Increment 1-4 evolution): an
  // `events` array of records with `party`, `event_id`, `traffic_share`,
  // and `cc_attributed`. Filtered server-side to this app's provider
  // party — but we filter client-side too in case the SV returns
  // network-wide records.
  const body = (await res.json()) as {
    events: Array<{
      party: string;
      event_id: string;
      traffic_share: number;
      cc_attributed: string | number;
      onchain_event_cid?: string;
      app_provider?: string;
    }>;
  };

  return (body.events ?? [])
    .filter(
      (ev) =>
        !ev.app_provider ||
        ev.app_provider === config.cantonAppProviderParty
    )
    .map((ev) => ({
      party: ev.party,
      eventId: ev.event_id,
      trafficShare: Number(ev.traffic_share),
      ccAttributed: Number(ev.cc_attributed),
      onchainEventCid: ev.onchain_event_cid,
    }));
}

// --- Persistence ---

async function persistRecords(
  roundNumber: number,
  records: ScanActivityRecord[],
  source: "scan" | "mock"
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
 * Pull (mock or real) activity records for a round and persist idempotently.
 * Returns the number of records written.
 */
export async function ingestRoundRecords(roundNumber: number): Promise<{
  source: "scan" | "mock" | "skipped";
  records: number;
}> {
  if (config.mockRewards) {
    const records = await generateMockRecords(roundNumber);
    const written = await persistRecords(roundNumber, records, "mock");
    return { source: "mock", records: written };
  }

  if (!config.scanApiUrl) {
    return { source: "skipped", records: 0 };
  }

  try {
    const records = await fetchScanRecords(roundNumber);
    const written = await persistRecords(roundNumber, records, "scan");
    return { source: "scan", records: written };
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
