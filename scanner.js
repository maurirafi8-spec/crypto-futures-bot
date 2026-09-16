import { exchangeInfo, tickers24h, klines, funding, openInterestHistory } from './binance.js';
import { ema, rsi, atr, macd, pctChange } from './indicators.js';

const EXCLUDED_BASE = new Set(['USDC','FDUSD','TUSD','USDP','DAI','EUR','TRY','BRL']);

function last(arr) { return arr[arr.length - 1]; }
function fmt(n, d = 4) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: d }); }

function analyzeTf(candles) {
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.quoteVolume);
  const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
  const rs = rsi(closes, 14);
  const at = atr(candles, 14);
  const mc = macd(closes);
  const c = last(candles);
  const avgVol = volumes.slice(-21, -1).reduce((a,b)=>a+b,0) / Math.max(1, volumes.slice(-21,-1).length);
  return {
    price: c.close,
    ema20: last(e20), ema50: last(e50), ema200: last(e200),
    rsi: last(rs), atr: last(at),
    macdHist: last(mc.histogram),
    volumeRatio: avgVol ? c.quoteVolume / avgVol : 1,
    bullish: c.close > last(e20) && last(e20) > last(e50) && last(e50) > last(e200),
    bearish: c.close < last(e20) && last(e20) < last(e50) && last(e50) < last(e200)
  };
}

function scoreSignal(t15, t1h, t4h, oiPct, fundingRate) {
  let long = 0, short = 0;
  const whyLong = [], whyShort = [];
  const add = (side, pts, text) => {
    if (side === 'LONG') { long += pts; whyLong.push(text); }
    else { short += pts; whyShort.push(text); }
  };

  if (t4h.bullish) add('LONG', 22, '4H em tendência de alta');
  if (t4h.bearish) add('SHORT', 22, '4H em tendência de baixa');
  if (t1h.bullish) add('LONG', 18, '1H alinhado para alta');
  if (t1h.bearish) add('SHORT', 18, '1H alinhado para baixa');
  if (t15.price > t15.ema20 && t15.ema20 > t15.ema50) add('LONG', 12, '15m acima das EMAs');
  if (t15.price < t15.ema20 && t15.ema20 < t15.ema50) add('SHORT', 12, '15m abaixo das EMAs');

  if (t15.rsi >= 52 && t15.rsi <= 68) add('LONG', 10, `RSI 15m ${t15.rsi.toFixed(1)}`);
  if (t15.rsi <= 48 && t15.rsi >= 32) add('SHORT', 10, `RSI 15m ${t15.rsi.toFixed(1)}`);
  if (t15.macdHist > 0) add('LONG', 8, 'MACD ganhando força');
  if (t15.macdHist < 0) add('SHORT', 8, 'MACD vendedor');
  if (t15.volumeRatio >= 1.25) {
    if (t15.price > t15.ema20) add('LONG', 10, `Volume ${t15.volumeRatio.toFixed(2)}x`);
    if (t15.price < t15.ema20) add('SHORT', 10, `Volume ${t15.volumeRatio.toFixed(2)}x`);
  }
  if (oiPct >= 0.5) {
    if (t15.price > t15.ema20) add('LONG', 10, `OI +${oiPct.toFixed(2)}%`);
    if (t15.price < t15.ema20) add('SHORT', 10, `OI +${oiPct.toFixed(2)}%`);
  }
  if (fundingRate <= 0.0005) add('LONG', 4, `Funding ${(fundingRate*100).toFixed(4)}%`);
  if (fundingRate >= -0.0005) add('SHORT', 4, `Funding ${(fundingRate*100).toFixed(4)}%`);

  const side = long >= short ? 'LONG' : 'SHORT';
  return { side, score: Math.min(100, Math.max(long, short)), reasons: side === 'LONG' ? whyLong : whyShort };
}

