const entities=dashboard=>[...(dashboard?.trades?.best||[]),...(dashboard?.trades?.worst||[]),...(dashboard?.positions?.top||[]),...(dashboard?.livePortfolio?.positions||[])];
// Preserve identity metadata, never old prices, balances, costs or PnL.
export function mergeWalletDashboard(current,incoming) {
 if(!current||current.wallet!==incoming?.wallet)return incoming;
 const older=current.coverage?.backfillUpdatedAt&&incoming.coverage?.backfillUpdatedAt&&current.coverage.backfillUpdatedAt>incoming.coverage.backfillUpdatedAt;
 const base=older?current:incoming, supplement=older?incoming:current;
 const byMint=new Map();
 for(const item of entities(supplement)){
  const old=byMint.get(item.tokenMint)||{};
  byMint.set(item.tokenMint,{tokenName:item.tokenName||old.tokenName,tokenSymbol:item.tokenSymbol||old.tokenSymbol,tokenImage:item.tokenImage||old.tokenImage});
 }
 const copy=structuredClone(base);
 for(const item of entities(copy)){
  const identity=byMint.get(item.tokenMint);if(!identity)continue;
  for(const key of ['tokenName','tokenSymbol','tokenImage'])if(!item[key]&&identity[key])item[key]=identity[key];
 }
 return copy;
}
