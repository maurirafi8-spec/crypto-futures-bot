import {
  futureMarkets,
  exchanges,
  ohlcvHistory,
  fundingRates,
  openInterestHistory
} from './binance.js';

import { ema, rsi, atr, macd, pctChange } from './indicators.js';

const CORE_BASES = [
  'BTC',
  'ETH',
  'SOL',
  'XRP',
  'BNB',
  'DOGE'
];

const ROTATING_BASES = [
  'ADA',
  'LINK',
  'AVAX',
  'SUI',
  'LTC',
  'BCH',
  'DOT',
  'NEAR',
  'UNI',
  'AAVE',
  'ETC',
  'ATOM',
  'INJ',
  'HBAR',
  'TRX',
  'FIL',
  'ARB',
  'OP'
];

let marketRotationCursor = 0;

// V1.6.4: contexto BTC persiste entre os lotes de 1 minuto.
// Assim uma altcoin pode usar o último BTC mesmo quando BTC não está
// no lote atual.
let cachedBtcContext = null;
let cachedBtcContextAt = 0;
const BTC_CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;

const EXCHANGE_PRIORITY = [
  'BINANCE',
  'BYBIT',
  'OKX',
  'BITGET'
];

function last(arr) {
  return arr[arr.length - 1];
}

const M5_MS = 5 * 60 * 1000;
const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const H4_MS = 4 * 60 * 60 * 1000;

// V1.3.4: indicadores e volume usam somente candles totalmente fechados.
// Isso evita volume relativo artificialmente baixo logo após abrir uma vela nova.
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

    const tsMs = rawTs < 10_000_000_000
      ? rawTs * 1000
      : rawTs;

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

