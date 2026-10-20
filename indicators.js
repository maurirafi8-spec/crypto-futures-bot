/**
 * INDICATORS.JS — V2.0 OTIMIZADO
 * Funções matemáticas puras de análise técnica para futuros de criptoativos.
 * Inclui EMA, RSI, ATR, MACD, Bandas de Bollinger (%B e Bandwidth), ADX e VWAP Diária.
 */

export function ema(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = Array(period - 1).fill(null);
  let prev = seed;
  out.push(seed);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(values, period = 14) {
  if (values.length <= period) return Array(values.length).fill(null);
  const out = Array(period).fill(null);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const gain = Math.max(d, 0);
    const loss = Math.max(-d, 0);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return out;
}

export function atr(candles, period = 14) {
  if (candles.length < 2) return Array(candles.length).fill(null);
  const tr = [null];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const out = Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function macd(values, fast = 12, slow = 26, signal = 9) {
  const fastE = ema(values, fast);
  const slowE = ema(values, slow);
  const line = values.map((_, i) => fastE[i] == null || slowE[i] == null ? null : fastE[i] - slowE[i]);
  const compact = line.filter(v => v != null);
  const sigCompact = ema(compact, signal);
  const signalLine = Array(values.length).fill(null);
  let j = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] != null) signalLine[i] = sigCompact[j++];
  }
  const histogram = line.map((v, i) => v == null || signalLine[i] == null ? null : v - signalLine[i]);
  return { line, signal: signalLine, histogram };
}

export function pctChange(a, b) {
  if (!a) return 0;
  return ((b - a) / a) * 100;
}

/**
 * NOVO: Bandas de Bollinger (%B e Bandwidth)
 * Identifica Squeeze (compressão) e expansão real de volatilidade.
 */
export function bollingerBands(closes, period = 20, multiplier = 2) {
  const sma = [];
  const upper = [];
  const lower = [];
  const bandwidth = [];
  const percentB = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      sma.push(null);
      upper.push(null);
      lower.push(null);
      bandwidth.push(null);
      percentB.push(null);
      continue;
    }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    const up = mean + multiplier * stdDev;
    const low = mean - multiplier * stdDev;
    const bw = mean > 0 ? (up - low) / mean : 0;
    const pb = up !== low ? (closes[i] - low) / (up - low) : 0.5;

    sma.push(mean);
    upper.push(up);
    lower.push(low);
    bandwidth.push(bw);
    percentB.push(pb);
  }

  return { sma, upper, lower, bandwidth, percentB };
}

/**
 * NOVO: ADX (Average Directional Index) com +DI e -DI
 * Filtro de mercado sem tendência (CHOP).
 * adx >= 22 indica tendência direcional forte.
 */
export function adx(candles, period = 14) {
  const n = candles.length;
  if (n < period * 2) {
    return {
      adx: Array(n).fill(null),
      plusDi: Array(n).fill(null),
      minusDi: Array(n).fill(null)
    };
  }

  const tr = [0];
  const plusDm = [0];
  const minusDm = [0];

  for (let i = 1; i < n; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];

    const hDiff = cur.high - prev.high;
    const lDiff = prev.low - cur.low;

    plusDm.push(hDiff > lDiff && hDiff > 0 ? hDiff : 0);
    minusDm.push(lDiff > hDiff && lDiff > 0 ? lDiff : 0);

    const trueRange = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    tr.push(trueRange);
  }

  // Suavização Wilder dos primeiros 'period' períodos
  let smoothTr = tr.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let smoothPlusDm = plusDm.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let smoothMinusDm = minusDm.slice(1, period + 1).reduce((a, b) => a + b, 0);

  const plusDiArr = Array(period).fill(null);
  const minusDiArr = Array(period).fill(null);
  const dxArr = Array(period).fill(null);

  const calcDi = () => {
    const pDi = smoothTr > 0 ? (smoothPlusDm / smoothTr) * 100 : 0;
    const mDi = smoothTr > 0 ? (smoothMinusDm / smoothTr) * 100 : 0;
    const sum = pDi + mDi;
    const dx = sum > 0 ? (Math.abs(pDi - mDi) / sum) * 100 : 0;
    return { pDi, mDi, dx };
  };

  const initial = calcDi();
  plusDiArr.push(initial.pDi);
  minusDiArr.push(initial.mDi);
  dxArr.push(initial.dx);

  for (let i = period + 1; i < n; i++) {
    smoothTr = smoothTr - (smoothTr / period) + tr[i];
    smoothPlusDm = smoothPlusDm - (smoothPlusDm / period) + plusDm[i];
    smoothMinusDm = smoothMinusDm - (smoothMinusDm / period) + minusDm[i];

    const { pDi, mDi, dx } = calcDi();
    plusDiArr.push(pDi);
    minusDiArr.push(mDi);
    dxArr.push(dx);
  }

  // Cálculo da média móvel do DX para obter o ADX final
  const adxArr = Array(period * 2 - 1).fill(null);
  const validDx = dxArr.slice(period);
  if (validDx.length >= period) {
    let adxSmooth = validDx.slice(0, period).reduce((a, b) => a + b, 0) / period;
    adxArr.push(adxSmooth);

    for (let i = period; i < validDx.length; i++) {
      adxSmooth = (adxSmooth * (period - 1) + validDx[i]) / period;
      adxArr.push(adxSmooth);
    }
  }

  return {
    adx: adxArr,
    plusDi: plusDiArr,
    minusDi: minusDiArr
  };
}

/**
 * NOVO: VWAP Diária Ancorada (Daily Anchored VWAP)
 * Ancorada na virada do dia UTC (00:00).
 * Nível institucional de preço justo.
 */
export function dailyVwap(candles5m) {
  let cumulativePv = 0;
  let cumulativeVol = 0;
  let currentDay = '';

  return (candles5m || []).map(c => {
    const day = new Date(c.openTime).toISOString().slice(0, 10);
    if (day !== currentDay) {
      currentDay = day;
      cumulativePv = 0;
      cumulativeVol = 0;
    }
    const typicalPrice = (Number(c.high) + Number(c.low) + Number(c.close)) / 3;
    const vol = Number(c.quoteVolume || (Number(c.volume || 0) * Number(c.close)));
    cumulativePv += typicalPrice * vol;
    cumulativeVol += vol;
    return cumulativeVol > 0 ? cumulativePv / cumulativeVol : Number(c.close);
  });
}
