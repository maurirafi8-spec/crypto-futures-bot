const BASE = 'https://api.coinalyze.net/v1';
const API_KEY = process.env.COINALYZE_API_KEY;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function get(path, params = {}, tentativa = 0) {
  if (!API_KEY) {
    throw new Error('COINALYZE_API_KEY não configurada');
  }

  const url = new URL(BASE + path);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url, {
    headers: {
      api_key: API_KEY,
      'User-Agent': 'crypto-futures-scanner/1.6.4'
    },
    signal: AbortSignal.timeout(20000)
  });

  if (res.status === 429 && tentativa < 4) {
    const retryAfter = Math.max(
      1,
      Number(res.headers.get('retry-after') || 10)
    );

    console.log(
      `[Coinalyze] limite atingido. Aguardando ${retryAfter}s...`
    );

    await sleep((retryAfter + 1) * 1000);
    return get(path, params, tentativa + 1);
  }

  if (!res.ok) {
    throw new Error(`Coinalyze ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

let futureMarketsCache = null;
let futureMarketsCacheAt = 0;

export async function futureMarkets() {
  const ttlMs = 15 * 60 * 1000;

  if (
    futureMarketsCache &&
    Date.now() - futureMarketsCacheAt < ttlMs
  ) {
    return futureMarketsCache;
  }

  futureMarketsCache = await get('/future-markets');
  futureMarketsCacheAt = Date.now();

  return futureMarketsCache;
}

let exchangesCache = null;

export async function exchanges() {
  if (exchangesCache) return exchangesCache;
  exchangesCache = await get('/exchanges');
  return exchangesCache;
}

export async function ohlcvHistory(symbols, interval, from, to) {
  return get('/ohlcv-history', {
    symbols: symbols.join(','),
    interval,
    from,
    to
  });
}

export async function fundingRates(symbols) {
  return get('/funding-rate', {
    symbols: symbols.join(',')
  });
}

export async function openInterestHistory(symbols, interval, from, to) {
  return get('/open-interest-history', {
    symbols: symbols.join(','),
    interval,
    from,
    to
  });
}
