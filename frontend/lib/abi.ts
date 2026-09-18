/**
 * On-chain interfaces for the Polygon PoS staking flow:
 * `validatorShareAbi`, `stakeManagerAbi`, `stakingLoggerAbi`, `erc20Abi`.
 * Polygon PoS staking settles on Ethereum L1, StakeManager deploys one
 * ValidatorShare per validator, `buyVoucher` is NOT payable (delegation
 * is an ERC-20 approve + transferFrom through the StakeManager), and
 * delegation events are emitted by the shared StakingInfo logger with
 * `validatorId` as their first indexed topic.
 */

// --- Polygon PoS -----------------------------------------------------------

export const validatorShareAbi = [
  {
    type: "function",
    name: "buyVoucher",
    // NOT payable — the delegator approves the StakeManager and it pulls the
    // ERC-20 stake token. Sending value here reverts.
    stateMutability: "nonpayable",
    inputs: [
      { name: "_amount", type: "uint256" },
      { name: "_minSharesToMint", type: "uint256" },
    ],
    outputs: [{ name: "amountToDeposit", type: "uint256" }],
  },
  {
    type: "function",
    name: "sellVoucher_new",
    stateMutability: "nonpayable",
    inputs: [
      { name: "claimAmount", type: "uint256" },
      { name: "maximumSharesToBurn", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "unstakeClaimTokens_new",
    stateMutability: "nonpayable",
    inputs: [{ name: "unbondNonce", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawRewards",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "restake",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },
  {
    type: "function",
    name: "validatorId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    // Scaled by a per-validator precision constant: 100 for the original
    // foundation validators (validatorId < 8), 1e29 for everyone else.
    type: "function",
    name: "exchangeRate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawExchangeRate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    // Share balance — NOT the POL amount. Use getTotalStake for that.
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    // Returns (stake-token amount, exchange rate).
    type: "function",
    name: "getTotalStake",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },
  {
    // Claimable protocol yield from the validator's reward pool.
    type: "function",
    name: "getLiquidRewards",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "unbondNonces",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "unbonds_new",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [
      { name: "shares", type: "uint256" },
      { name: "withdrawEpoch", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "minAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const stakeManagerAbi = [
  {
    type: "function",
    name: "validators",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      { name: "amount", type: "uint256" },
      { name: "reward", type: "uint256" },
      { name: "activationEpoch", type: "uint256" },
      { name: "deactivationEpoch", type: "uint256" },
      { name: "jailTime", type: "uint256" },
      { name: "signer", type: "address" },
      { name: "contractAddress", type: "address" },
      { name: "status", type: "uint8" },
      { name: "commissionRate", type: "uint256" },
      { name: "lastCommissionUpdate", type: "uint256" },
      { name: "delegatorsReward", type: "uint256" },
      { name: "delegatedAmount", type: "uint256" },
      { name: "initialRewardPerStake", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "signerToValidator",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "epoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawalDelay",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

/**
 * StakingInfo ("the logger") — every delegation event in the system is
 * emitted here, not on the ValidatorShare. `amount`/`rewards` are indexed.
 */
export const stakingLoggerAbi = [
  {
    type: "event",
    name: "ShareMinted",
    inputs: [
      { name: "validatorId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: true },
      { name: "tokens", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ShareBurnedWithId",
    inputs: [
      { name: "validatorId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: true },
      { name: "tokens", type: "uint256", indexed: false },
      { name: "nonce", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DelegatorUnstakeWithId",
    inputs: [
      { name: "validatorId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "nonce", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DelegatorClaimedRewards",
    inputs: [
      { name: "validatorId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "rewards", type: "uint256", indexed: true },
    ],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;
