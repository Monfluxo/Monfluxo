import test from 'node:test';import assert from 'node:assert/strict';
import {attachLivePositionAccounting} from '../src/livePositionAccounting.js';
function dashboard(price=2){return{portfolio:{solPriceUsd:100},livePortfolio:{positions:[{tokenMint:'Mint',amount:10,priceUsd:price}]}};}
test('current holding exposes remaining cost and unrealized return',()=>{
 const d=dashboard();attachLivePositionAccounting(d,[{mint:'Mint',tokensRemaining:10,purchasedTokensRemaining:10,remainingCostSol:.1}]);
 const p=d.livePortfolio.positions[0];assert.equal(p.costBasisSol,.1);assert.equal(p.unrealizedPnlSol,.1);assert.equal(p.unrealizedPnlUsd,10);assert.equal(p.unrealizedRoiPct,100);
});
test('external inventory is never assigned a zero cost or trading profit',()=>{
 const d=dashboard();attachLivePositionAccounting(d,[{mint:'Mint',tokensRemaining:10,purchasedTokensRemaining:0,remainingCostSol:0}]);
 assert.equal(d.livePortfolio.positions[0].accountingStatus,'external_inventory');assert.equal(d.livePortfolio.positions[0].costBasisSol,null);
});
test('mixed holdings value only purchased inventory',()=>{
 const d=dashboard();attachLivePositionAccounting(d,[{mint:'Mint',tokensRemaining:10,purchasedTokensRemaining:5,remainingCostSol:.1}]);
 assert.equal(d.livePortfolio.positions[0].unrealizedPnlSol,0);assert.equal(d.livePortfolio.positions[0].accountingStatus,'mixed_inventory');
});
test('missing price preserves cost without inventing a loss',()=>{
 const d=dashboard(null);attachLivePositionAccounting(d,[{mint:'Mint',tokensRemaining:10,purchasedTokensRemaining:10,remainingCostSol:.1}]);
 assert.equal(d.livePortfolio.positions[0].costBasisSol,.1);assert.equal(d.livePortfolio.positions[0].unrealizedPnlSol,null);
});
test('live balance mismatch is explicit rather than silently scaling cost',()=>{
 const d=dashboard();attachLivePositionAccounting(d,[{mint:'Mint',tokensRemaining:20,purchasedTokensRemaining:20,remainingCostSol:.1}]);
 assert.equal(d.livePortfolio.positions[0].accountingStatus,'balance_mismatch');assert.equal(d.livePortfolio.positions[0].unrealizedPnlSol,null);
});
