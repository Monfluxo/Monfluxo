"use client";

import { useMemo, useState } from "react";

function fmt(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
}

function usd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n < 10 ? 2 : 0
  }).format(n);
}

function sol(value, digits = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${fmt(n, digits)} SOL`;
}

function shorten(value, left = 7, right = 6) {
  if (!value) return "—";
  return value.length <= left + right + 3
    ? value
    : `${value.slice(0, left)}…${value.slice(-right)}`;
}

function StatusPill({ tone = "neutral", children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function TokenCell({ item }) {
  const initials = (item?.tokenSymbol || item?.tokenName || item?.assetId || "?")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase() || "?";
  return <div className="token-cell">
    {item?.tokenImage
      ? <img className="token-avatar token-avatar-img" src={item.tokenImage} alt=""/>
      : <div className="token-avatar">{initials}</div>}
    <div className="token-copy">
      <div className="token-primary">
        {item?.tokenName || item?.tokenSymbol || shorten(item?.assetId)}
        {item?.tokenSymbol && item?.tokenName ? <span>${item.tokenSymbol}</span> : null}
      </div>
      <div className="token-mint mono">{shorten(item?.assetId)}</div>
    </div>
  </div>;
}

function rowsFor(incoming, mode) {
  const fallback = Array.isArray(incoming?.events) ? incoming.events : [];
  const source = mode === "latest"
    ? (Array.isArray(incoming?.latest) ? incoming.latest : fallback)
    : (Array.isArray(incoming?.highestValue) ? incoming.highestValue : fallback);

  return [...source]
    .sort((a, b) => mode === "latest"
      ? Number(b.blockTime || 0) - Number(a.blockTime || 0)
      : Number(b.estimatedUsd || 0) - Number(a.estimatedUsd || 0))
    .slice(0, 10);
}

export default function IncomingFlowsPanel({ incoming = {}, onAnalyze }) {
  const [mode, setMode] = useState("value");
  const rows = useMemo(() => rowsFor(incoming, mode), [incoming, mode]);
  const hidden = Number(incoming?.hiddenBelowThresholdOrUnpriced || 0);
  const minUsd = Number(incoming?.minUsd || 5);

  return <section className="panel secondary-panel incoming-flows-panel">
    <div className="panel-header incoming-header">
      <div>
        <h2>Relevant incoming flows</h2>
        <p>Meaningful external inflows. Creator claims are grouped by payout asset; dust and unpriced transfers are hidden.</p>
      </div>
      <StatusPill tone="neutral">≥ ${fmt(minUsd, 0)} USD</StatusPill>
    </div>

    <div className="incoming-toolbar">
      <div className="incoming-tabs" role="tablist" aria-label="Incoming flow ordering">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "value"}
          className={mode === "value" ? "active" : ""}
          onClick={() => setMode("value")}
        >Highest value</button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "latest"}
          className={mode === "latest" ? "active" : ""}
          onClick={() => setMode("latest")}
        >Latest</button>
      </div>
      <span className="incoming-sort-note">
        {mode === "value" ? "Largest USD inflows first" : "Most recent inflows first"}
      </span>
    </div>

    <div className="funding-credit-note">
      Transfers and creator-fee claims are classified separately. <strong>{fmt(hidden, 0)}</strong> low-value or unpriced groups are hidden.
    </div>

    {!rows.length
      ? <div className="empty">No incoming transfer or reward above the ${fmt(minUsd, 0)} relevance threshold has been priced yet.</div>
      : <div className="table-wrap funding-table"><table>
          <thead><tr><th>Type</th><th>Asset</th><th>Amount</th><th>Est. value</th><th>Origin</th><th>Date</th><th>Tx</th><th></th></tr></thead>
          <tbody>{rows.map((event, index) => {
            const isReward = event.classification === "CREATOR_REWARD";
            const canAnalyze = !isReward && Boolean(event.sourceAddress);
            const claimCount = Number(event.claimCount || 1);
            const originLabel = isReward
              ? `${fmt(claimCount, 0)} ${claimCount === 1 ? "claim" : "claims"}`
              : "unknown";
            return <tr key={`${event.signature || "event"}-${event.assetId || "asset"}-${index}`}>
              <td><StatusPill tone={isReward ? "success" : "neutral"}>{isReward ? "creator reward" : "transfer"}</StatusPill></td>
              <td>{event.assetType === "SOL"
                ? <div className="funding-asset sol-asset"><span className="funding-dot">◎</span><div><strong>SOL</strong><small>Native Solana</small></div></div>
                : <TokenCell item={event}/>}</td>
              <td className="funding-amount">{event.assetType === "SOL" ? sol(event.amount) : fmt(event.amount, 6)}</td>
              <td className="incoming-value"><strong>{usd(event.estimatedUsd)}</strong></td>
              <td>{canAnalyze
                ? <button className="wallet-link mono" onClick={() => onAnalyze?.(event.sourceAddress)}>{shorten(event.sourceAddress)}</button>
                : <span className="muted">{originLabel}</span>}</td>
              <td>{event.blockTime ? new Date(event.blockTime * 1000).toLocaleDateString() : "—"}</td>
              <td>{event.signature ? <a className="tx-link" href={`https://solscan.io/tx/${event.signature}`} target="_blank" rel="noreferrer">View ↗</a> : "—"}</td>
              <td>{canAnalyze ? <button className="analyze-source" onClick={() => onAnalyze?.(event.sourceAddress)}>Analyze · 1 credit</button> : null}</td>
            </tr>;
          })}</tbody>
        </table></div>}
  </section>;
}
