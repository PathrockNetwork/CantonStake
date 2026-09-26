import { SOLANA_STAKE_ACCOUNT_SPACE, SOLANA_STAKE_PROGRAM } from "./solana-rpc.js";

type ParsedInstruction = {
  program?: string;
  programId?: string;
  parsed?: { type?: string; info?: Record<string, unknown> };
};

export type ParsedSolanaTransaction = {
  slot?: number;
  blockTime?: number | null;
  meta?: { err?: unknown; preBalances?: number[]; postBalances?: number[] };
  transaction?: {
    signatures?: string[];
    message?: {
      accountKeys?: Array<{ pubkey?: string; signer?: boolean } | string>;
      instructions?: ParsedInstruction[];
    };
  };
};

export type SolanaStakeBinding = {
  wallet: string;
  stakeAccount: string;
  voteAccount: string;
  amountLamports: bigint;
  rentLamports: bigint;
};

export type SolanaStakeAction = {
  kind: "stake" | "deactivate" | "withdraw";
  wallet: string;
  stakeAccount: string;
  voteAccount: string;
  amountLamports: bigint;
  txHash: string;
  slot: number;
  timestamp: Date;
};

function natural(value: unknown): bigint | null {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+$/.test(String(value))) return null;
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  return BigInt(String(value));
}

function isInstruction(ix: ParsedInstruction, program: string, type: string): boolean {
  return ix.program === program && ix.parsed?.type === type;
}

/** Strictly bind a finalized parsed transaction to one pre-registered stake
 * account. The stake path accepts only create + initialize + delegate in one
 * atomic transaction, with both authorities held by the funding wallet. */
export function decodeSolanaStakeAction(
  tx: ParsedSolanaTransaction,
  binding: SolanaStakeBinding,
): SolanaStakeAction | null {
  const message = tx.transaction?.message;
  const keys = message?.accountKeys?.map((key) => typeof key === "string" ? { pubkey: key, signer: false } : key) ?? [];
  const instructions = message?.instructions ?? [];
  const signature = tx.transaction?.signatures?.[0];
  if (tx.meta?.err !== null || !signature || !Number.isSafeInteger(tx.slot) || !Number.isSafeInteger(tx.blockTime) ||
      tx.slot! < 0 || tx.blockTime! <= 0 || !keys[0] || keys[0].pubkey !== binding.wallet || keys[0].signer !== true) return null;
  const walletSigned = keys.some((key) => key.pubkey === binding.wallet && key.signer === true);
  const stakeIndex = keys.findIndex((key) => key.pubkey === binding.stakeAccount);
  if (!walletSigned || stakeIndex < 0) return null;
  const base = {
    wallet: binding.wallet, stakeAccount: binding.stakeAccount, voteAccount: binding.voteAccount,
    txHash: signature, slot: tx.slot!, timestamp: new Date(tx.blockTime! * 1000),
  };

  if (instructions.length === 3 && isInstruction(instructions[0]!, "system", "createAccount") &&
      isInstruction(instructions[1]!, "stake", "initialize") && isInstruction(instructions[2]!, "stake", "delegate")) {
    const create = instructions[0]!.parsed!.info!;
    const initialize = instructions[1]!.parsed!.info!;
    const delegate = instructions[2]!.parsed!.info!;
    const funded = natural(create.lamports);
    const lockup = initialize.lockup as { epoch?: unknown; unixTimestamp?: unknown } | undefined;
    const authorized = initialize.authorized as { staker?: string; withdrawer?: string } | undefined;
    if (create.source !== binding.wallet || create.newAccount !== binding.stakeAccount ||
        create.owner !== SOLANA_STAKE_PROGRAM || natural(create.space) !== BigInt(SOLANA_STAKE_ACCOUNT_SPACE) ||
        funded !== binding.amountLamports + binding.rentLamports ||
        initialize.stakeAccount !== binding.stakeAccount || authorized?.staker !== binding.wallet ||
        authorized.withdrawer !== binding.wallet || natural(lockup?.epoch) !== 0n ||
        natural(lockup?.unixTimestamp) !== 0n ||
        delegate.stakeAccount !== binding.stakeAccount || delegate.voteAccount !== binding.voteAccount ||
        delegate.stakeAuthority !== binding.wallet || keys[stakeIndex]?.signer !== true ||
        natural(tx.meta?.preBalances?.[stakeIndex]) !== 0n || natural(tx.meta?.postBalances?.[stakeIndex]) !== funded) return null;
    return { ...base, kind: "stake", amountLamports: binding.amountLamports };
  }

  if (instructions.length === 1 && isInstruction(instructions[0]!, "stake", "deactivate")) {
    const info = instructions[0]!.parsed!.info!;
    if (info.stakeAccount !== binding.stakeAccount || info.stakeAuthority !== binding.wallet) return null;
    return { ...base, kind: "deactivate", amountLamports: binding.amountLamports };
  }

  if (instructions.length === 1 && isInstruction(instructions[0]!, "stake", "withdraw")) {
    const info = instructions[0]!.parsed!.info!;
    const withdrawn = natural(info.lamports);
    if (info.stakeAccount !== binding.stakeAccount || info.withdrawAuthority !== binding.wallet ||
        info.destination !== binding.wallet || !withdrawn || withdrawn <= 0n ||
        natural(tx.meta?.preBalances?.[stakeIndex]) !== withdrawn ||
        natural(tx.meta?.postBalances?.[stakeIndex]) !== 0n) return null;
    return { ...base, kind: "withdraw", amountLamports: withdrawn };
  }
  return null;
}
