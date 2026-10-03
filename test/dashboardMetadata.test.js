import test from 'node:test';
import assert from 'node:assert/strict';
process.env.HELIUS_API_KEY='test';
process.env.SUPABASE_URL='https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='test';
const {enrichTokenMetadata}=await import('../src/walletProductService.js');
test('fast dashboard does not call external metadata and preserves accounting',async()=>{
 const original=global.fetch;global.fetch=()=>{throw Error('external request on fast path')};
 try{const d={trades:{best:[{tokenMint:'fast-mint',costSol:2,pnlSol:3}]}};await enrichTokenMetadata(d);assert.equal(d.trades.best[0].costSol,2);assert.equal(d.trades.best[0].pnlSol,3);assert.equal(d.trades.best[0].priceUsd,null);}finally{global.fetch=original}
});
test('full metadata warms cache for subsequent fast dashboard',async()=>{
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;return{ok:true,json:async()=>({result:{content:{metadata:{name:'Example',symbol:'EX'},links:{image:'https://example.invalid/image.png'}},token_info:{price_info:{price_per_token:2}}}})}};
 try{const make=()=>({trades:{best:[{tokenMint:'warm-mint',costSol:2,pnlSol:3}]}});await enrichTokenMetadata(make(),true);const count=calls;const d=make();await enrichTokenMetadata(d);assert.equal(calls,count);assert.equal(d.trades.best[0].tokenSymbol,'EX');assert.equal(d.trades.best[0].pnlSol,3);}finally{global.fetch=original}
});
