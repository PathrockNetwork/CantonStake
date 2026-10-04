// A bounded, testnet-only deposit. Never bridges/burns tokens or sends on mainnet.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JsonRpcProvider, Wallet, Contract, parseEther, parseUnits, formatEther } = require('ethers');
const address = '0x3c7a9412b9ab03aad2129a2c2159372516011e45';
const abi = [
  'function paused() view returns(bool)',
  'function lastExchangeRateUpdate() view returns(uint256)',
  'function maxExchangeRateUpdateDelay() view returns(uint256)',
  'function safetyFee() view returns(uint16)',
  'function convertPOLToSPOL(uint256) view returns(uint256)',
  'function balanceOf(address) view returns(uint256)',
  'function buySPOL(uint256) payable',
  'event sPOLMinted(address indexed user,uint256 amountPOL,uint256 amountSPOL)',
];
async function main() {
  // The gateway deliberately rejects batches containing transaction submissions.
  const provider = new JsonRpcProvider('https://testnet.cantonstake.pathrocknetwork.org/api/rpc/testnet/polygon', undefined, {batchMaxCount:1});
  try {
    assert.equal((await provider.getNetwork()).chainId, 80002n);
    const stored = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../.test-wallets/spol-amoy.json'), 'utf8'));
    assert.equal(stored.chainId, 80002);
    const wallet = new Wallet(stored.privateKey, provider);
    assert.equal(wallet.address.toLowerCase(), '0xdb6833afe3209156d128d9076dd31832ce573137');
    const c = new Contract(address, abi, wallet);
    const block = await provider.getBlock('latest');
    assert.equal(await c.paused(), false);
    assert(BigInt(block.timestamp) <= await c.lastExchangeRateUpdate() + await c.maxExchangeRateUpdateDelay());
    const before = await c.balanceOf(wallet.address);
    const nativeBefore = await provider.getBalance(wallet.address);
    console.log(JSON.stringify({wallet:wallet.address, chainId:80002, nativePOL:formatEther(nativeBefore), sPOL:formatEther(before), safetyFeeBps:String(await c.safetyFee())}));
    // Prevent accidental second deposits when re-running after uncertain submission.
    assert.equal(before, 0n, 'Wallet already holds sPOL; inspect the previous test instead of repeating');
    assert.equal(await provider.getTransactionCount(wallet.address, 'latest'), 0, 'Wallet has sent transactions already; inspect before retrying');
    assert.equal(await provider.getTransactionCount(wallet.address, 'pending'), 0, 'Pending transaction exists; do not duplicate');
    const amount = parseEther('0.01');
    const quote = await c.convertPOLToSPOL(amount);
    assert(quote > 0n);
    // Bound simulation gas too: this RPC defaults eth_call to an enormous gas
    // allowance, causing a false insufficient-funds error when fees are set.
    const options = {value:amount, gasLimit:200000n, maxPriorityFeePerGas:parseUnits('35','gwei'), maxFeePerGas:parseUnits('100','gwei')};
    console.log('Simulating deposit');
    await c.buySPOL.staticCall(amount, options);
    console.log('Estimating gas');
    const gasEstimate = await c.buySPOL.estimateGas(amount, options);
    const gasLimit = gasEstimate * 12n / 10n;
    assert(gasLimit * options.maxFeePerGas <= parseEther('0.02'), 'Fee exceeds test budget');
    assert(nativeBefore >= amount + gasLimit * options.maxFeePerGas, 'Insufficient test POL');
    console.log(JSON.stringify({simulation:'PASS',depositPOL:formatEther(amount),quotedSPOL:formatEther(quote),gasEstimate:String(gasEstimate),maxGasPOL:formatEther(gasLimit*options.maxFeePerGas)}));
    if (!process.argv.includes('--send')) return;
    const tx = await c.buySPOL(amount, {...options, gasLimit});
    console.log(JSON.stringify({submittedTx:tx.hash}));
    const receipt = await tx.wait(2, 120000);
    assert.equal(receipt.status, 1);
    const event = receipt.logs.map(l=>{try{return c.interface.parseLog(l);}catch{return null;}}).find(l=>l?.name==='sPOLMinted');
    assert(event);
    assert.equal(event.args.user, wallet.address);
    assert.equal(event.args.amountPOL, amount);
    const after = await c.balanceOf(wallet.address, {blockTag:receipt.blockNumber});
    const nativeAfter = await provider.getBalance(wallet.address, receipt.blockNumber);
    assert.equal(after-before,event.args.amountSPOL);
    assert.equal(nativeBefore-nativeAfter,amount+receipt.fee);
    console.log(JSON.stringify({result:'LIVE DEPOSIT PASS',tx:tx.hash,block:receipt.blockNumber,depositPOL:formatEther(amount),mintedSPOL:formatEther(after-before),gasUsed:String(receipt.gasUsed),gasPaidPOL:formatEther(receipt.fee),remainingPOL:formatEther(nativeAfter),exit:'NOT TESTED: no verified Amoy swap route',canton:'NOT INTEGRATED'}));
  } finally {provider.destroy();}
}
main().catch(e=>{console.error(JSON.stringify({message:e.shortMessage||e.message,rpcError:e.info?.error?.message,revertData:e.data}));process.exitCode=1;});
