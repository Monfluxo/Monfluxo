import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeWalletDashboard} from '../web/lib/dashboardMetadata.js';
const make=(time,rows)=>({wallet:'wallet',coverage:{backfillUpdatedAt:time},trades:{best:rows,worst:[]}});
test('progress refresh preserves name and ticker without preserving stale financial data',()=>{
 const current=make('2026-10-04T00:00:00Z',[{tokenMint:'mint',tokenName:'Example',tokenSymbol:'EX',pnlSol:1,priceUsd:2}]);
 const next=make('2026-10-04T00:01:00Z',[{tokenMint:'mint',tokenName:null,tokenSymbol:null,pnlSol:7,priceUsd:null}]);
 const result=mergeWalletDashboard(current,next);
 assert.equal(result.trades.best[0].tokenName,'Example');assert.equal(result.trades.best[0].tokenSymbol,'EX');assert.equal(result.trades.best[0].pnlSol,7);assert.equal(result.trades.best[0].priceUsd,null);assert.equal(next.trades.best[0].tokenName,null);
});
test('slow metadata response enriches newer rows without rolling back their coverage or PnL',()=>{
 const current=make('2026-10-04T00:02:00Z',[{tokenMint:'mint',pnlSol:8}]);
 const enriched=make('2026-10-04T00:01:00Z',[{tokenMint:'mint',tokenName:'Example',tokenSymbol:'EX',pnlSol:3}]);
 const result=mergeWalletDashboard(current,enriched);assert.equal(result.coverage.backfillUpdatedAt,current.coverage.backfillUpdatedAt);assert.equal(result.trades.best[0].pnlSol,8);assert.equal(result.trades.best[0].tokenSymbol,'EX');
});
test('moving a trade between top and bottom preserves only matching mint identity',()=>{
 const current=make('1',[{tokenMint:'a',tokenName:'Alpha',tokenSymbol:'A'}]);
 const next=make('2',[]);next.trades.worst=[{tokenMint:'a',pnlSol:-5},{tokenMint:'b',pnlSol:-1}];
 const result=mergeWalletDashboard(current,next);assert.equal(result.trades.worst[0].tokenSymbol,'A');assert.equal(result.trades.worst[1].tokenName,undefined);
 const other={...next,wallet:'other'};assert.equal(mergeWalletDashboard(current,other),other);
});
