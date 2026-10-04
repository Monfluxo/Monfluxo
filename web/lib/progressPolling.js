// A restarted poller follows the new budget even if its first response is still paused.
export function startProgressPolling({read,onProgress,onMilestone,schedule=setTimeout,cancel=clearTimeout}) {
 let stopped=false,timer,last='';
 async function poll(){
  let delay=8000;
  try {
   const p=await read();
   if(stopped)return;
   onProgress(p);
   const signature=JSON.stringify([p.status,p.historyComplete,p.transactionsIndexed,p.pagesScanned]);
   if(signature!==last){last=signature;onMilestone?.(p,Boolean(p.historyComplete));}
   if(p.historyComplete||p.status==='blocked')return;
   delay=['syncing','active','queued','idle'].includes(p.status)&&!p.budgetExhausted?3000:8000;
  }catch{/* Network interruptions retry without losing saved progress. */}
  if(!stopped)timer=schedule(poll,delay);
 }
 poll();
 return ()=>{stopped=true;cancel(timer);};
}
