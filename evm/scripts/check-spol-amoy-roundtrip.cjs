/** Real deployed sPOL and test pool on an ephemeral Amoy fork; NEVER signs live. */
const assert = require('node:assert/strict');
const hre = require('hardhat');

const SPOL = '0x3c7a9412b9ab03aad2129a2c2159372516011e45';
const ROUTER = '0x2179F58DFfEb0B64F19F7bA568c54A39fd6183C6';
const QUOTER = '0xFAa862C54004832997C5141Bb7eE91510E49Af3F';
const WRAPPER = '0x465572dE80c3B7F7b99158B169F29Aa87D39268E';
const POOL = '0xeE0dC3E9abC99330419aF9C082629D9a40712dC0';

async function main() {
  assert.equal(hre.network.name, 'hardhat', 'LOCAL FORK ONLY');
  console.log('Initializing isolated Amoy fork (no live signing)');
  assert.equal((await hre.ethers.provider.getNetwork()).chainId, 31337n);
  const metadata = await hre.network.provider.send('hardhat_metadata');
  assert.equal(metadata.forkedNetwork.chainId, 80002, 'Must fork Amoy, never mainnet');
  console.log('Fork initialized at Amoy block', metadata.forkedNetwork.forkBlockNumber);
  await hre.network.provider.send('evm_mine');
  const [wallet] = await hre.ethers.getSigners();
  const token = new hre.ethers.Contract(SPOL, [
    'function buySPOL(uint256) payable', 'function balanceOf(address) view returns(uint256)',
    'function approve(address,uint256) returns(bool)', 'function allowance(address,address) view returns(uint256)',
  ], wallet);
  const router = new hre.ethers.Contract(ROUTER, [
    'function factory() view returns(address)', 'function WETH9() view returns(address)',
    'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns(uint256)',
    'function unwrapWETH9(uint256,address) payable', 'function multicall(bytes[]) payable returns(bytes[])',
  ], wallet);
  const quoter = new hre.ethers.Contract(QUOTER, [
    'function factory() view returns(address)', 'function WETH9() view returns(address)',
    'function quoteExactInputSingle(address,address,uint24,uint256,uint160) returns(uint256)',
  ], wallet);
  assert.equal((await router.WETH9()).toLowerCase(), WRAPPER.toLowerCase());
  assert.equal(await router.factory(), await quoter.factory());
  assert.equal(await router.WETH9(), await quoter.WETH9());
  const factory = new hre.ethers.Contract(await router.factory(), ['function getPool(address,address,uint24) view returns(address)'], wallet);
  assert.equal((await factory.getPool(SPOL, WRAPPER, 100)).toLowerCase(), POOL.toLowerCase());
  console.log('Swap contracts verified; executing local deposit');

  const beforeNative = await hre.ethers.provider.getBalance(wallet.address);
  const beforeShares = await token.balanceOf(wallet.address);
  const amount = hre.ethers.parseEther('0.001');
  const deposit = await (await token.buySPOL(amount, { value: amount })).wait();
  assert.equal(deposit.status, 1);
  const minted = await token.balanceOf(wallet.address) - beforeShares;
  assert(minted > 0n);
  const output = await quoter.quoteExactInputSingle.staticCall(SPOL, WRAPPER, 100, minted, 0);
  console.log('Local deposit minted shares; exit quote received');
  assert(output > 0n);
  const approval = await (await token.approve(ROUTER, minted)).wait();
  const block = await hre.ethers.provider.getBlock('latest');
  const params = { tokenIn: SPOL, tokenOut: WRAPPER, fee: 100, recipient: ROUTER,
    deadline: BigInt(block.timestamp + 30), amountIn: minted, amountOutMinimum: output * 99n / 100n, sqrtPriceLimitX96: 0n };
  await assert.rejects(() => router.exactInputSingle.staticCall({ ...params, amountOutMinimum: output + 1n }));
  await assert.rejects(() => router.exactInputSingle.staticCall({ ...params, deadline: BigInt(block.timestamp - 1) }));
  const swap = await (await router.multicall([
    router.interface.encodeFunctionData('exactInputSingle', [params]),
    router.interface.encodeFunctionData('unwrapWETH9', [params.amountOutMinimum, wallet.address]),
  ])).wait();
  assert.equal(swap.status, 1);
  assert.equal(await token.balanceOf(wallet.address), beforeShares);
  assert.equal(await token.allowance(wallet.address, ROUTER), 0n);
  const gas = deposit.fee + approval.fee + swap.fee;
  assert.equal(await hre.ethers.provider.getBalance(wallet.address), beforeNative - amount - gas + output);
  console.log(JSON.stringify({ status: 'PASS', sourceBlock: metadata.forkedNetwork.forkBlockNumber,
    depositPOL: hre.ethers.formatEther(amount), mintedSPOL: hre.ethers.formatEther(minted),
    returnedPOL: hre.ethers.formatEther(output), gasPOL: hre.ethers.formatEther(gas),
    tests: ['official sPOL deposit', 'router/quoter/pool binding', 'exact approval', 'slippage rejection', 'expired swap rejection', 'native POL payout', 'zero residual shares/allowance', 'gas reconciliation'],
    liveTransactions: 0, canton: 'NOT TESTED: fork events are not Canton evidence',
    canonicalRedemption: 'NOT TESTED: this exit is a swap through test liquidity' }));
}

const timeout = setTimeout(() => { console.error('Fork round trip timed out'); process.exit(1); }, 120000);
main().catch(e => { console.error(e.shortMessage || e.message); process.exitCode = 1; }).finally(() => clearTimeout(timeout));
