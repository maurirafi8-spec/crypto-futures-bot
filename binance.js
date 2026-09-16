const BASE = 'https://fapi.binance.com';

async function get(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, { headers: { 'User-Agent': 'crypto-futures-scanner/1.0' } });
  if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function exchangeInfo() {
  return get('/fapi/v1/exchangeInfo');
}

export async function tickers24h() {
  return get('/fapi/v1/ticker/24hr');
}

export async function klines(symbol, interval, limit = 250) {
  const rows = await get('/fapi/v1/klines', { symbol, interval, limit });
  return rows.map(k => ({
    openTime: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: Number(k[6]),
    quoteVolume: Number(k[7]),
    trades: Number(k[8]),
    takerBuyBase: Number(k[9]),
    takerBuyQuote: Number(k[10])
  }));
}

export async function funding(symbol) {
  const data = await get('/fapi/v1/premiumIndex', { symbol });
  return {
    markPrice: Number(data.markPrice),
    indexPrice: Number(data.indexPrice),
    fundingRate: Number(data.lastFundingRate ?? 0),
    nextFundingTime: Number(data.nextFundingTime ?? 0)
  };
}

export async function openInterestHistory(symbol, period = '15m', limit = 8) {
  const rows = await get('/futures/data/openInterestHist', { symbol, period, limit });
  return rows.map(r => ({
    openInterest: Number(r.sumOpenInterest),
    openInterestValue: Number(r.sumOpenInterestValue),
    timestamp: Number(r.timestamp)
  }));
}
