const assert=require('node:assert/strict');
const hre=require('hardhat');
const {setup}=require('./spol-v3-fixture.cjs');
async function main(){
 assert.equal(hre.network.name,'hardhat');
 const [signer]=await hre.ethers.getSigners();
 const f=await setup(signer,{local:true});
 const amount=hre.ethers.parseEther('0.009');
 await(await f.token.deposit({value:amount})).wait();
 const quoted=await f.quoter.quoteExactInputSingle.staticCall(f.addresses.sPOL,f.addresses.wrapper,100,amount,0);
 assert(quoted>0n);
 await(await f.token.approve(f.addresses.router,amount)).wait();
 const deadline=BigInt((await signer.provider.getBlock('latest')).timestamp+300);
 const params={tokenIn:f.addresses.sPOL,tokenOut:f.addresses.wrapper,fee:100,recipient:f.addresses.router,deadline,amountIn:amount,amountOutMinimum:quoted*99n/100n,sqrtPriceLimitX96:0};
 await assert.rejects(()=>f.router.exactInputSingle.staticCall({...params,amountOutMinimum:quoted+1n}));
 const nativeBefore=await signer.provider.getBalance(signer.address);
 const sharesBefore=await f.token.balanceOf(signer.address);
 const tx=await f.router.multicall([f.router.interface.encodeFunctionData('exactInputSingle',[params]),f.router.interface.encodeFunctionData('unwrapWETH9',[params.amountOutMinimum,signer.address])]);
 const r=await tx.wait();
 assert.equal(await f.token.balanceOf(signer.address),sharesBefore-amount);
 assert.equal(await signer.provider.getBalance(signer.address)-nativeBefore+r.fee,quoted);
 assert.equal(await f.wrapper.balanceOf(f.addresses.router),0n);
 assert.equal(await signer.provider.getBalance(f.addresses.router),0n);
 console.log(JSON.stringify({status:'PASS',tests:['fixture deployment','funded V3 pool','quote','slippage rejection','exact token debit','native unwrap payout','gas accounting','no router residue'],scope:'LOCAL TEST TOKENS ONLY; not an Amoy or real sPOL round trip',quotedNative:hre.ethers.formatEther(quoted)}));
}
main().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});