function buildLevels(side, price, atrValue) {
  const risk = atrValue * 1.25;
  if (side === 'LONG') {
    const stop = price - risk;
    return { entry: price, stop, tp1: price + risk*1.5, tp2: price + risk*2.2, tp3: price + risk*3.0 };
  }
  const stop = price + risk;
  return { entry: price, stop, tp1: price - risk*1.5, tp2: price - risk*2.2, tp3: price - risk*3.0 };
}

export async function getUniverse(topMarkets = 15, minQuoteVolume = 50_000_000) {
  const [info, ticks] = await Promise.all([exchangeInfo(), tickers24h()]);
  const allowed = new Set(info.symbols
    .filter(s => s.status === 'TRADING' && s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && !EXCLUDED_BASE.has(s.baseAsset))
    .map(s => s.symbol));
  return ticks
    .filter(t => allowed.has(t.symbol) && Number(t.quoteVolume) >= minQuoteVolume)
    .sort((a,b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, topMarkets)
    .map(t => ({ symbol: t.symbol, quoteVolume: Number(t.quoteVolume), change24h: Number(t.priceChangePercent) }));
}

export async function analyzeSymbol(symbol) {
  const [c15, c1h, c4h, fund, oi] = await Promise.all([
    klines(symbol, '15m', 250), klines(symbol, '1h', 250), klines(symbol, '4h', 250),
    funding(symbol), openInterestHistory(symbol, '15m', 8)
  ]);
  const t15 = analyzeTf(c15), t1h = analyzeTf(c1h), t4h = analyzeTf(c4h);
  const oiPct = oi.length >= 2 ? pctChange(oi[0].openInterestValue, last(oi).openInterestValue) : 0;
  const sig = scoreSignal(t15, t1h, t4h, oiPct, fund.fundingRate);
  const levels = buildLevels(sig.side, t15.price, t15.atr);
  return { symbol, ...sig, ...levels, t15, t1h, t4h, oiPct, fundingRate: fund.fundingRate };
}

export async function scanMarket({ topMarkets = 15, minQuoteVolume = 50_000_000, minScore = 70 } = {}) {
  const universe = await getUniverse(topMarkets, minQuoteVolume);
  const results = [];
  for (const m of universe) {
    try {
      const r = await analyzeSymbol(m.symbol);
      r.quoteVolume = m.quoteVolume;
      r.change24h = m.change24h;
      results.push(r);
      await new Promise(res => setTimeout(res, 80));
    } catch (e) {
      console.error('Falha', m.symbol, e.message);
    }
  }
  return results.filter(r => r.score >= minScore).sort((a,b) => b.score - a.score);
}

export function signalText(s) {
  const emoji = s.side === 'LONG' ? '🟢' : '🔴';
  const digits = s.entry >= 1000 ? 2 : s.entry >= 1 ? 4 : 6;
  const n = x => Number(x).toFixed(digits);
  return `${emoji} <b>${s.symbol} — ${s.side}</b>\n` +
    `⭐ Score: <b>${s.score}/100</b>\n` +
    `💰 Entrada ref.: <b>${n(s.entry)}</b>\n` +
    `🛑 Stop técnico: <b>${n(s.stop)}</b>\n` +
    `🎯 TP1: ${n(s.tp1)}\n🎯 TP2: ${n(s.tp2)}\n🎯 TP3: ${n(s.tp3)}\n` +
    `📊 RSI 15m: ${s.t15.rsi.toFixed(1)} | Vol: ${s.t15.volumeRatio.toFixed(2)}x\n` +
    `📈 OI: ${s.oiPct >= 0 ? '+' : ''}${s.oiPct.toFixed(2)}% | Funding: ${(s.fundingRate*100).toFixed(4)}%\n` +
    `🧠 ${s.reasons.slice(0,4).join(' • ')}\n\n` +
    `<i>Sinal técnico experimental; futuros têm risco elevado e podem liquidar posições.</i>`;
}
