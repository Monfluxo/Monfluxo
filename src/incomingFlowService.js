import { getWalletFundingPage, getWalletInboundTransferPage, getWalletRewardsPage } from "./db.js";
import { getTokenMetadata } from "./helius.js";
import { getWalletPortfolioSnapshot } from "./walletPortfolioService.js";
import { getEntityLabels } from "./entityLabelService.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const MIN_USD = Number(process.env.MIN_INCOMING_USD || 5);
const MIN_ORIGIN_SOL = Number(process.env.MIN_WALLET_ORIGIN_SOL || 0.001);
const MAX_ROWS = Math.max(500, Number(process.env.INCOMING_FLOW_MAX_ROWS || 10000));
const CACHE_MS = Number(process.env.INCOMING_FLOW_CACHE_MS || 60000);
const METADATA_CONCURRENCY = Math.max(1, Number(process.env.INCOMING_FLOW_METADATA_CONCURRENCY || 2));
const cache = new Map();

function blockTime(row) {
  return row?.block_time ? Math.floor(new Date(row.block_time).getTime() / 1000) : null;
}

function mapSolFunding(row) {
  return {
    signature: row.signature || null,
    blockTime: blockTime(row),
    assetType: "SOL",
    assetId: "SOL",
    amount: Number(row.amount || 0),
    sourceAddress: row.source_address || null,
    destinationAddress: row.destination_address || null,
    parser: row.parser || null,
    classification: "TRANSFER"
  };
}

function mapInboundTransfer(row) {
  return {
    signature: row.signature || null,
    blockTime: blockTime(row),
    assetType: "TOKEN",
    assetId: row.token_mint || null,
    tokenMint: row.token_mint || null,
    amount: Number(row.token_amount || 0),
    sourceAddress: row.source_address || null,
    destinationAddress: row.destination_address || null,
    sourceTokenAccount: row.source_token_account || null,
    destinationTokenAccount: row.destination_token_account || null,
    parser: row.parser || null,
    classification: "TRANSFER"
  };
}

function mapReward(row) {
  return {
    signature: row.signature || null,
    blockTime: blockTime(row),
    assetType: "TOKEN",
    assetId: row.quote_mint || null,
    tokenMint: row.quote_mint || null,
    amount: Number(row.amount || 0),
    claimCount: 1,
    classification: "CREATOR_REWARD"
  };
}

async function readAll(pageFn, address, mapper) {
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; offset < MAX_ROWS; offset += pageSize) {
    const page = await pageFn(address, pageSize, offset);
    if (!page.length) break;
    rows.push(...page.map(mapper));
    if (page.length < pageSize) break;
  }
  return rows;
}

