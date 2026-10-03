"use client";

function fmt(value, digits = 2) {
  const n = value == null ? NaN : Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
}

function usd(value) {
  const n = value == null ? NaN : Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 2 : 0 }).format(n);
}

function sol(value, digits = 3) {
  const n = value == null ? NaN : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${fmt(n, digits)} SOL`;
}

export default function PortfolioSummary({ portfolio }) {
  if (!portfolio || portfolio.status !== "ready") return null;
  const unrealized = portfolio.openPositionsUnrealizedPnlSol == null ? NaN : Number(portfolio.openPositionsUnrealizedPnlSol);
  const unpriced = Number(portfolio.unpricedTokenCount || 0);
  return <section className="portfolio-summary" aria-label="Current wallet portfolio">
    <div className="portfolio-kpi portfolio-kpi-primary">
      <span>Wallet value</span>
      <strong>{usd(portfolio.walletValueUsd)}</strong>
      <small>{unpriced > 0 ? `${fmt(portfolio.pricedTokenCount,0)} priced · ${fmt(unpriced,0)} unpriced tokens` : `${fmt(portfolio.pricedTokenCount,0)} priced tokens`}</small>
    </div>
    <div className="portfolio-kpi">
      <span>SOL balance</span>
      <strong>{sol(portfolio.solBalance,4)}</strong>
      <small>{usd(portfolio.solValueUsd)} · SOL {usd(portfolio.solPriceUsd)}</small>
    </div>
    <div className="portfolio-kpi">
      <span>Token holdings</span>
      <strong>{usd(portfolio.tokenValueUsd)}</strong>
      <small>{fmt(portfolio.tokenCount,0)} non-zero token balances</small>
    </div>
    <div className={`portfolio-kpi ${Number.isFinite(unrealized) ? (unrealized >= 0 ? "portfolio-positive" : "portfolio-negative") : ""}`}>
      <span>Open unrealized PnL</span>
      <strong>{Number.isFinite(unrealized) ? sol(unrealized,4) : "—"}</strong>
      <small>{portfolio.openPositionsUnrealizedPnlUsd == null ? "Cost basis or pricing unavailable" : `${usd(portfolio.openPositionsUnrealizedPnlUsd)} at current prices`}</small>
    </div>
  </section>;
}

