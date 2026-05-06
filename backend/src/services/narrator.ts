/**
 * Round narrator — plain-English commentary for the CC visualizer.
 *
 * Default path is rule-based: branches on round-over-round delta (up /
 * down / flat), share band (low / typical / high), and milestones (first
 * round, lifetime CC thresholds). Each branch carries 2-3 phrasings
 * picked deterministically by round number, so the same round always
 * renders the same line — predictable demo timing, no API cost, no
 * external dependency, no failure modes at demo time.
 *
 * Anthropic path (Claude Haiku) is opt-in: when ANTHROPIC_API_KEY is
 * set the request goes through Claude with prompt caching on the system
 * prompt. The rule-based generator is still always available, so a
 * failed API call falls through to it instead of rendering empty.
 */

import { config } from "../config.js";
import { prisma } from "../db.js";

// --- Public types ---

export type NarratorSource = "anthropic" | "rule-based";

export interface NarratorContext {
  address: string;
  partyId: string | null;
  latestRoundNumber: number | null;
  totalUserCc: number;
  totalTreasuryCc: number;
  rewardEventCount: number;

  // Most recent completed round
  recentRoundCc: number;
  recentRoundShare: number | null;  // 0..1, null if no records exist

  // Round before that — used for trend detection
  previousRoundCc: number | null;
  previousRoundNumber: number | null;

  // Lifetime metrics + milestone flags (true only if crossed *this* round)
  lifetimeUserCc: number;
  crossedTen: boolean;
  crossedHundred: boolean;
  crossedThousand: boolean;

  source: NarratorSource;
}

export interface NarratorResponse {
  text: string;
  model: string;  // "claude-haiku-4-5" | "rule-based" | etc.
  context: NarratorContext;
}

// --- Anthropic system prompt (cached) ---

const SYSTEM_PROMPT = `You are the live round narrator for CantonStake — a self-custodial multi-chain staking app that earns Canton Coin (CC) on every staking action via CIP-0104 traffic-based rewards.

Your job: turn round-summary JSON into one or two short, plain-English sentences explaining what just happened to the user's CC balance and why. Audience: a retail staker watching the /rewards visualizer. They are NOT a Canton expert.

Rules:
- 1 to 2 sentences. Maximum 240 characters total.
- Use the user's own numbers (CC delta, % share, round number).
- Never invent numbers not in the input.
- Never use jargon like "sequencer", "mediator", "marker", "FA marker", "Daml", "AppRewardCoupon". Say "this round" or "your share" instead.
- The 75/25 split between user (75%) and treasury (25%) is on-ledger; you can mention "75% to you" if relevant.
- If recentRoundCc is 0, say something honest like "no CC this round — your stake is still earning native APY" rather than hyping.
- Output plain text only. No markdown, no quotes, no preamble.`;

// --- Anthropic API call ---

