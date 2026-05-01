/**
 * Event orchestrator: polls MockValidatorShare events on Amoy and
 * translates them into Canton Daml choices.
 *
 * Flow:
 *   1. User submits a StakingRequest on Canton (frontend -> JSON API).
 *   2. User calls buyVoucher() on Amoy from their MetaMask.
 *   3. MockValidatorShare emits ShareMinted.
 *   4. This orchestrator catches ShareMinted, matches it to the pending
 *      StakingRequest by EVM address + amount, and exercises
 *      StakingRequest_Accept on Canton -> Daml emits FeaturedAppActivityMarker.
 *   5. User later calls sellVoucher_new() -> ShareBurnedWithId ->
 *      orchestrator exercises StakingPosition_ConfirmUnbond.
 *   6. After unbonding period, user calls unstakeClaimTokens_new() ->
 *      orchestrator exercises StakingPosition_Release.
 */
import {
  createPublicClient,
  http,
  parseAbiItem,
  formatEther,
  type Address,
  type Log,
} from "viem";
import { polygonAmoy } from "viem/chains";
import { config } from "./config.js";
import { canton, TEMPLATES, type ActiveContract } from "./canton.js";
import { prisma } from "./db.js";

// --- Viem client ---

const client = createPublicClient({
  chain: polygonAmoy,
  transport: http(config.amoyRpcUrl),
});

// --- Event ABIs (must match MockValidatorShare.sol) ---

const shareMintedAbi = parseAbiItem(
  "event ShareMinted(address indexed user, uint256 amount, uint256 tokens)"
);

const shareBurnedAbi = parseAbiItem(
  "event ShareBurnedWithId(address indexed user, uint256 amount, uint256 tokens, uint256 nonce)"
);

const EVENT_POLL_MS = 5_000;
const INITIAL_LOOKBACK_BLOCKS = 50n;
const MAX_BLOCK_RANGE = 50n;
const UNBONDING_PERIOD_SECONDS = 60;

