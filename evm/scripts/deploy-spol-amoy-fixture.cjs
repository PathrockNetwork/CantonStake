// One-shot deployment. Refuses to repeat if a journal exists; inspect it first.
const fs=require('node:fs');
const path=require('node:path');
const {JsonRpcProvider,Wallet,parseEther,formatEther}=require('ethers');
const {setup}=require('./spol-v3-fixture.cjs');
async function main(){
 const provider=new JsonRpcProvider('https://testnet.cantonstake.pathrocknetwork.org/api/rpc/testnet/polygon',undefined,{batchMaxCount:1});
 try{
 if((await provider.getNetwork()).chainId!==80002n)throw Error('Amoy only');
 const key=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../.test-wallets/spol-amoy.json'),'utf8'));
 const wallet=new Wallet(key.privateKey,provider);
 if(wallet.address!==key.address||key.chainId!==80002)throw Error('Wallet mismatch');
 const balance=await provider.getBalance(wallet.address);
 console.log(JSON.stringify({wallet:wallet.address,balancePOL:formatEther(balance),requiredBudgetPOL:'3',liquidityPOL:'0.5',testOnly:true}));
 if(balance<parseEther('3'))throw Error('Need at least 3 Amoy POL before deploying the complete test fixture');
 if(!process.argv.includes('--deploy'))return;
 if(await provider.getTransactionCount(wallet.address,'latest')!==await provider.getTransactionCount(wallet.address,'pending'))throw Error('Pending transaction exists');
 const directory=path.resolve(__dirname,'../deployments');fs.mkdirSync(directory,{recursive:true});
 const file=path.join(directory,'spol-amoy-fixture.json');
 const state={chainId:80002,testOnly:true,wallet:wallet.address,startedAt:new Date().toISOString(),addresses:{},events:[]};
 fs.writeFileSync(file,JSON.stringify(state,null,2),{flag:'wx'});
 const record=event=>{
   if(event.addresses)state.addresses=event.addresses;
   for(const k of ['complete','liquidityTokenId','seedPOL','seedSPOL','originalSPOL'])if(event[k]!==undefined)state[k]=event[k];
   state.events.push(event);
   fs.writeFileSync(file+'.tmp',JSON.stringify(state,null,2)+'\n');fs.renameSync(file+'.tmp',file);
   console.log(JSON.stringify(event));
 };
 await setup(wallet,{record});
 console.log('Fixture ready; no swap has been performed yet');
 }finally{provider.destroy();}
}
main().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});
