export interface SignedStakingRequest {
  delegator: string; evmAddress: string; amountPol: string; chain?: string;
  validator?: string; stakeAccountAddress?: string; clientNetworkMode?: string;
  ownershipNonce?: string; ownershipSignedAt?: number;
}

export function stakingOwnershipMessage(body: SignedStakingRequest): string {
  return "CantonStake: authorize one staking request\nThis signature does not transfer funds. Existing identities and rewards are not reassigned.\n" + JSON.stringify({
    clientNetworkMode: body.clientNetworkMode, delegator: body.delegator, evmAddress: body.evmAddress,
    amountPol: body.amountPol, chain: body.chain ?? "polygon", validator: body.validator ?? null,
    stakeAccountAddress: body.stakeAccountAddress ?? null, nonce: body.ownershipNonce, signedAt: body.ownershipSignedAt,
  });
}

export function identityOwnershipMessage(body: Pick<SignedStakingRequest, "delegator" | "evmAddress" | "clientNetworkMode" | "ownershipNonce" | "ownershipSignedAt">): string {
  return "CantonStake: verify my CC reward recipient\nThis signature does not transfer funds or reassign existing positions.\n" + JSON.stringify({
    clientNetworkMode: body.clientNetworkMode, delegator: body.delegator, evmAddress: body.evmAddress,
    nonce: body.ownershipNonce, signedAt: body.ownershipSignedAt,
  });
}
