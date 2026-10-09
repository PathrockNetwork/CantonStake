import { strict as assert } from "node:assert";
import { readLidoState, lidoClient, lidoAbi, LIDO } from "../lib/lido";
import { parseEther, zeroAddress } from "viem";

async function main() {
  const state = await readLidoState(zeroAddress);
  assert.equal(state.wallet, zeroAddress);
  assert(state.balance >= 0n);
  assert(state.stETH >= 0n);
  const shares = await lidoClient.readContract({ address: LIDO, abi: lidoAbi, functionName: "getSharesByPooledEth", args: [parseEther("0.01")] });
  assert(shares > 0n);
  console.log(JSON.stringify({ chainId: 560048, pool: LIDO, block: String(state.block), paused: state.paused, stakeLimit: String(state.stakeLimit), withdrawalPaused: state.withdrawalPaused, minWithdrawal: String(state.minWithdrawal), maxWithdrawal: String(state.maxWithdrawal), sharesForPointZeroOneEth: String(shares), signedTransactions: 0 }));
}
main().catch(error => { console.error(error.shortMessage ?? error.message); process.exitCode = 1; });
