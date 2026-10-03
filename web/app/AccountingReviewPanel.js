"use client";
const fmt=(v,d=6)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:d}).format(Number(v)||0);
export default function AccountingReviewPanel({accounting={},historyComplete=false}) {
  const rows=accounting.unmatchedPositions||[];
  return <section className="glass-surface review-panel" aria-label="Accounting review">
    <h2>Accounting review · unmatched inventory</h2>
    <p>Sales without a matching purchase, transfer or reward in the reconstructed inventory. These proceeds are not verified trading profit.</p>
    <div className="detail-grid"><div><span>Unmatched sale proceeds</span><strong>{fmt(accounting.unmatchedSellProceedsSol)} SOL</strong></div><div><span>Tokens affected</span><strong>{accounting.tokensAffected??'—'}</strong></div><div><span>External-token sale proceeds</span><strong>{fmt(accounting.externalTokenSaleProceedsSol)} SOL</strong></div></div>
    <p>{historyComplete?'Indexed history is complete; unmatched inventory still requires accounting review.':'History is partial; earlier inventory may still be missing.'} External-token proceeds are accounted for separately.</p>
    {rows.length?<div className="review-table-scroll"><table className="review-table"><thead><tr><th>Token mint</th><th>Unmatched quantity</th><th>Unmatched proceeds</th></tr></thead><tbody>{rows.map(row=><tr key={row.tokenMint}><td><a className="mono" href={`https://solscan.io/token/${encodeURIComponent(row.tokenMint)}`} target="_blank" rel="noreferrer">{row.tokenMint}</a></td><td>{fmt(row.unmatchedSoldTokens,9)}</td><td>{fmt(row.unmatchedSellProceedsSol)} SOL</td></tr>)}</tbody></table></div>:<p>{Number(accounting.unmatchedSellProceedsSol)>0?'The total is available; per-token details are temporarily unavailable.':'No unmatched sale proceeds detected in the available history.'}</p>}
    {accounting.tokensAffected>rows.length?<p>Showing {rows.length} of {accounting.tokensAffected} affected tokens, ordered by proceeds.</p>:null}
    {accounting.truncated?<p>Details cover a bounded history sample and may omit additional events.</p>:null}
  </section>;
}
