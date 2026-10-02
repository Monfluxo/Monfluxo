const PROFILE_CACHE_MS = Number(process.env.PUMP_PROFILE_CACHE_MS || 10 * 60 * 1000);
const profileCache = new Map();

function clean(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function numberOrNull(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function first(...values) { return values.find((value) => value !== null && value !== undefined && value !== "") ?? null; }

function normalizeProfile(raw, wallet) {
  if (!raw || typeof raw !== "object") return null;
  const source = raw.user || raw.profile || raw.data || raw;
  const username = clean(first(source.username, source.user_name, source.name, source.display_name));
  if (!username) return null;
  return {
    wallet,
    username,
    displayName: clean(first(source.display_name, source.displayName, source.name)) || username,
    bio: clean(first(source.bio, source.biography, source.description)),
    avatar: clean(first(source.profile_image, source.profileImage, source.avatar, source.avatar_url, source.image)),
    followers: numberOrNull(first(source.followers, source.followers_count, source.follower_count)),
    following: numberOrNull(first(source.following, source.following_count)),
    profileUrl: `https://pump.fun/profile/${encodeURIComponent(wallet)}`,
    source: "pump.fun"
  };
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "MONFLUXO/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") || "";
    if (!type.includes("json")) return null;
    return await response.json();
  } catch { return null; }
}

export async function getPumpWalletProfile(wallet) {
  const cached = profileCache.get(wallet);
  if (cached && Date.now() - cached.createdAt < PROFILE_CACHE_MS) return cached.value;

  // Pump has changed its public frontend endpoints over time. Keep the resolver tolerant:
  // each candidate is public, read-only and a failure simply falls through to the next one.
  const encoded = encodeURIComponent(wallet);
  const urls = [
    `https://frontend-api-v3.pump.fun/users/${encoded}`,
    `https://frontend-api-v3.pump.fun/users/${encoded}/profile`,
    `https://frontend-api.pump.fun/users/${encoded}`,
    `https://frontend-api.pump.fun/profile/${encoded}`
  ];

  let value = null;
  for (const url of urls) {
    const payload = await fetchJson(url);
    value = normalizeProfile(payload, wallet);
    if (value) break;
  }
  profileCache.set(wallet, { createdAt: Date.now(), value });
  return value;
}
