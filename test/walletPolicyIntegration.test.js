import {createHash} from "node:crypto";
import {exactTransactionBase,acceptedHistoryPage} from "../src/transactionCounter.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {transactionAllowance,indexedWork} from '../src/analysisBudget.js';
const wallet='11111111111111111111111111111111';
function syncHarness({size=5000000,initial=null,policy={transaction_limit:5000},blockAt=Infinity,failWriteAt=Infinity,env={}}={}) {
  let state=initial?{...initial}:null,calls=0,writes=0,policyCalls=0;
  const source=readFileSync(new URL('../src/sync.js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\n/gm,'').replace(/export /g,'');
  const noop=async()=>{};
  const context=vm.createContext({process:{env,cpuUsage:process.cpuUsage,memoryUsage:process.memoryUsage},Buffer,console:{...console,log:()=>{}},createHash,transactionAllowance,indexedWork,exactTransactionBase,acceptedHistoryPage,
    assertWalletAllowed:async()=>{if(++policyCalls>=blockAt){const e=new Error('Blocked');e.code='wallet_blocked';throw e}return policy},
    claimWalletSyncLease:async()=>{if(state?.status==='syncing')return false;state={...state,status:'syncing'};return true},
    assertEventModelV2Schema:noop,upsertWallet:noop,getSyncState:async()=>state?{...state}:null,
    upsertSyncState:async patch=>{state={...state,...patch}},
    getTransactionsForAddress:async(_wallet,cursor,options)=>{calls++;const offset=Number(cursor||0),count=Math.min(options.limit,size-offset);return {data:Array.from({length:Math.max(0,count)},(_,i)=>({signature:`s${offset+i}`,blockTime:2000000000-offset-i})),paginationToken:offset+count<size?String(offset+count):null}},
    parseTransaction:()=>({trades:[],transfers:[],rewards:[]}),parseNativeSolFunding:()=>[],replaceWalletEventsForSignatures:noop,
    persistWalletEventPage:async(_wallet,_signatures,_data,checkpoint)=>{if(++writes===failWriteAt)throw new Error("write_failed");if(checkpoint)state={...state,...checkpoint}},
    upsertTransactions:async()=>{if(++writes===failWriteAt)throw new Error('write_failed')},upsertTrades:noop,upsertTransfers:noop,upsertRewards:noop,upsertFundingEvents:noop
  });
  const sync=vm.runInContext(source+'\nsyncWalletHistory',context);
  return{sync:opts=>sync(wallet,opts),state:()=>state,calls:()=>calls};
}
test('5M-transaction history stops at 5,000, keeps cursor and does not restart on repeat',async()=>{
  const h=syncHarness();const result=await h.sync({mode:'deep',maxPages:100000});
  assert.equal(result.transactionsStored,5000);assert.equal(result.historyComplete,false);assert.equal(result.budgetExhausted,true);
  assert.equal(h.calls(),50);assert.equal(h.state().backfill_pagination_token,'5000');assert.equal(h.state().transactions_scanned,5000);
  const repeat=await h.sync({mode:'deep',maxPages:100000});assert.equal(repeat.status,'paused');assert.equal(h.calls(),50);
});
test('remaining partial-page allowance is honored exactly',async()=>{
  const h=syncHarness({initial:{transactions_scanned:4950,backfill_pagination_token:'4950',history_complete:false}});
  const r=await h.sync({mode:'deep',maxPages:100});assert.equal(r.transactionsStored,50);assert.equal(h.calls(),1);assert.equal(h.state().transactions_scanned,5000);
});
test('small history finishes without reporting budget exhaustion',async()=>{
  const h=syncHarness({size:123});const r=await h.sync({mode:'deep'});assert.equal(r.historyComplete,true);assert.equal(r.budgetExhausted,false);assert.equal(h.state().transactions_scanned,123);
});
test('new restriction interrupts an already running slice before next history call',async()=>{
  const h=syncHarness({blockAt:3});await assert.rejects(h.sync({mode:'deep'}),/Blocked/);assert.equal(h.calls(),1);assert.equal(h.state().transactions_scanned,100);assert.equal(h.state().backfill_pagination_token,'100');
});
test('failed write retains previous successful cursor and work checkpoint',async()=>{
  const h=syncHarness({failWriteAt:2});await assert.rejects(h.sync({mode:'deep'}),/write_failed/);assert.equal(h.state().transactions_scanned,100);assert.equal(h.state().backfill_pagination_token,'100');
});
test('simultaneous calls cannot acquire the same sync lease',async()=>{
  const h=syncHarness({size:123});const results=await Promise.allSettled([h.sync({mode:'deep'}),h.sync({mode:'deep'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(h.state().transactions_scanned,123);
});

test("large deep pages preserve exact budget and quick requests stay small",async()=>{
 const deep=syncHarness({env:{HELIUS_FULL_PAGE_LIMIT:"1000"}});await deep.sync({mode:"deep",maxPages:50});assert.equal(deep.calls(),5);assert.equal(deep.state().transactions_scanned,5000);
 const quick=syncHarness({env:{HELIUS_FULL_PAGE_LIMIT:"1000"}});const r=await quick.sync({mode:"quick",maxPages:1});assert.equal(r.transactionsStored,100);assert.equal(quick.calls(),1);
});


test('complete deep refresh counts only the new prefix before the saved signature',async()=>{
 const h=syncHarness({size:100,initial:{transactions_scanned:99,pages_scanned:1,history_complete:true,newest_signature:'s1'}});
 await h.sync({mode:'deep',maxPages:1});
 assert.equal(h.state().transactions_scanned,100);
 assert.equal(h.calls(),1);
});
