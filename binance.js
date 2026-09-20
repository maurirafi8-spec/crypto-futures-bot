const BASE = 'https://api.coinalyze.net/v1';
const API_KEY = process.env.COINALYZE_API_KEY;

async function get(path, params = {}) {
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
      'User-Agent': 'crypto-futures-scanner/1.0'
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!res.ok) {
    throw new Error(`Coinalyze ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

export async function futureMarkets() {
  return get('/future-markets');
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
