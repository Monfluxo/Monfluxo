"use client";

import { useEffect, useMemo, useState } from "react";

const DEFAULT_WALLET = "6DQAGJT7VZPVBsuG4kn3AvpyHCEi7B2RFFvMZdbqQqqP";

function fmt(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits
  }).format(n);
}

function sol(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${fmt(n, digits)} SOL`;
}

function shorten(value, left = 6, right = 5) {
  if (!value) return "—";
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

function tokenLabel(position) {
  if (position?.tokenName && position?.tokenSymbol) {
    return `${position.tokenName} (${position.tokenSymbol})`;
  }
  if (position?.tokenName) return position.tokenName;
  if (position?.tokenSymbol) return position.tokenSymbol;
  return shorten(position?.tokenMint, 7, 6);
}

function StatusPill({ tone = "neutral", children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function MetricCard({ label, value, hint, tone = "default" }) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </div>
  );
}

function Section({ title, subtitle, children, action }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PositionTable({ positions = [] }) {
  if (!positions.length) return <div className="empty">No position data available.</div>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th>State</th>
            <th>Trades</th>
            <th>Costo</th>
            <th>Venta</th>
            <th>Utilidad</th>
            <th>PnL coverage</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr key={`${position.tokenMint}-${position.state}`}>
              <td>{tokenLabel(position)}</td>
              <td>
                <StatusPill tone={position.state === "open" ? "warning" : "neutral"}>
                  {position.state}
                </StatusPill>
              </td>
              <td>{fmt(position.trades, 0)}</td>
              <td>{sol(position.solSpent)}</td>
              <td>{sol(position.solReceived)}</td>
              <td className={Number(position.totalPnlSol) >= 0 ? "positive" : "negative"}>
                {sol(position.totalPnlSol)}
              </td>
              <td>
                <StatusPill tone={position.pnlComplete ? "success" : "warning"}>
                  {position.pnlComplete ? "complete" : "partial"}
                </StatusPill>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Home() {
  const [wallet, setWallet] = useState(DEFAULT_WALLET);
  const [query, setQuery] = useState(DEFAULT_WALLET);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadWallet(address, silent = false) {
    if (!address) return;
    if (!silent) setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/wallet/${encodeURIComponent(address)}`, {
        cache: "no-store"
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || "Unable to load wallet intelligence.");
      setData(payload);
      setWallet(address);
    } catch (err) {
      setError(err.message || "Unable to load wallet intelligence.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadWallet(DEFAULT_WALLET);
  }, []);

  useEffect(() => {
    if (!data?.indexing?.refreshRecommended || !wallet) return;
    const timer = setInterval(() => loadWallet(wallet, true), 12000);
    return () => clearInterval(timer);
  }, [data?.indexing?.refreshRecommended, wallet]);

  const confidenceTone = useMemo(() => {
    if (data?.confidence?.level === "high") return "success";
    if (data?.confidence?.level === "review") return "danger";
    return "warning";
  }, [data?.confidence?.level]);

  function submit(event) {
    event.preventDefault();
    loadWallet(query.trim());
  }

  const overview = data?.overview || {};
  const performance = data?.performance || {};
  const coverage = data?.coverage || {};
  const accounting = data?.accounting || {};
  const activity = data?.activity || {};
  const rewards = data?.rewards || {};

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-row">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-name">MONFLUXO</div>
            <div className="brand-subtitle">Wallet Intelligence</div>
          </div>
        </div>
        <div className="topbar-right">
          <StatusPill tone="neutral">Solana</StatusPill>
          {data ? (
            <StatusPill tone={data.status === "ready" ? "success" : "warning"}>
              {data.status}
            </StatusPill>
          ) : null}
        </div>
      </header>

      <div className="content">
        <section className="hero">
          <div className="eyebrow">ON-CHAIN INTELLIGENCE</div>
          <h1>Understand the wallet, not just the transactions.</h1>
          <p>
            Deterministic Solana wallet reconstruction with explicit historical coverage,
            PnL confidence and accounting integrity.
          </p>

          <form className="search" onSubmit={submit}>
            <input
              aria-label="Solana wallet address"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Paste a Solana wallet address"
            />
            <button type="submit" disabled={loading}>
              {loading ? "Analyzing…" : "Analyze wallet"}
            </button>
          </form>
          {error ? <div className="error-box">{error}</div> : null}
        </section>

        {data ? (
          <>
            <div className="wallet-strip">
              <div>
                <div className="strip-label">Wallet</div>
                <div className="wallet-address mono">{data.wallet}</div>
              </div>
              <div className="strip-pills">
                <StatusPill tone={data.metricsStatus === "final" ? "success" : "warning"}>
                  {data.metricsStatus} metrics
                </StatusPill>
                <StatusPill tone={confidenceTone}>{data.confidence?.label}</StatusPill>
              </div>
            </div>

            <div className="metric-grid">
              <MetricCard
                label="Known-cost PnL"
                value={sol(performance.totalPnlSol)}
                hint={performance.pnlCoverage?.complete ? "Complete cost basis" : "Partial cost-basis coverage"}
                tone={Number(performance.totalPnlSol) >= 0 ? "positive" : "negative"}
              />
              <MetricCard label="Total volume" value={sol(overview.totalVolumeSol)} hint={`${fmt(overview.tradesAnalyzed, 0)} analyzed trades`} />
              <MetricCard label="Win rate" value={`${fmt(overview.winRatePct)}%`} hint={`${fmt(overview.closedPositions, 0)} closed positions`} />
              <MetricCard label="Fees" value={sol(overview.feesSol, 4)} hint="Observed trading fees" />
            </div>

            <div className="two-col">
              <Section title="Historical coverage" subtitle="How much of the wallet MONFLUXO has indexed.">
                <div className="coverage-status">
                  <StatusPill tone={coverage.historyComplete ? "success" : "warning"}>
                    {coverage.historyComplete ? "complete" : "indexing"}
                  </StatusPill>
                  <div className="coverage-copy">
                    {coverage.historyComplete
                      ? "Full indexed history is available for this wallet."
                      : "Older activity is still being indexed in the background."}
                  </div>
                </div>
                <div className="detail-grid">
                  <div><span>Pages scanned</span><strong>{fmt(coverage.pagesScanned, 0)}</strong></div>
                  <div><span>Oldest indexed</span><strong>{coverage.oldestIndexedAt ? new Date(coverage.oldestIndexedAt).toLocaleDateString() : "—"}</strong></div>
                  <div><span>Newest indexed</span><strong>{coverage.newestIndexedAt ? new Date(coverage.newestIndexedAt).toLocaleDateString() : "—"}</strong></div>
                  <div><span>Background job</span><strong>{data.indexing?.job?.status || (coverage.historyComplete ? "not needed" : "pending")}</strong></div>
                </div>
              </Section>

              <Section title="Accounting confidence" subtitle="Reconstruction quality, not investment quality.">
                <div className="confidence-block">
                  <StatusPill tone={confidenceTone}>{data.confidence?.label}</StatusPill>
                  <p>{data.confidence?.reason}</p>
                </div>
                <div className="detail-grid">
                  <div><span>Unmatched proceeds</span><strong>{sol(accounting.unmatchedSellProceedsSol, 6)}</strong></div>
                  <div><span>Unknown-cost proceeds</span><strong>{sol(accounting.unknownCostSellProceedsSol)}</strong></div>
                  <div><span>Low-confidence excluded</span><strong>{fmt(activity.lowConfidenceTradesExcluded, 0)}</strong></div>
                  <div><span>Excluded volume</span><strong>{sol(activity.lowConfidenceVolumeSolExcluded, 5)}</strong></div>
                </div>
              </Section>
            </div>

            <Section
              title="Top positions"
              subtitle="Normalized positions from deterministic FIFO inventory accounting."
              action={<StatusPill tone={performance.pnlCoverage?.complete ? "success" : "warning"}>{performance.pnlCoverage?.status || "partial"} PnL coverage</StatusPill>}
            >
              <PositionTable positions={data.positions?.top || []} />
            </Section>

            <div className="two-col">
              <Section title="Activity" subtitle="Wallet behavior across trades and transfers.">
                <div className="detail-grid">
                  <div><span>Buys</span><strong>{fmt(overview.buyCount, 0)}</strong></div>
                  <div><span>Sells</span><strong>{fmt(overview.sellCount, 0)}</strong></div>
                  <div><span>Transfer in</span><strong>{fmt(activity.transferInCount, 0)}</strong></div>
                  <div><span>Transfer out</span><strong>{fmt(activity.transferOutCount, 0)}</strong></div>
                  <div><span>Unique tokens</span><strong>{fmt(overview.uniqueTokens, 0)}</strong></div>
                  <div><span>Transfer tokens</span><strong>{fmt(activity.transferTokenCount, 0)}</strong></div>
                </div>
              </Section>

              <Section title="Creator rewards" subtitle="Creator-fee claims kept separate from trading PnL.">
                <div className="reward-number">{fmt(rewards.creatorRewardCount, 0)}</div>
                <div className="reward-label">reward events identified</div>
                <div className="reward-foot">Token amount observed: <strong>{fmt(rewards.creatorRewardTokenAmount, 6)}</strong></div>
              </Section>
            </div>

            <footer>
              <div>MONFLUXO · Don&apos;t just look at the blockchain. Understand it.</div>
              <div className="mono">schema {data.schemaVersion}</div>
            </footer>
          </>
        ) : (
          <div className="loading-panel">{loading ? "Building wallet intelligence…" : "Enter a wallet to begin."}</div>
        )}
      </div>
    </main>
  );
}