function featuredRightCidForDaml(): string | null {
  if (!config.featuredAppRightCid || config.featuredAppRightCid === "demo-stub") {
    return null;
  }
  return config.featuredAppRightCid;
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

async function mirrorPosition(args: {
  contractId: string;
  evmAddress: string;
  partyId: string;
  amountPol: string;
  status: "Pending" | "Bonded" | "Unbonding" | "Released";
  evmTxHash?: string;
  cantonTxId?: string;
  unbondingReadyAt?: Date;
}) {
  const user = await upsertUserByEvm(args.evmAddress, args.partyId);
  return prisma.stakingPosition.upsert({
    where: { contractId: args.contractId },
    update: {
      status: args.status,
      cantonTxId: args.cantonTxId,
      evmTxHash: args.evmTxHash,
      unbondingReadyAt: args.unbondingReadyAt,
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
    },
  });
}

/**
 * Extract the createdEvent.contractId from a submit-and-wait response.
 * The JSON Ledger API returns events as an array of CreatedEvent / ArchivedEvent objects.
 */
function extractCreatedContractId(events: unknown[]): string | null {
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

async function handleShareMinted(log: Log) {
  const { args, transactionHash, blockNumber } = log as unknown as {
    args: { user: Address; amount: bigint; tokens: bigint };
    transactionHash: string;
    blockNumber: bigint;
  };

  console.log(
    `[ShareMinted] user=${args.user} amount=${formatEther(args.amount)} tx=${transactionHash}`
  );

  const req = await findPendingRequest(args.user, args.amount);
  if (!req) {
    console.warn(
      `  no matching pending StakingRequest for ${args.user} / ${formatEther(args.amount)}`
    );
    return;
  }

  try {
    const result = await canton.exerciseChoice({
      templateId: TEMPLATES.StakingRequest,
      contractId: req.contractId,
      choice: "StakingRequest_Accept",
      argument: {
        proof: {
          txHash: transactionHash,
          blockNumber: Number(blockNumber),
          validatorShare: config.mockValidatorShare,
        },
        featuredRightCid: featuredRightCidForDaml(),
      },
    });
    console.log(`  -> accepted. tx=${result.transactionId}`);

    // Mirror to Postgres: the Accept choice archives StakingRequest and
    // creates a new StakingPosition. Extract the new contractId from events.
    const reqArg = req.argument as { evmAddress?: string; amountPol?: string; delegator?: string };
    const newContractId = extractCreatedContractId(result.events) || `pending-${Date.now()}`;

    await mirrorPosition({
      contractId: newContractId,
      evmAddress: reqArg.evmAddress || args.user,
      partyId: reqArg.delegator || "unknown",
      amountPol: reqArg.amountPol || formatEther(args.amount),
      status: "Bonded",
      evmTxHash: transactionHash,
      cantonTxId: result.transactionId,
    });
    console.log(`  -> mirrored Bonded position to Postgres (contractId=${newContractId.slice(0, 16)}…)`);
  } catch (err) {
    console.error(`  failed to accept StakingRequest:`, err);
  }
}

async function handleShareBurned(log: Log) {
  const { args, transactionHash, blockNumber } = log as unknown as {
    args: { user: Address; amount: bigint; tokens: bigint; nonce: bigint };
    transactionHash: string;
    blockNumber: bigint;
  };

  console.log(
    `[ShareBurned] user=${args.user} amount=${formatEther(args.amount)} nonce=${args.nonce} tx=${transactionHash}`
  );

  const position = await findBondedPosition(args.user);
  if (!position) {
    console.warn(`  no matching Bonded StakingPosition for ${args.user}`);
    return;
  }

  // 60 seconds = unbondingPeriodSeconds in the mock contract.
  // On production this would be 21 days.
  try {
    const unbondingReadyAt = new Date(Date.now() + UNBONDING_PERIOD_SECONDS * 1_000);
    const unbondingReadyEpoch = Math.floor(unbondingReadyAt.getTime() / 1_000);
    const result = await canton.exerciseChoice({
      templateId: TEMPLATES.StakingPosition,
      contractId: position.contractId,
      choice: "StakingPosition_ConfirmUnbond",
      argument: {
        proof: {
          txHash: transactionHash,
          blockNumber: Number(blockNumber),
          validatorShare: config.mockValidatorShare,
        },
        unbondingReadyEpoch,
        featuredRightCid: featuredRightCidForDaml(),
      },
    });
    console.log(`  -> unbonding confirmed. tx=${result.transactionId}`);

    // Mirror to Postgres: update position to Unbonding
    const posArg = position.argument as { evmAddress?: string; delegator?: string; amountPol?: string };
    await mirrorPosition({
      contractId: position.contractId,
      evmAddress: posArg.evmAddress || args.user,
      partyId: posArg.delegator || "unknown",
      amountPol: posArg.amountPol || formatEther(args.amount),
      status: "Unbonding",
      evmTxHash: transactionHash,
      cantonTxId: result.transactionId,
      unbondingReadyAt,
    });
    console.log(`  -> mirrored Unbonding position to Postgres`);
  } catch (err) {
    console.error(`  failed to confirm unbond:`, err);
  }
}

// --- Event polling ---

async function getLogsBatched(args: {
  address: Address;
  event: typeof shareMintedAbi | typeof shareBurnedAbi;
  fromBlock: bigint;
  toBlock: bigint;
}) {
  const allLogs: Log[] = [];
  for (let from = args.fromBlock; from <= args.toBlock; from += MAX_BLOCK_RANGE + 1n) {
    const to = from + MAX_BLOCK_RANGE > args.toBlock ? args.toBlock : from + MAX_BLOCK_RANGE;
    const logs = await client.getLogs({
      address: args.address,
      event: args.event,
      fromBlock: from,
      toBlock: to,
    });
    allLogs.push(...(logs as Log[]));
  }
  return allLogs;
}

export function startWatchers(): void {
  console.log(`[orchestrator] polling ${config.mockValidatorShare} on Amoy`);

  let lastScannedBlock: bigint | undefined;
  const poll = async () => {
    try {
      const latestBlock = await client.getBlockNumber();
      const fromBlock =
        lastScannedBlock === undefined
          ? latestBlock > INITIAL_LOOKBACK_BLOCKS
            ? latestBlock - INITIAL_LOOKBACK_BLOCKS
            : 0n
          : lastScannedBlock + 1n;
      if (fromBlock > latestBlock) return;

      const [mintedLogs, burnedLogs] = await Promise.all([
        getLogsBatched({
          address: config.mockValidatorShare as Address,
          event: shareMintedAbi,
          fromBlock,
          toBlock: latestBlock,
        }),
        getLogsBatched({
          address: config.mockValidatorShare as Address,
          event: shareBurnedAbi,
          fromBlock,
          toBlock: latestBlock,
        }),
      ]);

      for (const log of mintedLogs) {
        await handleShareMinted(log as unknown as Log);
      }
      for (const log of burnedLogs) {
        await handleShareBurned(log as unknown as Log);
      }

      lastScannedBlock = latestBlock;
    } catch (err) {
      console.error("[event-poller]", err);
    }
  };

  void poll();
  setInterval(() => void poll(), EVENT_POLL_MS);
}

function readyAtMillis(value: string): number {
  if (/^\d+$/.test(value)) {
    const epoch = Number(value);
    return epoch < 1_000_000_000_000 ? epoch * 1_000 : epoch;
  }
  return new Date(value).getTime();
}

/**
 * Polling-based release checker: every 15s, finds Unbonding positions
 * whose unbondingReadyAt has passed and calls Release.
 *
 * In production you'd also check that the user has called
 * unstakeClaimTokens_new() on-chain. For the hackathon MVP we assume
 * the backend auto-releases once the timer elapses.
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
        if (!arg.unbondingReadyAt) continue;
        const readyAt = readyAtMillis(arg.unbondingReadyAt);
        if (!Number.isFinite(readyAt)) continue;
        if (now < readyAt) continue;

        console.log(`[release-checker] releasing position for ${arg.evmAddress}`);
        try {
          const result = await canton.exerciseChoice({
            templateId: TEMPLATES.StakingPosition,
            contractId: p.contractId,
            choice: "StakingPosition_Release",
            argument: {
              proof: {
                txHash: "auto-release",
                blockNumber: 0,
                validatorShare: config.mockValidatorShare,
              },
            },
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
