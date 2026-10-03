const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,Number.isFinite(n)?n:0));
const median=a=>{if(!a.length)return 0;const x=[...a].sort((a,b)=>a-b),m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2};
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
export function buildSmartWalletScore(journeys,{historyComplete=false}={}){
 const closed=(journeys||[]).filter(j=>j.closed&&j.realizedCost>=.005&&Number.isFinite(j.realizedPnl)&&Number.isFinite(j.pnlPct));
 const wins=closed.filter(j=>j.realizedPnl>0),losses=closed.filter(j=>j.realizedPnl<0),grossProfit=wins.reduce((s,j)=>s+j.realizedPnl,0),grossLoss=Math.abs(losses.reduce((s,j)=>s+j.realizedPnl,0)),pf=grossLoss>0?grossProfit/grossLoss:(grossProfit>0?5:0),winRate=closed.length?wins.length/closed.length*100:0,rois=closed.map(j=>j.pnlPct),medRoi=median(rois),positiveShare=winRate,mean=avg(rois),variance=avg(rois.map(x=>(x-mean)**2)),cv=Math.abs(mean)>1?Math.sqrt(variance)/Math.abs(mean):5,consistency=clamp(100-cv*18),totalCost=closed.reduce((s,j)=>s+j.realizedCost,0),totalPnl=closed.reduce((s,j)=>s+j.realizedPnl,0),capitalRoi=totalCost>0?totalPnl/totalCost*100:0;
 const profitScore=clamp(50+capitalRoi*.8),roiScore=clamp(50+medRoi),pfScore=clamp(pf/3*100),winScore=clamp((winRate-35)/35*100),riskScore=clamp(consistency*.6+Math.min(positiveShare,70)/70*40),entryScore=50,exitScore=50;
 const score=Math.round(profitScore*.20+roiScore*.15+pfScore*.15+winScore*.10+consistency*.15+entryScore*.10+exitScore*.05+riskScore*.10);
 const eligible=historyComplete&&closed.length>=20&&totalCost>=.25;
 const classification=!eligible?'Unclassified':score>=80?'Elite Smart Wallet':score>=70?'Smart Wallet':score>=60?'Skilled / Watchlist':'Unclassified';
 const tags=[];if(winRate>=65)tags.push('High Win Rate');if(medRoi>=25)tags.push('High ROI');if(consistency>=70)tags.push('Consistent');if(pf>=2)tags.push('Strong Profit Factor');if(closed.length>=100)tags.push('High Sample');
 return{methodology:'smart_score_v1',score,classification,eligible,journeysAnalyzed:closed.length,winRate,profitFactor:pf,medianRoi:medRoi,consistency,riskScore,totalCostSol:totalCost,totalPnlSol:totalPnl,tags,gates:{historyComplete,minJourneys:20,minCostSol:.25,passesHistory:historyComplete,passesJourneys:closed.length>=20,passesCost:totalCost>=.25},components:{profitScore,roiScore,pfScore,winScore,consistency,entryScore,exitScore,riskScore}};
}
