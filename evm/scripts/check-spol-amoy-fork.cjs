/**
 * Real Amoy bytecode/state, transactions on an ephemeral LOCAL fork only.
 * Run from evm/: npx hardhat run --no-compile --config spol-test.config.cjs scripts/check-spol-amoy-fork.cjs
 * No deployment keys, no live transaction submission, no fake sPOL liquidity.
 */
const assert = require("node:assert/strict");
const hre = require("hardhat");

const SPOL = "0x3c7a9412b9ab03aad2129a2c2159372516011e45";
const ABI = [
  "function paused() view returns (bool)",
  "function safetyFee() view returns (uint16)",
  "function lastExchangeRateUpdate() view returns (uint256)",
  "function maxExchangeRateUpdateDelay() view returns (uint256)",
  "function convertPOLToSPOL(uint256) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function buySPOL(uint256) payable",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)",
  "function transferFrom(address,address,uint256) returns (bool)",
  "function withdraw(uint256)",
  "function pauseBuy()",
  "event sPOLMinted(address indexed user,uint256 amountPOL,uint256 amountSPOL)",
];

async function main() {
  assert.equal(hre.network.name, "hardhat", "Local fork only");
  const upstream = new hre.ethers.JsonRpcProvider(process.env.SPOL_AMOY_RPC_URL ||
    "https://testnet.cantonstake.pathrocknetwork.org/api/rpc/testnet/polygon");
  assert.equal((await upstream.getNetwork()).chainId, 80002n, "Upstream must be Amoy");
  console.log("Starting isolated Amoy fork; no public transactions will be sent");
  const metadata = await hre.network.provider.send("hardhat_metadata");
  assert.equal(metadata.forkedNetwork.chainId, 80002);
  const block = await upstream.getBlock(metadata.forkedNetwork.forkBlockNumber);
  console.log("Fork source block", block.number);
  // Execute calls in a local block under our explicit Cancun configuration,
  // rather than EDR's historical remote-block execution path.
  await hre.network.provider.send("evm_mine");
  const [wallet, recipient, spender] = await hre.ethers.getSigners();
  const c = new hre.ethers.Contract(SPOL, ABI, wallet);
  const results = [];
  const record = (name, details = {}) => { results.push({ name, status: "PASS", ...details }); console.log(JSON.stringify(results.at(-1))); };
  async function reverts(name, run) {
    await assert.rejects(run, (e) => /revert|CALL_EXCEPTION/i.test(e.message));
    record(name);
  }
  const paused = await c.paused();
  const updated = await c.lastExchangeRateUpdate();
  const maxAge = await c.maxExchangeRateUpdateDelay();
  assert.equal(paused, false);
  assert(BigInt(block.timestamp) <= updated + maxAge, "Exchange rate must be fresh");
  record("Amoy contract active and exchange rate fresh", {
    sourceChainId: 80002, localChainId: 31337, block: block.number,
    blockTime: new Date(block.timestamp * 1000).toISOString(),
    safetyFeeBps: String(await c.safetyFee()),
    lastExchangeRateUpdate: String(updated), maxAgeSeconds: String(maxAge),
  });

  const amount = hre.ethers.parseEther("0.01");
  const quote = await c.convertPOLToSPOL(amount);
  assert(quote > 0n);
  const before = await c.balanceOf(wallet.address);
  const supply = await c.totalSupply();
  const polBefore = await hre.ethers.provider.getBalance(wallet.address);
  const receipt = await (await c.buySPOL(amount, { value: amount })).wait();
  assert.equal(receipt.status, 1);
  assert.equal(await c.balanceOf(wallet.address), before + quote);
  assert.equal(await c.totalSupply(), supply + quote);
  assert.equal(polBefore - await hre.ethers.provider.getBalance(wallet.address), amount + receipt.fee);
  const minted = receipt.logs.map((l) => { try { return c.interface.parseLog(l); } catch { return null; } })
    .find((l) => l?.name === "sPOLMinted");
  assert(minted, "sPOLMinted event required for indexing");
  assert.equal(minted.args.user, wallet.address);
  assert.equal(minted.args.amountPOL, amount);
  assert.equal(minted.args.amountSPOL, quote);
  record("Deposit native POL, exact minted balance, supply, event and native gas accounting", {
    inputPOL: hre.ethers.formatEther(amount), outputSPOL: hre.ethers.formatEther(quote),
    gasUsed: String(receipt.gasUsed), forkGasPOL: hre.ethers.formatEther(receipt.fee),
  });
  await reverts("Zero deposit rejected", () => c.buySPOL.staticCall(0n));
  await reverts("Mismatched native value rejected", () => c.buySPOL.staticCall(amount, { value: amount - 1n }));
  await reverts("Unauthorized pause rejected", () => c.pauseBuy.staticCall());

  const moved = quote / 4n;
  const recipientBefore = await c.balanceOf(recipient.address);
  await (await c.transfer(recipient.address, moved)).wait();
  assert.equal(await c.balanceOf(recipient.address), recipientBefore + moved);
  record("sPOL transfers update holder balances");
  await reverts("Spending without allowance rejected", () => c.connect(spender).transferFrom.staticCall(wallet.address, recipient.address, moved));
  await (await c.approve(spender.address, moved)).wait();
  assert.equal(await c.allowance(wallet.address, spender.address), moved);
  await (await c.connect(spender).transferFrom(wallet.address, recipient.address, moved)).wait();
  assert.equal(await c.allowance(wallet.address, spender.address), 0n);
  assert.equal(await c.balanceOf(recipient.address), recipientBefore + 2n * moved);
  record("Exact approval and transferFrom work; allowance consumed");

  // IMPORTANT: withdraw() is a bridge burn, NOT a local POL redemption.
  const balanceBeforeBurn = await c.balanceOf(wallet.address);
  const nativeBeforeBurn = await hre.ethers.provider.getBalance(wallet.address);
  const burnReceipt = await (await c.withdraw(moved)).wait();
  assert.equal(await c.balanceOf(wallet.address), balanceBeforeBurn - moved);
  assert.equal(nativeBeforeBurn - await hre.ethers.provider.getBalance(wallet.address), burnReceipt.fee);
  record("Bridge withdraw burns sPOL but returns ZERO native POL locally");

  // Only advance local fork time; no privileged contract storage edits.
  await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(updated + maxAge + 1n)]);
  await hre.network.provider.send("evm_mine");
  await reverts("Stale exchange rate blocks deposits", () => c.buySPOL.staticCall(amount, { value: amount }));
  console.log(JSON.stringify({ summary: { passed: results.length, liveTransactions: 0,
    swapExit: "NOT TESTED: no verified Amoy sPOL/native-POL liquidity route",
    cantonIntegration: "NOT IMPLEMENTED", fullLiveRoundTrip: "BLOCKED" } }));
  upstream.destroy();
}

const deadline = setTimeout(() => {
  console.error("Fork diagnostics timed out; no full-test success may be inferred");
  process.exit(1);
}, 120_000);
main().catch((e) => { console.error(e.shortMessage || e.message); process.exitCode = 1; })
  .finally(() => clearTimeout(deadline));
