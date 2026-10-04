// Read-only estimate of a dedicated testnet V3 stack. No signer or broadcasts.
const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');
const {JsonRpcProvider, ContractFactory, parseUnits, formatEther} = require('ethers');
const source = fs.readFileSync(path.resolve(__dirname,'../contracts/TestWrappedPOL.sol'),'utf8');
const compiled = JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'TestWrappedPOL.sol':{content:source}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode']}}}}),{import:(p)=>({contents:fs.readFileSync(require.resolve(p),'utf8')})}));
const errors=(compiled.errors||[]).filter(e=>e.severity==='error');
if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
const w=compiled.contracts['TestWrappedPOL.sol'].TestWrappedPOL;
const artifacts={wrapper:{abi:w.abi,bytecode:'0x'+w.evm.bytecode.object},factory:require('@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json'),router:require('@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json'),quoter:require('@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json'),manager:require('@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json')};
module.exports={artifacts};
async function main(){
 const p=new JsonRpcProvider('https://testnet.cantonstake.pathrocknetwork.org/api/rpc/testnet/polygon',undefined,{batchMaxCount:1});
 try{
 if((await p.getNetwork()).chainId!==80002n)throw Error('Amoy only');
 const dummy='0x0000000000000000000000000000000000000001';
 let total=0n;
 for(const [name,a]of Object.entries(artifacts)){
 const args=name==='router'||name==='quoter'?[dummy,dummy]:name==='manager'?[dummy,dummy,'0x0000000000000000000000000000000000000000']:[];
 const tx=await new ContractFactory(a.abi,a.bytecode).getDeployTransaction(...args);
 const gas=await p.estimateGas(tx);total+=gas;
 console.log(JSON.stringify({contract:name,estimatedGas:String(gas),costAt35GweiPOL:formatEther(gas*parseUnits('35','gwei'))}));
 }
 console.log(JSON.stringify({deploymentGas:String(total),deploymentFeeAt100GweiPOL:formatEther(total*parseUnits('100','gwei')),remainingOperations:'Pool creation, minting and tests are additional; liquidity provision is capital, not gas'}));
 }finally{p.destroy();}
}
if(require.main===module)main().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});
