export type UnsignedTx =
  | { kind: "evm"; to: `0x${string}`; data: `0x${string}`; value?: bigint; gas?: bigint }
  | { kind: "substrate"; method: string; args: unknown[] }
  | { kind: "cosmos"; typeUrl: string; value: Record<string, unknown> }
  | { kind: "sui"; tx: unknown };

export type Position = {
  validator: string;
  amount: bigint;
  status: "pending" | "bonded" | "unbonding" | "released";
  unbondingReadyAt?: number;
};

export type Validator = {
  address: string;
  name: string;
  apr: number;
  commission: number;
  uptime: number;
};

export type Unsubscribe = () => void;

export interface IChainAdapter {
  readonly chainId: string;
  getValidators(): Promise<Validator[]>;
  getDelegations(address: string): Promise<Position[]>;
  /**
   * Optional prerequisite transaction that must confirm BEFORE
   * buildDelegateTx's transaction is sent.
   *
   * Polygon needs this: its stake token is an ERC-20 and `buyVoucher` is not
   * payable, so the delegator has to approve the StakeManager first. Returns
   * null when no approval is needed (sufficient allowance, or a chain that
   * stakes the native token). Chains without an approval step omit it.
   */
  buildApprovalTx?(args: {
    validator: string;
    amount: bigint;
    delegator: string;
  }): Promise<UnsignedTx | null>;
  buildDelegateTx(args: {
    validator: string;
    amount: bigint;
    delegator: string;
  }): Promise<UnsignedTx>;
  buildUndelegateTx(args: {
    validator: string;
    amount: bigint;
    delegator: string;
  }): Promise<UnsignedTx>;
  buildClaimTx(args: {
    validator: string;
    delegator: string;
  }): Promise<UnsignedTx>;
  estimateGas(tx: UnsignedTx, from: string): Promise<bigint>;
  watchPosition(address: string, cb: (p: Position) => void): Unsubscribe;
}

export type ChainAdapterErrorCode =
  | "VALIDATOR_NOT_FOUND"
  | "INSUFFICIENT_BALANCE"
  | "UNBONDING_PERIOD"
  | "NETWORK";

export class ChainAdapterError extends Error {
  constructor(
    public readonly code: ChainAdapterErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ChainAdapterError";
  }
}
