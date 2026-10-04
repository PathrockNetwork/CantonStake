// Isolated Uniswap V3 fixture. Native wrapper and liquidity are TEST ONLY.
const {Contract,ContractFactory,parseEther,parseUnits,ZeroAddress} = require('ethers');
const {artifacts} = require('./estimate-spol-fixture.cjs');
const SPOL='0x3c7a9412b9ab03aad2129a2c2159372516011e45';
const tokenAbi=['function approve(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)','function buySPOL(uint256) payable'];
function sqrt(n){ if(n<0n)throw Error('Negative square root');if(n<2n)return n;let x=n,y=(x+1n)/2n;while(y<x){x=y;y=(x+n/x)/2n;}return x; }
async function setup(signer,{local=false,record=()=>{}}={}){
 const chain=(await signer.provider.getNetwork()).chainId;
 if(chain!==(local?31337n:80002n))throw Error('Wrong fixture network');
 const fees=local?{}:{maxPriorityFeePerGas:parseUnits('35','gwei'),maxFeePerGas:parseUnits('100','gwei')};
 const addresses={};
 async function confirm(tx,label){record({stage:label,txHash:tx.hash,status:'submitted'});const r=await tx.wait(local?1:2,120000);if(r.status!==1)throw Error(label+' reverted');record({stage:label,txHash:tx.hash,status:'confirmed',gasUsed:String(r.gasUsed),gasFee:String(r.fee)});return r;}
 async function deploy(name,args=[]){const c=await new ContractFactory(artifacts[name].abi,artifacts[name].bytecode,signer).deploy(...args,fees);await confirm(c.deploymentTransaction(),'deploy-'+name);addresses[name]=await c.getAddress();record({addresses:{...addresses}});return c;}
 const wrapper=await deploy('wrapper');
 let token;
 if(local){token=await new ContractFactory(artifacts.wrapper.abi,artifacts.wrapper.bytecode,signer).deploy();await token.waitForDeployment();addresses.sPOL=await token.getAddress();}
 else {addresses.sPOL=SPOL;token=new Contract(SPOL,tokenAbi,signer);}
 const originalSPOL=await token.balanceOf(signer.address);
 const factory=await deploy('factory');
 const router=await deploy('router',[addresses.factory,addresses.wrapper]);
 const quoter=await deploy('quoter',[addresses.factory,addresses.wrapper]);
 // The zero descriptor disables NFT metadata only. Liquidity mint/burn works.
 const manager=await deploy('manager',[addresses.factory,addresses.wrapper,ZeroAddress]);
 await confirm(await factory.enableFeeAmount(100,1,fees),'enable-100-fee');
 const seed=parseEther('0.25');
 if(local)await confirm(await token.deposit({value:seed}),'seed-test-token');
 else await confirm(await token.buySPOL(seed,{...fees,value:seed,gasLimit:200000n}),'seed-spol');
 const seedShares=await token.balanceOf(signer.address)-originalSPOL;
 if(seedShares<=0n)throw Error('No seed sPOL minted');
 await confirm(await wrapper.deposit({...fees,value:seed}),'wrap-seed-pol');
 const [token0,token1]=[addresses.sPOL,addresses.wrapper].sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
 const amount0=token0===addresses.sPOL?seedShares:seed;
 const amount1=token1===addresses.sPOL?seedShares:seed;
 const price=sqrt((amount1<<192n)/amount0);
 await confirm(await manager.createAndInitializePoolIfNecessary(token0,token1,100,price,fees),'create-pool');
 addresses.pool=await factory.getPool(token0,token1,100);
 record({addresses:{...addresses},seedPOL:String(seed),seedSPOL:String(seedShares),originalSPOL:String(originalSPOL)});
 await confirm(await token.approve(addresses.manager,seedShares,fees),'approve-spol-seed');
 await confirm(await wrapper.approve(addresses.manager,seed,fees),'approve-pol-seed');
 const deadline=BigInt((await signer.provider.getBlock('latest')).timestamp+600);
 const receipt=await confirm(await manager.mint({token0,token1,fee:100,tickLower:-887272,tickUpper:887272,amount0Desired:amount0,amount1Desired:amount1,amount0Min:amount0*99n/100n,amount1Min:amount1*99n/100n,recipient:signer.address,deadline},fees),'mint-liquidity');
 const event=receipt.logs.map(l=>{try{return manager.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='IncreaseLiquidity');
 if(!event)throw Error('Missing liquidity event');
 await confirm(await token.approve(addresses.manager,0n,fees),'revoke-spol-seed');
 await confirm(await wrapper.approve(addresses.manager,0n,fees),'revoke-pol-seed');
 record({addresses:{...addresses},liquidityTokenId:String(event.args.tokenId),complete:true,testOnly:true});
 return{addresses,token,wrapper,router,quoter,manager,fees,confirm};
}
module.exports={setup,sqrt};
