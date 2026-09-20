import {
  futureMarkets,
  ohlcvHistory,
  fundingRates,
  openInterestHistory
} from './binance.js';

import { ema, rsi, atr, macd, pctChange } from './indicators.js';

const TARGET_BASES = [
  'BTC',
  'ETH',
  'SOL',
  'XRP',
  'BNB',
  'DOGE',
  'ADA',
  'AVAX'
];

const EXCHANGE_PRIORITY = [
  'BINANCE',
  'BYBIT',
  'OKX',
  'BITGET'
];

function last(arr) {
  return arr[arr.length - 1];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mapHistory(data) {
  return (data || []).map(k => ({
    openTime: Number(k.t) * 1000,
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v || 0),

    // aproximação do volume negociado em USDT
    quoteVolume: Number(k.v || 0) * Number(k.c)
  }));
}

function resample4h(candles) {
  const groups = new Map();

  for (const c of candles) {
    const bucket =
      Math.floor(c.openTime / (4 * 60 * 60 * 1000)) *
      (4 * 60 * 60 * 1000);

    if (!groups.has(bucket)) {
      groups.set(bucket, {
        openTime: bucket,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        quoteVolume: c.quoteVolume
      });
    } else {
      const g = groups.get(bucket);

      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.close = c.close;
      g.volume += c.volume;
      g.quoteVolume += c.quoteVolume;
    }
  }

  return [...groups.values()].sort(
    (a, b) => a.openTime - b.openTime
  );
}

function analyzeTf(candles) {
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.quoteVolume);

  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const rs = rsi(closes, 14);
  const at = atr(candles, 14);
  const mc = macd(closes);

  const c = last(candles);

  const previousVolumes = volumes.slice(-21, -1);

  const avgVol =
    previousVolumes.reduce((a, b) => a + b, 0) /
    Math.max(1, previousVolumes.length);

  return {
    price: c.close,

    ema20: last(e20),
    ema50: last(e50),
    ema200: last(e200),

    rsi: last(rs),
    atr: last(at),

    macdHist: last(mc.histogram),

    volumeRatio:
      avgVol > 0
        ? c.quoteVolume / avgVol
        : 1,

    bullish:
      c.close > last(e20) &&
      last(e20) > last(e50) &&
      last(e50) > last(e200),

    bearish:
      c.close < last(e20) &&
      last(e20) < last(e50) &&
      last(e50) < last(e200)
  };
}

function scoreSignal(
  t15,
  t1h,
  t4h,
  oiPct,
  fundingRate
) {
  let long = 0;
  let short = 0;

  const whyLong = [];
  const whyShort = [];

  const add = (side, points, reason) => {
    if (side === 'LONG') {
      long += points;
      whyLong.push(reason);
    } else {
      short += points;
      whyShort.push(reason);
    }
  };

  if (t4h.bullish)
    add('LONG', 22, '4H em tendência de alta');

  if (t4h.bearish)
    add('SHORT', 22, '4H em tendência de baixa');

  if (t1h.bullish)
    add('LONG', 18, '1H alinhado para alta');

  if (t1h.bearish)
    add('SHORT', 18, '1H alinhado para baixa');

  if (
    t15.price > t15.ema20 &&
    t15.ema20 > t15.ema50
  ) {
    add('LONG', 12, '15m acima das EMAs');
  }

  if (
    t15.price < t15.ema20 &&
    t15.ema20 < t15.ema50
  ) {
    add('SHORT', 12, '15m abaixo das EMAs');
  }

  if (t15.rsi >= 52 && t15.rsi <= 68) {
    add(
      'LONG',
      10,
      `RSI 15m ${t15.rsi.toFixed(1)}`
    );
  }

  if (t15.rsi <= 48 && t15.rsi >= 32) {
    add(
      'SHORT',
      10,
      `RSI 15m ${t15.rsi.toFixed(1)}`
    );
  }

  if (t15.macdHist > 0) {
    add('LONG', 8, 'MACD comprador');
  }

  if (t15.macdHist < 0) {
    add('SHORT', 8, 'MACD vendedor');
  }

  if (t15.volumeRatio >= 1.25) {
    if (t15.price > t15.ema20) {
      add(
        'LONG',
        10,
        `Volume ${t15.volumeRatio.toFixed(2)}x`
      );
    }

    if (t15.price < t15.ema20) {
      add(
        'SHORT',
        10,
        `Volume ${t15.volumeRatio.toFixed(2)}x`
      );
    }
  }

  if (oiPct >= 0.5) {
    if (t15.price > t15.ema20) {
      add(
        'LONG',
        10,
        `OI +${oiPct.toFixed(2)}%`
      );
    }

    if (t15.price < t15.ema20) {
      add(
        'SHORT',
        10,
        `OI +${oiPct.toFixed(2)}%`
      );
    }
  }

  if (fundingRate <= 0.0005) {
    add(
      'LONG',
      4,
      `Funding ${(fundingRate * 100).toFixed(4)}%`
    );
  }

  if (fundingRate >= -0.0005) {
    add(
      'SHORT',
      4,
      `Funding ${(fundingRate * 100).toFixed(4)}%`
    );
  }

  const side =
    long >= short
      ? 'LONG'
      : 'SHORT';

  return {
    side,

    score: Math.min(
      100,
      Math.max(long, short)
    ),

    reasons:
      side === 'LONG'
        ? whyLong
        : whyShort
  };
}

