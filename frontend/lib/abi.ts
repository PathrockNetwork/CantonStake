export const mockValidatorShareAbi = [
  {
    type: "function",
    name: "buyVoucher",
    stateMutability: "payable",
    inputs: [
      { name: "_amount", type: "uint256" },
      { name: "_minSharesToMint", type: "uint256" },
    ],
    outputs: [{ name: "amountStaked", type: "uint256" }],
  },
  {
    type: "function",
    name: "sellVoucher_new",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_claimAmount", type: "uint256" },
      { name: "_maximumSharesToBurn", type: "uint256" },
    ],
    outputs: [{ name: "nonce", type: "uint256" }],
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
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingRewards",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalStaked",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "aprBasisPoints",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "ShareMinted",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "tokens", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ShareBurnedWithId",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "tokens", type: "uint256", indexed: false },
      { name: "nonce", type: "uint256", indexed: false },
    ],
  },
] as const;
