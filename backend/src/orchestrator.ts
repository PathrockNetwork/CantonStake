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
          await canton.exerciseChoice({
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
