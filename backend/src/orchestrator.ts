/**
 * Event orchestrator: watches MockValidatorShare events on Amoy and
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

// --- Matching logic ---

/**
 * Find a pending StakingRequest for a given EVM address + amount.
 * We match by exact amount (1:1) since the mock is 1:1 shares:POL.
 */
async function findPendingRequest(
  evmAddress: string,
  amountPol: bigint
): Promise<ActiveContract | undefined> {
  const requests = await canton.activeContracts(TEMPLATES.StakingRequest);
  const amountDecimal = formatEther(amountPol);
  return requests.find((r) => {
    const arg = r.argument as { evmAddress?: string; amountPol?: string };
    return (
      arg.evmAddress?.toLowerCase() === evmAddress.toLowerCase() &&
      arg.amountPol === amountDecimal
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
    const created = (ev as Record<string, unknown>)?.CreatedEvent as Record<string, unknown> | undefined;
    if (created?.contractId) return created.contractId as string;
    // Some API versions nest it differently
    const archived = (ev as Record<string, unknown>)?.ArchivedEvent as Record<string, unknown> | undefined;
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
        featuredRightCid: config.featuredAppRightCid || null,
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
  // On production this would be 21 days = 1814400 microseconds in RelTime form.
  // Daml's RelTime is represented as {microseconds: number}.
  try {
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
        unbondingPeriod: { microseconds: "60000000" }, // 60s
        featuredRightCid: config.featuredAppRightCid || null,
      },
    });
    console.log(`  -> unbonding confirmed. tx=${result.transactionId}`);

    // Mirror to Postgres: update position to Unbonding
    const posArg = position.argument as { evmAddress?: string; delegator?: string; amountPol?: string };
    const unbondingReadyAt = new Date(Date.now() + 60_000); // 60s from now
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

// --- Watchers ---

export function startWatchers(): void {
  console.log(`[orchestrator] watching ${config.mockValidatorShare} on Amoy`);

  client.watchEvent({
    address: config.mockValidatorShare as Address,
    event: shareMintedAbi,
    onLogs: async (logs) => {
      for (const log of logs) {
        await handleShareMinted(log);
      }
    },
    onError: (err) => console.error("[watcher:ShareMinted]", err),
  });

  client.watchEvent({
    address: config.mockValidatorShare as Address,
    event: shareBurnedAbi,
    onLogs: async (logs) => {
      for (const log of logs) {
        await handleShareBurned(log);
      }
    },
    onError: (err) => console.error("[watcher:ShareBurned]", err),
  });
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
        const readyAt = new Date(arg.unbondingReadyAt).getTime();
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

// Re-exported for the HTTP API.
export { findPendingRequest, findBondedPosition, findUnbondingPosition };