function buildLevels(side, price, atrValue) {
  const risk = atrValue * 1.25;

  if (side === 'LONG') {
    return {
      entry: price,
      stop: price - risk,
      tp1: price + risk * 1.5,
      tp2: price + risk * 2.2,
      tp3: price + risk * 3
    };
  }

  return {
    entry: price,
    stop: price + risk,
    tp1: price - risk * 1.5,
    tp2: price - risk * 2.2,
    tp3: price - risk * 3
  };
}

function chooseMarkets(markets, limit) {
  const selected = [];

  for (const base of TARGET_BASES) {
    const available = markets.filter(m =>
      String(m.base_asset).toUpperCase() === base &&
      String(m.quote_asset).toUpperCase() === 'USDT' &&
      m.is_perpetual === true &&
      m.has_ohlcv_data === true
    );

    if (!available.length) continue;

    available.sort((a, b) => {
      const aExchange =
        EXCHANGE_PRIORITY.indexOf(
          String(a.exchange).toUpperCase()
        );

      const bExchange =
        EXCHANGE_PRIORITY.indexOf(
          String(b.exchange).toUpperCase()
        );

      const aa =
        aExchange === -1 ? 999 : aExchange;

      const bb =
        bExchange === -1 ? 999 : bExchange;

      return aa - bb;
    });

    selected.push(available[0]);

    if (selected.length >= limit) break;
  }

  return selected;
}

