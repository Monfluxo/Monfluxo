export function attachLivePositionAccounting(dashboard, positions) {
  const byMint=new Map(positions.map(p=>[p.mint||p.tokenMint,p]));
  const solPrice=Number(dashboard.portfolio?.solPriceUsd);
  for(const holding of dashboard.livePortfolio?.positions||[]) {
    const p=byMint.get(holding.tokenMint);
    Object.assign(holding,{costBasisSol:null,unrealizedPnlSol:null,unrealizedPnlUsd:null,unrealizedRoiPct:null,accountingStatus:'inventory_unknown'});
    if(!p) continue;
    const quantity=Number(p.purchasedTokensRemaining||0), total=Number(p.tokensRemaining||0);
    if(Math.abs(total-Number(holding.amount))>Math.max(1e-8,total*1e-6)) {holding.accountingStatus='balance_mismatch';continue;}
    if(!(quantity>0)) {holding.accountingStatus='external_inventory';continue;}
    const cost=Number(p.remainingCostSol);
    if(!Number.isFinite(cost)||cost<0) continue;
    holding.costBasisSol=cost;holding.purchasedAmount=quantity;
    holding.accountingStatus=quantity<total-1e-8?'mixed_inventory':'matched';
    const price=holding.priceUsd;
    if(price==null||!(Number(price)>0)||!(solPrice>0)) {holding.priceStatus='unavailable';continue;}
    const pnl=quantity*Number(price)/solPrice-cost;
    holding.unrealizedPnlSol=pnl;holding.unrealizedPnlUsd=pnl*solPrice;
    holding.unrealizedRoiPct=cost>0?pnl/cost*100:null;
  }
  return dashboard;
}
