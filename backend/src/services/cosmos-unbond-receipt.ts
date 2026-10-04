import { decodeTxRaw } from "@cosmjs/proto-signing";
import { fromBase64, fromHex, toBase64, toHex } from "@cosmjs/encoding";
import { sha256 } from "@cosmjs/crypto";
import { MsgUndelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx";
import { parseUnits } from "viem";
import { rpcUrls } from "./rpc-registry.js";
import { assertCosmosChainIdentity, type CosmosChain } from "./native-network.js";

const DENOM: Record<CosmosChain, string> = { cosmos: "uatom", celestia: "utia", osmosis: "uosmo" };

/** Existing native receipt only. No private keys, simulation or broadcast.
 * The configured checked RPC serves both identity and transaction reads. */
export async function readCosmosUnbondReceipt(input: {
  chain: CosmosChain; hash: string; wallet: string; validator: string; amount: string; bondHeight: number;
}): Promise<{ status: "pending" | "settled" | "reverted"; hash: string }> {
  if (!/^[A-Fa-f0-9]{64}$/.test(input.hash)) throw new Error("Invalid Cosmos transaction hash");
  const hash = input.hash.toUpperCase();
  if (!Number.isSafeInteger(input.bondHeight) || input.bondHeight <= 0) throw new Error("Native bond block is not verified");
  const rpc = async <T>(method: string, params: Record<string, string | boolean> = {}) => {
    const response = await fetch(rpcUrls[input.chain], {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      redirect: "error", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Cosmos receipt RPC is unavailable");
    return await response.json() as { result?: T; error?: { code?: number; message?: string; data?: string } };
  };
  const status = await rpc<{ node_info?: { network?: string }; sync_info?: { catching_up?: boolean } }>("status");
  if (!status.result || status.error) throw new Error("Cosmos receipt RPC identity is unavailable");
  if (status.result.sync_info?.catching_up !== false) throw new Error("Cosmos receipt RPC is not verified as synchronized");
  assertCosmosChainIdentity(input.chain, status.result.node_info?.network, status.result.sync_info?.catching_up);
  // JSON-RPC encodes byte arrays as base64 (the GET /tx route uses hex).
  const response = await rpc<{ hash?: string; height?: string; tx?: string; tx_result?: { code?: number } }>("tx", { hash: toBase64(fromHex(hash)), prove: false });
  if (response.error) {
    // Missing from this RPC's index is only pending, never permission to retry.
    if (response.error.code === -32603 && typeof response.error.data === "string" &&
        response.error.data.includes(hash) && /not found/i.test(response.error.data)) return { status: "pending", hash };
    throw new Error("Cosmos transaction lookup is unavailable");
  }
  const receipt = response.result;
  if (!receipt?.tx || receipt.hash?.toUpperCase() !== hash || !/^\d+$/.test(receipt.height ?? "") ||
      BigInt(receipt.height!) <= BigInt(input.bondHeight) ||
      !Number.isSafeInteger(receipt.tx_result?.code) || receipt.tx_result!.code! < 0) {
    throw new Error("Cosmos receipt is malformed or predates the position's native bond");
  }
  const bytes = fromBase64(receipt.tx);
  if (toHex(sha256(bytes)).toUpperCase() !== hash) throw new Error("Cosmos receipt bytes do not match the supplied hash");
  const messages = decodeTxRaw(bytes).body.messages;
  if (messages.length !== 1 || messages[0]!.typeUrl !== "/cosmos.staking.v1beta1.MsgUndelegate") {
    throw new Error("Cosmos transaction is not a single native unbond");
  }
  const message = MsgUndelegate.decode(messages[0]!.value);
  if (message.delegatorAddress !== input.wallet || message.validatorAddress !== input.validator ||
      message.amount?.denom !== DENOM[input.chain] || !/^\d+$/.test(message.amount.amount) ||
      BigInt(message.amount.amount) !== parseUnits(input.amount, 6)) {
    throw new Error("Cosmos unbond does not match the position's wallet, validator, denomination and amount");
  }
  return { status: receipt.tx_result!.code === 0 ? "settled" : "reverted", hash };
}
