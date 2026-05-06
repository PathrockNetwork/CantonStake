import type { ValidatorRow } from "@/lib/validators";
import { validatorsForChain as staticValidatorsForChain } from "@/lib/validators";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4001";

interface ScoreSnapshot {
  chain: string;
  fetchedAt: string;
  source: "live" | "cache" | "stub";
  validators: Array<{
    address: string;
    name: string;
    commissionPct: number;
    uptimePct: number;
    jailed: boolean;
    score: number;
    totalStaked: number;
    stakeSharePct: number;
  }>;
}

function isHexAddress(s: string): s is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function toRow(
  v: ScoreSnapshot["validators"][number],
  index: number,
): ValidatorRow | null {
  if (!isHexAddress(v.address)) return null;
  return {
    address: v.address,
    name: v.name || `Validator ${index + 1}`,
    apr: Math.max(0, 100 - v.commissionPct) / 12,
    uptime: v.uptimePct,
    commission: v.commissionPct,
    totalStaked: v.totalStaked > 0 ? `${(v.totalStaked / 1e6).toFixed(1)}M` : undefined,
    recommended: index === 0,
  };
}

export async function fetchScoredValidators(
  chain: string,
): Promise<{ rows: ValidatorRow[]; source: "live" | "cache" | "stub" | "fallback" }> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/validators/scores/${encodeURIComponent(chain)}`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`status ${res.status}`);
    const snap = (await res.json()) as ScoreSnapshot;

    const rows = snap.validators
      .filter((v) => !v.jailed)
      .sort((a, b) => b.score - a.score)
      .map((v, i) => toRow(v, i))
      .filter((row): row is ValidatorRow => row !== null);

    if (rows.length === 0) {
      return { rows: staticValidatorsForChain(chain), source: "fallback" };
    }
    return { rows, source: snap.source };
  } catch {
    return { rows: staticValidatorsForChain(chain), source: "fallback" };
  }
}
