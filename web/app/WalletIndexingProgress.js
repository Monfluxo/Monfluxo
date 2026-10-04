"use client";
import {useEffect,useState} from "react";
import {startProgressPolling} from '../lib/progressPolling';
const fmt=v=>new Intl.NumberFormat('en-US').format(Number(v||0));
const date=v=>{const d=v?new Date(v):null;return d&&!Number.isNaN(d.getTime())?d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'—';};
export default function WalletIndexingProgress({wallet,initialPages=0,initialTransactions=null,initialComplete=false,initialPaused=false,onMilestone}) {
 const [progress,setProgress]=useState({pagesScanned:initialPages,transactionsIndexed:initialTransactions,historyComplete:initialComplete,status:initialComplete?'complete':initialPaused?'paused':'queued'});
 useEffect(()=>{if(!wallet||initialComplete)return;return startProgressPolling({
  read:async()=>{const r=await fetch(`/api/wallet-progress/${encodeURIComponent(wallet)}`,{cache:'no-store'});if(!r.ok)throw Error('Progress unavailable');return r.json();},
  onProgress:setProgress,onMilestone
 });},[wallet,initialComplete,onMilestone]);
 const complete=progress.historyComplete,paused=progress.status==='paused',blocked=progress.status==='blocked';
 return <div className={`indexing-live ${complete?'indexing-complete':''}`}><div><strong>{complete?'Full history indexed':paused?'Analysis paused at its limit':blocked?'Analysis restricted':'Indexing wallet history'}</strong><span>{complete?'Final historical coverage is available.':paused?'Saved history is available. Extend above Analyze wallet to continue; PnL remains partial.':blocked?'Further indexing is disabled for this wallet.':'Saved transactions and metrics update as indexing progresses.'}</span></div><div className="indexing-live-stats"><b>{progress.transactionsIndexed==null?'—':fmt(progress.transactionsIndexed)}</b><span>transactions indexed</span><b>{fmt(progress.pagesScanned)}</b><span>RPC pages</span><b>{date(progress.oldestBlockTime)}</b><span>history reached</span></div></div>;
}