function resampleCandles(candles, bucketMs) {
  const groups = new Map();

  for (const c of candles) {
    const bucket =
      Math.floor(c.openTime / bucketMs) *
      bucketMs;

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

  return [...groups.values()]
    .sort((a, b) => a.openTime - b.openTime);
}

function resample15m(candles5m) {
  return resampleCandles(candles5m, M15_MS);
}

function resample4h(candles1h) {
  return resampleCandles(candles1h, H4_MS);
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
    volumeRatio: avgVol > 0 ? c.quoteVolume / avgVol : 1,
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

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmt(value, digits = 2, fallback = '—') {
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toFixed(digits)
    : fallback;
}

function directionalStructure(tf) {
  if (
    tf?.price > tf?.ema20 &&
    tf?.ema20 > tf?.ema50
  ) {
    return 'LONG';
  }

  if (
    tf?.price < tf?.ema20 &&
    tf?.ema20 < tf?.ema50
  ) {
    return 'SHORT';
  }

  return 'MIXED';
}

function buildBtcContext({
  t5,
  t15,
  t1h,
  t4h,
  oiPct,
  change24h = 0,
  side = null,
  score = null
}) {
  return {
    side,
    score,
    change24hPct:
      finiteNumber(change24h, 0),
    trend5m:
      directionalStructure(t5) === 'LONG'
        ? 'BULLISH'
        : directionalStructure(t5) === 'SHORT'
          ? 'BEARISH'
          : 'MIXED',
    trend15m:
      directionalStructure(t15) === 'LONG'
        ? 'BULLISH'
        : directionalStructure(t15) === 'SHORT'
          ? 'BEARISH'
          : 'MIXED',
    trend1h:
      directionalStructure(t1h) === 'LONG'
        ? 'BULLISH'
        : directionalStructure(t1h) === 'SHORT'
          ? 'BEARISH'
          : 'MIXED',
    trend4h:
      directionalStructure(t4h) === 'LONG'
        ? 'BULLISH'
        : directionalStructure(t4h) === 'SHORT'
          ? 'BEARISH'
          : 'MIXED',
    rsi5m:
      finiteNumber(t5?.rsi, null),
    rsi15m:
      finiteNumber(t15?.rsi, null),
    volumeRatio5m:
      finiteNumber(t5?.volumeRatio, null),
    openInterestChangePct:
      finiteNumber(oiPct, 0),
    fundingRatePct: null,
    cached: false,
    ageMin: 0
  };
}

function freshBtcContext(nowMs = Date.now()) {
  if (
    !cachedBtcContext ||
    !cachedBtcContextAt
  ) {
    return null;
  }

  const ageMs =
    nowMs - cachedBtcContextAt;

  if (
    ageMs < 0 ||
    ageMs > BTC_CONTEXT_MAX_AGE_MS
  ) {
    return null;
  }

  return {
    ...cachedBtcContext,
    cached:
      ageMs > 15_000,
    ageMin:
      ageMs / 60_000
  };
}

function btcDirectionalAdjustment(
  side,
  symbol,
  btcContext
) {
  const isBtc =
    String(symbol || '')
      .toUpperCase()
      .startsWith('BTC');

  if (
    isBtc ||
    !btcContext
  ) {
    return {
      points: 0,
      reason: ''
    };
  }

  const aligned =
    side === 'LONG'
      ? 'BULLISH'
      : 'BEARISH';

  const opposite =
    side === 'LONG'
      ? 'BEARISH'
      : 'BULLISH';

  const t15 =
    String(
      btcContext.trend15m ||
      'MIXED'
    ).toUpperCase();

  const t1h =
    String(
      btcContext.trend1h ||
      'MIXED'
    ).toUpperCase();

  const alignedCount =
    [t15, t1h]
      .filter(x => x === aligned)
      .length;

  const oppositeCount =
    [t15, t1h]
      .filter(x => x === opposite)
      .length;

  if (alignedCount === 2) {
    return {
      points: 4,
      reason:
        `BTC 15m/1h alinhado com ${side} (+4)`
    };
  }

  if (
    alignedCount === 1 &&
    oppositeCount === 0
  ) {
    return {
      points: 2,
      reason:
        `BTC parcialmente alinhado com ${side} (+2)`
    };
  }

  if (oppositeCount === 2) {
    return {
      points: -12,
      reason:
        `BTC 15m/1h contrário a ${side} (-12)`
    };
  }

  if (
    oppositeCount === 1 &&
    alignedCount === 0
  ) {
    return {
      points: -7,
      reason:
        `BTC parcialmente contrário a ${side} (-7)`
    };
  }

  if (
    oppositeCount === 1 &&
    alignedCount === 1
  ) {
    return {
      points: -4,
      reason:
        `BTC dividido contra ${side} (-4)`
    };
  }

  return {
    points: -4,
    reason:
      `BTC 15m/1h misto (-4)`
  };
}

function scoreSignal(
  t5,
  t15,
  t1h,
  t4h,
  oiPct,
  symbol = '',
  btcContext = null
) {
  const rsi5 =
    finiteNumber(t5?.rsi, 50);

  const vol5 =
    finiteNumber(
      t5?.volumeRatio,
      0
    );

  const oi =
    finiteNumber(oiPct, 0);

  let long = 0;
  let short = 0;

  const whyLong = [];
  const whyShort = [];

  const add = (
    side,
    points,
    reason
  ) => {
    if (side === 'LONG') {
      long += points;
      whyLong.push(reason);
    } else {
      short += points;
      whyShort.push(reason);
    }
  };

  // V1.6.4 DIRECTION BALANCE:
  // LONG e SHORT recebem exatamente os mesmos pesos espelhados.
  // 5m/15m = timing; 1h = confirmação principal; 4h = contexto.
  const structure5 =
    directionalStructure(t5);

  const structure15 =
    directionalStructure(t15);

  const structure1h =
    directionalStructure(t1h);

  const structure4h =
    directionalStructure(t4h);

  if (structure1h === 'LONG') {
    add(
      'LONG',
      20,
      '1H confirma tendência de alta'
    );
  }

  if (structure1h === 'SHORT') {
    add(
      'SHORT',
      20,
      '1H confirma tendência de baixa'
    );
  }

  if (structure15 === 'LONG') {
    add(
      'LONG',
      18,
      '15m acima das EMAs'
    );
  }

  if (structure15 === 'SHORT') {
    add(
      'SHORT',
      18,
      '15m abaixo das EMAs'
    );
  }

  if (structure5 === 'LONG') {
    add(
      'LONG',
      14,
      '5m acima das EMAs'
    );
  }

  if (structure5 === 'SHORT') {
    add(
      'SHORT',
      14,
      '5m abaixo das EMAs'
    );
  }

  if (
    rsi5 >= 51 &&
    rsi5 <= 69
  ) {
    add(
      'LONG',
      10,
      `RSI 5m ${rsi5.toFixed(1)}`
    );
  }

  if (
    rsi5 <= 49 &&
    rsi5 >= 31
  ) {
    add(
      'SHORT',
      10,
      `RSI 5m ${rsi5.toFixed(1)}`
    );
  }

  if (t5.macdHist > 0) {
    add(
      'LONG',
      10,
      'MACD 5m comprador'
    );
  }

  if (t5.macdHist < 0) {
    add(
      'SHORT',
      10,
      'MACD 5m vendedor'
    );
  }

  if (vol5 >= 1.10) {
    if (structure5 === 'LONG') {
      add(
        'LONG',
        10,
        `Volume 5m ${vol5.toFixed(2)}x`
      );
    }

    if (structure5 === 'SHORT') {
      add(
        'SHORT',
        10,
        `Volume 5m ${vol5.toFixed(2)}x`
      );
    }
  }

  if (oi >= 0.50) {
    if (structure5 === 'LONG') {
      add(
        'LONG',
        10,
        `OI +${oi.toFixed(2)}%`
      );
    }

    if (structure5 === 'SHORT') {
      add(
        'SHORT',
        10,
        `OI +${oi.toFixed(2)}%`
      );
    }
  }

  if (t15.macdHist > 0) {
    add(
      'LONG',
      4,
      'MACD 15m comprador'
    );
  }

  if (t15.macdHist < 0) {
    add(
      'SHORT',
      4,
      'MACD 15m vendedor'
    );
  }

  if (structure4h === 'LONG') {
    add(
      'LONG',
      6,
      '4H favorável'
    );
  }

  if (structure4h === 'SHORT') {
    add(
      'SHORT',
      6,
      '4H favorável'
    );
  }

  const rawLongScore = long;
  const rawShortScore = short;

  const btcLong =
    btcDirectionalAdjustment(
      'LONG',
      symbol,
      btcContext
    );

  const btcShort =
    btcDirectionalAdjustment(
      'SHORT',
      symbol,
      btcContext
    );

  long += btcLong.points;
  short += btcShort.points;

  // Sem desempate "LONG >=".
  // Em empate usa primeiro a estrutura 1H, depois 15m, depois momentum 5m.
  let side;

  if (long > short) {
    side = 'LONG';
  } else if (short > long) {
    side = 'SHORT';
  } else if (structure1h !== 'MIXED') {
    side = structure1h;
  } else if (structure15 !== 'MIXED') {
    side = structure15;
  } else if (t5.macdHist > 0) {
    side = 'LONG';
  } else if (t5.macdHist < 0) {
    side = 'SHORT';
  } else {
    side =
      rsi5 > 50
        ? 'LONG'
        : rsi5 < 50
          ? 'SHORT'
          : 'NEUTRAL';
  }

  const selectedScore =
    side === 'LONG'
      ? long
      : side === 'SHORT'
        ? short
        : 0;

  const directionEdge =
    Math.abs(long - short);

  const oneHourConfirmed =
    side !== 'NEUTRAL' &&
    structure1h === side;

  const btcSelected =
    side === 'LONG'
      ? btcLong
      : side === 'SHORT'
        ? btcShort
        : {
            points: 0,
            reason: ''
          };

  const reasons =
    side === 'LONG'
      ? [...whyLong]
      : side === 'SHORT'
        ? [...whyShort]
        : ['Direção neutra'];

  if (btcSelected.reason) {
    reasons.push(
      btcSelected.reason
    );
  }

  return {
    side,
    score:
      Math.min(
        100,
        Math.max(
          0,
          Math.round(selectedScore)
        )
      ),
    rawLongScore,
    rawShortScore,
    longScore:
      Math.max(
        0,
        Math.round(long)
      ),
    shortScore:
      Math.max(
        0,
        Math.round(short)
      ),
    directionEdge:
      Math.round(directionEdge),
    oneHourConfirmed,
    structure5,
    structure15,
    structure1h,
    structure4h,
    btcScoreAdjustment:
      btcSelected.points,
    reasons
  };
}

// Export simples para teste/diagnóstico da lógica direcional.
export function directionScoreSnapshot({
  t5,
  t15,
  t1h,
  t4h,
  oiPct = 0,
  symbol = 'TESTUSDT',
  btcContext = null
}) {
  return scoreSignal(
    t5,
    t15,
    t1h,
    t4h,
    oiPct,
    symbol,
    btcContext
  );
}

function confirmationStatus(
  t5,
  oiPct,
  score,
  minVolumeRatio,
  minOiPct,
  hardMinVolumeRatio,
  oiRejectPct,
  exceptionScore,
  exceptionVolumeRatio
) {
  const volumeRatio = Number(t5?.volumeRatio || 0);
  const volumeFloorOk = volumeRatio >= hardMinVolumeRatio;
  const volumeOk = volumeRatio >= minVolumeRatio;
  const oiOk = oiPct >= minOiPct;

  // V1.2.2: protege contra divergência forte de Open Interest.
  // Se o OI cair abaixo do limite, o sinal é rejeitado.
  // Exceção: score alto + volume realmente forte.
  const oiDivergence = oiPct < oiRejectPct;
  const divergenceException =
    oiDivergence &&
    score >= exceptionScore &&
    volumeRatio >= exceptionVolumeRatio;

  const confirmed =
    volumeFloorOk &&
    (volumeOk || oiOk) &&
    (!oiDivergence || divergenceException);

  let label = '⏳ AGUARDANDO';

  if (!volumeFloorOk) {
    label = '🚫 VOLUME MUITO BAIXO';
  } else if (oiDivergence && !divergenceException) {
    label = '🚫 OI EM DIVERGÊNCIA';
  } else if (divergenceException) {
    label = '⚠️ OI NEGATIVO / VOLUME FORTE';
  } else if (volumeOk && oiOk) {
    label = '🔥 VOLUME + OI';
  } else if (oiOk) {
    label = '✅ OI FORTE';
  } else if (volumeOk) {
    label = '✅ VOLUME CONFIRMADO';
  }

  return {
    confirmed,
    label,
    volumeFloorOk,
    volumeOk,
    oiOk,
    oiDivergence,
    divergenceException
  };
}


function momentumBundleStatus(
  side,
  t5,
  oiPct,
  minVolumeRatio,
  minOiPct
) {
  const volumeRatio =
    finiteNumber(t5?.volumeRatio, 0);

  const oi =
    finiteNumber(oiPct, 0);

  const macdHist =
    finiteNumber(t5?.macdHist, 0);

  const volumeOk =
    volumeRatio >= minVolumeRatio;

  const oiOk =
    oi >= minOiPct;

  const macdOk =
    side === 'LONG'
      ? macdHist > 0
      : side === 'SHORT'
        ? macdHist < 0
        : false;

  return {
    confirmed:
      volumeOk &&
      oiOk &&
      macdOk,
    volumeOk,
    oiOk,
    macdOk,
    volumeRatio,
    oiPct: oi,
    macdHist
  };
}

function antiChaseStatus(
  side,
  t5,
  candles5m = []
) {
  const price =
    finiteNumber(t5?.price, 0);

  const atrValue =
    Math.max(
      finiteNumber(t5?.atr, 0),
      price * 0.001
    );

  const ema20 =
    finiteNumber(t5?.ema20, price);

  const lastCandle =
    candles5m?.[candles5m.length - 1] || null;

  if (
    !lastCandle ||
    atrValue <= 0 ||
    price <= 0
  ) {
    return {
      ok: true,
      stretched: false,
      extreme: false,
      retest: false,
      distanceAtr: 0,
      bodyAtr: 0,
      reason: 'dados insuficientes; anti-chase neutro'
    };
  }

  const directionalBody =
    side === 'LONG'
      ? Number(lastCandle.close) - Number(lastCandle.open)
      : Number(lastCandle.open) - Number(lastCandle.close);

  const bodyAtr =
    Math.max(
      0,
      directionalBody / atrValue
    );

  const distanceAtr =
    Math.abs(
      price - ema20
    ) / atrValue;

  const retest =
    side === 'LONG'
      ? Number(lastCandle.low) <= ema20 + atrValue * 0.35
      : side === 'SHORT'
        ? Number(lastCandle.high) >= ema20 - atrValue * 0.35
        : false;

  const stretched =
    distanceAtr >= 1.25 ||
    bodyAtr >= 1.00;

  const extreme =
    distanceAtr >= 1.75 ||
    bodyAtr >= 1.40;

  const ok =
    !extreme &&
    (
      !stretched ||
      retest
    );

  return {
    ok,
    stretched,
    extreme,
    retest,
    distanceAtr,
    bodyAtr,
    reason:
      ok
        ? retest
          ? 'reteste/EMA20 confirmado'
          : 'entrada não esticada'
        : `movimento esticado sem reteste (${distanceAtr.toFixed(2)} ATR da EMA20; corpo ${bodyAtr.toFixed(2)} ATR)`
  };
}

function btcRegimeGuardStatus({
  side,
  symbol,
  btcContext,
  score,
  volumeRatio,
  oiPct,
  directionEdge
}) {
  const isBtc =
    String(symbol || '')
      .toUpperCase()
      .startsWith('BTC');

  if (
    isBtc ||
    !btcContext
  ) {
    return {
      ok: true,
      strongAligned: false,
      strongOpposite: false,
      exceptional: false,
      regime:
        isBtc
          ? 'BTC_SELF'
          : 'UNKNOWN'
    };
  }

  const aligned =
    side === 'LONG'
      ? 'BULLISH'
      : 'BEARISH';

  const opposite =
    side === 'LONG'
      ? 'BEARISH'
      : 'BULLISH';

  const t1h =
    String(btcContext.trend1h || 'MIXED')
      .toUpperCase();

  const t4h =
    String(btcContext.trend4h || 'MIXED')
      .toUpperCase();

  const strongAligned =
    t1h === aligned &&
    t4h === aligned;

  const strongOpposite =
    t1h === opposite &&
    t4h === opposite;

  const exceptional =
    Number(score || 0) >= 85 &&
    Number(volumeRatio || 0) >= 0.80 &&
    Number(oiPct || 0) >= 1.00 &&
    Number(directionEdge || 0) >= 12;

  return {
    ok:
      !strongOpposite ||
      exceptional,
    strongAligned,
    strongOpposite,
    exceptional,
    regime:
      strongAligned
        ? 'ALIGNED'
        : strongOpposite
          ? 'OPPOSITE'
          : 'MIXED',
    t1h,
    t4h
  };
}

export function qualityEntryPreview({
  side,
  symbol = 'TESTUSDT',
  t5,
  candles5m = [],
  oiPct = 0,
  minVolumeRatio = 0.50,
  minOiPct = 0.50,
  btcContext = null,
  score = 70,
  directionEdge = 6
}) {
  return {
    momentum:
      momentumBundleStatus(
        side,
        t5,
        oiPct,
        minVolumeRatio,
        minOiPct
      ),
    antiChase:
      antiChaseStatus(
        side,
        t5,
        candles5m
      ),
    btcRegime:
      btcRegimeGuardStatus({
        side,
        symbol,
        btcContext,
        score,
        volumeRatio: t5?.volumeRatio,
        oiPct,
        directionEdge
      })
  };
}

function smartStopConfig() {
  const numberEnv = (
    name,
    fallback,
    min,
    max
  ) => {
    const n =
      Number(
        process.env[name] ??
        fallback
      );

    if (!Number.isFinite(n)) {
      return fallback;
    }

    return Math.max(
      min,
      Math.min(
        max,
        n
      )
    );
  };

  return {
    lookback:
      Math.trunc(
        numberEnv(
          'SMART_STOP_LOOKBACK_CANDLES',
          10,
          5,
          24
        )
      ),

    minAtr:
      numberEnv(
        'SMART_STOP_MIN_ATR',
        1.25,
        0.80,
        3.00
      ),

    maxAtr:
      numberEnv(
        'SMART_STOP_MAX_ATR',
        2.00,
        1.00,
        4.00
      ),

    bufferAtr:
      numberEnv(
        'SMART_STOP_STRUCTURE_BUFFER_ATR',
        0.25,
        0,
        1.00
      ),

    minPct:
      numberEnv(
        'SMART_STOP_MIN_PCT',
        0.35,
        0.10,
        3.00
      ),

    maxPct:
      numberEnv(
        'SMART_STOP_MAX_PCT',
        2.50,
        0.50,
        6.00
      ),

    tp1R:
      numberEnv(
        'SMART_STOP_TP1_R',
        0.90,
        0.50,
        3.00
      ),

    tp2R:
      numberEnv(
        'SMART_STOP_TP2_R',
        1.40,
        0.80,
        4.00
      ),

    tp3R:
      numberEnv(
        'SMART_STOP_TP3_R',
        2.10,
        1.00,
        6.00
      )
  };
}

function recentStructurePrice(
  side,
  candles5m,
  lookback
) {
  const recent =
    (
      candles5m || []
    )
      .slice(
        -lookback
      )
      .filter(c =>
        Number.isFinite(
          Number(c?.low)
        ) &&
        Number.isFinite(
          Number(c?.high)
        )
      );

  if (!recent.length) {
    return null;
  }

  if (side === 'LONG') {
    return Math.min(
      ...recent.map(
        c => Number(c.low)
      )
    );
  }

  return Math.max(
    ...recent.map(
      c => Number(c.high)
    )
  );
}

function buildLevels(
  side,
  price,
  atrValue,
  candles5m = []
) {
  const cfg =
    smartStopConfig();

  const px =
    Number(price);

  const rawAtr =
    Number(atrValue);

  const safeAtr =
    Number.isFinite(rawAtr) &&
    rawAtr > 0
      ? rawAtr
      : px * 0.0025;

  const structure =
    recentStructurePrice(
      side,
      candles5m,
      cfg.lookback
    );

  const buffer =
    safeAtr *
    cfg.bufferAtr;

  let structureStop = null;
  let structureRisk = null;

  if (
    Number.isFinite(
      structure
    )
  ) {
    structureStop =
      side === 'LONG'
        ? structure -
          buffer
        : structure +
          buffer;

    structureRisk =
      Math.abs(
        px -
        structureStop
      );
  }

  // Piso principal: 1.25 ATR.
  // Assim um ruído normal de 5m não tira o trade tão facilmente.
  const minRisk =
    Math.min(
      Math.max(
        safeAtr *
          cfg.minAtr,
        px *
          cfg.minPct /
          100
      ),
      px *
        cfg.maxPct /
        100
    );

  // Teto evita que um fundo/topo muito distante transforme scalp em swing.
  const maxRisk =
    Math.max(
      minRisk,
      Math.min(
        safeAtr *
          cfg.maxAtr,
        px *
          cfg.maxPct /
          100
      )
    );

  const desiredRisk =
    Number.isFinite(
      structureRisk
    ) &&
    structureRisk > 0
      ? structureRisk
      : minRisk;

  const risk =
    Math.max(
      minRisk,
      Math.min(
        maxRisk,
        desiredRisk
      )
    );

  const stop =
    side === 'LONG'
      ? px - risk
      : px + risk;

  const stopMode =
    !Number.isFinite(
      structureRisk
    )
      ? 'ATR_FALLBACK'
      : structureRisk <
          minRisk
        ? 'ATR_MIN'
        : structureRisk >
            maxRisk
          ? 'ATR_CAP'
          : 'STRUCTURE_ATR';

  if (side === 'LONG') {
    return {
      entry:
        px,
      stop,
      tp1:
        px +
        risk *
          cfg.tp1R,
      tp2:
        px +
        risk *
          cfg.tp2R,
      tp3:
        px +
        risk *
          cfg.tp3R,
      tradeStyle:
        'SCALP_5M_SMART_STOP',
      stopMode,
      stopAtrMultiple:
        safeAtr > 0
          ? risk /
            safeAtr
          : null,
      stopPct:
        px > 0
          ? risk /
            px *
            100
          : null,
      structurePrice:
        structure,
      structureLookback:
        cfg.lookback
    };
  }

  return {
    entry:
      px,
    stop,
    tp1:
      px -
      risk *
        cfg.tp1R,
    tp2:
      px -
      risk *
        cfg.tp2R,
    tp3:
      px -
      risk *
        cfg.tp3R,
    tradeStyle:
      'SCALP_5M_SMART_STOP',
    stopMode,
    stopAtrMultiple:
      safeAtr > 0
        ? risk /
          safeAtr
        : null,
    stopPct:
      px > 0
        ? risk /
          px *
          100
        : null,
    structurePrice:
      structure,
    structureLookback:
      cfg.lookback
  };
}

export function smartStopPreview({
  side,
  price,
  atrValue,
  candles5m = []
}) {
  return buildLevels(
    side,
    price,
    atrValue,
    candles5m
  );
}

function bestMarketForBase(
  markets,
  exchangeNames,
  base
) {
  const available = markets.filter(m =>
    String(m.base_asset).toUpperCase() === base &&
    String(m.quote_asset).toUpperCase() === 'USDT' &&
    m.is_perpetual === true &&
    m.has_ohlcv_data === true
  );

  if (!available.length) {
    return null;
  }

  available.sort((a, b) => {
    const aName = String(
      exchangeNames.get(String(a.exchange)) || a.exchange
    ).toUpperCase();

    const bName = String(
      exchangeNames.get(String(b.exchange)) || b.exchange
    ).toUpperCase();

    const ai = EXCHANGE_PRIORITY.indexOf(aName);
    const bi = EXCHANGE_PRIORITY.indexOf(bName);

    return (
      (ai === -1 ? 999 : ai) -
      (bi === -1 ? 999 : bi)
    );
  });

  const picked = available[0];

  return {
    ...picked,
    exchangeName:
      exchangeNames.get(String(picked.exchange)) ||
      picked.exchange
  };
}

function chooseMarkets(
  markets,
  exchangeNames,
  limit,
  requestedBases = null
) {
  const selected = [];
  const usedBases = new Set();

  const pushBase = base => {
    const normalized =
      String(base || '')
        .toUpperCase()
        .replace(/USDT$/, '');

    if (
      !normalized ||
      normalized === 'USDT' ||
      selected.length >= limit ||
      usedBases.has(normalized)
    ) {
      return;
    }

    const picked =
      bestMarketForBase(
        markets,
        exchangeNames,
        normalized
      );

    if (picked) {
      selected.push(picked);
      usedBases.add(normalized);
    }
  };

  if (
    Array.isArray(requestedBases) &&
    requestedBases.length
  ) {
    for (const base of requestedBases) {
      pushBase(base);
    }

    return selected;
  }

  for (const base of CORE_BASES) {
    pushBase(base);
  }

  const altSlots =
    Math.max(0, limit - selected.length);

  for (
    let offset = 0;
    offset < ROTATING_BASES.length &&
    selected.length < limit;
    offset += 1
  ) {
    const idx =
      (marketRotationCursor + offset) %
      ROTATING_BASES.length;

    pushBase(
      ROTATING_BASES[idx]
    );
  }

  if (altSlots > 0) {
    marketRotationCursor =
      (
        marketRotationCursor +
        altSlots
      ) %
      ROTATING_BASES.length;
  }

  return selected;
}

export async function scanMarket({
  topMarkets = 12,
  marketBases = null,
  minQuoteVolume = 20_000_000,
  minScore = 70,
  preCandidateMinScore = 60,
  minVolumeRatio = 0.60,
  minOiPct = 0.50,
  hardMinVolumeRatio = 0.40,
  oiRejectPct = -1.00,
  exceptionScore = 82,
  exceptionVolumeRatio = 1.00,
  minDirectionEdge = 6,
  require1hConfirmation = true,
  requireMomentumBundle = true,
  antiChaseEnabled = true,
  btcRegimeGuardEnabled = true
} = {}) {
  const [marketList, exchangeList] = await Promise.all([
    futureMarkets(),
    exchanges()
  ]);

  const exchangeNames = new Map(
    exchangeList.map(e => [String(e.code), e.name])
  );

  const effectiveLimit =
    Array.isArray(marketBases) && marketBases.length
      ? Math.min(marketBases.length, 12)
      : Math.min(topMarkets, 12);

  const markets = chooseMarkets(
    marketList,
    exchangeNames,
    effectiveLimit,
    marketBases
  );

  if (!markets.length) {
    throw new Error('Nenhum mercado perpétuo USDT encontrado');
  }

  const symbols = markets.map(m => m.symbol);

  const now = Math.floor(Date.now() / 1000);
  const from5 = now - 72 * 60 * 60;
  const from1h = now - 900 * 60 * 60;
  const fromOi = now - 6 * 60 * 60;

  console.log(
    '[scan] mercados:',
    markets.map(m => `${m.base_asset}@${m.exchangeName}`).join(', ')
  );

  console.log(
    `[scan] modo SCALP 5m · lote ${markets.length} mercado(s) · ` +
    `pares cotados em USDT · funding omitido para preservar rate limit`
  );

  const [candles5Raw, candles1hRaw, oiRaw] =
    await Promise.all([
      ohlcvHistory(symbols, '5min', from5, now),
      ohlcvHistory(symbols, '1hour', from1h, now),
      openInterestHistory(symbols, '15min', fromOi, now)
    ]);

  const map5 = new Map(
    candles5Raw.map(x => [x.symbol, x.history])
  );

  const map1h = new Map(
    candles1hRaw.map(x => [x.symbol, x.history])
  );

  const oiMap = new Map(
    oiRaw.map(x => [x.symbol, x.history || []])
  );

  const allResults = [];
  const preRejected = [];

  for (const market of markets) {
    try {
      const nowMs = Date.now();

      const c5All =
        mapHistory(map5.get(market.symbol));

      const c1hAll =
        mapHistory(map1h.get(market.symbol));

      const c5 =
        onlyClosedCandles(
          c5All,
          M5_MS,
          nowMs
        );

      const c15 =
        onlyClosedCandles(
          resample15m(c5),
          M15_MS,
          nowMs
        );

      const c1h =
        onlyClosedCandles(
          c1hAll,
          H1_MS,
          nowMs
        );

      // Primeiro agrega 1h -> 4h; depois remove o bloco ainda em formação.
      const c4h = onlyClosedCandles(
        resample4h(c1h),
        H4_MS,
        nowMs
      );

      const displaySymbol =
        market.symbol_on_exchange ||
        `${market.base_asset}USDT`;

      if (
        c5.length < 210 ||
        c15.length < 210 ||
        c1h.length < 210 ||
        c4h.length < 205
      ) {
        console.log(
          '[scan] poucos candles',
          market.symbol,
          c5.length,
          c15.length,
          c1h.length,
          c4h.length
        );

        preRejected.push({
          symbol: displaySymbol,
          exchange: market.exchangeName,
          side: '—',
          score: null,
          volumeRatio: null,
          oiPct: null,
          quoteVolume: null,
          reason:
            `Histórico fechado insuficiente: ` +
            `15m ${c15.length}/${c15All.length}, ` +
            `1h ${c1h.length}/${c1hAll.length}, ` +
            `4h ${c4h.length}`
        });
        continue;
      }

      const last96 = c15.slice(-96);

      const quoteVolume24h = last96.reduce(
        (sum, c) => sum + c.quoteVolume,
        0
      );

      const first24 = last96[0];
      const last24 = last(last96);
      const change24h = pctChange(first24.close, last24.close);

      const oi = onlyClosedOi(
        oiMap.get(market.symbol) || [],
        M15_MS,
        nowMs
      );
      let oiPct = 0;

      if (oi.length >= 2) {
        const firstOi = Number(oi[0].c);
        const lastOi = Number(last(oi).c);

        if (
          Number.isFinite(firstOi) &&
          Number.isFinite(lastOi) &&
          firstOi !== 0
        ) {
          oiPct = pctChange(firstOi, lastOi);
        }
      }

      const t5 = analyzeTf(c5);
      const t15 = analyzeTf(c15);
      const t1h = analyzeTf(c1h);
      const t4h = analyzeTf(c4h);

      const fundingRate = null;

      const isBtcMarket =
        String(
          market.base_asset || ''
        ).toUpperCase() === 'BTC';

      let btcContextForScore =
        freshBtcContext(
          nowMs
        );

      // Quando BTC está no lote, atualiza o contexto antes de pontuar
      // as altcoins que vierem depois dele.
      if (isBtcMarket) {
        btcContextForScore =
          buildBtcContext({
            t5,
            t15,
            t1h,
            t4h,
            oiPct,
            change24h
          });

        cachedBtcContext =
          btcContextForScore;

        cachedBtcContextAt =
          nowMs;
      }

      const sig =
        scoreSignal(
          t5,
          t15,
          t1h,
          t4h,
          oiPct,
          displaySymbol,
          btcContextForScore
        );

      if (isBtcMarket) {
        cachedBtcContext = {
          ...btcContextForScore,
          side: sig.side,
          score: sig.score
        };
      }

      const confirmation = confirmationStatus(
        t5,
        oiPct,
        sig.score,
        minVolumeRatio,
        minOiPct,
        hardMinVolumeRatio,
        oiRejectPct,
        exceptionScore,
        exceptionVolumeRatio
      );
      const levels =
        buildLevels(
          sig.side,
          t5.price,
          t5.atr,
          c5
        );

      const volume24hOk = quoteVolume24h >= minQuoteVolume;
      const scoreOk =
        sig.score >= minScore;

      const directionEdgeOk =
        sig.directionEdge >= minDirectionEdge;

      const oneHourConfirmationOk =
        !require1hConfirmation ||
        sig.oneHourConfirmed;

      const directionalSideOk =
        sig.side === 'LONG' ||
        sig.side === 'SHORT';

      const momentum =
        momentumBundleStatus(
          sig.side,
          t5,
          oiPct,
          minVolumeRatio,
          minOiPct
        );

      const momentumOk =
        !requireMomentumBundle ||
        momentum.confirmed;

      const antiChase =
        antiChaseStatus(
          sig.side,
          t5,
          c5
        );

      const antiChaseOk =
        !antiChaseEnabled ||
        antiChase.ok;

      const btcRegime =
        btcRegimeGuardStatus({
          side: sig.side,
          symbol: displaySymbol,
          btcContext: btcContextForScore,
          score: sig.score,
          volumeRatio: t5?.volumeRatio,
          oiPct,
          directionEdge: sig.directionEdge
        });

      const btcRegimeOk =
        !btcRegimeGuardEnabled ||
        btcRegime.ok;

      const isPreCandidate =
        volume24hOk &&
        directionalSideOk &&
        sig.score >= preCandidateMinScore &&
        sig.score < minScore;

      const mathApproved =
        volume24hOk &&
        scoreOk &&
        confirmation.confirmed &&
        directionalSideOk &&
        directionEdgeOk &&
        oneHourConfirmationOk &&
        momentumOk &&
        antiChaseOk &&
        btcRegimeOk;

      // V1.3.3: guarda TODOS os motivos de rejeição.
      const rejectionReasons = [];

      if (!volume24hOk) {
        rejectionReasons.push(
          `Volume 24h ${(quoteVolume24h / 1e6).toFixed(1)}M abaixo do mínimo ${(minQuoteVolume / 1e6).toFixed(0)}M`
        );
      }

      if (!scoreOk) {
        rejectionReasons.push(
          `Score ${sig.score} abaixo do mínimo ${minScore}`
        );
      }

      if (!directionalSideOk) {
        rejectionReasons.push(
          'Direção neutra: LONG e SHORT sem vantagem suficiente'
        );
      }

      if (
        directionalSideOk &&
        !directionEdgeOk
      ) {
        rejectionReasons.push(
          `Vantagem direcional ${sig.directionEdge} abaixo do mínimo ${minDirectionEdge} (LONG ${sig.longScore} x SHORT ${sig.shortScore})`
        );
      }

      if (
        directionalSideOk &&
        !oneHourConfirmationOk
      ) {
        rejectionReasons.push(
          `1H não confirma ${sig.side} (estrutura 1H: ${sig.structure1h})`
        );
      }

      if (
        requireMomentumBundle &&
        !momentum.confirmed
      ) {
        const missing = [];

        if (!momentum.volumeOk) {
          missing.push(
            `volume ${momentum.volumeRatio.toFixed(2)}x abaixo de ${minVolumeRatio.toFixed(2)}x`
          );
        }

        if (!momentum.oiOk) {
          missing.push(
            `OI ${momentum.oiPct >= 0 ? '+' : ''}${momentum.oiPct.toFixed(2)}% abaixo de +${minOiPct.toFixed(2)}%`
          );
        }

        if (!momentum.macdOk) {
          missing.push(
            `MACD 5m não confirma ${sig.side}`
          );
        }

        rejectionReasons.push(
          `Momentum incompleto: ${missing.join(' · ')}`
        );
      }

      if (
        antiChaseEnabled &&
        !antiChase.ok
      ) {
        rejectionReasons.push(
          `Anti-chase: ${antiChase.reason}`
        );
      }

      if (
        btcRegimeGuardEnabled &&
        !btcRegime.ok
      ) {
        rejectionReasons.push(
          `Regime BTC 1H+4H contrário a ${sig.side}; exige setup excepcional (score 85+, vol 0.80x+, OI +1.00%+, edge 12+)`
        );
      }

      if (!confirmation.volumeFloorOk) {
        rejectionReasons.push(
          `Volume relativo ${fmt(t5?.volumeRatio, 2, '0.00')}x abaixo do piso ${hardMinVolumeRatio.toFixed(2)}x`
        );
      }

      if (confirmation.oiDivergence && !confirmation.divergenceException) {
        rejectionReasons.push(
          `OI ${fmt(oiPct, 2, '0.00')}% abaixo do bloqueio ${oiRejectPct.toFixed(2)}%`
        );
      }

      if (
        confirmation.volumeFloorOk &&
        !confirmation.oiDivergence &&
        !confirmation.confirmed
      ) {
        rejectionReasons.push(
          `Sem confirmação: volume ${fmt(t5?.volumeRatio, 2, '0.00')}x (alvo ${minVolumeRatio.toFixed(2)}x) e OI ${finiteNumber(oiPct, 0) >= 0 ? '+' : ''}${fmt(oiPct, 2, '0.00')}% (alvo +${minOiPct.toFixed(2)}%)`
        );
      }

      const rejectionReason =
        rejectionReasons[0] || '';

      // "Quase aprovado": score já atingiu o mínimo e somente UM gate
      // impediu a entrada. Continua rejeitado, mas fica destacado no debug.
      const nearApproved =
        !mathApproved &&
        scoreOk &&
        volume24hOk &&
        rejectionReasons.length === 1;

      allResults.push({
        symbol: displaySymbol,
        dataSymbol: market.symbol,
        exchange: market.exchangeName,
        quoteVolume: quoteVolume24h,
        change24h,
        ...sig,
        ...levels,
        confirmation,
        t5,
        t15,
        t1h,
        t4h,
        oiPct,
        fundingRate,
        btcContextUsed:
          btcContextForScore,
        momentum,
        antiChase,
        btcRegime,
        candlePolicy: 'CLOSED_ONLY',
        nearApproved,
        candidateTier: mathApproved
          ? 'STANDARD'
          : nearApproved
            ? 'NEAR_APPROVED'
            : isPreCandidate
              ? 'PRE_CANDIDATE'
              : 'REJECTED',
        gates: {
          volume24hOk,
          scoreOk,
          preCandidate: isPreCandidate,
          confirmationOk: confirmation.confirmed,
          directionalSideOk,
          directionEdgeOk,
          oneHourConfirmationOk,
          momentumOk,
          antiChaseOk,
          btcRegimeOk,
          mathApproved
        },
        rejectionReasons,
        rejectionReason
      });
    } catch (error) {
      console.error('[scan] falha', market.symbol, error.message);
      preRejected.push({
        symbol: market.symbol_on_exchange || `${market.base_asset}USDT`,
        exchange: market.exchangeName,
        side: '—',
        score: null,
        volumeRatio: null,
        oiPct: null,
        quoteVolume: null,
        reason: `Falha ao analisar: ${error.message}`.slice(0, 180)
      });
    }
  }

  const btc =
    allResults.find(r =>
      String(r.symbol)
        .toUpperCase()
        .startsWith('BTC')
    );

  if (btc) {
    cachedBtcContext = {
      ...buildBtcContext({
        t5: btc.t5,
        t15: btc.t15,
        t1h: btc.t1h,
        t4h: btc.t4h,
        oiPct: btc.oiPct,
        change24h: btc.change24h,
        side: btc.side,
        score: btc.score
      }),
      side: btc.side,
      score: btc.score
    };

    cachedBtcContextAt =
      Date.now();
  }

  const btcContext =
    freshBtcContext();

  for (const r of allResults) {
    r.btcContext =
      btcContext;
  }

  const signals = allResults
    .filter(r => r.gates.mathApproved)
    .sort((a, b) => b.score - a.score);

  // Pré-candidato: score 60–69 (por padrão), sem afrouxar a regra
  // que libera sinal real. Ele só pode ser analisado pela IA/Watchlist.
  const preCandidates = allResults
    .filter(r => r.gates.preCandidate)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.t5.volumeRatio !== a.t5.volumeRatio) {
        return b.t5.volumeRatio - a.t5.volumeRatio;
      }
      return b.oiPct - a.oiPct;
    });

  const rejected = [
    ...allResults
      .filter(r => !r.gates.mathApproved)
      .map(r => ({
        symbol: r.symbol,
        exchange: r.exchange,
        side: r.side,
        score: r.score,
        volumeRatio: r.t5.volumeRatio,
        oiPct: r.oiPct,
        quoteVolume: r.quoteVolume,
        confirmation: r.confirmation.label,
        candidateTier: r.candidateTier,
        nearApproved: Boolean(r.nearApproved),
        reasons: r.rejectionReasons?.length
          ? r.rejectionReasons
          : ['Filtro técnico não confirmado'],
        reason:
          r.rejectionReasons?.[0] ||
          r.rejectionReason ||
          'Filtro técnico não confirmado'
      })),
    ...preRejected.map(r => ({
      ...r,
      reasons: [r.reason || 'Falha de análise']
    }))
  ].sort((a, b) => {
    const aScore = Number.isFinite(a.score) ? a.score : -1;
    const bScore = Number.isFinite(b.score) ? b.score : -1;
    return bScore - aScore;
  });

  return {
    signals,
    preCandidates,
    snapshots: allResults,
    debug: {
      selectedMarkets: markets.length,
      analyzedMarkets: allResults.length,
      mathApproved: signals.length,
      directionStats: {
        longApproved:
          signals.filter(
            r => r.side === 'LONG'
          ).length,
        shortApproved:
          signals.filter(
            r => r.side === 'SHORT'
          ).length,
        minDirectionEdge,
        require1hConfirmation,
        btcContextAgeMin:
          btcContext?.ageMin ?? null
      },
      preCandidateMinScore,
      closedCandlePolicy: true,
      nearApproved: rejected.filter(r => r.nearApproved),
      preCandidates: preCandidates.map(r => ({
        symbol: r.symbol,
        exchange: r.exchange,
        side: r.side,
        score: r.score,
        volumeRatio: r.t5.volumeRatio,
        oiPct: r.oiPct,
        quoteVolume: r.quoteVolume,
        longScore: r.longScore,
        shortScore: r.shortScore,
        directionEdge: r.directionEdge,
        oneHourConfirmed: r.oneHourConfirmed,
        btcScoreAdjustment: r.btcScoreAdjustment,
        reasons: r.rejectionReasons,
        reason: r.rejectionReason || 'Pré-candidato'
      })),
      rejected
    }
  };
}

