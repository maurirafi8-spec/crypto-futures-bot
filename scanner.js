/**
 * SCANNER.JS — V2.0 OTIMIZADO
 * Motor de busca e classificação técnica de futuros cripto.
 */

import {
  futureMarkets,
  exchanges,
  ohlcvHistory,
  openInterestHistory
} from './binance.js';

import {
  ema,
  rsi,
  atr,
  macd,
  pctChange,
  bollingerBands,
  adx,
  dailyVwap
} from './indicators.js';

const CORE_BASES = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE'];
const ROTATING_BASES = [
  'ADA', 'LINK', 'AVAX', 'SUI', 'LTC', 'BCH', 'DOT', 'NEAR',
  'UNI', 'AAVE', 'ETC', 'ATOM', 'INJ', 'HBAR', 'TRX', 'FIL', 'ARB', 'OP'
];

let marketRotationCursor = 0;
let cachedBtcContext = null;
let cachedBtcContextAt = 0;
const BTC_CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;

const EXCHANGE_PRIORITY = ['BINANCE', 'HYPERLIQUID', 'BYBIT', 'OKX', 'BITGET'];

function last(arr) {
  return arr && arr.length ? arr[arr.length - 1] : null;
}

const M5_MS = 5 * 60 * 1000;
const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const H4_MS = 4 * 60 * 60 * 1000;

function onlyClosedCandles(candles, intervalMs, nowMs = Date.now()) {
  const graceMs = 5000;
  return (candles || [])
    .filter(c =>
      Number.isFinite(c.openTime) &&
      c.openTime + intervalMs <= nowMs - graceMs
    )
    .sort((a, b) => a.openTime - b.openTime);
}

function onlyClosedOi(history, intervalMs = M15_MS, nowMs = Date.now()) {
  const graceMs = 5000;
  return (history || []).filter(x => {
    const rawTs = Number(x.t ?? x.timestamp ?? 0);
    if (!Number.isFinite(rawTs) || rawTs <= 0) return true;
    const tsMs = rawTs < 10_000_000_000 ? rawTs * 1000 : rawTs;
    return tsMs + intervalMs <= nowMs - graceMs;
  });
}

function mapHistory(data) {
  return (data || []).map(k => ({
    openTime: Number(k.t) * 1000,
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v || 0),
    quoteVolume: Number(k.v || 0) * Number(k.c)
  }));
}

