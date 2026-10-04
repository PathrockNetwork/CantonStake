const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {JsonRpcProvider,Wallet,Contract,parseEther,parseUnits,formatEther}=require('ethers');
const routerArtifact=require('@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json');
const quoterArtifact=require('@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json');
async function main(){
 const provider=new JsonRpcProvider('https://testnet.cantonstake.pathrocknetwork.org/api/rpc/testnet/polygon',undefined,{batchMaxCount:1});
 try{
 assert.equal((await provider.getNetwork()).chainId,80002n);
 const fixture=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../deployments/spol-amoy-fixture.json'),'utf8'));assert.equal(fixture.complete,true);assert.equal(fixture.chainId,80002);
 const key=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../.test-wallets/spol-amoy.json'),'utf8'));const wallet=new Wallet(key.privateKey,provider);assert.equal(wallet.address,fixture.wallet);
 const a=fixture.addresses;
 const token=new Contract(a.sPOL,['function balanceOf(address) view returns(uint256)','function approve(address,uint256) returns(bool)','function allowance(address,address) view returns(uint256)'],wallet);
 const router=new Contract(a.router,routerArtifact.abi,wallet);const quoter=new Contract(a.quoter,quoterArtifact.abi,provider);
 assert.equal((await router.factory()).toLowerCase(),a.factory.toLowerCase());assert.equal((await router.WETH9()).toLowerCase(),a.wrapper.toLowerCase());
 const amount=await token.balanceOf(wallet.address);assert(amount>0n&&amount<parseEther('0.011'),'Only original small test deposit may be sold');
 const fees={maxPriorityFeePerGas:parseUnits('35','gwei'),maxFeePerGas:parseUnits('100','gwei')};
 const nativeBefore=await provider.getBalance(wallet.address);
 const q=await quoter.quoteExactInputSingle.staticCall(a.sPOL,a.wrapper,100,amount,0);assert(q>0n);
 console.log(JSON.stringify({wallet:wallet.address,sPOL:formatEther(amount),quotePOL:formatEther(q),testOnly:true}));
 if(!process.argv.includes('--exit'))return;
 // Register using the SAME signature flow offered by the test frontend.
 const issuedAt=Date.now();const message=`CantonStake Amoy sPOL balance tracking\nWallet: ${wallet.address.toLowerCase()}\nChain: 80002\nIssued at: ${issuedAt}\nRecords public token balances on Canton. No token approval or CC reward entitlement.`;
 const response=await fetch('https://testnet.cantonstake.pathrocknetwork.org/api/polygon/liquid/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({wallet:wallet.address,issuedAt,signature:await wallet.signMessage(message)})});
 if(!response.ok)throw Error('Canton tracking must succeed before exit test: HTTP '+response.status);
 console.log('Canton pre-exit tracking',await response.text());
 const approval=await token.approve(a.router,amount,{...fees,gasLimit:100000n});console.log('Approval',approval.hash);const ar=await approval.wait(2,120000);assert.equal(ar.status,1);
 const output=await quoter.quoteExactInputSingle.staticCall(a.sPOL,a.wrapper,100,amount,0);const minimum=output*99n/100n;
 const deadline=BigInt((await provider.getBlock('latest')).timestamp+120);
 const params={tokenIn:a.sPOL,tokenOut:a.wrapper,fee:100,recipient:a.router,deadline,amountIn:amount,amountOutMinimum:minimum,sqrtPriceLimitX96:0n};
 const data=[router.interface.encodeFunctionData('exactInputSingle',[params]),router.interface.encodeFunctionData('unwrapWETH9',[minimum,wallet.address])];
 await router.multicall.staticCall(data,{...fees,gasLimit:300000n});
 const tx=await router.multicall(data,{...fees,gasLimit:300000n});console.log('Exit',tx.hash);const r=await tx.wait(2,120000);assert.equal(r.status,1);
 const remaining=await token.balanceOf(wallet.address,{blockTag:r.blockNumber});assert.equal(remaining,0n);
 assert.equal(await token.allowance(wallet.address,a.router),0n);
 const nativeAfter=await provider.getBalance(wallet.address,r.blockNumber);const received=nativeAfter-nativeBefore+ar.fee+r.fee;assert(received>=minimum);
 const result={status:'LIVE AMOY DEPOSIT/SWAP ROUND TRIP PASS',exitTx:tx.hash,approvalTx:approval.hash,block:r.blockNumber,soldSPOL:formatEther(amount),receivedPOL:formatEther(received),exitAndApprovalGasPOL:formatEther(ar.fee+r.fee),remainingPOL:formatEther(nativeAfter),remainingSPOL:String(remaining),liquidity:'SELF-SEEDED TEST FIXTURE',cantonPostExit:'must verify after 12 blocks and next poll'};
 fs.writeFileSync(path.resolve(__dirname,'../deployments/spol-amoy-roundtrip.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
 }finally{provider.destroy();}
}
main().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});
