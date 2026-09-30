const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

const CACHE_MS = Math.max(60_000, Number(process.env.ENTITY_LABEL_CACHE_MS || 24 * 60 * 60 * 1000));
const memoryCache = new Map();
let dbLabelsAvailable = true;

const NON_CLUSTERABLE = new Set([
  "CEX",
  "DEX",
  "ROUTER",
  "BRIDGE",
  "PROTOCOL",
  "CONTRACT",
  "MARKET_MAKER",
  "CUSTODIAN",
  "PAYMENT_PROCESSOR",
  "BOT_SERVICE",
  "INFRASTRUCTURE"
]);

function normalizeCategory(value, type, tags = []) {
  const text = [value, type, ...(Array.isArray(tags) ? tags : [])].filter(Boolean).join(" ").toLowerCase();
  if (/centralized exchange|\bcex\b|exchange/.test(text) && !/decentralized/.test(text)) return "CEX";
  if (/decentralized exchange|\bdex\b/.test(text)) return "DEX";
  if (/router|aggregator/.test(text)) return "ROUTER";
  if (/bridge/.test(text)) return "BRIDGE";
  if (/market maker|\bmm\b/.test(text)) return "MARKET_MAKER";
  if (/custod/.test(text)) return "CUSTODIAN";
  if (/payment|processor|merchant/.test(text)) return "PAYMENT_PROCESSOR";
  if (/bot|service/.test(text)) return "BOT_SERVICE";
  if (/program|contract/.test(text)) return "CONTRACT";
  if (/protocol|defi|staking|lending|launchpad/.test(text)) return "PROTOCOL";
  if (/infrastructure|validator/.test(text)) return "INFRASTRUCTURE";
  if (/wallet|individual|person|unknown/.test(text)) return "UNKNOWN";
  return value ? String(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_") : "UNKNOWN";
}

function normalizedIdentity(row, source = "helius_wallet_api") {
  if (!row?.address) return null;
  const category = normalizeCategory(row.category, row.type, row.tags);
  const known = Boolean(row.name) || (row.type && String(row.type).toLowerCase() !== "unknown") || category !== "UNKNOWN";
  return {
    address: row.address,
    label: row.name || null,
    category,
    entityType: row.type || null,
    confidence: known ? "verified" : "unknown",
    source,
    clusterable: !NON_CLUSTERABLE.has(category),
    tags: Array.isArray(row.tags) ? row.tags : [],
    known
  };
}

function cacheSet(identity) {
  if (!identity?.address) return;
  memoryCache.set(identity.address, { value: identity, createdAt: Date.now() });
}

function cacheGet(address) {
  const hit = memoryCache.get(address);
  if (!hit || Date.now() - hit.createdAt > CACHE_MS) return null;
  return hit.value;
}

async function readPersisted(addresses) {
  if (!dbLabelsAvailable || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !addresses.length) return [];
  const encoded = addresses.map((x) => `"${String(x).replaceAll('"', '')}"`).join(",");
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/wallet_entity_labels?address=in.(${encodeURIComponent(encoded)})&select=*`;
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (response.status === 404 || response.status === 400) {
    dbLabelsAvailable = false;
    return [];
  }
  if (!response.ok) return [];
  const rows = await response.json();
  return (rows || []).map((row) => ({
    address: row.address,
    label: row.label || null,
    category: row.category || "UNKNOWN",
    entityType: row.entity_type || null,
    confidence: row.confidence || "unknown",
    source: row.source || "database",
    clusterable: row.clusterable !== false,
    tags: Array.isArray(row.tags) ? row.tags : [],
    known: Boolean(row.label) || row.category !== "UNKNOWN"
  }));
}

async function persist(identities) {
  if (!dbLabelsAvailable || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  const rows = identities.filter((x) => x?.address && x.known).map((x) => ({
    address: x.address,
    label: x.label,
    category: x.category,
    entity_type: x.entityType,
    confidence: x.confidence,
    source: x.source,
    clusterable: x.clusterable,
    tags: x.tags || [],
    last_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));
  if (!rows.length) return;
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/wallet_entity_labels?on_conflict=address`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(rows)
  });
  if (response.status === 404 || response.status === 400) dbLabelsAvailable = false;
}

async function heliusBatch(addresses) {
  if (!HELIUS_API_KEY || !addresses.length) return [];
  try {
    const response = await fetch("https://api.helius.xyz/v1/wallet/batch-identity", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": HELIUS_API_KEY
      },
      body: JSON.stringify({ addresses }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return [];
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    return rows.map((row) => normalizedIdentity(row)).filter(Boolean);
  } catch {
    return [];
  }
}

export async function getEntityLabels(addresses = []) {
  const unique = [...new Set(addresses.filter(Boolean))].slice(0, 100);
  const output = new Map();
  const missing = [];

  for (const address of unique) {
    const cached = cacheGet(address);
    if (cached) output.set(address, cached);
    else missing.push(address);
  }

  const persisted = await readPersisted(missing);
  for (const identity of persisted) {
    output.set(identity.address, identity);
    cacheSet(identity);
  }

  const unresolved = missing.filter((address) => !output.has(address));
  const helius = await heliusBatch(unresolved);
  const byAddress = new Map(helius.map((x) => [x.address, x]));

  for (const address of unresolved) {
    const identity = byAddress.get(address) || {
      address,
      label: null,
      category: "UNKNOWN",
      entityType: "unknown",
      confidence: "unknown",
      source: "unlabeled",
      clusterable: true,
      tags: [],
      known: false
    };
    output.set(address, identity);
    cacheSet(identity);
  }

  await persist(helius).catch(() => {});
  return output;
}

export async function getEntityLabel(address) {
  if (!address) return null;
  return (await getEntityLabels([address])).get(address) || null;
}

export function isClusterableEntity(identity) {
  return !identity || identity.clusterable !== false;
}
