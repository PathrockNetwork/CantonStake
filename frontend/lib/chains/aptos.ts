import { fetchValidatorScores, type ValidatorScore } from "../api";
import { APTOS_MAX_U64, aptosDelegationStake, aptosNetwork, aptosPendingWithdrawal, aptosU64, aptosView, assertAptosIndexerChainId, fullAptosAddress } from "../aptos/network";
import { ChainAdapterError, type IChainAdapter, type Position, type UnsignedTx, type Validator } from "./types";

const MODULE = "0x1::delegation_pool";

async function poolAddressesFor(delegator: string): Promise<string[]> {
  const response = await fetch(aptosNetwork.indexer, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `query Pools($delegator: String!) { ledger_infos(limit: 1) { chain_id } current_delegator_balances(where: {delegator_address: {_eq: $delegator}}, distinct_on: pool_address) { pool_address } }`,
      variables: { delegator },
    }),
  });
  if (!response.ok) throw new ChainAdapterError("NETWORK", `Aptos indexer returned ${response.status}`);
  const body = await response.json() as { data?: { ledger_infos?: Array<{ chain_id?: number | string }>; current_delegator_balances?: Array<{ pool_address: string }> }; errors?: unknown[] };
  if (body.errors?.length) throw new ChainAdapterError("NETWORK", `Aptos indexer query failed: ${JSON.stringify(body.errors)}`);
  try { assertAptosIndexerChainId(body.data?.ledger_infos?.[0]?.chain_id); }
  catch (cause) { throw new ChainAdapterError("NETWORK", "Aptos indexer does not match this app's selected network", cause); }
  return [...new Set((body.data?.current_delegator_balances ?? []).map((row) => fullAptosAddress(row.pool_address)).filter((row): row is string => !!row))];
}

export const aptosAdapter: IChainAdapter = {
  chainId: "aptos",

  async getValidators(): Promise<Validator[]> {
    const snap = await fetchValidatorScores("aptos");
    return snap.validators.map((v: ValidatorScore) => ({
      address: v.address, name: v.name, apr: 0,
      commission: v.commissionPct, uptime: v.uptimePct,
    }));
  },

  async getDelegations(address: string): Promise<Position[]> {
    const delegator = fullAptosAddress(address);
    if (!delegator) throw new ChainAdapterError("NETWORK", "Invalid Aptos address");
    const pools = await poolAddressesFor(delegator);
    const positions: Position[] = [];
    for (const pool of pools) {
      const [activeOcta, inactiveOcta, pendingOcta] = aptosDelegationStake(await aptosView(`${MODULE}::get_stake`, [pool, delegator]));
      if (activeOcta > 0n) positions.push({ validator: pool, amount: activeOcta, status: "bonded" });
      if (inactiveOcta + pendingOcta > 0n) positions.push({ validator: pool, amount: inactiveOcta + pendingOcta, status: "unbonding" });
    }
    return positions;
  },

  async buildDelegateTx({ validator, amount, delegator }) {
    const pool = fullAptosAddress(validator);
    const address = fullAptosAddress(delegator);
    if (!pool || !address || amount <= 0n || amount > APTOS_MAX_U64) throw new ChainAdapterError("VALIDATOR_NOT_FOUND", "A valid Aptos delegation pool, owner, and positive u64 amount are required");
    const balances = aptosDelegationStake(await aptosView(`${MODULE}::get_stake`, [pool, address]));
    if (balances.some(value => value > 0n)) {
      throw new ChainAdapterError("NETWORK", "This Aptos wallet already has stake in that pool; choose another. CantonStake tracks one complete wallet/pool delegation.");
    }
    return { kind: "aptos", function: `${MODULE}::add_stake`, args: [pool, amount.toString()] } satisfies UnsignedTx;
  },

  async buildUndelegateTx({ validator, amount, delegator }) {
    const pool = fullAptosAddress(validator);
    const address = fullAptosAddress(delegator);
    if (!pool || !address || amount <= 0n) throw new ChainAdapterError("VALIDATOR_NOT_FOUND", "A valid Aptos delegation pool, owner, and positive amount are required");
    const [owned] = aptosDelegationStake(await aptosView(`${MODULE}::get_stake`, [pool, address]));
    if (owned <= 0n) throw new ChainAdapterError("INSUFFICIENT_BALANCE", "No active stake remains in this Aptos pool");
    const poolStake = await aptosView(`${MODULE}::get_delegation_pool_stake`, [pool]);
    if (poolStake.length !== 4) throw new ChainAdapterError("NETWORK", "Invalid Aptos pool stake view");
    const [poolActive] = poolStake.map(aptosU64);
    if (owned > poolActive) throw new ChainAdapterError("UNBONDING_PERIOD", "Wait for Aptos stake activation before unlocking the entire delegation");
    // A Canton position represents this wallet's entire pool delegation.
    // Include compounded rewards; the native minimum-stake rule clears
    // small rounding/reward residuals accrued before signing. MAX_U64 is
    // not valid for unlock, which first checks the pool's active balance.
    return { kind: "aptos", function: `${MODULE}::unlock`, args: [pool, owned.toString()] } satisfies UnsignedTx;
  },

  async buildClaimTx({ validator, delegator }) {
    const pool = fullAptosAddress(validator);
    const address = fullAptosAddress(delegator);
    if (!pool || !address) throw new ChainAdapterError("VALIDATOR_NOT_FOUND", "Invalid Aptos pool or delegator address");
    const { ready, amount } = aptosPendingWithdrawal(await aptosView(`${MODULE}::get_pending_withdrawal`, [pool, address]));
    if (!ready || amount <= 0n) {
      throw new ChainAdapterError("UNBONDING_PERIOD", "Aptos stake is not withdrawable yet");
    }
    // withdraw caps redemption at this delegator's shares. Requesting the
    // full u64 amount also sweeps rewards accrued after the readiness read.
    return { kind: "aptos", function: `${MODULE}::withdraw`, args: [pool, APTOS_MAX_U64.toString()] } satisfies UnsignedTx;
  },

  async estimateGas(tx) {
    if (tx.kind !== "aptos") throw new ChainAdapterError("NETWORK", "Not an Aptos transaction");
    return 2_000n;
  },

  watchPosition(address, cb) {
    let cancelled = false;
    const tick = async () => {
      try {
        const positions = await aptosAdapter.getDelegations(address);
        if (!cancelled) cb(positions[0] ?? { validator: "", amount: 0n, status: "released" });
      } catch { /* keep polling after temporary read failures */ }
    };
    void tick();
    const timer = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  },
};
