export type ValidatorRow = {
  address: `0x${string}`;
  name: string;
  apr: number;
  /** Percent, or null when the chain does not measure uptime. */
  uptime: number | null;
  commission: number;
  totalStaked?: string;
  recommended?: boolean;
};
