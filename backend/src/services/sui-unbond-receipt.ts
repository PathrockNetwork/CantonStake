import { Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import { fromBase64, normalizeSuiAddress, toBase64 } from "@mysten/sui/utils";
import { assertSuiChainIdentifier } from "./native-network.js";
import { rpcUrls } from "./rpc-registry.js";

/** Existing receipt only. No simulation, signer, wallet or transaction submit. */
export async function readSuiUnbondReceipt(args: {
  wallet: string; receiptId: string; digest: string; bondHeight: number;
}): Promise<{ hash: string; status: "pending" | "settled" | "reverted" }> {
  if (!/^0x[a-f0-9]{64}$/.test(args.wallet) || !/^0x[a-fA-F0-9]{64}$/.test(args.receiptId) ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(args.digest) || !Number.isSafeInteger(args.bondHeight) || args.bondHeight <= 0) {
    throw new Error("Sui recovery requires verified wallet, receipt object, digest and bond checkpoint");
  }
  const response = await fetch(rpcUrls.sui, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: `query($digest: String!) { chainIdentifier
      transaction(digest: $digest) { digest transactionBcs
        effects { status checkpoint { sequenceNumber } }
      } }`, variables: { digest: args.digest } }), signal: AbortSignal.timeout(12000), redirect: "error" });
  if (!response.ok) throw new Error(`Sui receipt read unavailable (${response.status})`);
  const body = await response.json() as { errors?: unknown[]; data?: { chainIdentifier?: string;
    transaction?: { digest?: string; transactionBcs?: string; effects?: { status?: string; checkpoint?: { sequenceNumber?: string | number } } } | null } };
  if (body.errors?.length || !body.data) throw new Error("Sui receipt read returned incomplete data");
  assertSuiChainIdentifier(body.data.chainIdentifier);
  const transaction = body.data.transaction;
  if (transaction === null) return { hash: args.digest, status: "pending" };
  if (!transaction || transaction.digest !== args.digest || !transaction.transactionBcs) throw new Error("Sui receipt digest/bytes unavailable");
  const bytes = fromBase64(transaction.transactionBcs);
  if (bytes.length > 128_000 || toBase64(bytes) !== transaction.transactionBcs || TransactionDataBuilder.getDigestFromBytes(bytes) !== args.digest) {
    throw new Error("Sui receipt bytes do not prove the requested digest");
  }
  const data = Transaction.from(bytes).getData();
  const call = data.commands.length === 1 ? data.commands[0]?.MoveCall : null;
  const system = call?.arguments[0], receipt = call?.arguments[1];
  if (data.sender !== args.wallet || !call || normalizeSuiAddress(call.package) !== normalizeSuiAddress("0x3") ||
      call.module !== "sui_system" || call.function !== "request_withdraw_stake" || call.typeArguments.length !== 0 ||
      call.arguments.length !== 2 || system?.$kind !== "Input" || receipt?.$kind !== "Input" ||
      data.inputs[system.Input]?.Object?.SharedObject?.objectId !== normalizeSuiAddress("0x5") ||
      data.inputs[receipt.Input]?.Object?.ImmOrOwnedObject?.objectId !== args.receiptId.toLowerCase()) {
    throw new Error("Sui transaction does not withdraw this wallet's exact staking receipt");
  }
  const checkpoint = Number(transaction.effects?.checkpoint?.sequenceNumber);
  if (!Number.isSafeInteger(checkpoint) || checkpoint <= args.bondHeight) return { hash: args.digest, status: "pending" };
  if (transaction.effects?.status === "FAILURE") return { hash: args.digest, status: "reverted" };
  if (transaction.effects?.status !== "SUCCESS") throw new Error("Sui transaction execution status is unavailable");
  return { hash: args.digest, status: "settled" };
}
