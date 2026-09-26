/** Event and transaction signers are nullable for Sui system transactions.
 * A user staking transition needs a signer that matches the event staker. */
export function verifiedSuiStakingSender(
  staker: string,
  eventSender?: string | null,
  transactionSender?: string | null,
): string | null {
  if (!eventSender && !transactionSender) return null;
  if (eventSender && transactionSender && eventSender.toLowerCase() !== transactionSender.toLowerCase()) {
    throw new Error("Sui event and transaction signers disagree");
  }
  const sender = eventSender ?? transactionSender!;
  if (sender.toLowerCase() !== staker.toLowerCase()) {
    throw new Error("Sui staking signer does not match event staker");
  }
  return sender;
}
