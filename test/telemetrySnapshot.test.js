import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildTelemetrySnapshot,publicTelemetry} from '../src/telemetrySnapshot.js';
const now=Date.parse('2026-10-03T22:00:00Z');const at=delta=>new Date(now+delta).toISOString();
test('telemetry excludes unindexed and institutional wallets and reports legacy counter coverage honestly',()=>{
 const s=buildTelemetrySnapshot({now,excluded:new Set(['cex']),states:[{wallet_address:'new',pages_scanned:0},{wallet_address:'legacy',pages_scanned:12},{wallet_address:'exact',transactions_scanned:32000,pages_scanned:140,history_complete:true},{wallet_address:'cex',transactions_scanned:5000000,pages_scanned:5000,history_complete:true}],smartScores:[{wallet_address:'cex',eligible:true,score:95},{wallet_address:'exact',eligible:true,score:80}]});
 assert.equal(s.network.walletsIndexed,2);assert.equal(s.network.pagesIndexed,152);assert.equal(s.network.transactionsIndexed,32000);assert.equal(s.network.transactionCounterWallets,1);assert.equal(s.network.transactionCounterComplete,false);assert.equal(s.network.smartWallets,1);assert.equal(s.pagesPerMinute,null);
});
test('fresh job start is not stale merely because its prior history heartbeat is old',()=>{
 const s=buildTelemetrySnapshot({now,jobs:[{wallet_address:'w',status:'running',started_at:at(-1000),updated_at:at(-1000)}],states:[{wallet_address:'w',pages_scanned:100,backfill_updated_at:at(-86400000),updated_at:at(-86400000)}]});
 assert.equal(s.summary.stale,0);assert.equal(s.network.indexingNow,1);assert.equal(s.latestAnalyses[0].updated_at,at(-1000));
});
test('public telemetry hides job errors, internal queue records and calibration rankings',()=>{
 const s=buildTelemetrySnapshot({now,jobs:[{wallet_address:'w',status:'error',last_error:'private diagnostic',attempts:9,updated_at:at(-1000)}],states:[{wallet_address:'w',pages_scanned:1}]});const p=publicTelemetry(s);
 assert.equal(p.summary.error,1);assert.equal(p.jobs,undefined);assert.equal(p.smartLeaderboard,undefined);assert.equal(p.latestAnalyses[0].attempts,undefined);assert.equal(p.latestAnalyses[0].last_error,undefined);
});
test('public network route requires no admin key while admin telemetry stays protected',async()=>{
 const source=readFileSync(new URL('../src/httpApi.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
 const context=vm.createContext({process:{env:{MONFLUXO_ADMIN_KEY:'secret'},argv:[]},URL,console,creditsEnabled:()=>true,getPublicIndexerTelemetry:async()=>({network:{walletsIndexed:3}})});const handle=vm.runInContext(source+'\nhandleRequest',context);
 async function call(path){let status,body;await handle({method:'GET',url:path,headers:{}},{writeHead(s){status=s},end(b){body=b}});return{status,body};}
 assert.equal((await call('/api/data/network')).status,200);assert.equal((await call('/api/admin/indexer')).status,401);
});

test('admin queue orders recent paused wallets first and retains exact transactions separately from pages',()=>{
 const s=buildTelemetrySnapshot({now,jobs:[{wallet_address:'old',status:'paused',updated_at:at(-90000)},{wallet_address:'new',status:'paused',updated_at:at(-1000)},{wallet_address:'middle',status:'paused',updated_at:at(-5000)}],states:[{wallet_address:'old',transactions_scanned:5000,pages_scanned:50},{wallet_address:'new',transactions_scanned:32000,pages_scanned:140},{wallet_address:'middle',transactions_scanned:5000,pages_scanned:50}]});
 assert.deepEqual(s.jobs.map(r=>r.wallet_address),['new','middle','old']);assert.equal(s.jobs[0].transactions_scanned,32000);assert.equal(s.jobs[0].pages_scanned,140);
});
