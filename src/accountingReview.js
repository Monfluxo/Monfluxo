export function buildAccountingReview(positions, { historyComplete = false, truncated = false } = {}) {
  const rows = positions.filter(p => Number(p.unmatchedSellProceedsSol || 0) > 0)
    .map(p => ({tokenMint:p.tokenMint || p.mint, unmatchedSoldTokens:Number(p.unmatchedSoldTokens || 0),
      unmatchedSellProceedsSol:Number(p.unmatchedSellProceedsSol || 0)}))
    .sort((a,b) => b.unmatchedSellProceedsSol-a.unmatchedSellProceedsSol || a.tokenMint.localeCompare(b.tokenMint));
  return {status:truncated?'partial':historyComplete?'ready':'provisional',
    tokensAffected:rows.length, displayedTokens:Math.min(rows.length,50), truncated,
    unmatchedPositions:rows.slice(0,50),
    detailMessage:'Sale proceeds without matching purchased or external inventory. These amounts are not verified trading profit. Token quantities belong to different assets and must not be added together.'};
}
