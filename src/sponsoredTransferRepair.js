import { parseTransaction } from './parser.js';

function decode58(value) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const c of value) {
    const d = alphabet.indexOf(c);
    if (d < 0) return null;
    n = n * 58n + BigInt(d);
  }
  const bytes = [];
  while (n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of value) { if (c !== '1') break; bytes.unshift(0); }
  return Buffer.from(bytes);
}

// A fee-sized sale is only a candidate. Require the original successful
// transaction, an unchanged SOL balance, a different payer and an explicit
// SPL transfer matching the wallet's entire outgoing token movement.
export function verifiedSponsoredTransfers(tx, wallet) {
  if (!tx?.meta || tx.meta.err) return null;
  const keys = [...(tx.transaction?.message?.accountKeys || []),
    ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])]
    .map(k => typeof k === 'string' ? k : k.pubkey);
  const index = keys.indexOf(wallet);
  if (index <= 0 || tx.meta.preBalances?.[index] == null ||
      tx.meta.preBalances[index] !== tx.meta.postBalances?.[index]) return null;
  const parsed = parseTransaction(tx, wallet);
  if (parsed.trades.length || parsed.rewards.length) return null;
  const instructions = [...(tx.transaction.message.instructions || []),
    ...(tx.meta.innerInstructions || []).flatMap(i => i.instructions || [])];
  const accounts = new Map([...tx.meta.preTokenBalances || [], ...tx.meta.postTokenBalances || []]
    .map(b => [keys[b.accountIndex], b]));
  const outgoing = parsed.transfers.filter(t => t.direction === 'OUT');
  if (!outgoing.length) return null;
  const verified = [];
  for (const t of outgoing) {
    const matching = [];
    for (const ins of instructions) {
      const program = ins.programId || keys[ins.programIdIndex];
      if (!['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'].includes(program)) continue;
      let source, destination, amount;
      if (['transfer', 'transferChecked'].includes(ins.parsed?.type)) {
        source = ins.parsed.info.source; destination = ins.parsed.info.destination;
        amount = ins.parsed.info.amount ?? ins.parsed.info.tokenAmount?.amount;
      } else {
        const bytes = typeof ins.data === 'string' ? decode58(ins.data) : null;
        if (!bytes || bytes.length < 9) continue;
        const zeroFeeChecked = program === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' &&
          bytes.length === 19 && bytes[0] === 26 && bytes[1] === 1 &&
          bytes.readBigUInt64LE(11) === 0n;
        if (![3,12].includes(bytes[0]) && !zeroFeeChecked) continue;
        source = keys[ins.accounts[0]];
        destination = keys[ins.accounts[bytes[0] === 12 || zeroFeeChecked ? 2 : 1]];
        amount = bytes.readBigUInt64LE(zeroFeeChecked ? 2 : 1).toString();
      }
      const info = accounts.get(source);
      if (info?.owner === wallet && info.mint === t.mint && amount === t.rawAmount)
        matching.push({source, destination});
    }
    if (matching.length !== 1) return null;
    verified.push({...t, sourceAddress: wallet,
      destinationAddress: accounts.get(matching[0].destination)?.owner || null,
      sourceTokenAccount: matching[0].source, destinationTokenAccount: matching[0].destination});
  }
  return verified;
}