function aggregateRewards(events) {
  const grouped = new Map();
  for (const event of events) {
    if (!event.assetId) continue;
    const current = grouped.get(event.assetId) || { ...event, amount: 0, claimCount: 0, firstBlockTime: null, lastBlockTime: null };
    current.amount += Number(event.amount || 0);
    current.claimCount += 1;
    const time = Number(event.blockTime || 0);
    if (time && (!current.firstBlockTime || time < current.firstBlockTime)) current.firstBlockTime = time;
    if (time && (!current.lastBlockTime || time > current.lastBlockTime)) {
      current.lastBlockTime = time;
      current.blockTime = time;
      current.signature = event.signature || current.signature;
    }
    grouped.set(event.assetId, current);
  }
  return [...grouped.values()];
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

async function resolveSolPriceUsd(portfolio) {
  const nativePrice = Number(portfolio?.solPriceUsd);
  if (Number.isFinite(nativePrice) && nativePrice > 0) return nativePrice;
  try {
    const wrappedSol = await getTokenMetadata(WSOL_MINT);
    const wrappedPrice = Number(wrappedSol?.priceUsd);
    if (Number.isFinite(wrappedPrice) && wrappedPrice > 0) return wrappedPrice;
  } catch {}
  return null;
}

function isMeaningfulOrigin(event) {
  const estimatedUsd = Number(event?.estimatedUsd);
  if (Number.isFinite(estimatedUsd)) return estimatedUsd >= MIN_USD;
  if (event?.assetType === "SOL") return Number(event.amount || 0) >= MIN_ORIGIN_SOL;
  return false;
}

function withEntity(event, labels) {
  if (!event?.sourceAddress) return event;
  return { ...event, sourceEntity: labels.get(event.sourceAddress) || null };
}

export async function buildIncomingFlowIntelligence(address) {
  const hit = cache.get(address);
  if (hit && Date.now() - hit.createdAt < CACHE_MS) return hit.value;

  const [solFunding, tokenInflows, rewards, portfolio] = await Promise.all([
    readAll(getWalletFundingPage, address, mapSolFunding),
    readAll(getWalletInboundTransferPage, address, mapInboundTransfer),
    readAll(getWalletRewardsPage, address, mapReward),
    getWalletPortfolioSnapshot(address).catch(() => ({ status: "unavailable", holdings: [] }))
  ]);

  const funding = [...solFunding, ...tokenInflows];
  const rewardGroups = aggregateRewards(rewards);
  const portfolioByMint = new Map((portfolio?.holdings || []).map((item) => [item.tokenMint, item]));
  const solPriceUsd = await resolveSolPriceUsd(portfolio);
  const tokenMints = [...new Set([...tokenInflows, ...rewardGroups]
    .map((event) => event.assetId)
    .filter(Boolean))];

  const missingMints = tokenMints.filter((mint) => !portfolioByMint.has(mint));
  const metadataRows = await mapLimit(missingMints, METADATA_CONCURRENCY, async (mint) => {
    try { return [mint, await getTokenMetadata(mint)]; }
    catch { return [mint, null]; }
  });
  const metadataByMint = new Map(metadataRows);

  function enrich(event) {
    if (event.assetType === "SOL") {
      return {
        ...event,
        tokenName: "Solana",
        tokenSymbol: "SOL",
        priceUsd: Number.isFinite(solPriceUsd) ? solPriceUsd : null,
        estimatedUsd: Number.isFinite(solPriceUsd) ? Number(event.amount || 0) * solPriceUsd : null
      };
    }
    const holding = portfolioByMint.get(event.assetId);
    const metadata = metadataByMint.get(event.assetId);
    const priceUsd = Number(holding?.priceUsd ?? metadata?.priceUsd);
    const image = holding?.imageUrl || holding?.tokenImageRaw || metadata?.image || null;
    return {
      ...event,
      tokenName: holding?.tokenName || metadata?.name || null,
      tokenSymbol: holding?.tokenSymbol || metadata?.symbol || null,
      tokenImage: image || null,
      priceUsd: Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : null,
      estimatedUsd: Number.isFinite(priceUsd) && priceUsd > 0 ? Number(event.amount || 0) * priceUsd : null
    };
  }

  const enrichedFunding = funding.map(enrich);
  const enrichedRewards = rewardGroups.map((event) => {
    if (event.assetId === WSOL_MINT && Number.isFinite(solPriceUsd)) {
      return { ...enrich(event), tokenName: "Wrapped SOL", tokenSymbol: "WSOL", priceUsd: solPriceUsd, estimatedUsd: Number(event.amount || 0) * solPriceUsd };
    }
    return enrich(event);
  });

  const all = [...enrichedFunding, ...enrichedRewards];
  const visible = all.filter((event) => Number.isFinite(Number(event.estimatedUsd)) && Number(event.estimatedUsd) >= MIN_USD);
  const rawHighestValue = [...visible]
    .sort((a, b) => Number(b.estimatedUsd || 0) - Number(a.estimatedUsd || 0) || Number(b.blockTime || 0) - Number(a.blockTime || 0))
    .slice(0, 30);
  const rawLatest = [...visible]
    .sort((a, b) => Number(b.blockTime || 0) - Number(a.blockTime || 0) || Number(b.estimatedUsd || 0) - Number(a.estimatedUsd || 0))
    .slice(0, 30);
  const meaningfulFunding = enrichedFunding.filter(isMeaningfulOrigin);
  const rawFirstFunding = meaningfulFunding.length
    ? [...meaningfulFunding].sort((a, b) => Number(a.blockTime || Number.MAX_SAFE_INTEGER) - Number(b.blockTime || Number.MAX_SAFE_INTEGER))[0]
    : null;

  const sourceAddresses = [...new Set([
    ...rawHighestValue.map((x) => x.sourceAddress),
    ...rawLatest.map((x) => x.sourceAddress),
    rawFirstFunding?.sourceAddress
  ].filter(Boolean))];
  const labels = await getEntityLabels(sourceAddresses).catch(() => new Map());
  const highestValue = rawHighestValue.map((event) => withEntity(event, labels));
  const latest = rawLatest.map((event) => withEntity(event, labels));
  const firstFunding = rawFirstFunding ? withEntity(rawFirstFunding, labels) : null;

  const value = {
    status: "ready",
    wallet: address,
    minUsd: MIN_USD,
    minOriginSol: MIN_ORIGIN_SOL,
    solPriceUsd,
    solPricingAvailable: Number.isFinite(solPriceUsd) && solPriceUsd > 0,
    scannedFundingEvents: funding.length,
    scannedNativeSolFundingEvents: solFunding.length,
    scannedInboundTokenTransfers: tokenInflows.length,
    scannedRewardClaims: rewards.length,
    historyTruncated: solFunding.length >= MAX_ROWS || tokenInflows.length >= MAX_ROWS || rewards.length >= MAX_ROWS,
    hiddenBelowThresholdOrUnpriced: all.length - visible.length,
    highestValue,
    latest,
    events: highestValue,
    firstFunding,
    transferCount: enrichedFunding.length,
    rewardCount: enrichedRewards.length,
    rewardClaimCount: rewards.length
  };
  cache.set(address, { createdAt: Date.now(), value });
  return value;
}
