/**
 * Tax export — Koinly-compatible CSV of staking positions, native reward
 * sweeps, and CC distribution events for a given EVM address.
 *
 * Schema reference: https://help.koinly.io/en/articles/3662999-how-to-create-a-custom-csv-file-with-your-data
 *
 * Columns (in order Koinly expects):
 *
 *   Date            UTC timestamp, "YYYY-MM-DD HH:MM:SS"
 *   Sent Amount
 *   Sent Currency
 *   Received Amount
 *   Received Currency
 *   Fee Amount
 *   Fee Currency
 *   Net Worth Amount   (USD value at event time — left blank; Koinly resolves it)
 *   Net Worth Currency (USD)
 *   Label              Koinly category, e.g. "staking", "reward", "cost"
 *   Description
 *   TxHash             EVM tx hash when available, Canton txId otherwise
 *
 * Mapping:
 *
 *   StakingPosition.bondedAt        → Sent: amountPol POL, Label "staking"
 *   StakingPosition.unbondingStartedAt → Received: amountPol POL, Label "staking"
 *                                       (the unbond returns the principal)
 *   RewardSweep.userPayoutWei       → Received: userPayoutPol POL,  Label "reward"
 *   RewardSweep.protocolFeeWei      → Sent:    protocolFeePol POL, Label "cost"
 *   RewardEvent (per round)         → Received: userShare CC,       Label "reward"
 *
 * The 25 % treasury share of CC is intentionally NOT included — that's
 * the app's revenue, not the user's taxable income.
 */

import { prisma } from "../db.js";

const POL_PER_WEI = 1e-18;

interface KoinlyRow {
  date: string;
  sentAmount: string;
  sentCurrency: string;
  receivedAmount: string;
  receivedCurrency: string;
  feeAmount: string;
  feeCurrency: string;
  netWorthAmount: string;
  netWorthCurrency: string;
  label: string;
  description: string;
  txHash: string;
}

const HEADERS: (keyof KoinlyRow)[] = [
  "date",
  "sentAmount",
  "sentCurrency",
  "receivedAmount",
  "receivedCurrency",
  "feeAmount",
  "feeCurrency",
  "netWorthAmount",
  "netWorthCurrency",
  "label",
  "description",
  "txHash",
];

const HEADER_LINE =
  "Date,Sent Amount,Sent Currency,Received Amount,Received Currency," +
  "Fee Amount,Fee Currency,Net Worth Amount,Net Worth Currency," +
  "Label,Description,TxHash";

function emptyRow(): KoinlyRow {
  return {
    date: "",
    sentAmount: "",
    sentCurrency: "",
    receivedAmount: "",
    receivedCurrency: "",
    feeAmount: "",
    feeCurrency: "",
    netWorthAmount: "",
    netWorthCurrency: "USD",
    label: "",
    description: "",
    txHash: "",
  };
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  // Koinly accepts "YYYY-MM-DD HH:MM:SS" (UTC).
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function toCsvLine(row: KoinlyRow): string {
  return HEADERS.map((k) => csvEscape(row[k])).join(",");
}

function weiToPol(value: string | null | undefined): number {
  if (!value) return 0;
  // Wei is potentially huge; round-trip through bigint to avoid precision loss.
  try {
    return Number(BigInt(value)) * POL_PER_WEI;
  } catch {
    return Number(value) * POL_PER_WEI;
  }
}

/**
 * Build a Koinly-compatible CSV string for the given EVM address.
 * Returns the CSV text (with header row) sorted by event date ascending.
 */
export async function buildKoinlyCsv(evmAddress: string): Promise<string> {
  const lower = evmAddress.toLowerCase();
  const user = await prisma.user.findFirst({ where: { evmAddress: lower } });

  if (!user) {
    return HEADER_LINE + "\n";
  }

  const [positions, sweeps, rewardEvents] = await Promise.all([
    prisma.stakingPosition.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.rewardSweep.findMany({
      where: { userId: user.id },
      orderBy: { sweptAt: "asc" },
    }),
    prisma.rewardEvent.findMany({
      where: { userId: user.id },
      include: { round: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const rows: { ts: number; row: KoinlyRow }[] = [];

  // 1. Bond events (POL leaves the wallet for staking).
  for (const p of positions) {
    const bondedAt = p.createdAt;
    const row = emptyRow();
    row.date = fmtDate(bondedAt);
    row.sentAmount = p.amountPol;
    row.sentCurrency = "POL";
    row.label = "staking";
    row.description = `Bond ${p.amountPol} POL via CantonStake (validator share)`;
    row.txHash = p.evmTxHash ?? p.cantonTxId ?? "";
    rows.push({ ts: bondedAt.getTime(), row });

    // 2. Unbond events (POL returns to the wallet).
    if (p.unbondingStartedAt || p.releasedAt) {
      const unbondAt = p.releasedAt ?? p.unbondingStartedAt!;
      const ur = emptyRow();
      ur.date = fmtDate(unbondAt);
      ur.receivedAmount = p.amountPol;
      ur.receivedCurrency = "POL";
      ur.label = "staking";
      ur.description = `Unbond ${p.amountPol} POL via CantonStake`;
      ur.txHash = p.evmTxHash ?? p.cantonTxId ?? "";
      rows.push({ ts: new Date(unbondAt).getTime(), row: ur });
    }
  }

  // 3. Native reward sweeps: user payout = "reward", protocol fee = "cost".
  for (const sweep of sweeps) {
    const userPayout = weiToPol(sweep.userPayoutWei);
    const fee = weiToPol(sweep.protocolFeeWei);
    const ts = sweep.sweptAt.getTime();

    if (userPayout > 0) {
      const row = emptyRow();
      row.date = fmtDate(sweep.sweptAt);
      row.receivedAmount = userPayout.toFixed(12);
      row.receivedCurrency = "POL";
      row.label = "reward";
      row.description = `Polygon native staking reward (post-fee) sweep ${sweep.id}`;
      row.txHash = sweep.evmTxHash ?? "";
      rows.push({ ts, row });
    }
    if (fee > 0) {
      const row = emptyRow();
      row.date = fmtDate(sweep.sweptAt);
      row.sentAmount = fee.toFixed(12);
      row.sentCurrency = "POL";
      row.label = "cost";
      row.description = `CantonStake protocol fee (${sweep.protocolFeeBps} bps)`;
      row.txHash = sweep.evmTxHash ?? "";
      rows.push({ ts, row });
    }
  }

  // 4. Per-round CC reward events (user share only — treasury is app revenue).
  for (const ev of rewardEvents) {
    const userShare = Number(ev.userShare);
    if (userShare <= 0) continue;
    const ts = ev.createdAt.getTime();
    const row = emptyRow();
    row.date = fmtDate(ev.createdAt);
    row.receivedAmount = userShare.toFixed(8);
    row.receivedCurrency = "CC";
    row.label = "reward";
    row.description = `Canton Coin reward · round #${ev.round.roundNumber}`;
    row.txHash = ev.cantonTxId ?? "";
    rows.push({ ts, row });
  }

  rows.sort((a, b) => a.ts - b.ts);

  const lines = [HEADER_LINE, ...rows.map(({ row }) => toCsvLine(row))];
  return lines.join("\n") + "\n";
}
