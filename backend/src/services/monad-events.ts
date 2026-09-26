/**
 * Monad staking-precompile events and calldata. Keep the indexed order in
 * sync with IMonadStaking: validatorId is topic 1, delegator is topic 2.
 * https://github.com/category-labs/monad-revm/blob/main/crates/monad-revm/src/staking/interface.rs
 */
import { parseAbi, parseAbiItem } from "viem";

export const monadDelegateAbi = parseAbiItem(
  "event Delegate(uint64 indexed validatorId, address indexed delegator, uint256 amount, uint64 activationEpoch)"
);

export const monadUndelegateAbi = parseAbiItem(
  "event Undelegate(uint64 indexed validatorId, address indexed delegator, uint8 withdrawId, uint256 amount, uint64 activationEpoch)"
);

export const monadWithdrawAbi = parseAbiItem(
  "event Withdraw(uint64 indexed validatorId, address indexed delegator, uint8 withdrawId, uint256 amount, uint64 withdrawEpoch)"
);

export const monadActionAbi = parseAbi([
  "function undelegate(uint64 validatorId, uint256 amount, uint8 withdrawId)",
  "function withdraw(uint64 validatorId, uint8 withdrawId)",
]);
