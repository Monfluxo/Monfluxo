import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
function harness({complete=true,cursor=null}={}) {
 const job={wallet_address:'wallet',snapshot:{newest:'newest',oldest:'oldest',cursor},lease_token:'lease',transactions_counted:0,pages_counted:0};let calls=0,finished,filters;
 const source=readFileSync(new URL('../src/counterRecountService.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
 const context=vm.createContext({process:{env:{}},console:{log(){},error(){}},AbortSignal,
 getTransactionSignaturesForAddress:async(_wallet,page,options)=>{
  if(options.limit===1)return {data:[{signature:'firstUnindexed'}]};
  filters=options.filters;calls++;return calls===1?{data:[{signature:'a'},{signature:'b'}],paginationToken:'next'}:{data:[{signature:'b'},{signature:'c'}],paginationToken:null};
 },fetch:async(url,options)=>{
  if(url.includes('claim_wallet'))return new Response(JSON.stringify([job]));
  if(url.includes('wallet_sync_state'))return new Response(JSON.stringify([{history_complete:complete}]));
  if(url.includes('finish_wallet')){finished=JSON.parse(options.body);return new Response('true');}
  return new Response('');
 },Response});
 return {run:vm.runInContext(source+'\nprocessCounterRecountSlice',context),result:()=>({finished,filters,calls})};
}
test('legacy recount excludes cross-page overlaps and finalizes an exact persistent total',async()=>{
 const h=harness();await h.run();const r=h.result();assert.equal(r.finished.p_total,3);assert.equal(r.filters.signature.lte,'newest');assert.equal(r.filters.signature.gte,undefined);
});
test('partial legacy recount uses saved cursor to resolve the first unindexed signature',async()=>{
 const h=harness({complete:false,cursor:'100:7'});await h.run();assert.equal(h.result().filters.signature.gt,'firstUnindexed');assert.equal(h.result().filters.signature.gte,undefined);
});
