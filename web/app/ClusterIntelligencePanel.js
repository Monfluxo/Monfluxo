"use client";
const fmt=v=>new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(Number(v)||0);
const labels={pending_history:'Awaiting complete history',unavailable:'Temporarily unavailable',insufficient_cluster_evidence:'Insufficient cluster evidence',relationship_detected:'Relationship detected',potential_cluster:'Potential cluster'};
export default function ClusterIntelligencePanel({cluster={}}) {
  const rows=cluster.relationships||[];
  return <section className="glass-surface review-panel" aria-label="Cluster Intelligence">
    <h2>Cluster Intelligence</h2><p>{labels[cluster.status]||'Cluster analysis pending'}</p>
    <div className="detail-grid"><div><span>Candidate wallets</span><strong>{cluster.candidateWallets??'—'}</strong></div><div><span>Previously analyzed</span><strong>{cluster.analyzedCandidateWallets??'—'}</strong></div><div><span>Likely related</span><strong>{cluster.likelyRelatedWallets??'—'}</strong></div></div>
    {rows.length?<><p>Funding relationships are visible below. Funding alone does not establish shared ownership or a cluster.</p><div className="review-table-scroll"><table className="review-table"><thead><tr><th>Wallet</th><th>Score</th><th>Direct funding</th><th>Behavioral data</th></tr></thead><tbody>{rows.map(row=><tr key={row.wallet}><td><a className="mono" href={`https://solscan.io/account/${encodeURIComponent(row.wallet)}`} target="_blank" rel="noreferrer">{row.entity?.label||row.wallet}</a></td><td>{row.score}/100 · {row.confidence}</td><td>{fmt(row.signals?.directFundingSol)} SOL · {row.signals?.directFundingEvents||0} events</td><td>{row.analyzed?'Available':'Not analyzed'}</td></tr>)}</tbody></table></div></>:<p>{cluster.status==='pending_history'?'Relationships will be evaluated when historical indexing completes.':cluster.status==='unavailable'?'Cluster analysis could not be loaded. Try refreshing the wallet.':'No eligible funding relationships found in the available sample.'}</p>}
    {cluster.excludedKnownEntities>0?<p>{cluster.excludedKnownEntities} known service entities excluded from scoring.</p>:null}
    <p>{cluster.disclaimer||'On-chain relationships estimate coordination; they do not establish human identity or ownership.'}</p>
  </section>;
}
