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
