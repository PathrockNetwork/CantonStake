import { createPublicClient, http, parseAbi, isAddress, type Address } from "viem";
import { config } from "../config.js";
import { rpcUrls } from "./rpc-registry.js";
import { canton } from "../canton.js";
import { prisma } from "../db.js";
import { createdContracts } from "./canton-ledger-client.js";
import { fromUnits } from "./daml-decimal.js";

export const SPOL = "0x3c7a9412b9ab03aad2129a2c2159372516011e45" as const;
export const liquidAbi = parseAbi([
  "function balanceOf(address) view returns(uint256)",
  "function paused() view returns(bool)",
  "function lastExchangeRateUpdate() view returns(uint256)",
  "function maxExchangeRateUpdateDelay() view returns(uint256)",
  "function safetyFee() view returns(uint16)",
  "function convertPOLToSPOL(uint256) view returns(uint256)",
  "function buySPOL(uint256) payable",
]);
export const liquidClient = createPublicClient({ transport: http(rpcUrls.polygon, { timeout: 15000, retryCount: 0 }) });
const template = "#cantonstake-liquid:CantonStake.Liquid:LiquidBalance";
export async function liquidLedgerBalance(wallet: Address) {
  const contracts=await canton.activeContracts(template);
  const rows=contracts.filter(c=>c.argument.wallet===wallet.toLowerCase());
  if(rows.length>1)throw new Error("Duplicate ledger records");
  return rows[0]?{shares:String(rows[0].argument.sharesBaseUnits),observedBlock:String(rows[0].argument.observedBlock)}:null;
}
export const liquidEnabled = () => config.networkMode === "testnet" && process.env.SPOL_TEST_ENABLED === "true";
export function liquidFixture() {
  const keys = ["SPOL_TEST_ROUTER", "SPOL_TEST_QUOTER", "SPOL_TEST_WRAPPER", "SPOL_TEST_POOL"] as const;
  const values = keys.map(k => process.env[k]);
  if (!values.every(v => v && isAddress(v) && !/^0x0{40}$/i.test(v))) throw new Error("Test swap fixture is not configured");
  return { router: values[0] as Address, quoter: values[1] as Address, wrapper: values[2] as Address, pool: values[3] as Address };
}
export async function assertLiquidChain() {
  if (!liquidEnabled() || await liquidClient.getChainId() !== 80002) throw new Error("Amoy liquid staking is disabled or RPC is on the wrong chain");
}
const busy = new Set<string>();
/** POL value of sPOL shares at the contract's exchange rate (18-decimal wei). */
export async function liquidPolValue(shares: bigint, blockNumber?: bigint,
  client: Pick<typeof liquidClient, "readContract"> = liquidClient): Promise<bigint> {
  if (shares === 0n) return 0n;
  const spolPerPol = await client.readContract({ address: SPOL, abi: liquidAbi, functionName: "convertPOLToSPOL", args: [10n ** 18n], blockNumber });
  if (spolPerPol <= 0n) throw new Error("sPOL exchange rate unavailable");
  return shares * 10n ** 18n / spolPerPol;
}

export const LIQUID_POSITION_CHAIN = "polygon-liquid";

/**
 * Mirror a tracked holding as a staking position (amount = POL value) so CC
 * reward allocation, payouts and history treat it like validator stake. Only
 * wallets linked to a CantonStake user join the pool; none are invented.
 */
async function mirrorLiquidPosition(wallet: string, contractId: string, shares: bigint, polWei: bigint): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { evmAddress: wallet } });
  if (!user) return false;
  const data = { contractId, userId: user.id, evmAddress: wallet, chain: LIQUID_POSITION_CHAIN, amountPol: fromUnits(polWei / 10n ** 8n),
    amountShares: String(shares), status: shares > 0n ? "Bonded" : "Released", validatorShare: SPOL };
  const existing = await prisma.stakingPosition.findFirst({ where: { evmAddress: wallet, chain: LIQUID_POSITION_CHAIN } });
  if (existing) await prisma.stakingPosition.update({ where: { id: existing.id }, data });
  else if (shares > 0n) await prisma.stakingPosition.create({ data });
  return true;
}

// Ledger is the persistent registry; the position mirror is derived from it.
export async function syncLiquidWallet(wallet: Address, allowCreate = false) {
  const normalized = wallet.toLowerCase();
  if (busy.has(normalized)) throw new Error("Synchronization already in progress");
  busy.add(normalized);
  try {
    await assertLiquidChain();
    const contracts = await canton.activeContracts(template);
    const matches = contracts.filter(c => c.argument.wallet === normalized);
    if (matches.length > 1) throw new Error("Duplicate ledger records require reconciliation");
    const existing = matches[0];
    if (existing) {
      const previous = await liquidClient.getBlock({blockNumber:BigInt(String(existing.argument.observedBlock))});
      if (previous.hash !== existing.argument.observedBlockHash) throw new Error("Confirmed block changed; ledger reconciliation required");
    }
    if (!existing && !allowCreate) throw new Error("Wallet is not registered");
    if (!existing && contracts.length >= 50) throw new Error("Test wallet registry capacity reached");
    const tip = await liquidClient.getBlockNumber();
    const block = await liquidClient.getBlock({ blockNumber: tip - 12n });
    const shares = await liquidClient.readContract({ address: SPOL, abi: liquidAbi, functionName: "balanceOf", args: [wallet], blockNumber: block.number });
    let contractId = existing?.contractId;
    if (!existing) {
      const result = await canton.createContract({ templateId: template, argument: { operator: config.cantonAppProviderParty, wallet: normalized, chainId: 80002, token: SPOL, sharesBaseUnits: String(shares), observedBlock: String(block.number), observedBlockHash: block.hash } });
      contractId = createdContracts(result.events)[0]?.contractId;
    } else if (BigInt(String(existing.argument.observedBlock)) < block.number && existing.argument.sharesBaseUnits !== String(shares)) {
      const result = await canton.exerciseChoice({ templateId: template, contractId: existing.contractId, choice: "LiquidBalance_Observe", argument: { newSharesBaseUnits: String(shares), newBlock: String(block.number), newBlockHash: block.hash } });
      contractId = createdContracts(result.events)[0]?.contractId ?? contractId;
    }
    if (!contractId) throw new Error("Canton did not return the liquid balance contract");
    const rewardsEnabled = await mirrorLiquidPosition(normalized, contractId, shares, await liquidPolValue(shares, block.number));
    return { synchronized: true, shares: String(shares), observedBlock: String(block.number), rewardsEnabled };
  } finally { busy.delete(normalized); }
}
export function startLiquidTracking(onError: (error: unknown) => void) {
  let running = false;
  const tick = async () => {
    if (!liquidEnabled() || running) return;
    running = true;
    try {
      const contracts = await canton.activeContracts(template);
      for (const c of contracts) {
        try { await syncLiquidWallet(c.argument.wallet as Address); } catch (e) { onError(e); }
      }
    } catch (e) { onError(e); } finally { running = false; }
  };
  const timer = setInterval(() => void tick(), 60000);
  timer.unref();
  return () => clearInterval(timer);
}
