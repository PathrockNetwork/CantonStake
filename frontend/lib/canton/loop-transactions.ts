import type { CantonNetwork } from "./types";

export interface LoopTransactionSigner {
  party_id: string;
  getAccount(): Promise<{ party_id: string }>;
  submitAndWaitForTransaction(payload: LoopTransactionPayload, options: {
    message: string; requestTimeout: number; deduplicationPeriod: { seconds: number };
  }): Promise<unknown>;
}

export interface LoopStakingDeployment {
  network: CantonNetwork;
  packageId: string;
  synchronizerId: string;
  appProvider: string;
  // Backend/operator-attested exact package, not a browser feature flag.
  loopReviewedPackageId: string | null;
}

export type LoopStakingAction =
  | { kind: "create-request"; delegator: string; evmAddress: string; amount: string; requestedAt: string }
  | { kind: "cancel-request"; delegator: string; contractId: string }
  | { kind: "request-unbond"; delegator: string; contractId: string };

export interface LoopTransactionPayload {
  commands: unknown[];
  disclosedContracts: unknown[];
  actAs: string[];
  readAs: string[];
  synchronizerId: string;
  packageIdSelectionPreference: string[];
}

function requireParty(value: string): void {
  if (!/^[^\s:]+::[a-f0-9]{68}$/.test(value)) throw new Error("Invalid Canton party ID.");
}

export function buildLoopStakingCommand(deployment: LoopStakingDeployment, action: LoopStakingAction): LoopTransactionPayload {
  if (!["create-request", "cancel-request", "request-unbond"].includes(action.kind)) throw new Error("Unsupported Loop staking action.");
  if (!/^[a-f0-9]{64}$/.test(deployment.packageId)) throw new Error("Invalid CantonStake package ID.");
  if (deployment.loopReviewedPackageId !== deployment.packageId) {
    throw new Error("Loop staking is awaiting review and deployment of this exact CantonStake package by Five North.");
  }
  if (!/^[^\s:]+::[a-f0-9]{68}$/.test(deployment.synchronizerId)) throw new Error("Invalid Canton synchronizer ID.");
  requireParty(deployment.appProvider);
  requireParty(action.delegator);
  const prefix = `${deployment.packageId}:CantonStake.Staking`;
  let command: unknown;
  if (action.kind === "create-request") {
    // Keep the exact Daml Decimal; never round stake amounts through Number.
    if (!/^\d+(?:\.\d{1,10})?$/.test(action.amount) || !/[1-9]/.test(action.amount) || action.amount.split(".")[0].length > 28) {
      throw new Error("Stake amount must be a positive Daml Decimal with at most 10 fractional digits.");
    }
    if (!action.evmAddress || /\s/.test(action.evmAddress) || action.evmAddress.length > 128) throw new Error("Invalid native wallet address.");
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(action.requestedAt) ||
        !Number.isFinite(Date.parse(action.requestedAt)) || new Date(action.requestedAt).toISOString() !== action.requestedAt) {
      throw new Error("Staking request requires a canonical UTC timestamp.");
    }
    command = { CreateCommand: { templateId: `${prefix}:StakingRequest`, createArguments: {
      delegator: action.delegator, appProvider: deployment.appProvider,
      evmAddress: action.evmAddress, amountPol: action.amount, requestedAt: action.requestedAt,
    } } };
  } else {
    if (!/^[a-f0-9]{2,512}$/.test(action.contractId) || action.contractId.length % 2 !== 0) throw new Error("Invalid Canton contract ID.");
    const request = action.kind === "cancel-request";
    command = { ExerciseCommand: { templateId: `${prefix}:${request ? "StakingRequest" : "StakingPosition"}`,
      contractId: action.contractId,
      choice: request ? "StakingRequest_Cancel" : "StakingPosition_RequestUnbond", choiceArgument: {},
    } };
  }
  return { commands: [command], disclosedContracts: [], actAs: [action.delegator], readAs: [],
    synchronizerId: deployment.synchronizerId, packageIdSelectionPreference: [deployment.packageId] };
}

export class LoopSubmissionUncertainError extends Error {
  constructor(message: string, readonly originalError?: unknown) {
    super(message);
    this.name = "LoopSubmissionUncertainError";
  }
}

/** Backend observation/adoption is required before any native transaction. */
export async function approveLoopStakingAction(signer: LoopTransactionSigner, connectedNetwork: CantonNetwork,
  deployment: LoopStakingDeployment, action: LoopStakingAction,
): Promise<{ commandId: string; updateId: string }> {
  if (connectedNetwork !== deployment.network) throw new Error(`Switch Loop to Canton ${deployment.network} before approving.`);
  if (signer.party_id !== action.delegator) throw new Error("The connected Loop party does not own this request.");
  const payload = buildLoopStakingCommand(deployment, action);
  const account = await signer.getAccount();
  if (account.party_id !== action.delegator) throw new Error("Loop account changed. Reconnect your wallet.");
  let result: unknown;
  try {
    result = await signer.submitAndWaitForTransaction(payload, {
      message: action.kind === "create-request" ? "Create CantonStake staking request (native stake is a separate approval)"
        : action.kind === "cancel-request" ? "Cancel your pending CantonStake request"
        : "Request unbonding of your CantonStake position (native withdrawal is a separate approval)",
      requestTimeout: 300_000, deduplicationPeriod: { seconds: 1800 },
    });
  } catch (error) {
    // Timeout/disconnect/5xx may occur after commit: never auto-retry or stake.
    throw new LoopSubmissionUncertainError("Loop submission was not confirmed. Reconcile the Canton request before retrying; no native stake should be sent.", error);
  }
  const receipt = result as { status?: string; error?: { error_message?: string }; command_id?: string; update_id?: string } | null;
  if (receipt?.status === "failed" || receipt?.error) throw new Error(receipt.error?.error_message || "Loop transaction failed.");
  if (typeof receipt?.update_id !== "string" || !receipt.update_id ||
      typeof receipt.command_id !== "string" || !receipt.command_id || (receipt.status && receipt.status !== "succeeded")) {
    throw new LoopSubmissionUncertainError("Loop returned no finalized ledger receipt. Reconcile the request before retrying.");
  }
  return { commandId: receipt.command_id, updateId: receipt.update_id };
}
