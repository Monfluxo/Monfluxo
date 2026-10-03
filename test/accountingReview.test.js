import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAccountingReview } from '../src/accountingReview.js';
import { buildPositions } from '../src/positionEngine.js';
test('engine positions preserve their mint address in review details',()=>{
  const positions=[...buildPositions([{type:'SELL',tokenMint:'EngineMint',tokenAmount:2,solAmount:.02,blockTime:1,signature:'sig'}],[],[]).values()];
  const review=buildAccountingReview(positions,{historyComplete:true});
  assert.equal(review.unmatchedPositions[0].tokenMint,'EngineMint');
});
test('unmatched details include positions outside the dashboard top six and exclude external proceeds',()=>{
  const positions=Array.from({length:8},(_,i)=>({tokenMint:`Mint${i}`,unmatchedSoldTokens:0,unmatchedSellProceedsSol:0,externalTokenSaleProceedsSol:10}));
  positions[7].unmatchedSoldTokens=1.384647;positions[7].unmatchedSellProceedsSol=.01682;
  const review=buildAccountingReview(positions,{historyComplete:true});
  assert.equal(review.status,'ready');assert.equal(review.tokensAffected,1);
  assert.equal(review.unmatchedPositions[0].tokenMint,'Mint7');
  assert.equal(review.unmatchedPositions[0].unmatchedSellProceedsSol,.01682);
});
test('bounded details report omitted rows and partial source coverage',()=>{
  const positions=Array.from({length:60},(_,i)=>({tokenMint:`Mint${i}`,unmatchedSoldTokens:1,unmatchedSellProceedsSol:i+1}));
  const review=buildAccountingReview(positions,{historyComplete:true,truncated:true});
  assert.equal(review.status,'partial');assert.equal(review.tokensAffected,60);
  assert.equal(review.unmatchedPositions.length,50);assert.equal(review.unmatchedPositions[0].unmatchedSellProceedsSol,60);
});
test('empty history is provisional and does not invent discrepancies',()=>{
  const review=buildAccountingReview([]);assert.equal(review.status,'provisional');
  assert.equal(review.tokensAffected,0);assert.deepEqual(review.unmatchedPositions,[]);
});