export async function scanMarket({
  topMarkets = 8,
  minQuoteVolume = 50_000_000,
  minScore = 70
} = {}) {

  const marketList = await futureMarkets();

  const markets = chooseMarkets(
    marketList,
    Math.min(topMarkets, 8)
  );

  if (!markets.length) {
    throw new Error(
      'Nenhum mercado perpétuo USDT encontrado'
    );
  }

  const symbols = markets.map(m => m.symbol);

  const now = Math.floor(Date.now() / 1000);

  const from15 =
    now - 72 * 60 * 60;

  const from1h =
    now - 900 * 60 * 60;

  const fromOi =
    now - 6 * 60 * 60;

  console.log(
    '[scan] mercados:',
    markets
      .map(m => `${m.base_asset}@${m.exchange}`)
      .join(', ')
  );

  const [
    candles15Raw,
    candles1hRaw,
    fundingRaw,
    oiRaw
  ] = await Promise.all([
    ohlcvHistory(
      symbols,
      '15min',
      from15,
      now
    ),

    ohlcvHistory(
      symbols,
      '1hour',
      from1h,
      now
    ),

    fundingRates(symbols),

    openInterestHistory(
      symbols,
      '15min',
      fromOi,
      now
    )
  ]);

  const map15 = new Map(
    candles15Raw.map(x => [
      x.symbol,
      x.history
    ])
  );

  const map1h = new Map(
    candles1hRaw.map(x => [
      x.symbol,
      x.history
    ])
  );

  const fundingMap = new Map(
    fundingRaw.map(x => [
      x.symbol,
      Number(x.value || 0)
    ])
  );

  const oiMap = new Map(
    oiRaw.map(x => [
      x.symbol,
      x.history || []
    ])
  );

  const results = [];

  for (const market of markets) {
    try {
      const c15 = mapHistory(
        map15.get(market.symbol)
      );

      const c1h = mapHistory(
        map1h.get(market.symbol)
      );

      const c4h = resample4h(c1h);

      if (
        c15.length < 210 ||
        c1h.length < 210 ||
        c4h.length < 205
      ) {
        console.log(
          '[scan] poucos candles',
          market.symbol,
          c15.length,
          c1h.length,
          c4h.length
        );

        continue;
      }

      const last96 =
        c15.slice(-96);

      const quoteVolume24h =
        last96.reduce(
          (sum, c) =>
            sum + c.quoteVolume,
          0
        );

      if (
        quoteVolume24h <
        minQuoteVolume
      ) {
        continue;
      }

      const first24 =
        last96[0];

      const last24 =
        last(last96);

      const change24h =
        pctChange(
          first24.close,
          last24.close
        );

      const oi =
        oiMap.get(market.symbol) || [];

      let oiPct = 0;

      if (oi.length >= 2) {
        const firstOi =
          Number(oi[0].c);

        const lastOi =
          Number(last(oi).c);

        if (
          Number.isFinite(firstOi) &&
          Number.isFinite(lastOi) &&
          firstOi !== 0
        ) {
          oiPct =
            pctChange(
              firstOi,
              lastOi
            );
        }
      }

      const t15 =
        analyzeTf(c15);

      const t1h =
        analyzeTf(c1h);

      const t4h =
        analyzeTf(c4h);

      const fundingRate =
        fundingMap.get(
          market.symbol
        ) || 0;

      const sig =
        scoreSignal(
          t15,
          t1h,
          t4h,
          oiPct,
          fundingRate
        );

      const levels =
        buildLevels(
          sig.side,
          t15.price,
          t15.atr
        );

      results.push({
        symbol:
          market.symbol_on_exchange ||
          market.base_asset + 'USDT',

        dataSymbol:
          market.symbol,

        exchange:
          market.exchange,

        quoteVolume:
          quoteVolume24h,

        change24h,

        ...sig,
        ...levels,

        t15,
        t1h,
        t4h,

        oiPct,
        fundingRate
      });

      await sleep(20);

    } catch (error) {
      console.error(
        '[scan] falha',
        market.symbol,
        error.message
      );
    }
  }

  return results
    .filter(
      r => r.score >= minScore
    )
    .sort(
      (a, b) =>
        b.score - a.score
    );
}

export function signalText(s) {
  const emoji =
    s.side === 'LONG'
      ? '🟢'
      : '🔴';

  const digits =
    s.entry >= 1000
      ? 2
      : s.entry >= 1
        ? 4
        : 6;

  const n = x =>
    Number(x).toFixed(digits);

  return (
    `${emoji} <b>${s.symbol} — ${s.side}</b>\n` +
    `🏦 ${s.exchange}\n` +
    `⭐ Score: <b>${s.score}/100</b>\n` +
    `💰 Entrada: <b>${n(s.entry)}</b>\n` +
    `🛑 Stop: <b>${n(s.stop)}</b>\n` +
    `🎯 TP1: ${n(s.tp1)}\n` +
    `🎯 TP2: ${n(s.tp2)}\n` +
    `🎯 TP3: ${n(s.tp3)}\n` +
    `📊 RSI 15m: ${s.t15.rsi.toFixed(1)} | ` +
    `Vol: ${s.t15.volumeRatio.toFixed(2)}x\n` +
    `📈 OI: ${s.oiPct >= 0 ? '+' : ''}${s.oiPct.toFixed(2)}% | ` +
    `Funding: ${(s.fundingRate * 100).toFixed(4)}%\n` +
    `🧠 ${s.reasons.slice(0, 4).join(' • ')}\n\n` +
    `<i>Sinal técnico experimental. Futuros envolvem risco elevado e liquidação.</i>`
  );
}
