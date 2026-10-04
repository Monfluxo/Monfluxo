export const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
export function aggregateTokenAccounts(results) {
  const byMint = new Map();
  for (const result of results) {
    if (!Array.isArray(result?.value)) throw new Error('Incomplete token account response');
    for (const row of result.value) {
      const info = row?.account?.data?.parsed?.info;
      if (!info?.mint || !/^\d+$/.test(info?.tokenAmount?.amount || '') || !Number.isInteger(info.tokenAmount.decimals)) throw new Error('Unparsed token account response');
      const balance = BigInt(info.tokenAmount.amount), decimals = info.tokenAmount.decimals;
      if (balance === 0n) continue;
      const old = byMint.get(info.mint);
      if (old && old.decimals !== decimals) throw new Error('Inconsistent token decimals');
      byMint.set(info.mint, {tokenMint:info.mint, decimals, balance:(old?.balance || 0n)+balance, frozen:old?.frozen || info.state==='frozen'});
    }
  }
  return [...byMint.values()].map(({balance,...item})=>({...item,rawBalance:balance.toString(),amount:Number(balance)/(10**item.decimals)}));
}
export async function readChainHoldings(address, rpc) {
  const [spl, token2022, native] = await Promise.all([
    ...TOKEN_PROGRAMS.map(programId=>rpc('getTokenAccountsByOwner',[address,{programId},{encoding:'jsonParsed',commitment:'confirmed'}],'monfluxo-token-balances')),
    rpc('getBalance',[address,{commitment:'confirmed'}],'monfluxo-native-balance')
  ]);
  if (!Number.isFinite(native?.value)) throw new Error('Incomplete native balance response');
  const slots=[spl,token2022,native].map(r=>r?.context?.slot).filter(Number.isFinite);
  return {holdings:aggregateTokenAccounts([spl,token2022]),nativeBalanceLamports:native.value,generatedAt:new Date().toISOString(),slotFrom:slots.length?Math.min(...slots):null,slotTo:slots.length?Math.max(...slots):null};
}