function signalStrength(score) {
  if (score >= 85) return '🔥 MUITO FORTE';
  if (score >= 78) return '💪 FORTE';
  return '⚖️ MODERADO';
}

export function signalText(s) {
  const emoji = s.side === 'LONG' ? '🟢' : '🔴';

  const digits =
    s.entry >= 1000 ? 2 :
    s.entry >= 1 ? 4 : 6;

  const n = x => Number(x).toFixed(digits);

  const stopPct =
    Math.abs(s.entry - s.stop) / s.entry * 100;

  const risk = Math.abs(s.entry - s.stop);

  const rr1 = risk > 0 ? Math.abs(s.tp1 - s.entry) / risk : 0;
  const rr2 = risk > 0 ? Math.abs(s.tp2 - s.entry) / risk : 0;
  const rr3 = risk > 0 ? Math.abs(s.tp3 - s.entry) / risk : 0;

  return (
    `${emoji} <b>${s.symbol} — ${s.side}</b>\n` +
    `🏦 ${s.exchange}\n` +
    `⭐ Score: <b>${s.score}/100</b>\n` +
    `⚖️ Direção: LONG ${s.longScore ?? '—'} x SHORT ${s.shortScore ?? '—'} · edge ${s.directionEdge ?? '—'}\n` +
    `🕐 1H confirma ${s.side}: ${s.oneHourConfirmed ? 'SIM' : 'NÃO'}\n` +
    `${s.btcScoreAdjustment ? `₿ Ajuste BTC: ${s.btcScoreAdjustment > 0 ? '+' : ''}${s.btcScoreAdjustment}\n` : ''}` +
    `💪 Força: <b>${signalStrength(s.score)}</b>\n` +
    `🔎 Confirmação: <b>${s.confirmation.label}</b>\n` +
    `${s.momentum ? `🚦 Momentum: ${s.momentum.confirmed ? 'OK' : 'FALHOU'} · Vol ${fmt(s.momentum.volumeRatio, 2)}x · OI ${s.momentum.oiPct >= 0 ? '+' : ''}${fmt(s.momentum.oiPct, 2)}% · MACD ${s.momentum.macdOk ? 'OK' : 'NÃO'}\n` : ''}` +
    `${s.antiChase ? `🛑 Anti-chase: ${s.antiChase.ok ? 'OK' : 'BLOQUEIO'} · ${s.antiChase.reason}\n` : ''}` +
    `${s.btcRegime ? `₿ Regime BTC 1H+4H: ${s.btcRegime.regime}${s.btcRegime.exceptional ? ' · EXCEÇÃO FORTE' : ''}\n` : ''}` +
    (s.ai
      ? `🤖 IA: <b>${s.ai.decision}</b> · Confiança ${Math.round(s.ai.confidence)}% · ` +
        `${s.ai.style} · Risco ${s.ai.risk}\n` +
        `${s.ai.cached
          ? `♻️ Origem: CACHE${Number.isFinite(s.ai.cacheAgeMin) ? ` · ${s.ai.cacheAgeMin.toFixed(0)} min` : ''}`
          : s.ai.rescueUsed
            ? '🛟 Origem: OPENROUTER RESCUE'
            : s.ai.callMode === 'RECHECK'
              ? '🔄 Origem: RECHECK INTELIGENTE DE WAIT'
              : s.ai.callMode === 'PRIORITY'
                ? '⚡ Origem: NOVA ANÁLISE PRIORITÁRIA'
                : '🧠 Origem: NOVA ANÁLISE NORMAL'}\n` +
        `🧠 IA: ${s.ai.reason}\n`
      : '') +
    `\n` +

    `💰 Entrada: <b>${n(s.entry)}</b>\n` +
    `🛑 Stop: <b>${n(s.stop)}</b>\n` +
    `📐 Stop: ${stopPct.toFixed(2)}% do preço` +
    `${Number.isFinite(Number(s.stopAtrMultiple)) ? ` · ${Number(s.stopAtrMultiple).toFixed(2)} ATR` : ''}\n` +
    `${s.stopMode ? `🧠 Smart Stop: ${s.stopMode}${Number.isFinite(Number(s.structurePrice)) ? ` · estrutura ${n(s.structurePrice)}` : ''}\n` : ''}\n` +

    `🎯 TP1: ${n(s.tp1)} — 1:${rr1.toFixed(1)}\n` +
    `🎯 TP2: ${n(s.tp2)} — 1:${rr2.toFixed(1)}\n` +
    `🎯 TP3: ${n(s.tp3)} — 1:${rr3.toFixed(1)}\n\n` +

    `📊 RSI 5m: ${fmt(s.t5?.rsi, 1)} | RSI 15m: ${fmt(s.t15?.rsi, 1)} | ` +
    `Vol 5m: ${fmt(s.t5?.volumeRatio, 2)}x\n` +

    `📈 OI: ${finiteNumber(s.oiPct, 0) >= 0 ? '+' : ''}${fmt(s.oiPct, 2)}% | ` +
    `Funding: ${s.fundingRate == null ? 'omitido no scalp' : `${fmt(s.fundingRate, 4)}%`}\n\n` +

    `🧠 ${s.reasons.slice(0, 4).join(' • ')}\n\n` +

    `<i>V1.7.1: Quality Aggressive + Telegram Safe; filtros e gestão preservados. ` +
    `Futuros envolvem risco elevado e liquidação.</i>`
  );
}
