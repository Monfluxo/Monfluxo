import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisCredits,transactionAllowance,indexedWork,classifyIdentity,highActivitySample,CREDIT_PLAN} from '../src/analysisBudget.js';
import {validatePolicyInput,policyError} from '../src/walletPolicy.js';
test('credit thresholds count transactions, not provider pages',()=>{
  for(const [tx,c] of [[0,0],[1,3],[5000,3],[5001,4],[7000,4],[10000,6],[20000,11],[5000000,2501]])assert.equal(analysisCredits(tx),c);
  assert.equal(analysisCredits(0,{incremental:true}),0);assert.equal(analysisCredits(2001,{incremental:true}),2);
  assert.throws(()=>analysisCredits(-1));assert.throws(()=>analysisCredits(NaN));assert.equal(CREDIT_PLAN.billingEnabled,false);
});
test('repeated requests cannot replenish a wallet budget',()=>{
  const policy={transaction_limit:5000};assert.equal(transactionAllowance(null,policy),5000);
  assert.equal(transactionAllowance({transactions_scanned:4900},policy),100);
  assert.equal(transactionAllowance({transactions_scanned:5000},policy),0);
  assert.equal(transactionAllowance({transactions_scanned:5000},{transaction_limit:7000}),2000);
  assert.equal(transactionAllowance({history_complete:true,transactions_scanned:100000},policy),5000);
  assert.equal(indexedWork({pages_scanned:60}),6000);
});
test('confirmed institutional identities block while market makers are excluded',()=>{
  assert.equal(classifyIdentity({type:'exchange',category:'Centralized Exchange'}),'block');
  assert.equal(classifyIdentity({category:'Market Maker'}),'exclude');
  assert.equal(classifyIdentity({category:'Key Opinion Leader'}),'allow');assert.equal(classifyIdentity(null),'allow');
});
test('high activity requires a dense complete timestamp sample',()=>{
  const dense=Array.from({length:1000},(_,i)=>({blockTime:100000+i}));assert.equal(highActivitySample(dense),true);
  assert.equal(highActivitySample(dense.slice(1)),false);assert.equal(highActivitySample([...dense.slice(1),{blockTime:null}]),false);
  assert.equal(highActivitySample(dense.map((r,i)=>({blockTime:100000+i*1000}))),false);
});
test('admin policy rejects invalid addresses, limits and missing reasons',()=>{
  const input={wallet:'11111111111111111111111111111111',action:'block',reason:'Confirmed CEX'};
  assert.equal(validatePolicyInput(input).source,'manual');
  for(const patch of [{wallet:'bad'},{action:'delete'},{transactionLimit:Infinity},{transactionLimit:50001},{reason:''}])assert.throws(()=>validatePolicyInput({...input,...patch}));
  assert.equal(policyError({action:'block',reason:'CEX'}).statusCode,403);assert.equal(policyError({action:'review'}).code,'wallet_review_required');assert.equal(policyError({action:'exclude'}),null);
});