async function callAnthropic(
  contextJson: string
): Promise<{ text: string; model: string } | null> {
  if (!config.anthropicApiKey) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 160,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Round summary JSON:\n${contextJson}\n\nWrite the narrator line.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[narrator] Anthropic ${res.status}: ${body}`);
    return null;
  }

  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    model?: string;
  };
  const text = (json.content ?? [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join(" ")
    .trim();
  if (!text) return null;
  return { text, model: json.model ?? config.anthropicModel };
}

// --- Rule-based narrator -----------------------------------------------------
//
// Each branch returns 2-3 phrasings; we pick deterministically by round
// number so the visualizer is reproducible across reloads. Variant slots
// receive the round, CC delta, share %, etc. from the context — never
// invented numbers.

function pickVariant(variants: string[], seed: number): string {
  if (variants.length === 0) return "";
  const idx = ((seed % variants.length) + variants.length) % variants.length;
  return variants[idx]!;
}

function fmtCc(cc: number): string {
  // Trim trailing zeros so "4.70" → "4.7"; keep tabular alignment for ≥1.
  if (cc >= 100) return cc.toFixed(0);
  if (cc >= 10) return cc.toFixed(1);
  return cc.toFixed(2);
}

function fmtSharePct(share: number | null): string | null {
  if (share == null) return null;
  return (share * 100).toFixed(2);
}

function shareBand(share: number | null): "low" | "typical" | "high" | null {
  if (share == null) return null;
  if (share < 0.01) return "low";    // <1 %
  if (share > 0.1) return "high";    // >10 %
  return "typical";
}

function ruleBasedNarrator(ctx: NarratorContext): string {
  const round = ctx.latestRoundNumber ?? 0;
  const cc = ctx.recentRoundCc;
  const prev = ctx.previousRoundCc;
  const seed = round + Math.round(cc * 1000);

  // Milestone overrides — these take precedence over generic round commentary.
  if (ctx.crossedThousand) {
    return pickVariant(
      [
        `Milestone: 1,000 CC lifetime reached this round — round ${round} pushed your tally past the line.`,
        `You just crossed 1,000 CC lifetime. Round ${round}'s ${fmtCc(cc)} CC delta is the one that did it.`,
      ],
      seed,
    );
  }
  if (ctx.crossedHundred) {
    return pickVariant(
      [
        `100 CC lifetime cleared this round — ${fmtCc(cc)} CC in round ${round} pushed you over.`,
        `Round ${round} put you past 100 CC lifetime. 75 % lands in your wallet, 25 % in the treasury, on-ledger.`,
      ],
      seed,
    );
  }
  if (ctx.crossedTen) {
    return pickVariant(
      [
        `Round ${round} cleared your first 10 CC lifetime — early days, but the on-ledger 75/25 split is working.`,
        `You just crossed 10 CC lifetime. Round ${round}'s ${fmtCc(cc)} CC delta is part of a steady accrual stream.`,
      ],
      seed,
    );
  }

  // No CC ever yet
  if (ctx.rewardEventCount === 0) {
    return pickVariant(
      [
        `Your stake is earning native APY in the background, but CantonStake hasn't drawn a CC round for you yet — the visualizer above will tick when it does.`,
        `No CC rounds yet. Native staking APY accrues continuously off-chain; CC is a separate layer that fires once the app is featured.`,
      ],
      seed,
    );
  }

  // First-ever CC round
  if (ctx.rewardEventCount === 1 && cc > 0) {
    return pickVariant(
      [
        `First CC round just cleared — round ${round} attributed ${fmtCc(cc)} CC to your stake, with 75 % routed to your wallet on-ledger.`,
        `Round ${round} is your first CC distribution: ${fmtCc(cc)} CC, split 75/25 between your wallet and the app treasury.`,
      ],
      seed,
    );
  }

  // Zero CC this round (but the user has prior history)
  if (cc === 0) {
    return pickVariant(
      [
        `No CC attributed in round ${round} — your stake's still earning native APY in the background while CantonStake's traffic share rebalances.`,
        `Round ${round} returned 0 CC. Native staking yield continues; CC accrues only when the app's traffic share is non-zero in a given round.`,
        `Round ${round} was a quiet one — 0 CC attributed. Lifetime CC unchanged at ${fmtCc(ctx.lifetimeUserCc)}.`,
      ],
      seed,
    );
  }

  // CC > 0 — branch on trend + share band.
  const sharePct = fmtSharePct(ctx.recentRoundShare);
  const band = shareBand(ctx.recentRoundShare);

  // Trend: up / down / flat / no-prior
  type Trend = "up" | "down" | "flat" | "no-prior";
  const trend: Trend =
    prev == null
      ? "no-prior"
      : Math.abs(cc - prev) < 0.01
        ? "flat"
        : cc > prev
          ? "up"
          : "down";

  if (trend === "up" && prev != null) {
    const delta = cc - prev;
    return pickVariant(
      [
        `Round ${round}: ${fmtCc(cc)} CC, up ${fmtCc(delta)} from last round${sharePct ? ` — ${sharePct}% network share` : ""}.`,
        `Stake earned ${fmtCc(cc)} CC in round ${round}, an uptick from round ${ctx.previousRoundNumber}'s ${fmtCc(prev)}${sharePct ? ` (${sharePct}% share)` : ""}.`,
        sharePct
          ? `Round ${round} attributed ${fmtCc(cc)} CC — up from ${fmtCc(prev)}, on a ${sharePct}% share of CantonStake's network traffic.`
          : `Round ${round} attributed ${fmtCc(cc)} CC, up from ${fmtCc(prev)} the round before. 75% routes to your wallet on-ledger.`,
      ],
      seed,
    );
  }

  if (trend === "down" && prev != null) {
    const delta = prev - cc;
    return pickVariant(
      [
        `Round ${round}: ${fmtCc(cc)} CC, down ${fmtCc(delta)} from last round${sharePct ? ` (${sharePct}% share)` : ""}. The 75/25 split still routes 75% to your wallet.`,
        `Round ${round} settled at ${fmtCc(cc)} CC, a step below round ${ctx.previousRoundNumber}'s ${fmtCc(prev)}${sharePct ? ` — ${sharePct}% network share` : ""}.`,
        `${fmtCc(cc)} CC in round ${round}, down from ${fmtCc(prev)}. Total network traffic shifted between apps — your stake itself didn't change.`,
      ],
      seed,
    );
  }

  if (trend === "flat" && prev != null) {
    return pickVariant(
      [
        `Round ${round} held steady at ${fmtCc(cc)} CC${sharePct ? ` (${sharePct}% network share)` : ""}, in line with round ${ctx.previousRoundNumber}.`,
        sharePct
          ? `Round ${round} attributed ${fmtCc(cc)} CC — flat round-over-round, ${sharePct}% of CantonStake's network traffic.`
          : `${fmtCc(cc)} CC in round ${round}, matching the prior round. Steady accrual; 75% to your wallet on-ledger.`,
      ],
      seed,
    );
  }

  // no-prior trend (first comparison or gap in history) — band-aware phrasing.
  if (band === "high") {
    return pickVariant(
      [
        `Round ${round} attributed ${fmtCc(cc)} CC to your stake — a strong ${sharePct}% share of CantonStake's network traffic.`,
        `Round ${round}: ${fmtCc(cc)} CC. ${sharePct}% network share is on the high side — 75% routes to your wallet on-ledger.`,
      ],
      seed,
    );
  }
  if (band === "low") {
    return pickVariant(
      [
        `Round ${round} attributed ${fmtCc(cc)} CC. CantonStake's network share was a thin ${sharePct}% this round.`,
        `${fmtCc(cc)} CC in round ${round} on a ${sharePct}% network share — small, steady accrual.`,
      ],
      seed,
    );
  }

  // typical band, no prior — generic 2-variant phrasing.
  return pickVariant(
    [
      sharePct
        ? `Round ${round} attributed ${fmtCc(cc)} CC to your stake. That's a ${sharePct}% share of CantonStake's network traffic, with 75% routed to your wallet on-ledger.`
        : `Round ${round} attributed ${fmtCc(cc)} CC to your stake, with 75% routed to your wallet on-ledger via the 75/25 split.`,
      sharePct
        ? `${fmtCc(cc)} CC for round ${round}. CantonStake's share of network traffic was ${sharePct}%, split 75/25 between your wallet and the treasury.`
        : `${fmtCc(cc)} CC for round ${round}. The on-ledger split routes 75% to your Loop wallet, 25% to the app treasury.`,
    ],
    seed,
  );
}

