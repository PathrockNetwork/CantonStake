/** A Daml Released position retains lastUnbondProof, not the later release
 * proof. On release recovery, compare it with the mirror's unbond tx hash;
 * comparing only wallet/pool can select an older completed position. */
export function matchesUnbondProofForRecovery(
  from: "Bonded" | "Unbonding",
  observedTxHash: string,
  mirrorLastTxHash: string | null | undefined,
  cantonUnbondTxHash: string | null | undefined,
): boolean {
  const expected = from === "Bonded" ? observedTxHash : mirrorLastTxHash;
  return !!expected && cantonUnbondTxHash === expected;
}
