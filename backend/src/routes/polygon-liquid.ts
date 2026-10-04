import type { FastifyPluginAsync } from "fastify";
import { isAddress, parseAbi, verifyMessage, type Address, type Hex } from "viem";
import { liquidAmount, liquidPriceImpact, liquidTrackingMessage } from "../services/liquid-policy.js";
import * as liquidServices from "../services/polygon-liquid.js";

const quoterAbi = parseAbi(["function quoteExactInputSingle(address,address,uint24,uint256,uint160) returns(uint256)"]);
const poolAbi = parseAbi(["function token0() view returns(address)", "function token1() view returns(address)", "function liquidity() view returns(uint128)", "function fee() view returns(uint24)", "function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)"]);
const routingAbi = parseAbi(["function factory() view returns(address)", "function WETH9() view returns(address)", "function getPool(address,address,uint24) view returns(address)"]);
export function polygonLiquidRoutesFor(services: typeof liquidServices = liquidServices): FastifyPluginAsync {
const { SPOL, liquidAbi, liquidClient, liquidEnabled, liquidFixture, assertLiquidChain, syncLiquidWallet, startLiquidTracking, liquidLedgerBalance } = services;
return async app => {
  const syncedAt = new Map<string, number>();
  let requests = 0, windowStart = Date.now();
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api/polygon/liquid")) return;
    reply.header("Cache-Control", "no-store");
    if (!liquidEnabled()) return reply.code(404).send({error:"Test liquid staking is disabled"});
    if (Date.now() - windowStart > 60000) { requests = 0; windowStart = Date.now(); }
    if (++requests > 300) return reply.code(429).send({error:"Test route capacity exceeded"});
  });
  app.get<{Querystring:{wallet?:string}}>("/api/polygon/liquid", async (req, reply) => {
    if (req.query.wallet && !isAddress(req.query.wallet)) return reply.code(400).send({error:"Invalid wallet"});
    try {
      await assertLiquidChain();
      const fixture = liquidFixture();
      const block = await liquidClient.getBlock();
      const read = (functionName: "paused" | "lastExchangeRateUpdate" | "maxExchangeRateUpdateDelay" | "safetyFee") => liquidClient.readContract({address:SPOL,abi:liquidAbi,functionName,blockNumber:block.number});
      const [paused, updated, delay, fee] = await Promise.all([read("paused"),read("lastExchangeRateUpdate"),read("maxExchangeRateUpdateDelay"),read("safetyFee")]);
      const wallet = req.query.wallet as Address | undefined;
      let tracking:Awaited<ReturnType<typeof liquidLedgerBalance>>|"unavailable"=null;
      if(wallet){try{tracking=await liquidLedgerBalance(wallet);}catch{tracking="unavailable";}}
      return {chainId:80002,testOnly:true,token:SPOL,wallet:wallet?.toLowerCase()??null,...fixture,paused,rateFresh:BigInt(updated)+BigInt(delay)>=block.timestamp,safetyFeeBps:Number(fee),block:String(block.number),
        nativeBalance: wallet ? String(await liquidClient.getBalance({address:wallet,blockNumber:block.number})) : null,
        sharesBalance: wallet ? String(await liquidClient.readContract({address:SPOL,abi:liquidAbi,functionName:"balanceOf",args:[wallet],blockNumber:block.number})) : null,
        ccRewardsEnabled:false,trackingConfirmations:12,tracking};
    } catch { return reply.code(503).send({error:"Amoy liquidity route unavailable"}); }
  });
  app.get<{Querystring:{amount:string;direction:string}}>("/api/polygon/liquid/quote", async (req, reply) => {
    let amount: bigint;
    try { amount=liquidAmount(req.query.amount); } catch(e) { return reply.code(400).send({error:(e as Error).message}); }
    if (!["deposit","exit"].includes(req.query.direction)) return reply.code(400).send({error:"Invalid direction"});
    try {
      await assertLiquidChain();
      const fixture=liquidFixture();
      let output: bigint;
      let priceImpactBps: number | null = null;
      if(req.query.direction==="deposit") {
        const b=await liquidClient.getBlock();
        const paused=await liquidClient.readContract({address:SPOL,abi:liquidAbi,functionName:"paused",blockNumber:b.number});
        const updated=await liquidClient.readContract({address:SPOL,abi:liquidAbi,functionName:"lastExchangeRateUpdate",blockNumber:b.number});
        const delay=await liquidClient.readContract({address:SPOL,abi:liquidAbi,functionName:"maxExchangeRateUpdateDelay",blockNumber:b.number});
        if(paused||updated+delay<b.timestamp)throw Error("Deposit unavailable");
        output=await liquidClient.readContract({address:SPOL,abi:liquidAbi,functionName:"convertPOLToSPOL",args:[amount],blockNumber:b.number});
      } else {
        const blockNumber=await liquidClient.getBlockNumber();
        const [t0,t1,liq,fee,slot,routerFactory,quoterFactory,routerWrapper,quoterWrapper]=await Promise.all([
          liquidClient.readContract({address:fixture.pool,abi:poolAbi,functionName:"token0",blockNumber}),
          liquidClient.readContract({address:fixture.pool,abi:poolAbi,functionName:"token1",blockNumber}),
          liquidClient.readContract({address:fixture.pool,abi:poolAbi,functionName:"liquidity",blockNumber}),
          liquidClient.readContract({address:fixture.pool,abi:poolAbi,functionName:"fee",blockNumber}),
          liquidClient.readContract({address:fixture.pool,abi:poolAbi,functionName:"slot0",blockNumber}),
          liquidClient.readContract({address:fixture.router,abi:routingAbi,functionName:"factory",blockNumber}),
          liquidClient.readContract({address:fixture.quoter,abi:routingAbi,functionName:"factory",blockNumber}),
          liquidClient.readContract({address:fixture.router,abi:routingAbi,functionName:"WETH9",blockNumber}),
          liquidClient.readContract({address:fixture.quoter,abi:routingAbi,functionName:"WETH9",blockNumber}),
        ]);
        if(![t0,t1].some(t=>t.toLowerCase()===SPOL)||![t0,t1].some(t=>t.toLowerCase()===fixture.wrapper.toLowerCase())||liq===0n||fee!==100)throw Error("Invalid pool");
        if(routerFactory.toLowerCase()!==quoterFactory.toLowerCase()||[routerWrapper,quoterWrapper].some(a=>a.toLowerCase()!==fixture.wrapper.toLowerCase()))throw Error("Mismatched swap contracts");
        const routedPool=await liquidClient.readContract({address:routerFactory,abi:routingAbi,functionName:"getPool",args:[SPOL,fixture.wrapper,100],blockNumber});
        if(routedPool.toLowerCase()!==fixture.pool.toLowerCase())throw Error("Router pool mismatch");
        output=(await liquidClient.simulateContract({address:fixture.quoter,abi:quoterAbi,functionName:"quoteExactInputSingle",args:[SPOL,fixture.wrapper,100,amount,0n],blockNumber})).result;
        priceImpactBps=liquidPriceImpact(amount,output,slot[0],t0.toLowerCase()===SPOL);
      }
      if(output*99n/100n<=0n)throw Error("Empty quote");
      return {chainId:80002,token:SPOL,...fixture,amountIn:String(amount),amountOut:String(output),minimumOut:String(output*99n/100n),expiresAt:Date.now()+30000,direction:req.query.direction,testOnly:true,priceImpactBps};
    } catch { return reply.code(503).send({error:"No executable quote; pool liquidity or deposit rate may be unavailable"}); }
  });
  app.post<{Body:{wallet:string;issuedAt:number;signature:Hex}}>("/api/polygon/liquid/track", {bodyLimit:4096}, async (req,reply) => {
    const b=req.body;
    if(!b||!isAddress(b.wallet)||!Number.isSafeInteger(b.issuedAt)||b.issuedAt>Date.now()+10000||Date.now()-b.issuedAt>300000||typeof b.signature!=="string"||!/^0x[0-9a-fA-F]{130}$/.test(b.signature))return reply.code(400).send({error:"Invalid tracking authorization"});
    try {
      if(!await verifyMessage({address:b.wallet as Address,message:liquidTrackingMessage(b.wallet,b.issuedAt),signature:b.signature}))return reply.code(403).send({error:"Invalid wallet signature"});
      const key=b.wallet.toLowerCase();
      if(Date.now()-(syncedAt.get(key)??0)<60000)return reply.code(429).send({error:"Please wait a minute before synchronizing again"});
      syncedAt.set(key,Date.now());
      return await syncLiquidWallet(b.wallet as Address,true);
    } catch { return reply.code(503).send({error:"Canton tracking unavailable; on-chain funds are unaffected"}); }
  });
  const stop=startLiquidTracking(e=>app.log.warn({message:e instanceof Error?e.message:"Liquid tracking failed"},"sPOL tracker"));
  app.addHook("onClose",async()=>stop());
};
}
export default polygonLiquidRoutesFor();
