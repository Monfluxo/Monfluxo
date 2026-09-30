"use client";

export function LoadingDots({ label = "Loading" }) {
  return <span className="loading-dots" aria-label={label}><i/><i/><i/></span>;
}

export function SkeletonTable({ columns = 5, rows = 4 }) {
  return <div className="pending-table" aria-label="Loading table data">
    {Array.from({ length: rows }).map((_, row) => <div className="pending-table-row" key={row}>
      {Array.from({ length: columns }).map((__, col) => <span className={col === 0 ? "pending-cell pending-cell-token" : "pending-cell"} key={col}/>) }
    </div>)}
    <div className="pending-table-caption"><LoadingDots label="Indexing history"/> Indexing history</div>
  </div>;
}

export function PendingIntelligence() {
  return <section className="panel intel-hero pending-intelligence">
    <div className="panel-header"><div><h2>MONFLUXO Intelligence</h2><p>Behavioral intelligence will unlock as historical coverage grows.</p></div><span className="pill pill-warning">indexing</span></div>
    <div className="pending-intelligence-main">
      <div><span>Trader profile</span><strong><LoadingDots label="Building trader profile"/></strong></div>
      <div><span>Consistency</span><strong><LoadingDots label="Calculating consistency"/></strong></div>
      <div><span>Profit factor</span><strong><LoadingDots label="Calculating profit factor"/></strong></div>
      <div><span>Observed risk</span><strong><LoadingDots label="Calculating risk"/></strong></div>
    </div>
    <div className="pending-intelligence-note">Building behavioral profile from indexed history. MONFLUXO will not label the wallet until the sample is materially complete.</div>
  </section>;
}
