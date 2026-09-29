const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const baseUrl = SUPABASE_URL.replace(/\/$/, "");
const headers = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json"
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase cluster request failed (${response.status}): ${body}`);
  }
  if (response.status === 204) return null;
  const body = await response.text();
  return body.trim() ? JSON.parse(body) : null;
}

function q(value) {
  return encodeURIComponent(value);
}

async function getFunding(address, limit = 500) {
  return request(
    `wallet_funding_events?wallet_address=eq.${q(address)}&select=*&order=block_time.desc,slot.desc.nullslast&limit=${limit}`
  );
}

async function getTrades(address, limit = 5000) {
  return request(
    `wallet_trades?wallet_address=eq.${q(address)}&select=type,token_mint,sol_amount,dex,block_time,signature,event_index&order=block_time.asc,slot.asc.nullslast,event_index.asc&limit=${limit}`
  );
}

async function hasAnalyzedData(address) {
  const rows = await request(
    `wallet_analysis_cache?wallet_address=eq.${q(address)}&select=wallet_address&limit=1`
  );
  return Array.isArray(rows) && rows.length > 0;
}

function sourceStats(events, wallet) {
  const map = new Map();
  for (const event of events || []) {
    const source = event.source_address;
    if (!source || source === wallet) continue;
    const row = map.get(source) || {
      wallet: source,
      events: 0,
      solAmount: 0,
      tokenEvents: 0
    };
    row.events++;
    if (event.asset_type === "SOL") row.solAmount += Number(event.amount || 0);
    else row.tokenEvents++;
    map.set(source, row);
  }
  return [...map.values()].sort((a, b) =>
    (b.solAmount - a.solAmount) || (b.events - a.events)
  );
}

function tokenSet(trades) {
  return new Set((trades || []).map((x) => x.token_mint).filter(Boolean));
}

function jaccardPct(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  const union = new Set([...a, ...b]).size;
  return union ? (intersection / union) * 100 : 0;
}

function median(values) {
  const list = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

function similarityPct(a, b) {
  if (!(a > 0) || !(b > 0)) return 0;
  return (Math.min(a, b) / Math.max(a, b)) * 100;
}

function dexSet(trades) {
  return new Set((trades || []).map((x) => x.dex).filter(Boolean));
}

function synchronizedTradeStats(aTrades, bTrades, windowSeconds = 60) {
  const groups = new Map();
  for (const trade of bTrades || []) {
    if (!trade.token_mint || !trade.type || !trade.block_time) continue;
    const key = `${trade.type}:${trade.token_mint}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(new Date(trade.block_time).getTime() / 1000);
  }
  for (const values of groups.values()) values.sort((a, b) => a - b);

  let comparable = 0;
  let synchronized = 0;
  for (const trade of aTrades || []) {
    if (!trade.token_mint || !trade.type || !trade.block_time) continue;
    const times = groups.get(`${trade.type}:${trade.token_mint}`);
    if (!times?.length) continue;
    comparable++;
    const time = new Date(trade.block_time).getTime() / 1000;
    let nearest = Infinity;
    for (const candidate of times) {
      const diff = Math.abs(candidate - time);
      if (diff < nearest) nearest = diff;
      if (candidate > time + windowSeconds) break;
    }
    if (nearest <= windowSeconds) synchronized++;
  }

  return {
    synchronized,
    comparable,
    scorePct: comparable ? Math.min(100, (synchronized / comparable) * 100) : 0,
    windowSeconds
  };
}

function fundingSources(events, excluded = new Set()) {
  return new Set(
    (events || [])
      .map((x) => x.source_address)
      .filter((x) => x && !excluded.has(x))
  );
}

function intersectionCount(a, b) {
  let count = 0;
  for (const value of a) if (b.has(value)) count++;
  return count;
}

function confidence(score) {
  if (score >= 80) return "very_high";
  if (score >= 65) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function canonicalPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function persistRelationship(wallet, candidate, score, conf, signals, evidenceCount) {
  const [walletA, walletB] = canonicalPair(wallet, candidate);
  return request("wallet_relationships?on_conflict=wallet_a,wallet_b", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      wallet_a: walletA,
      wallet_b: walletB,
      relationship_score: score,
      confidence: conf,
      signals,
      evidence_count: evidenceCount,
      computed_at: new Date().toISOString()
    })
  });
}