// --- Public API --------------------------------------------------------------

export async function buildNarratorContext(
  evmAddress: string
): Promise<NarratorContext> {
  const lower = evmAddress.toLowerCase();
  const user = await prisma.user.findFirst({ where: { evmAddress: lower } });

  // Pull the two most recent completed rounds for trend detection.
  const recentRounds = await prisma.rewardRound.findMany({
    where: { status: "completed" },
    orderBy: { roundNumber: "desc" },
    take: 2,
  });
  const latestRound = recentRounds[0] ?? null;
  const priorRound = recentRounds[1] ?? null;

  let totalUserCc = 0;
  let totalTreasuryCc = 0;
  let rewardEventCount = 0;
  let recentRoundCc = 0;
  let previousRoundCc: number | null = null;
  let lifetimeUserCc = 0;
  let crossedTen = false;
  let crossedHundred = false;
  let crossedThousand = false;

  if (user) {
    const events = await prisma.rewardEvent.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    rewardEventCount = events.length;
    totalUserCc = events.reduce((s, e) => s + Number(e.userShare), 0);
    totalTreasuryCc = events.reduce((s, e) => s + Number(e.treasuryShare), 0);
    lifetimeUserCc = totalUserCc;

    if (latestRound) {
      const recent = events.filter((e) => e.roundId === latestRound.id);
      recentRoundCc = recent.reduce((s, e) => s + Number(e.ccAmount), 0);
    }
    if (priorRound) {
      const prior = events.filter((e) => e.roundId === priorRound.id);
      previousRoundCc = prior.reduce((s, e) => s + Number(e.ccAmount), 0);
    }

    // Milestone detection: did this round push the user across a threshold?
    const userShareThisRound =
      latestRound
        ? events
            .filter((e) => e.roundId === latestRound.id)
            .reduce((s, e) => s + Number(e.userShare), 0)
        : 0;
    const lifetimeBeforeThisRound = lifetimeUserCc - userShareThisRound;
    crossedTen =
      lifetimeBeforeThisRound < 10 && lifetimeUserCc >= 10;
    crossedHundred =
      lifetimeBeforeThisRound < 100 && lifetimeUserCc >= 100;
    crossedThousand =
      lifetimeBeforeThisRound < 1000 && lifetimeUserCc >= 1000;
  }

  let recentRoundShare: number | null = null;
  if (latestRound) {
    const records = await prisma.appActivityRecord.findMany({
      where: { roundNumber: latestRound.roundNumber },
    });
    const total = records.reduce((s, r) => s + r.trafficShare, 0);
    if (total > 0 && user) {
      const mine = records
        .filter((r) => r.party === user.cantonPartyId)
        .reduce((s, r) => s + r.trafficShare, 0);
      recentRoundShare = mine / total;
    }
  }

  return {
    address: lower,
    partyId: user?.cantonPartyId ?? null,
    latestRoundNumber: latestRound?.roundNumber ?? null,
    totalUserCc,
    totalTreasuryCc,
    rewardEventCount,
    recentRoundCc,
    recentRoundShare,
    previousRoundCc,
    previousRoundNumber: priorRound?.roundNumber ?? null,
    lifetimeUserCc,
    crossedTen,
    crossedHundred,
    crossedThousand,
    source: "rule-based",
  };
}

export async function narrate(
  evmAddress: string
): Promise<NarratorResponse> {
  const ctx = await buildNarratorContext(evmAddress);

  // Anthropic path is opt-in. When the key is set we try Claude first;
  // any failure falls through to the rule-based generator (never empty).
  if (config.anthropicApiKey) {
    const result = await callAnthropic(JSON.stringify(ctx));
    if (result) {
      return {
        text: result.text,
        model: result.model,
        context: { ...ctx, source: "anthropic" },
      };
    }
  }

  return {
    text: ruleBasedNarrator(ctx),
    model: "rule-based",
    context: ctx,
  };
}
