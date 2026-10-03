import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifiedSponsoredTransfers } from '../src/sponsoredTransferRepair.js';

function fixture() {
  const balance = (accountIndex, owner, amount) => ({accountIndex, owner, mint:'Mint',
    uiTokenAmount:{amount:String(amount),decimals:6}});
  return {blockTime:null, transaction:{signatures:['signature'], message:{
    accountKeys:['Sponsor','Wallet','Source','Destination'], instructions:[{
      programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      parsed:{type:'transfer',info:{source:'Source',destination:'Destination',amount:'1000000'}}
    }]}}, meta:{err:null,fee:110000,preBalances:[1000000,1000000,0,0],
      postBalances:[890000,1000000,0,0],
      preTokenBalances:[balance(2,'Wallet',1000000),balance(3,'Recipient',0)],
      postTokenBalances:[balance(2,'Wallet',0),balance(3,'Recipient',1000000)]}};
}

test('sponsored transfer preserves precise amounts, counterparties and missing timestamp', () => {
  const rows = verifiedSponsoredTransfers(fixture(),'Wallet');
  assert.equal(rows.length,1);
  assert.equal(rows[0].rawAmount,'1000000');
  assert.equal(rows[0].sourceAddress,'Wallet');
  assert.equal(rows[0].destinationAddress,'Recipient');
  assert.equal(rows[0].blockTime,null);
});
test('a SOL receipt is not eligible for automatic sale removal', () => {
  const tx=fixture();tx.meta.postBalances[1]+=110000;
  assert.equal(verifiedSponsoredTransfers(tx,'Wallet'),null);
});
test('failed transactions and missing metadata cannot authorize cleanup', () => {
  const tx=fixture();tx.meta.err={InstructionError:[0,'Failed']};
  assert.equal(verifiedSponsoredTransfers(tx,'Wallet'),null);
  assert.equal(verifiedSponsoredTransfers({},'Wallet'),null);
});
test('burns and unmatched transfer amounts remain untouched', () => {
  const tx=fixture();tx.transaction.message.instructions[0].parsed.type='burn';
  assert.equal(verifiedSponsoredTransfers(tx,'Wallet'),null);
  tx.transaction.message.instructions[0].parsed.type='transfer';
  tx.transaction.message.instructions[0].parsed.info.amount='999999';
  assert.equal(verifiedSponsoredTransfers(tx,'Wallet'),null);
});
test('wallet absent from account keys remains untouched', () => {
  assert.equal(verifiedSponsoredTransfers(fixture(),'SomeoneElse'),null);
});

test('real compiled Token-2022 zero-fee transfer is preserved', () => {
  const row=JSON.parse(fs.readFileSync(new URL('./fixtures/sponsored-token2022.json',import.meta.url)));
  const transfers=verifiedSponsoredTransfers(row.raw_transaction,row.wallet_address);
  assert.equal(transfers.length,1);
  assert.equal(transfers[0].signature,row.signature);
  assert.ok(transfers[0].sourceTokenAccount);
  assert.ok(transfers[0].destinationTokenAccount);
});