function resampleCandlesSafe(candles, bucketMs, minRequiredSubCandles) {
  const groups = new Map();

  for (const c of candles) {
    const bucket = Math.floor(c.openTime / bucketMs) * bucketMs;

    if (!groups.has(bucket)) {
      groups.set(bucket, {
        count: 1,
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
      g.count += 1;
      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.close = c.close;
      g.volume += c.volume;
      g.quoteVolume += c.quoteVolume;
    }
  }

  return [...groups.values()]
    .filter(g => g.count >= minRequiredSubCandles)
    .sort((a, b) => a.openTime - b.openTime);
}

function resample15m(candles5m) {
  return resampleCandlesSafe(candles5m, M15_MS, 3);
}

function resample4h(candles1h) {
  return resampleCandlesSafe(candles1h, H4_MS, 4);
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
  const bb = bollingerBands(closes, 20, 2);
  const adxResult = adx(candles, 14);

  const c = last(candles);
  const previousVolumes = volumes.slice(-21, -1);
  const avgVol =
    previousVolumes.reduce((a, b) => a + b, 0) /
    Math.max(1, previousVolumes.length);

  return {
    openTime: c.openTime,
    open: c.open,
    high: c.high,
    low: c.low,
    price: c.close,
    ema20: last(e20),
    ema50: last(e50),
    ema200: last(e200),
    rsi: last(rs),
    atr: last(at),
    macdHist: last(mc.histogram),
    bandwidth: last(bb.bandwidth),
    percentB: last(bb.percentB),
    adx: last(adxResult.adx),
    plusDi: last(adxResult.plusDi),
    minusDi: last(adxResult.minusDi),
    quoteVolume: Number(c.quoteVolume || 0),
    avgQuoteVolume: Number(avgVol || 0),
    volumeRatio: avgVol > 0 ? c.quoteVolume / avgVol : 1,
    bullish:
      c.close > last(e20) &&
      last(e20) > last(e50) &&
      last(e50) > (last(e200) || 0),
    bearish:
      c.close < last(e20) &&
      last(e20) < last(e50) &&
      last(e50) < (last(e200) || Infinity)
  };
}

function directionalStructure(tf) {
  if (tf?.price > tf?.ema20 && tf?.ema20 > tf?.ema50) return 'LONG';
  if (tf?.price < tf?.ema20 && tf?.ema20 < tf?.ema50) return 'SHORT';
  return 'MIXED';
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function btcHardGate(side, symbol, btcContext) {
  const isBtc = String(symbol || '').toUpperCase().startsWith('BTC');
  if (isBtc || !btcContext) return { ok: true, reason: '' };

  const trend15m = String(btcContext.trend15m || 'MIXED').toUpperCase();
  const trend1h = String(btcContext.trend1h || 'MIXED').toUpperCase();

  if (side === 'LONG' && (trend15m === 'BEARISH' || trend1h === 'BEARISH')) {
    return {
      ok: false,
      reason: `BTC contrário no 15m (${trend15m}) ou 1h (${trend1h}): compras em altcoins bloqueadas.`
    };
  }

  if (side === 'SHORT' && (trend15m === 'BULLISH' || trend1h === 'BULLISH')) {
    return {
      ok: false,
      reason: `BTC em alta no 15m (${trend15m}) ou 1h (${trend1h}): shorts em altcoins bloqueados.`
    };
  }

  return { ok: true, reason: '' };
}

function scoreSignal(t5, t15, t1h, t4h, oiPct, symbol = '', btcContext = null) {
  const rsi5 = finiteNumber(t5?.rsi, 50);
  const vol5 = finiteNumber(t5?.volumeRatio, 0);
  const oi = finiteNumber(oiPct, 0);

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

  const structure5 = directionalStructure(t5);
  const structure15 = directionalStructure(t15);
  const structure1h = directionalStructure(t1h);
  const structure4h = directionalStructure(t4h);

  if (structure1h === 'LONG') add('LONG', 22, '1H confirma tendência de alta');
  if (structure1h === 'SHORT') add('SHORT', 22, '1H confirma tendência de baixa');

  if (structure15 === 'LONG') add('LONG', 18, '15m alinhado');
  if (structure15 === 'SHORT') add('SHORT', 18, '15m alinhado');

  if (structure5 === 'LONG') add('LONG', 15, '5m acima das EMAs');
  if (structure5 === 'SHORT') add('SHORT', 15, '5m abaixo das EMAs');

  if (rsi5 >= 50 && rsi5 <= 68) add('LONG', 10, `RSI 5m saudável (${rsi5.toFixed(1)})`);
  if (rsi5 <= 50 && rsi5 >= 32) add('SHORT', 10, `RSI 5m saudável (${rsi5.toFixed(1)})`);

  if (t5.macdHist > 0) add('LONG', 10, 'MACD 5m positivo');
  if (t5.macdHist < 0) add('SHORT', 10, 'MACD 5m negativo');

  if (vol5 >= 1.10) {
    if (structure5 === 'LONG') add('LONG', 12, `Volume 5m forte (${vol5.toFixed(2)}x)`);
    if (structure5 === 'SHORT') add('SHORT', 12, `Volume 5m forte (${vol5.toFixed(2)}x)`);
  }

  if (oi >= 0.50) {
    if (structure5 === 'LONG') add('LONG', 8, `OI em alta (+${oi.toFixed(2)}%)`);
    if (structure5 === 'SHORT') add('SHORT', 8, `OI em alta (+${oi.toFixed(2)}%)`);
  }

  if (structure4h === 'LONG') add('LONG', 5, '4H macro favorável');
  if (structure4h === 'SHORT') add('SHORT', 5, '4H macro favorável');

  const side = long > short ? 'LONG' : short > long ? 'SHORT' : 'NEUTRAL';
  const selectedScore = side === 'LONG' ? long : side === 'SHORT' ? short : 0;
  const directionEdge = Math.abs(long - short);

  return {
    side,
    score: Math.min(100, Math.max(0, Math.round(selectedScore))),
    longScore: Math.round(long),
    shortScore: Math.round(short),
    directionEdge: Math.round(directionEdge),
    oneHourConfirmed: structure1h === side,
    structure5,
    structure15,
    structure1h,
    structure4h,
    reasons: side === 'LONG' ? whyLong : side === 'SHORT' ? whyShort : ['Neutro']
  };
}

function buildLevels(side, price, atrValue) {
  const px = Number(price);
  const safeAtr = Number.isFinite(atrValue) && atrValue > 0 ? atrValue : px * 0.003;
  const isLong = side === 'LONG';

  const risk = safeAtr * 1.5;

  return {
    entry: px,
    stop: isLong ? px - risk : px + risk,
    tp1: isLong ? px + risk * 1.30 : px - risk * 1.30,
    tp2: isLong ? px + risk * 1.80 : px - risk * 1.80,
    tp3: isLong ? px + risk * 2.50 : px - risk * 2.50,
    tradeStyle: 'SCALP_5M_HIGH_ASSERTIVENESS',
    stopAtrMultiple: 1.50,
    stopPct: (risk / px) * 100
  };
}

function chooseMarkets(markets, exchangeNames, limit, requestedBases = null) {
  const selected = [];
  const usedBases = new Set();

  const pushBase = base => {
    const normalized = String(base || '').toUpperCase().replace(/USDT$/, '');
    if (!normalized || normalized === 'USDT' || selected.length >= limit || usedBases.has(normalized)) return;

    const available = markets.filter(m =>
      String(m.base_asset).toUpperCase() === normalized &&
      String(m.quote_asset).toUpperCase() === 'USDT' &&
      m.is_perpetual === true && m.has_ohlcv_data === true
    );

    if (available.length) {
      available.sort((a, b) => {
        const ai = EXCHANGE_PRIORITY.indexOf(String(exchangeNames.get(String(a.exchange)) || a.exchange).toUpperCase());
        const bi = EXCHANGE_PRIORITY.indexOf(String(exchangeNames.get(String(b.exchange)) || b.exchange).toUpperCase());
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
      const picked = available[0];
      selected.push({ ...picked, exchangeName: exchangeNames.get(String(picked.exchange)) || picked.exchange });
      usedBases.add(normalized);
    }
  };

  if (Array.isArray(requestedBases) && requestedBases.length) {
    requestedBases.forEach(pushBase);
    return selected;
  }

  CORE_BASES.forEach(pushBase);
  const altSlots = Math.max(0, limit - selected.length);
  for (let o = 0; o < ROTATING_BASES.length && selected.length < limit; o++) {
    const idx = (marketRotationCursor + o) % ROTATING_BASES.length;
    pushBase(ROTATING_BASES[idx]);
  }

  if (altSlots > 0) {
    marketRotationCursor = (marketRotationCursor + altSlots) % ROTATING_BASES.length;
  }

  return selected;
}

export async function scanMarket({
  topMarkets = 12,
  marketBases = null,
  minQuoteVolume = 20_000_000,
  minScore = 84,
  minDirectionEdge = 8,
  minVolumeRatio = 1.00
} = {}) {
  const [marketList, exchangeList] = await Promise.all([futureMarkets(), exchanges()]);
  const exchangeNames = new Map(exchangeList.map(e => [String(e.code), e.name]));
  const markets = chooseMarkets(marketList, exchangeNames, topMarkets, marketBases);

  if (!markets.length) throw new Error('Nenhum mercado perpétuo USDT encontrado');

  const symbols = markets.map(m => m.symbol);
  const now = Math.floor(Date.now() / 1000);
  const from5 = now - 72 * 60 * 60;
  const from1h = now - 900 * 60 * 60;
  const fromOi = now - 6 * 60 * 60;

  const [candles5Raw, candles1hRaw, oiRaw] = await Promise.all([
    ohlcvHistory(symbols, '5min', from5, now),
    ohlcvHistory(symbols, '1hour', from1h, now),
    openInterestHistory(symbols, '15min', fromOi, now)
  ]);

  const map5 = new Map(candles5Raw.map(x => [x.symbol, x.history]));
  const map1h = new Map(candles1hRaw.map(x => [x.symbol, x.history]));
  const oiMap = new Map(oiRaw.map(x => [x.symbol, x.history || []]));

  const allResults = [];
  const nowMs = Date.now();

  for (const market of markets) {
    try {
      const c5All = mapHistory(map5.get(market.symbol));
      const c1hAll = mapHistory(map1h.get(market.symbol));

      const c5 = onlyClosedCandles(c5All, M5_MS, nowMs);
      const c15 = onlyClosedCandles(resample15m(c5), M15_MS, nowMs);
      const c1h = onlyClosedCandles(c1hAll, H1_MS, nowMs);
      const c4h = onlyClosedCandles(resample4h(c1h), H4_MS, nowMs);

      const displaySymbol = market.symbol_on_exchange || `${market.base_asset}USDT`;
      if (c5.length < 100 || c15.length < 50 || c1h.length < 50) continue;

      const last96 = c15.slice(-96);
      const quoteVolume24h = last96.reduce((sum, c) => sum + c.quoteVolume, 0);

      const oiHistoryList = onlyClosedOi(oiMap.get(market.symbol) || [], M15_MS, nowMs);
      let oiPct = 0;
      if (oiHistoryList.length >= 2) {
        const lastOi = Number(last(oiHistoryList).c);
        const prevOi = Number(oiHistoryList[Math.max(0, oiHistoryList.length - 3)].c);
        if (prevOi > 0) oiPct = pctChange(prevOi, lastOi);
      }

      const t5 = analyzeTf(c5);
      const t15 = analyzeTf(c15);
      const t1h = analyzeTf(c1h);
      const t4h = analyzeTf(c4h);

      const isBtc = String(market.base_asset).toUpperCase() === 'BTC';
      if (isBtc) {
        cachedBtcContext = { trend15m: t15.bullish ? 'BULLISH' : t15.bearish ? 'BEARISH' : 'MIXED', trend1h: t1h.bullish ? 'BULLISH' : t1h.bearish ? 'BEARISH' : 'MIXED' };
        cachedBtcContextAt = nowMs;
      }

      const sig = scoreSignal(t5, t15, t1h, t4h, oiPct, displaySymbol, cachedBtcContext);
      const levels = buildLevels(sig.side, t5.price, t5.atr);

      const btcGate = btcHardGate(sig.side, displaySymbol, cachedBtcContext);
      const bbExpanding = (t15.bandwidth || 0) >= 0.038;
      const adxTrending = (t15.adx || 0) >= 20;

      const volumeOk = t5.volumeRatio >= minVolumeRatio;
      const scoreOk = sig.score >= minScore;
      const edgeOk = sig.directionEdge >= minDirectionEdge;
      const mathApproved = scoreOk && edgeOk && volumeOk && btcGate.ok && sig.oneHourConfirmed && (bbExpanding || adxTrending);

      allResults.push({
        symbol: displaySymbol,
        dataSymbol: market.symbol,
        exchange: market.exchangeName,
        quoteVolume: quoteVolume24h,
        ...sig,
        ...levels,
        t5, t15, t1h, t4h,
        oiPct,
        candidateTier: mathApproved ? 'STANDARD' : 'REJECTED',
        gates: {
          scoreOk,
          volumeOk,
          edgeOk,
          btcGateOk: btcGate.ok,
          oneHourConfirmed: sig.oneHourConfirmed,
          mathApproved
        },
        rejectionReason: !btcGate.ok ? btcGate.reason : !scoreOk ? `Score ${sig.score} < ${minScore}` : !volumeOk ? `Volume ${t5.volumeRatio.toFixed(2)}x < 1.0x` : ''
      });
    } catch (e) {
      console.error(`[scanner] erro em ${market.symbol}:`, e.message);
    }
  }

  const signals = allResults
    .filter(r => r.gates.mathApproved)
    .sort((a, b) => b.score - a.score);

  return { signals, snapshots: allResults };
}

export function signalText(s) {
  const emoji = s.side === 'LONG' ? '🟢' : '🔴';
  return (
    `${emoji} <b>${s.symbol} — ${s.side}</b>\n` +
    `🏦 ${s.exchange} | ⭐ Score: <b>${s.score}/100</b> (Edge: ${s.directionEdge})\n` +
    `💰 Entrada Limite: <b>${s.entry.toFixed(4)}</b>\n` +
    `🛑 Stop Estrutural: <b>${s.stop.toFixed(4)}</b> (-${s.stopPct.toFixed(2)}% | 1.5 ATR)\n` +
    `🎯 TP1: <b>${s.tp1.toFixed(4)}</b> | TP2: <b>${s.tp2.toFixed(4)}</b> | TP3: <b>${s.tp3.toFixed(4)}</b>\n` +
    `📊 Vol 5m: ${s.t5?.volumeRatio?.toFixed(2)}x | RSI: ${s.t5?.rsi?.toFixed(1)} | ADX 15m: ${s.t15?.adx?.toFixed(1) || '—'}\n` +
    `📈 OI: ${s.oiPct >= 0 ? '+' : ''}${s.oiPct.toFixed(2)}% | 1H: ${s.oneHourConfirmed ? '✅ ALINHADO' : '❌'}\n` +
    `<i>V2.0: Alvos estruturais fora do ruído de mercado.</i>`
  );
}