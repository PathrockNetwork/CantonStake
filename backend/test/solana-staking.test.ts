import assert from "node:assert/strict";
import test from "node:test";
import { decodeSolanaStakeAction, type ParsedSolanaTransaction, type SolanaStakeBinding } from "../src/services/solana-staking.js";
import { SOLANA_STAKE_PROGRAM } from "../src/services/solana-rpc.js";

const binding: SolanaStakeBinding = {
  wallet: "WalletSigner1111111111111111111111111111111",
  stakeAccount: "StakeAccount11111111111111111111111111111",
  voteAccount: "VoteAccount111111111111111111111111111111",
  amountLamports: 1_000_000_000n,
  rentLamports: 1_666_240n,
};

const funded = Number(binding.amountLamports + binding.rentLamports);
const base: ParsedSolanaTransaction = {
  slot: 1234,
  blockTime: 1_800_000_000,
  meta: { err: null, preBalances: [2_000_000_000, 0, 0], postBalances: [998_328_760, funded, 0] },
  transaction: {
    signatures: ["Signature11111111111111111111111111111111111111111111111111111111111"],
    message: {
      accountKeys: [
        { pubkey: binding.wallet, signer: true },
        { pubkey: binding.stakeAccount, signer: true },
        { pubkey: binding.voteAccount, signer: false },
      ],
      instructions: [
        { program: "system", parsed: { type: "createAccount", info: {
          source: binding.wallet, newAccount: binding.stakeAccount,
          lamports: funded, owner: SOLANA_STAKE_PROGRAM, space: 200,
        } } },
        { program: "stake", parsed: { type: "initialize", info: {
          stakeAccount: binding.stakeAccount,
          authorized: { staker: binding.wallet, withdrawer: binding.wallet },
          lockup: { epoch: 0, unixTimestamp: 0 },
        } } },
        { program: "stake", parsed: { type: "delegate", info: {
          stakeAccount: binding.stakeAccount, voteAccount: binding.voteAccount, stakeAuthority: binding.wallet,
        } } },
      ],
    },
  },
};

const clone = (tx: ParsedSolanaTransaction): ParsedSolanaTransaction => structuredClone(tx);

test("binds atomic stake-account creation, wallet authorities, vote, amount, and signature", () => {
  const action = decodeSolanaStakeAction(base, binding);
  assert.equal(action?.kind, "stake");
  assert.equal(action?.amountLamports, binding.amountLamports);
  assert.equal(action?.stakeAccount, binding.stakeAccount);
});

test("rejects failed, underfunded, re-authorized, and unrelated stake transactions", () => {
  const failed = clone(base); failed.meta!.err = { InstructionError: [2, "InvalidArgument"] };
  assert.equal(decodeSolanaStakeAction(failed, binding), null);
  const underfunded = clone(base); underfunded.transaction!.message!.instructions![0]!.parsed!.info!.lamports = funded - 1;
  assert.equal(decodeSolanaStakeAction(underfunded, binding), null);
  const hijacked = clone(base); (hijacked.transaction!.message!.instructions![1]!.parsed!.info!.authorized as { withdrawer: string }).withdrawer = "Attacker";
  assert.equal(decodeSolanaStakeAction(hijacked, binding), null);
  const extra = clone(base); extra.transaction!.message!.instructions!.push({ program: "stake", parsed: { type: "authorize", info: {} } });
  assert.equal(decodeSolanaStakeAction(extra, binding), null);
});

test("accepts only wallet-authorized deactivation and complete withdrawal to that wallet", () => {
  const deactivation = clone(base);
  deactivation.transaction!.message!.instructions = [{ program: "stake", parsed: { type: "deactivate", info: {
    stakeAccount: binding.stakeAccount, stakeAuthority: binding.wallet,
  } } }];
  assert.equal(decodeSolanaStakeAction(deactivation, binding)?.kind, "deactivate");

  const withdrawal = clone(base);
  withdrawal.meta!.preBalances![1] = funded + 100;
  withdrawal.meta!.postBalances![1] = 0;
  withdrawal.transaction!.message!.instructions = [{ program: "stake", parsed: { type: "withdraw", info: {
    stakeAccount: binding.stakeAccount, withdrawAuthority: binding.wallet,
    destination: binding.wallet, lamports: funded + 100,
  } } }];
  assert.equal(decodeSolanaStakeAction(withdrawal, binding)?.kind, "withdraw");
  withdrawal.transaction!.message!.instructions![0]!.parsed!.info!.destination = "Attacker";
  assert.equal(decodeSolanaStakeAction(withdrawal, binding), null);
});
