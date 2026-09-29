"use client";

import { useEffect, useMemo, useState } from "react";

function fmt(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
}

function sol(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${fmt(n, digits)} SOL`;
}

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${fmt(n, 2)}%`;
}

function shorten(value, left = 8, right = 6) {
  if (!value) return "—";
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

function BrandMark({ compact = false }) {
  return (
    <div className={`brand-mark ${compact ? "brand-mark-compact" : ""}`} aria-label="Monfluxo">
      <svg viewBox="0 0 120 82" aria-hidden="true">
        <defs>
          <linearGradient id={compact ? "monfluxoGradientCompact" : "monfluxoGradient"} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#18f4df" />
            <stop offset="52%" stopColor="#10b8ff" />
            <stop offset="100%" stopColor="#315dff" />
          </linearGradient>
        </defs>
        <path d="M8 70 C15 70 18 66 22 58 L39 24 C44 14 53 14 59 23 L69 38 C72 43 76 43 80 38 L91 24 C98 15 107 16 112 27 L116 36" fill="none" stroke={`url(#${compact ? "monfluxoGradientCompact" : "monfluxoGradient"})`} strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18 69 C25 69 29 64 33 56 L46 31 C50 23 57 23 62 31 L80 61 C84 68 91 69 98 69" fill="none" stroke={`url(#${compact ? "monfluxoGradientCompact" : "monfluxoGradient"})`} strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function FlowBackground() {
  return (
    <div className="flow-stage" aria-hidden="true">
      <div className="flow-orb flow-orb-a" /><div className="flow-orb flow-orb-b" />
      <svg className="flow-svg flow-svg-a" viewBox="0 0 1600 900" preserveAspectRatio="none">
        <defs><linearGradient id="flowGradientA" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#14f1df" stopOpacity="0" /><stop offset="24%" stopColor="#14f1df" stopOpacity=".9" /><stop offset="72%" stopColor="#1688ff" stopOpacity=".9" /><stop offset="100%" stopColor="#315dff" stopOpacity="0" /></linearGradient></defs>
        {[0,1,2,3,4,5].map((i) => <path key={i} d={`M-120 ${650+i*18} C 300 ${510-i*20}, 520 ${780-i*25}, 900 ${625-i*18} S 1350 ${470-i*14}, 1740 ${540-i*22}`} fill="none" stroke="url(#flowGradientA)" strokeWidth={i===2?3:1.3} opacity={.7-i*.06} />)}
      </svg>
      <svg className="flow-svg flow-svg-b" viewBox="0 0 1600 900" preserveAspectRatio="none">{[0,1,2,3].map((i)=><path key={i} d={`M-100 ${270+i*34} C 330 ${100+i*20}, 650 ${500-i*12}, 980 ${300+i*26} S 1350 ${130+i*30}, 1700 ${250+i*22}`} fill="none" stroke="rgba(26,142,255,.28)" strokeWidth="1" />)}</svg>
      <div className="flow-particles">{Array.from({length:14}).map((_,i)=><span key={i} style={{"--i":i}} />)}</div>
    </div>
  );
}

function StatusPill({ tone="neutral", children }) { return <span className={`pill pill-${tone}`}>{children}</span>; }
function MetricCard({ label, value, hint, tone="default" }) { return <div className={`metric-card metric-${tone}`}><div className="metric-label">{label}</div><div className="metric-value">{value}</div>{hint?<div className="metric-hint">{hint}</div>:null}</div>; }
function Section({ title, subtitle, children, action, className="" }) { return <section className={`panel ${className}`}><div className="panel-header"><div><h2>{title}</h2>{subtitle?<p>{subtitle}</p>:null}</div>{action}</div>{children}</section>; }

function tokenTitle(item) {
  return item?.tokenName || item?.tokenSymbol || shorten(item?.tokenMint);
}

function TokenCell({ item }) {
  const initials = (item?.tokenSymbol || item?.tokenName || item?.tokenMint || "?").replace(/[^a-z0-9]/gi, "").slice(0,2).toUpperCase() || "?";
  return <div className="token-cell"><div className="token-avatar">{initials}</div><div className="token-copy"><div className="token-primary">{tokenTitle(item)}{item?.tokenSymbol && item?.tokenName ? <span>${item.tokenSymbol}</span> : null}</div><div className="token-mint mono">{shorten(item?.tokenMint)}</div></div></div>;
}

function TradeTable({ trades=[], emptyText }) {
  if (!trades.length) return <div className="empty">{emptyText}</div>;
  return <div className="table-wrap compact-table"><table><thead><tr><th>Token</th><th>Costo</th><th>Venta</th><th>PnL</th><th>ROI</th></tr></thead><tbody>{trades.map((trade)=><tr key={`${trade.signature}-${trade.tokenMint}`}><td><TokenCell item={trade}/></td><td>{sol(trade.costSol)}</td><td>{sol(trade.proceedsSol)}</td><td className={Number(trade.pnlSol)>=0?"positive":"negative"}>{sol(trade.pnlSol)}</td><td className={Number(trade.roiPct)>=0?"positive":"negative"}>{pct(trade.roiPct)}</td></tr>)}</tbody></table></div>;
}

function PositionTable({ positions=[] }) {
  if (!positions.length) return <div className="empty">No inventory data available.</div>;
  return <div className="table-wrap"><table><thead><tr><th>Token</th><th>Estado</th><th>Trades</th><th>Costo</th><th>Venta</th><th>Utilidad</th><th>Cobertura</th></tr></thead><tbody>{positions.map((position)=><tr key={`${position.tokenMint}-${position.state}`}><td><TokenCell item={position}/></td><td>{position.state==="provisional"?<StatusPill tone="warning">provisional</StatusPill>:<StatusPill tone={position.state==="open"?"warning":"neutral"}>{position.state==="open"?"abierta":"cerrada"}</StatusPill>}</td><td>{fmt(position.trades,0)}</td><td>{sol(position.solSpent)}</td><td>{sol(position.solReceived)}</td><td className={Number(position.totalPnlSol)>=0?"positive":"negative"}>{sol(position.totalPnlSol)}</td><td><StatusPill tone={position.pnlComplete?"success":"warning"}>{position.pnlComplete?"completa":"parcial"}</StatusPill></td></tr>)}</tbody></table></div>;
}

export default function Home() {
  const [wallet,setWallet]=useState("");
  const [query,setQuery]=useState("");
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  async function loadWallet(address, silent=false) {
    if (!address) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      const response=await fetch(`/api/wallet/${encodeURIComponent(address)}`,{cache:"no-store"});
      const payload=await response.json();
      if(!response.ok) throw new Error(payload?.message||"Unable to load wallet intelligence.");
      setData(payload); setWallet(address);
    } catch(err) { setError(err.message||"Unable to load wallet intelligence."); }
    finally { if(!silent) setLoading(false); }
  }

  useEffect(()=>{
    if(!data?.indexing?.refreshRecommended||!wallet) return;
    const timer=setInterval(()=>loadWallet(wallet,true),12000);
    return ()=>clearInterval(timer);
  },[data?.indexing?.refreshRecommended,wallet]);

  const confidenceTone=useMemo(()=>data?.confidence?.level==="high"?"success":data?.confidence?.level==="review"?"danger":"warning",[data?.confidence?.level]);
  function submit(event){event.preventDefault();loadWallet(query.trim());}

  const overview=data?.overview||{}, performance=data?.performance||{}, coverage=data?.coverage||{}, accounting=data?.accounting||{}, activity=data?.activity||{}, rewards=data?.rewards||{};
  const closedHint=coverage.historyComplete?`${fmt(overview.closedPositions,0)} closed positions`:"Position states provisional";

  return <main className="app-shell"><FlowBackground />
    <header className="topbar glass-surface"><div className="brand-row"><BrandMark compact/><div><div className="brand-name">MONFLUXO</div><div className="brand-subtitle">Wallet Intelligence</div></div></div><div className="topbar-right"><StatusPill>Solana</StatusPill>{data?<StatusPill tone={data.status==="ready"?"success":"warning"}>{data.status}</StatusPill>:null}</div></header>
    <div className="content">
      <section className="hero glass-surface hero-surface"><div className="hero-brand-watermark"><BrandMark/></div><div className="eyebrow">ON-CHAIN INTELLIGENCE</div><h1>Understand the wallet.<br/><span>Follow the flow.</span></h1><p>Deterministic Solana wallet reconstruction with explicit historical coverage, PnL confidence and accounting integrity.</p><form className="search" onSubmit={submit}><input aria-label="Solana wallet address" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Paste a Solana wallet address"/><button type="submit" disabled={loading||!query.trim()}>{loading?"Analyzing…":"Analyze wallet"}</button></form>{error?<div className="error-box">{error}</div>:null}</section>

      {data?<>
        <div className="wallet-strip glass-surface"><div><div className="strip-label">Wallet</div><div className="wallet-address mono">{data.wallet}</div></div><div className="strip-pills"><StatusPill tone={data.metricsStatus==="final"?"success":"warning"}>{data.metricsStatus} metrics</StatusPill><StatusPill tone={confidenceTone}>{data.confidence?.label}</StatusPill></div></div>
        <div className="metric-grid"><MetricCard label="Known-cost PnL" value={sol(performance.totalPnlSol)} hint={performance.pnlCoverage?.complete?"Complete cost basis":"Partial cost-basis coverage"} tone={Number(performance.totalPnlSol)>=0?"positive":"negative"}/><MetricCard label="Total volume" value={sol(overview.totalVolumeSol)} hint={`${fmt(overview.tradesAnalyzed,0)} analyzed events`}/><MetricCard label="Win rate" value={overview.winRatePct==null?"—":`${fmt(overview.winRatePct)}%`} hint={closedHint}/><MetricCard label="Fees" value={sol(overview.feesSol,4)} hint="Observed trading fees"/></div>

        <div className="trade-grid">
          <Section title="Top 5 trades" subtitle="Best realized FIFO outcomes by known-cost PnL." action={<StatusPill tone="success">best</StatusPill>}><TradeTable trades={data.trades?.best||[]} emptyText="No realized known-cost trades yet."/></Section>
          <Section title="Bottom 5 trades" subtitle="Worst realized FIFO outcomes by known-cost PnL." action={<StatusPill tone="danger">worst</StatusPill>}><TradeTable trades={data.trades?.worst||[]} emptyText="No realized known-cost trades yet."/></Section>
        </div>

        <Section title="Inventory & positions" subtitle={coverage.historyComplete?"Final reconstructed token inventory.":"Provisional inventory while historical indexing is still running."} action={<StatusPill tone={coverage.historyComplete?"success":"warning"}>{coverage.historyComplete?"final states":"provisional states"}</StatusPill>}><PositionTable positions={data.positions?.top||[]}/></Section>

        <div className="two-col"><Section title="Historical coverage" subtitle="How much of the wallet MONFLUXO has indexed."><div className="coverage-status"><StatusPill tone={coverage.historyComplete?"success":"warning"}>{coverage.historyComplete?"complete":"indexing"}</StatusPill><div className="coverage-copy">{coverage.historyComplete?"Full indexed history is available for this wallet.":"Older activity is still being indexed. Inventory states remain provisional until completion."}</div></div><div className="detail-grid"><div><span>Pages scanned</span><strong>{fmt(coverage.pagesScanned,0)}</strong></div><div><span>Oldest indexed</span><strong>{coverage.oldestIndexedAt?new Date(coverage.oldestIndexedAt).toLocaleDateString():"—"}</strong></div><div><span>Newest indexed</span><strong>{coverage.newestIndexedAt?new Date(coverage.newestIndexedAt).toLocaleDateString():"—"}</strong></div><div><span>Background job</span><strong>{data.indexing?.job?.status||(coverage.historyComplete?"not needed":"pending")}</strong></div></div></Section>
        <Section title="Accounting confidence" subtitle="Reconstruction quality, not investment quality."><div className="confidence-block"><StatusPill tone={confidenceTone}>{data.confidence?.label}</StatusPill><p>{data.confidence?.reason}</p></div><div className="detail-grid"><div><span>Unmatched proceeds</span><strong>{sol(accounting.unmatchedSellProceedsSol,6)}</strong></div><div><span>Unknown-cost proceeds</span><strong>{sol(accounting.unknownCostSellProceedsSol)}</strong></div><div><span>Low-confidence excluded</span><strong>{fmt(activity.lowConfidenceTradesExcluded,0)}</strong></div><div><span>Excluded volume</span><strong>{sol(activity.lowConfidenceVolumeSolExcluded,5)}</strong></div></div></Section></div>

        <div className="two-col"><Section title="Activity" subtitle="Wallet behavior across trades and transfers."><div className="detail-grid"><div><span>Buys</span><strong>{fmt(overview.buyCount,0)}</strong></div><div><span>Sells</span><strong>{fmt(overview.sellCount,0)}</strong></div><div><span>Transfer in</span><strong>{fmt(activity.transferInCount,0)}</strong></div><div><span>Transfer out</span><strong>{fmt(activity.transferOutCount,0)}</strong></div><div><span>Unique tokens</span><strong>{fmt(overview.uniqueTokens,0)}</strong></div><div><span>Realized trades</span><strong>{fmt(overview.realizedTradesAnalyzed,0)}</strong></div></div></Section><Section title="Creator rewards" subtitle="Creator-fee claims kept separate from trading PnL."><div className="reward-number">{fmt(rewards.creatorRewardCount,0)}</div><div className="reward-label">reward events identified</div><div className="reward-foot">Token amount observed: <strong>{fmt(rewards.creatorRewardTokenAmount,6)}</strong></div></Section></div>
        <footer><div>MONFLUXO · Don&apos;t just look at the blockchain. Understand it.</div><div className="mono">schema {data.schemaVersion}</div></footer>
      </>:<div className="loading-panel">{loading?"Building wallet intelligence…":"Paste a wallet to begin."}</div>}
    </div>
  </main>;
}
