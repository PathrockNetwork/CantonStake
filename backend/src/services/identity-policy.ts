import { sameWalletAddress } from "./wallet-address.js";

export class IdentityConflictError extends Error {
  readonly statusCode = 409;
}

/** A verified session may edit a profile, never move existing funds/positions. */
export function assertIdentityBinding(
  byParty: { id: string; evmAddress: string | null } | null,
  byWallet: { id: string } | null,
  wallet: string,
  allowAdditionalWallet = false,
) {
  if (byWallet && byWallet.id !== byParty?.id) {
    throw new IdentityConflictError("This native wallet is already linked to another Canton identity; existing positions and rewards will not be reassigned");
  }
  if (!allowAdditionalWallet && byParty?.evmAddress && !sameWalletAddress(byParty.evmAddress, wallet)) {
    throw new IdentityConflictError("This Canton identity already has a different primary wallet; use the verified external staking workflow for additional wallets");
  }
}

export interface SignedStakingRequest {
  delegator: string; evmAddress: string; amountPol: string; chain?: string;
  validator?: string; stakeAccountAddress?: string; clientNetworkMode?: string;
  ownershipNonce?: string; ownershipSignedAt?: number;
}

/** Exact, domain-separated consent; changing any request field invalidates it. */
export function stakingOwnershipMessage(body: SignedStakingRequest): string {
  return "CantonStake: authorize one staking request\nThis signature does not transfer funds. Existing identities and rewards are not reassigned.\n" + JSON.stringify({
    clientNetworkMode: body.clientNetworkMode, delegator: body.delegator, evmAddress: body.evmAddress,
    amountPol: body.amountPol, chain: body.chain ?? "polygon", validator: body.validator ?? null,
    stakeAccountAddress: body.stakeAccountAddress ?? null, nonce: body.ownershipNonce, signedAt: body.ownershipSignedAt,
  });
}

export function validOwnershipWindow(body: Pick<SignedStakingRequest, "ownershipNonce" | "ownershipSignedAt">, now = Date.now()): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.ownershipNonce ?? "") &&
    Number.isSafeInteger(body.ownershipSignedAt) && body.ownershipSignedAt! <= now + 30_000 &&
    body.ownershipSignedAt! >= now - 300_000;
}

export function identityOwnershipMessage(body: Pick<SignedStakingRequest, "delegator" | "evmAddress" | "clientNetworkMode" | "ownershipNonce" | "ownershipSignedAt">): string {
  return "CantonStake: verify my CC reward recipient\nThis signature does not transfer funds or reassign existing positions.\n" + JSON.stringify({
    clientNetworkMode: body.clientNetworkMode, delegator: body.delegator, evmAddress: body.evmAddress,
    nonce: body.ownershipNonce, signedAt: body.ownershipSignedAt,
  });
}
