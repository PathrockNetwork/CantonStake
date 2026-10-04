export type ValidatorRow = {
  address: `0x${string}`;
  name: string;
  apr: number;
  uptime: number;
  commission: number;
  totalStaked?: string;
  recommended?: boolean;
};
