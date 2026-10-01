"use client";

import { useEffect, useMemo, useState } from "react";

function fmt(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
}
function usd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 2 : 0 }).format(n);
}
function sol(value, digits = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${fmt(n, digits)} SOL`;
}
function shorten(value, left = 7, right = 6) {
  if (!value) return "—";
  return value.length <= left + right + 3 ? value : `${value.slice(0,left)}…${value.slice(-right)}`;
}
function StatusPill({ tone="neutral", children }) { return <span className={`pill pill-${tone}`}>{children}</span>; }
function LoadingDots() { return <span className="loading-dots" aria-label="Loading"><i/><i/><i/></span>; }

function TokenCell({ item }) {
  const initials=(item?.tokenSymbol||item?.tokenName||item?.assetId||"?").replace(/[^a-z0-9]/gi,"").slice(0,2).toUpperCase()||"?";
  return <div className="token-cell">{item?.tokenImage?<img className="token-avatar token-avatar-img" src={item.tokenImage} alt=""/>:<div className="token-avatar">{initials}</div>}<div className="token-copy"><div className="token-primary">{item?.tokenName||item?.tokenSymbol||shorten(item?.assetId)}{item?.tokenSymbol&&item?.tokenName?<span>${item.tokenSymbol}</span>:null}</div><div className="token-mint mono">{shorten(item?.assetId)}</div></div></div>;
}

function EntitySource({ event, onAnalyze, compact=false }) {
  const entity=event?.sourceEntity;
  const known=Boolean(entity?.known && entity?.label);
  const service=entity?.clusterable===false;
  if (known) return <div className="entity-source"><strong>{entity.label}</strong><div><StatusPill tone={service?"success":"neutral"}>{entity.category||"KNOWN"}</StatusPill></div><small className="mono">{shorten(event.sourceAddress,compact?7:9,compact?6:7)}</small></div>;
  if (!event?.sourceAddress) return <strong>Unknown</strong>;
  return <button className="wallet-link mono" onClick={()=>onAnalyze?.(event.sourceAddress)}>{shorten(event.sourceAddress,compact?7:9,compact?6:7)}</button>;
}

function rowsFor(incoming, mode) {
  const fallback=Array.isArray(incoming?.events)?incoming.events:[];
  const source=mode==="latest"?(Array.isArray(incoming?.latest)?incoming.latest:fallback):(Array.isArray(incoming?.highestValue)?incoming.highestValue:fallback);
  return [...source].sort((a,b)=>mode==="latest"?Number(b.blockTime||0)-Number(a.blockTime||0):Number(b.estimatedUsd||0)-Number(a.estimatedUsd||0)).slice(0,10);
}

function FirstFunding({ event, onAnalyze }) {
  if (!event) return null;
  return <div className="wallet-origin-card">
    <div><span>Wallet origin</span><strong>{event.blockTime?new Date(event.blockTime*1000).toLocaleDateString():"First indexed funding"}</strong><small>Earliest material external inflow indexed by MONFLUXO</small></div>
    <div><span>Asset</span><strong>{event.assetType==="SOL"?sol(event.amount):`${fmt(event.amount,6)} ${event.tokenSymbol||"tokens"}`}</strong><small>{event.estimatedUsd!=null?usd(event.estimatedUsd):"Unpriced at current market"}</small></div>
    <div><span>Source</span><EntitySource event={event} onAnalyze={onAnalyze}/><small>{event.signature?<a className="tx-link" href={`https://solscan.io/tx/${event.signature}`} target="_blank" rel="noreferrer">View transaction ↗</a>:""}</small></div>
  </div>;
}

