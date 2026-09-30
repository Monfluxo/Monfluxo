"use client";

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

function sol(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${fmt(n, digits)} SOL`;
}

function shorten(value, left = 7, right = 5) {
  if (!value) return "—";
  return value.length <= left + right + 3 ? value : `${value.slice(0, left)}…${value.slice(-right)}`;
}

function RevenueToken({ coin }) {
  const initials = (coin?.tokenSymbol || coin?.tokenName || coin?.tokenMint || "?").replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
  return <div className="creator-token">
    {coin?.tokenImage ? <img src={coin.tokenImage} alt="" className="creator-token-image"/> : <div className="creator-token-fallback">{initials}</div>}
    <div><strong>{coin?.tokenName || coin?.tokenSymbol || shorten(coin?.tokenMint)}</strong>{coin?.tokenSymbol ? <span>${coin.tokenSymbol}</span> : null}<small>{shorten(coin?.tokenMint)}</small></div>
  </div>;
}

export default function CreatorRevenuePanel({ revenue }) {
  if (!revenue || revenue.status === "unavailable") return null;
  if (revenue.status === "none") return null;
  const rows = revenue.topCoins || [];
  const claimedUsd = Number(revenue?.totals?.claimed?.usd);
  const unclaimedUsd = Number(revenue?.totals?.unclaimed?.usd);
  return <section className="panel creator-revenue-panel">
    <div className="panel-header"><div><h2>Creator Revenue Intelligence</h2><p>Per-token Pump creator revenue reconstructed from actual fee-distribution timelines.</p></div><span className="pill pill-success">coin-attributed</span></div>
    <div className="creator-revenue-kpis">
      <div><span>Distributed revenue</span><strong>{usd(revenue?.distributed?.usd)}</strong><small>{sol(revenue?.distributed?.sol)}</small></div>
      <div><span>Last 30 days</span><strong>{usd(revenue?.last30d?.usd)}</strong><small>{sol(revenue?.last30d?.sol)}</small></div>
      <div><span>Earning tokens</span><strong>{fmt(revenue?.earningCoins,0)}</strong><small>{fmt(revenue?.totalCoins,0)} linked tokens</small></div>
      <div><span>Unclaimed</span><strong>{Number.isFinite(unclaimedUsd)?usd(unclaimedUsd):"—"}</strong><small>{Number.isFinite(claimedUsd)?`${usd(claimedUsd)} claimed`:"wallet-level"}</small></div>
    </div>
    {rows.length ? <div className="table-wrap creator-revenue-table"><table><thead><tr><th>Token</th><th>Revenue paid</th><th>30d</th><th>Distributions</th><th>Share of revenue</th><th>Last paid</th></tr></thead><tbody>{rows.map((coin)=><tr key={coin.tokenMint}><td><RevenueToken coin={coin}/></td><td><strong>{usd(coin?.earned?.usd)}</strong><small className="revenue-sol">{sol(coin?.earned?.sol)}</small></td><td>{usd(coin?.earnedLast30d?.usd)}</td><td>{fmt(coin.distributions,0)}</td><td>{fmt(coin.shareOfCreatorRevenuePct,1)}%</td><td>{coin.lastEarnedAt?new Date(coin.lastEarnedAt).toLocaleDateString():"—"}</td></tr>)}</tbody></table></div> : <div className="empty">No distributed per-token creator revenue detected yet.</div>}
    <div className="creator-revenue-note">Per-token values represent <strong>distributed/paid creator fees</strong>. Pump reports unclaimed fees at wallet level, so unclaimed revenue is intentionally not assigned to a specific token until it is distributed.</div>
  </section>;
}
