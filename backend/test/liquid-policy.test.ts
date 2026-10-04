import assert from "node:assert/strict";
import test from "node:test";
import {liquidAmount,liquidPriceImpact,liquidTrackingMessage} from "../src/services/liquid-policy.js";
test("liquid test amounts reject ambiguous, negative, oversized and zero inputs",()=>{
 for(const value of [undefined,1, "0", "-1", "1.5", "1e18", "01", "1000000000000000001"])assert.throws(()=>liquidAmount(value));
 assert.equal(liquidAmount("1"),1n);
 assert.equal(liquidAmount("1000000000000000000"),10n**18n);
});
test("exit quotes cap price impact with both pool token orderings",()=>{
 const q96=1n<<96n;
 assert.equal(liquidPriceImpact(10000n,9990n,q96,true),10);
 assert.equal(liquidPriceImpact(10000n,9990n,q96,false),10);
 assert.equal(liquidPriceImpact(10000n,39960n,q96*2n,true),10);
 assert.equal(liquidPriceImpact(10000n,2497n,q96*2n,false),12);
 assert.equal(liquidPriceImpact(10000n,9500n,q96,true),500);
 assert.throws(()=>liquidPriceImpact(10000n,9499n,q96,true));
 assert.throws(()=>liquidPriceImpact(1n,0n,q96,true));
 assert.throws(()=>liquidPriceImpact(1n,1n,0n,true));
});
test("tracking signature is domain and chain bound with no token approvals",()=>{
 const text=liquidTrackingMessage("0xABC",123);
 assert.match(text,/Wallet: 0xabc/);assert.match(text,/Chain: 80002/);
 assert.match(text,/Issued at: 123/);assert.match(text,/No token approval/);
 assert.notEqual(text,liquidTrackingMessage("0xABC",124));
});