export async function buildClusterIntelligence(wallet, options = {}) {
  const candidateLimit = Math.min(Math.max(Number(options.candidateLimit || 12), 1), 30);
  const currentFunding = await getFunding(wallet, 500);
  const candidates = sourceStats(currentFunding, wallet).slice(0, candidateLimit);
  const currentTrades = await getTrades(wallet, 5000);
  const currentTokenSet = tokenSet(currentTrades);
  const currentDexSet = dexSet(currentTrades);
  const currentMedianTradeSol = median(currentTrades.map((x) => x.sol_amount));
  const currentSources = fundingSources(currentFunding, new Set([wallet]));

  const relationships = [];

  for (const candidateInfo of candidates) {
    const candidate = candidateInfo.wallet;
    const analyzed = await hasAnalyzedData(candidate);
    let score = candidateInfo.solAmount > 0.001 ? 25 : 10;
    let evidenceCount = 1;
    const signals = {
      directFunding: true,
      directFundingSol: round(candidateInfo.solAmount, 6),
      directFundingEvents: candidateInfo.events,
      directTokenFundingEvents: candidateInfo.tokenEvents,
      behavioralDataAvailable: analyzed
    };

    if (analyzed) {
      const [candidateTrades, candidateFunding] = await Promise.all([
        getTrades(candidate, 5000),
        getFunding(candidate, 500)
      ]);

      const overlapPct = jaccardPct(currentTokenSet, tokenSet(candidateTrades));
      const sync = synchronizedTradeStats(currentTrades, candidateTrades, 60);
      const tradeSizeSimilarityPct = similarityPct(
        currentMedianTradeSol,
        median(candidateTrades.map((x) => x.sol_amount))
      );
      const dexOverlapPct = jaccardPct(currentDexSet, dexSet(candidateTrades));
      const candidateSources = fundingSources(candidateFunding, new Set([wallet, candidate]));
      const sharedFundingSources = intersectionCount(currentSources, candidateSources);
      const returnFlow = candidateFunding.some((event) => event.source_address === wallet);

      signals.tokenOverlapPct = round(overlapPct);
      signals.synchronizedTrades = sync.synchronized;
      signals.comparableSynchronizedTrades = sync.comparable;
      signals.tradeSynchronizationPct = round(sync.scorePct);
      signals.synchronizationWindowSeconds = sync.windowSeconds;
      signals.tradeSizeSimilarityPct = round(tradeSizeSimilarityPct);
      signals.dexOverlapPct = round(dexOverlapPct);
      signals.sharedFundingSources = sharedFundingSources;
      signals.bidirectionalFunding = returnFlow;

      if (returnFlow) {
        score += 25;
        evidenceCount++;
      }
      if (sharedFundingSources > 0) {
        score += Math.min(15, 5 + sharedFundingSources * 5);
        evidenceCount++;
      }
      if (overlapPct >= 20) {
        score += Math.min(15, overlapPct * 0.15);
        evidenceCount++;
      }
      if (sync.synchronized >= 3) {
        score += Math.min(15, sync.scorePct * 0.15);
        evidenceCount++;
      }
      if (tradeSizeSimilarityPct >= 50) {
        score += Math.min(5, tradeSizeSimilarityPct * 0.05);
        evidenceCount++;
      }
      if (dexOverlapPct >= 50) {
        score += Math.min(5, dexOverlapPct * 0.05);
        evidenceCount++;
      }
    }

    score = round(Math.min(100, score));
    const conf = confidence(score);
    await persistRelationship(wallet, candidate, score, conf, signals, evidenceCount);

    relationships.push({
      wallet: candidate,
      score,
      confidence: conf,
      evidenceCount,
      analyzed,
      signals
    });
  }

  relationships.sort((a, b) => b.score - a.score);
  const likely = relationships.filter((x) => x.score >= 45);

  return {
    methodology: "relationship_score_v1",
    disclaimer: "Relationship score estimates on-chain coordination or probable common control. It does not establish human identity or ownership.",
    candidateWallets: relationships.length,
    analyzedCandidateWallets: relationships.filter((x) => x.analyzed).length,
    likelyRelatedWallets: likely.length,
    strongestScore: relationships[0]?.score || 0,
    status: likely.length >= 2
      ? "potential_cluster"
      : likely.length === 1
        ? "relationship_detected"
        : "insufficient_cluster_evidence",
    members: likely.slice(0, 8),
    relationships: relationships.slice(0, 12)
  };
}
