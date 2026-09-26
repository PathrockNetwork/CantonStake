/** RPC receipt lookup success is not transaction execution success. Use the
 * receipt hash so a same-call gas repricing is followed to its settled tx. */
export function successfulEvmSettlementHash(receipt?: {
  status: "success" | "reverted";
  transactionHash: string;
}, replacementReason?: "repriced" | "replaced" | "cancelled"): string | null {
  if (replacementReason && replacementReason !== "repriced") return null;
  return receipt?.status === "success" ? receipt.transactionHash : null;
}
