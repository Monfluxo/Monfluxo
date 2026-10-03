import test from 'node:test';
import assert from 'node:assert/strict';
import {exactTransactionBase,acceptedHistoryPage} from '../src/transactionCounter.js';
const tx=s=>({transaction:{signatures:[s]}});
test('incremental overlap and repeated signatures do not inflate indexed totals',()=>{
 const p=acceptedHistoryPage([tx('new'),tx('new'),tx('anchor'),tx('old')],'anchor',true);
 assert.equal(p.transactions.length,1);assert.equal(p.stoppedOnExisting,true);
 assert.equal(acceptedHistoryPage([tx('anchor')],'anchor',true).transactions.length,0);
});
test('legacy page estimates never become exact counters',()=>{
 assert.equal(exactTransactionBase({pages_scanned:4198}),null);
 assert.equal(exactTransactionBase({pages_scanned:0}),0);
 assert.equal(exactTransactionBase({transactions_scanned:32000,pages_scanned:140}),32000);
});