export default function IncomingFlowsPanel({ incoming={}, onAnalyze }) {
  const [mode,setMode]=useState("value");
  const [resolved,setResolved]=useState(incoming||{});
  useEffect(()=>{
    setResolved(incoming||{});
    const wallet=incoming?.wallet;
    if(incoming?.status!=="loading"||!wallet)return;
    let cancelled=false;
    fetch(`/api/incoming-flows/${encodeURIComponent(wallet)}`,{cache:"no-store"}).then(async response=>{const payload=await response.json();if(!response.ok)throw new Error(payload?.message||"Unable to load incoming flows");if(!cancelled)setResolved(payload);}).catch(()=>{if(!cancelled)setResolved({status:"unavailable",minUsd:incoming?.minUsd||5,highestValue:[],latest:[]});});
    return()=>{cancelled=true;};
  },[incoming?.status,incoming?.wallet]);

  const rows=useMemo(()=>rowsFor(resolved,mode),[resolved,mode]);
  const hidden=Number(resolved?.hiddenBelowThresholdOrUnpriced||0);
  const minUsd=Number(resolved?.minUsd||5);
  const loading=resolved?.status==="loading";

  return <section className="panel secondary-panel incoming-flows-panel">
    <div className="panel-header incoming-header"><div><h2>Relevant incoming flows</h2><p>Largest external inflows first, with a separate recent view and the wallet&apos;s earliest indexed funding.</p></div><StatusPill tone={loading?"warning":"neutral"}>{loading?"loading":`≥ $${fmt(minUsd,0)} USD`}</StatusPill></div>
    {loading?<div className="incoming-loading"><LoadingDots/><span>Scanning indexed funding history</span></div>:<FirstFunding event={resolved?.firstFunding} onAnalyze={onAnalyze}/>} 
    <div className="incoming-toolbar"><div className="incoming-tabs" role="tablist" aria-label="Incoming flow ordering"><button type="button" role="tab" aria-selected={mode==="value"} className={mode==="value"?"active":""} onClick={()=>setMode("value")}>Highest value</button><button type="button" role="tab" aria-selected={mode==="latest"} className={mode==="latest"?"active":""} onClick={()=>setMode("latest")}>Latest</button></div><span className="incoming-sort-note">{mode==="value"?"Largest USD inflows first":"Most recent inflows first"}</span></div>
    {!loading?<div className="funding-credit-note">Scanned <strong>{fmt(resolved?.scannedFundingEvents||0,0)}</strong> external funding events and <strong>{fmt(resolved?.scannedRewardClaims||0,0)}</strong> creator claims. <strong>{fmt(hidden,0)}</strong> low-value or unpriced groups are hidden.</div>:null}
    {loading?<div className="empty">Incoming-flow intelligence is loading independently so it does not block the main dashboard.</div>:!rows.length?<div className="empty">No priced incoming transfer or reward above the ${fmt(minUsd,0)} relevance threshold is indexed yet.</div>:<div className="table-wrap funding-table"><table><thead><tr><th>Type</th><th>Asset</th><th>Amount</th><th>Est. value</th><th>Origin</th><th>Date</th><th>Tx</th><th></th></tr></thead><tbody>{rows.map((event,index)=>{
      const isReward=event.classification==="CREATOR_REWARD";
      const knownService=event?.sourceEntity?.clusterable===false;
      const canAnalyze=!isReward&&Boolean(event.sourceAddress)&&!knownService;
      const claimCount=Number(event.claimCount||1);
      return <tr key={`${event.signature||"event"}-${event.assetId||"asset"}-${index}`}><td><StatusPill tone={isReward?"success":"neutral"}>{isReward?"creator reward":"transfer"}</StatusPill></td><td>{event.assetType==="SOL"?<div className="funding-asset sol-asset"><span className="funding-dot">◎</span><div><strong>SOL</strong><small>Native Solana</small></div></div>:<TokenCell item={event}/>}</td><td className="funding-amount">{event.assetType==="SOL"?sol(event.amount):fmt(event.amount,6)}</td><td className="incoming-value"><strong>{usd(event.estimatedUsd)}</strong></td><td>{isReward?<span className="muted">{fmt(claimCount,0)} {claimCount===1?"claim":"claims"}</span>:<EntitySource event={event} onAnalyze={onAnalyze} compact/>}</td><td>{event.blockTime?new Date(event.blockTime*1000).toLocaleDateString():"—"}</td><td>{event.signature?<a className="tx-link" href={`https://solscan.io/tx/${event.signature}`} target="_blank" rel="noreferrer">View ↗</a>:"—"}</td><td>{canAnalyze?<button className="analyze-source" onClick={()=>onAnalyze?.(event.sourceAddress)}>Analyze · 1 credit</button>:knownService?<StatusPill tone="success">service</StatusPill>:null}</td></tr>;
    })}</tbody></table></div>}
  </section>;
}
