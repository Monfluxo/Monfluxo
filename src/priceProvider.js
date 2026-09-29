const BIRDEYE_BASE_URL = "https://public-api.birdeye.so";

export function candleIntervalForHold(seconds) {
  const s = Math.max(0, Number(seconds || 0));
  if (s <= 60 * 60) return "1m";
  if (s <= 12 * 60 * 60) return "5m";
  if (s <= 3 * 24 * 60 * 60) return "15m";
  if (s <= 14 * 24 * 60 * 60) return "1H";
  if (s <= 90 * 24 * 60 * 60) return "4H";
  return "1D";
}

function normalizeCandle(row) {
  return {
    time: Number(row?.unixTime ?? row?.time ?? 0),
    open: Number(row?.o ?? row?.open),
    high: Number(row?.h ?? row?.high),
    low: Number(row?.l ?? row?.low),
    close: Number(row?.c ?? row?.close),
    volume: Number(row?.v ?? row?.volume ?? 0)
  };
}

export class HistoricalPriceProvider {
  constructor({ apiKey = process.env.BIRDEYE_API_KEY, fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey || null;
    this.fetchImpl = fetchImpl;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  async getCandles({ mint, startTime, endTime, interval }) {
    if (!this.apiKey) {
      return { status: "provider_not_configured", provider: "birdeye", candles: [] };
    }
    if (!mint || !Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
      throw new Error("Invalid historical candle request");
    }

    const type = interval || candleIntervalForHold(endTime - startTime);
    const params = new URLSearchParams({
      address: mint,
      type,
      time_from: String(Math.floor(startTime)),
      time_to: String(Math.floor(endTime))
    });

    const response = await this.fetchImpl(`${BIRDEYE_BASE_URL}/defi/ohlcv?${params.toString()}`, {
      headers: {
        accept: "application/json",
        "X-API-KEY": this.apiKey,
        "x-chain": "solana"
      }
    });

    if (!response.ok) throw new Error(`Birdeye OHLCV failed (${response.status})`);
    const payload = await response.json();
    const rows = payload?.data?.items || payload?.data || [];
    const candles = (Array.isArray(rows) ? rows : [])
      .map(normalizeCandle)
      .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close))
      .sort((a, b) => a.time - b.time);

    return { status: "ready", provider: "birdeye", interval: type, candles };
  }
}

export const historicalPriceProvider = new HistoricalPriceProvider();
