import { decodeEventLog, type Address, type Hex } from "viem";
import { hoodi } from "viem/chains";
import { LIDO, LIDO_QUEUE, lidoAbi, queueAbi, lidoClient, lidoTransaction, readLidoState, validateLidoAction, validateLidoClaim, assertLidoMode } from "./lido";

export type LidoAction = "deposit" | "withdraw" | "claim";
export type LidoSend = (tx: { account: Address; chainId: number; to: Address; data: Hex; value: bigint; gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }) => Promise<Hex>;

export function assertSettledTransaction(tx: { from: Address; to: Address | null; input: Hex; value: bigint }, wallet: Address, expected: { to: Address; data: Hex; value: bigint }) {
  if (tx.from.toLowerCase() !== wallet.toLowerCase() || tx.to?.toLowerCase() !== expected.to.toLowerCase() || tx.input.toLowerCase() !== expected.data.toLowerCase() || tx.value !== expected.value)
    throw Error("Transaction was replaced or cancelled. Check the explorer before retrying.");
}

/** Fresh contract state and wallet context are checked across every signing boundary. */
export async function executeLidoAction({ action, amountOrId, wallet, assertCurrent, send, onTransaction, onProgress, client = lidoClient, readState = readLidoState }: {
  action: LidoAction; amountOrId: bigint; wallet: Address; assertCurrent: () => void; send: LidoSend;
  onTransaction: (label: string, hash: Hex, replaces?: Hex) => void; onProgress: (message: string) => void;
  client?: typeof lidoClient; readState?: typeof readLidoState;
}) {
  assertLidoMode();
  const fresh = async () => {
    assertCurrent();
    const state = await readState(wallet, client);
    assertCurrent();
    if (action === "claim") validateLidoClaim(state.requests.find(row => row.id === amountOrId), wallet);
    else validateLidoAction(state, wallet, action, amountOrId);
    return state;
  };
  const submit = async (kind: LidoAction | "approve", label: string) => {
    await fresh();
    const tx = lidoTransaction(kind, amountOrId, wallet);
    await client.call({ ...tx, account: wallet });
    const [estimate, fees, balance] = await Promise.all([
      client.estimateGas({ ...tx, account: wallet }), client.estimateFeesPerGas(), client.getBalance({ address: wallet }),
    ]);
    const gas = (estimate * 120n + 99n) / 100n;
    if (balance < tx.value + gas * fees.maxFeePerGas) throw Error("Insufficient Hoodi ETH for the amount and maximum gas fee.");
    assertCurrent();
    onProgress(`${label}: confirm in your wallet.`);
    const hash = await send({ ...tx, account: wallet, chainId: hoodi.id, gas, ...fees });
    onTransaction(label, hash);
    onProgress(`${label}: waiting for Hoodi confirmation…`);
    // A submitted transaction is tracked even if the user changes wallets.
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 2 });
    if (receipt.transactionHash !== hash) onTransaction(label, receipt.transactionHash, hash);
    if (receipt.status !== "success") throw Error(`${label} reverted. See the transaction on the explorer.`);
    assertSettledTransaction(await client.getTransaction({ hash: receipt.transactionHash }), wallet, tx);
    if (kind !== "approve") {
      const evidenced = receipt.logs.some(log => {
        try {
          if (kind === "deposit" && log.address.toLowerCase() === LIDO.toLowerCase()) {
            const event = decodeEventLog({ abi: lidoAbi, data: log.data, topics: log.topics });
            return event.args.sender.toLowerCase() === wallet.toLowerCase() && event.args.amount === amountOrId;
          }
          if (kind !== "deposit" && log.address.toLowerCase() === LIDO_QUEUE.toLowerCase()) {
            const event = decodeEventLog({ abi: queueAbi, data: log.data, topics: log.topics });
            if (kind === "withdraw" && event.eventName === "WithdrawalRequested")
              return event.args.requestor.toLowerCase() === wallet.toLowerCase() && event.args.owner.toLowerCase() === wallet.toLowerCase() && event.args.amountOfStETH === amountOrId;
            if (kind === "claim" && event.eventName === "WithdrawalClaimed")
              return event.args.requestId === amountOrId && event.args.owner.toLowerCase() === wallet.toLowerCase() && event.args.receiver.toLowerCase() === wallet.toLowerCase();
          }
        } catch { /* unrelated log */ }
        return false;
      });
      if (!evidenced) throw Error("Transaction confirmed, but expected Lido evidence is missing. Inspect the receipt before retrying.");
    }
    if (kind === "approve") assertCurrent();
  };
  const state = await fresh();
  if (action === "withdraw" && state.allowance < amountOrId) {
    await submit("approve", "Approve stETH");
    const updated = await fresh();
    if (updated.allowance < amountOrId) throw Error("Approval confirmed but allowance is insufficient. Review before retrying.");
  }
  await submit(action, action === "deposit" ? "Stake ETH" : action === "withdraw" ? "Request withdrawal" : "Claim ETH");
}
