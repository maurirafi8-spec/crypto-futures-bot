const BASE = 'https://api.bybit.com';

async function get(path, params = {}) {
  const url = new URL(BASE + path);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'crypto-futures-scanner/1.0'
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    throw new Error(`Bybit HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();

  if (data.retCode !== 0) {
    throw new Error(`Bybit ${data.retCode}: ${data.retMsg}`);
  }

  return data.result;
}

export async function exchangeInfo() {
  const result = await get('/v5/market/instruments-info', {
    category: 'linear',
    status: 'Trading',
    limit: 1000
  });

  return {
    symbols: result.list.map(s => ({
      symbol: s.symbol,
      status: s.status === 'Trading' ? 'TRADING' : s.status,
      contractType:
        s.contractType === 'LinearPerpetual'
          ? 'PERPETUAL'
          : s.contractType,
      quoteAsset: s.quoteCoin,
      baseAsset: s.baseCoin
    }))
  };
}

export async function tickers24h() {
  const result = await get('/v5/market/tickers', {
    category: 'linear'
  });

  return result.list.map(t => ({
    symbol: t.symbol,
    quoteVolume: Number(t.turnover24h || 0),
    priceChangePercent: Number(t.price24hPcnt || 0) * 100
  }));
}

function convertInterval(interval) {
  const map = {
    '1m': '1',
    '3m': '3',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '2h': '120',
    '4h': '240',
    '6h': '360',
    '12h': '720',
    '1d': 'D'
  };

  return map[interval] || interval;
}

export async function klines(symbol, interval, limit = 250) {
  const result = await get('/v5/market/kline', {
    category: 'linear',
    symbol,
    interval: convertInterval(interval),
    limit
  });

  return result.list
    .slice()
    .reverse()
    .map(k => ({
      openTime: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      quoteVolume: Number(k[6]),
      closeTime: Number(k[0]),
      trades: 0,
      takerBuyBase: 0,
      takerBuyQuote: 0
    }));
}

export async function funding(symbol) {
  const result = await get('/v5/market/tickers', {
    category: 'linear',
    symbol
  });

  const data = result.list[0];

  if (!data) {
    throw new Error(`Ticker não encontrado para ${symbol}`);
  }

  return {
    markPrice: Number(data.markPrice || 0),
    indexPrice: Number(data.indexPrice || 0),
    fundingRate: Number(data.fundingRate || 0),
    nextFundingTime: Number(data.nextFundingTime || 0)
  };
}

export async function openInterestHistory(
  symbol,
  period = '15m',
  limit = 8
) {
  const periodMap = {
    '5m': '5min',
    '15m': '15min',
    '30m': '30min',
    '1h': '1h',
    '4h': '4h',
    '1d': '1d'
  };

  const result = await get('/v5/market/open-interest', {
    category: 'linear',
    symbol,
    intervalTime: periodMap[period] || '15min',
    limit
  });

  return result.list
    .slice()
    .reverse()
    .map(r => ({
      openInterest: Number(r.openInterest),
      openInterestValue: Number(r.openInterest),
      timestamp: Number(r.timestamp)
    }));
}
