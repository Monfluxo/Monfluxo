import test from 'node:test';import assert from 'node:assert/strict';
import {buildPositions} from '../src/positionEngine.js';
import {buildTradeJourneys} from '../src/tradeJourneyEngine.js';
const mint='token',trade=(type,tokenAmount,solAmount,blockTime)=>({tokenMint:mint,type,tokenAmount,solAmount,blockTime,signature:`${type}${blockTime}`});
const transfer=(direction,amount,blockTime,m=mint)=>({mint:m,direction,amount,blockTime,signature:`${direction}${blockTime}`});
test('20 tokens cost 2 SOL, leave, return and sell for 10 SOL: both engines report 8 SOL',()=>{
 const trades=[trade('BUY',20,2,1),trade('SELL',20,10,4)],transfers=[transfer('OUT',20,2),transfer('IN',20,3)];
 const p=buildPositions(trades,transfers).get(mint),j=buildTradeJourneys(trades,transfers)[0];
 assert.equal(p.realizedPnl,8);assert.equal(p.realizedCostBasis,2);assert.equal(p.transferredOutKnownCostSol,0);assert.equal(p.unknownCostSellProceedsSol || 0,0);
 assert.equal(j.realizedPnl,8);assert.equal(j.realizedCost,2);assert.equal(j.closed,true);assert.equal(j.events.length,4);
});
test('partial returns restore proportionate basis once and do not realize profit before a sale',()=>{
 const trades=[trade('BUY',20,2,1),trade('SELL',5,5,4),trade('SELL',15,15,6)];const transfers=[transfer('OUT',20,2),transfer('IN',5,3),transfer('IN',15,5)];
 const p=buildPositions(trades,transfers).get(mint),j=buildTradeJourneys(trades,transfers)[0];assert.equal(p.realizedPnl,18);assert.equal(j.realizedPnl,18);assert.equal(j.closed,true);
 const partial=buildTradeJourneys(trades.slice(0,2),transfers.slice(0,2))[0];assert.equal(partial.closed,false);assert.equal(partial.realizedCost,.5);
 const noSale=buildPositions(trades.slice(0,1),transfers).get(mint);assert.equal(noSale.realizedPnl,0);
});
test('excess incoming inventory and different mints cannot create new purchased cost',()=>{
 const trades=[trade('BUY',20,2,1),trade('SELL',30,15,4)],transfers=[transfer('OUT',20,2),transfer('IN',30,3)];const p=buildPositions(trades,transfers).get(mint);assert.equal(p.realizedPnl,8);assert.equal(p.externalSaleProceedsSol,5);
 assert.equal(buildPositions(trades,[transfer('OUT',20,2),transfer('IN',20,3,'other')]).get(mint).realizedPnl,0);
});
test('FIFO restores multiple lots and repeated outbound/return cycles without duplicating cost',()=>{
 const trades=[trade('BUY',10,2,1),trade('BUY',10,4,2),trade('SELL',20,10,7)];const transfers=[transfer('OUT',20,3),transfer('IN',20,4),transfer('OUT',20,5),transfer('IN',20,6)];const p=buildPositions(trades,transfers).get(mint);assert.equal(p.realizedCostBasis,6);assert.equal(p.realizedPnl,4);assert.equal(buildTradeJourneys(trades,transfers)[0].realizedPnl,4);
});
