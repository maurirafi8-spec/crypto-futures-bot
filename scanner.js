import {
  futureMarkets,
  exchanges,
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

  return [...groups.values()].sort((a, b) => a.openTime - b.openTime);
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

function scoreSignal(t15, t1h, t4h, oiPct, fundingRate) {
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

  if (t4h.bullish) add('LONG', 22, '4H em tendência de alta');
  if (t4h.bearish) add('SHORT', 22, '4H em tendência de baixa');

  if (t1h.bullish) add('LONG', 18, '1H alinhado para alta');
  if (t1h.bearish) add('SHORT', 18, '1H alinhado para baixa');

  if (t15.price > t15.ema20 && t15.ema20 > t15.ema50) {
    add('LONG', 12, '15m acima das EMAs');
  }

  if (t15.price < t15.ema20 && t15.ema20 < t15.ema50) {
    add('SHORT', 12, '15m abaixo das EMAs');
  }

  if (t15.rsi >= 52 && t15.rsi <= 68) {
    add('LONG', 10, `RSI 15m ${t15.rsi.toFixed(1)}`);
  }

  if (t15.rsi <= 48 && t15.rsi >= 32) {
    add('SHORT', 10, `RSI 15m ${t15.rsi.toFixed(1)}`);
  }

  if (t15.macdHist > 0) add('LONG', 8, 'MACD comprador');
  if (t15.macdHist < 0) add('SHORT', 8, 'MACD vendedor');

  if (t15.volumeRatio >= 1.25) {
    if (t15.price > t15.ema20) {
      add('LONG', 10, `Volume ${t15.volumeRatio.toFixed(2)}x`);
    }

    if (t15.price < t15.ema20) {
      add('SHORT', 10, `Volume ${t15.volumeRatio.toFixed(2)}x`);
    }
  }

  if (oiPct >= 0.5) {
    if (t15.price > t15.ema20) {
      add('LONG', 10, `OI +${oiPct.toFixed(2)}%`);
    }

    if (t15.price < t15.ema20) {
      add('SHORT', 10, `OI +${oiPct.toFixed(2)}%`);
    }
  }

  // Coinalyze já retorna funding em percentual.
  if (fundingRate <= -0.01) {
    add('LONG', 4, `Funding ${fundingRate.toFixed(4)}%`);
  }

  if (fundingRate >= 0.01) {
    add('SHORT', 4, `Funding ${fundingRate.toFixed(4)}%`);
  }

  const side = long >= short ? 'LONG' : 'SHORT';

  return {
    side,
    score: Math.min(100, Math.max(long, short)),
    reasons: side === 'LONG' ? whyLong : whyShort
  };
}

function confirmationStatus(
  t15,
  oiPct,
  score,
  minVolumeRatio,
  minOiPct,
  hardMinVolumeRatio,
  oiRejectPct,
  exceptionScore,
  exceptionVolumeRatio
) {
  const volumeRatio = Number(t15.volumeRatio || 0);
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

function chooseMarkets(markets, exchangeNames, limit) {
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
      const aName = String(
        exchangeNames.get(String(a.exchange)) || a.exchange
      ).toUpperCase();

      const bName = String(
        exchangeNames.get(String(b.exchange)) || b.exchange
      ).toUpperCase();

      const ai = EXCHANGE_PRIORITY.indexOf(aName);
      const bi = EXCHANGE_PRIORITY.indexOf(bName);

      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    const picked = available[0];

    selected.push({
      ...picked,
      exchangeName:
        exchangeNames.get(String(picked.exchange)) || picked.exchange
    });

    if (selected.length >= limit) break;
  }

  return selected;
}

export async function scanMarket({
  topMarkets = 6,
  minQuoteVolume = 20_000_000,
  minScore = 70,
  preCandidateMinScore = 60,
  minVolumeRatio = 0.60,
  minOiPct = 0.50,
  hardMinVolumeRatio = 0.40,
  oiRejectPct = -1.00,
  exceptionScore = 82,
  exceptionVolumeRatio = 1.00
} = {}) {
  const [marketList, exchangeList] = await Promise.all([
    futureMarkets(),
    exchanges()
  ]);

  const exchangeNames = new Map(
    exchangeList.map(e => [String(e.code), e.name])
  );

  const markets = chooseMarkets(
    marketList,
    exchangeNames,
    Math.min(topMarkets, 6)
  );

  if (!markets.length) {
    throw new Error('Nenhum mercado perpétuo USDT encontrado');
  }

  const symbols = markets.map(m => m.symbol);

  const now = Math.floor(Date.now() / 1000);
  const from15 = now - 72 * 60 * 60;
  const from1h = now - 900 * 60 * 60;
  const fromOi = now - 6 * 60 * 60;

  console.log(
    '[scan] mercados:',
    markets.map(m => `${m.base_asset}@${m.exchangeName}`).join(', ')
  );

  const [candles15Raw, candles1hRaw, fundingRaw, oiRaw] =
    await Promise.all([
      ohlcvHistory(symbols, '15min', from15, now),
      ohlcvHistory(symbols, '1hour', from1h, now),
      fundingRates(symbols),
      openInterestHistory(symbols, '15min', fromOi, now)
    ]);

  const map15 = new Map(
    candles15Raw.map(x => [x.symbol, x.history])
  );

  const map1h = new Map(
    candles1hRaw.map(x => [x.symbol, x.history])
  );

  const fundingMap = new Map(
    fundingRaw.map(x => [x.symbol, Number(x.value || 0)])
  );

  const oiMap = new Map(
    oiRaw.map(x => [x.symbol, x.history || []])
  );

  const allResults = [];
  const preRejected = [];

  for (const market of markets) {
    try {
      const nowMs = Date.now();

      const c15All = mapHistory(map15.get(market.symbol));
      const c1hAll = mapHistory(map1h.get(market.symbol));

      const c15 = onlyClosedCandles(c15All, M15_MS, nowMs);
      const c1h = onlyClosedCandles(c1hAll, H1_MS, nowMs);

      // Primeiro agrega 1h -> 4h; depois remove o bloco 4h ainda em formação.
      const c4h = onlyClosedCandles(
        resample4h(c1h),
        H4_MS,
        nowMs
      );

      const displaySymbol =
        market.symbol_on_exchange || `${market.base_asset}USDT`;

      if (c15.length < 210 || c1h.length < 210 || c4h.length < 205) {
        console.log(
          '[scan] poucos candles',
          market.symbol,
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

      const t15 = analyzeTf(c15);
      const t1h = analyzeTf(c1h);
      const t4h = analyzeTf(c4h);

      const fundingRate = fundingMap.get(market.symbol) || 0;

      const sig = scoreSignal(t15, t1h, t4h, oiPct, fundingRate);
      const confirmation = confirmationStatus(
        t15,
        oiPct,
        sig.score,
        minVolumeRatio,
        minOiPct,
        hardMinVolumeRatio,
        oiRejectPct,
        exceptionScore,
        exceptionVolumeRatio
      );
      const levels = buildLevels(sig.side, t15.price, t15.atr);

      const volume24hOk = quoteVolume24h >= minQuoteVolume;
      const scoreOk = sig.score >= minScore;
      const isPreCandidate =
        volume24hOk &&
        sig.score >= preCandidateMinScore &&
        sig.score < minScore;

      const mathApproved =
        volume24hOk &&
        scoreOk &&
        confirmation.confirmed;

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

      if (!confirmation.volumeFloorOk) {
        rejectionReasons.push(
          `Volume relativo ${t15.volumeRatio.toFixed(2)}x abaixo do piso ${hardMinVolumeRatio.toFixed(2)}x`
        );
      }

      if (confirmation.oiDivergence && !confirmation.divergenceException) {
        rejectionReasons.push(
          `OI ${oiPct.toFixed(2)}% abaixo do bloqueio ${oiRejectPct.toFixed(2)}%`
        );
      }

      if (
        confirmation.volumeFloorOk &&
        !confirmation.oiDivergence &&
        !confirmation.confirmed
      ) {
        rejectionReasons.push(
          `Sem confirmação: volume ${t15.volumeRatio.toFixed(2)}x (alvo ${minVolumeRatio.toFixed(2)}x) e OI ${oiPct >= 0 ? '+' : ''}${oiPct.toFixed(2)}% (alvo +${minOiPct.toFixed(2)}%)`
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
        t15,
        t1h,
        t4h,
        oiPct,
        fundingRate,
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

  const btc = allResults.find(r =>
    String(r.symbol).toUpperCase().startsWith('BTC')
  );

  const btcContext = btc
    ? {
        side: btc.side,
        score: btc.score,
        change24hPct: Number(btc.change24h.toFixed(3)),
        trend15m: btc.t15.bullish ? 'BULLISH' : btc.t15.bearish ? 'BEARISH' : 'MIXED',
        trend1h: btc.t1h.bullish ? 'BULLISH' : btc.t1h.bearish ? 'BEARISH' : 'MIXED',
        trend4h: btc.t4h.bullish ? 'BULLISH' : btc.t4h.bearish ? 'BEARISH' : 'MIXED',
        rsi15m: Number(btc.t15.rsi.toFixed(2)),
        volumeRatio15m: Number(btc.t15.volumeRatio.toFixed(3)),
        openInterestChangePct: Number(btc.oiPct.toFixed(3)),
        fundingRatePct: Number(btc.fundingRate.toFixed(5))
      }
    : null;

  for (const r of allResults) {
    r.btcContext = btcContext;
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
      if (b.t15.volumeRatio !== a.t15.volumeRatio) {
        return b.t15.volumeRatio - a.t15.volumeRatio;
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
        volumeRatio: r.t15.volumeRatio,
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
      preCandidateMinScore,
      closedCandlePolicy: true,
      nearApproved: rejected.filter(r => r.nearApproved),
      preCandidates: preCandidates.map(r => ({
        symbol: r.symbol,
        exchange: r.exchange,
        side: r.side,
        score: r.score,
        volumeRatio: r.t15.volumeRatio,
        oiPct: r.oiPct,
        quoteVolume: r.quoteVolume,
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
    `💪 Força: <b>${signalStrength(s.score)}</b>\n` +
    `🔎 Confirmação: <b>${s.confirmation.label}</b>\n` +
    (s.ai
      ? `🤖 IA: <b>${s.ai.decision}</b> · Confiança ${Math.round(s.ai.confidence)}% · ` +
        `${s.ai.style} · Risco ${s.ai.risk}\n` +
        `🧠 IA: ${s.ai.reason}\n`
      : '') +
    `\n` +

    `💰 Entrada: <b>${n(s.entry)}</b>\n` +
    `🛑 Stop: <b>${n(s.stop)}</b>\n` +
    `📐 Stop: ${stopPct.toFixed(2)}% do preço\n\n` +

    `🎯 TP1: ${n(s.tp1)} — 1:${rr1.toFixed(1)}\n` +
    `🎯 TP2: ${n(s.tp2)} — 1:${rr2.toFixed(1)}\n` +
    `🎯 TP3: ${n(s.tp3)} — 1:${rr3.toFixed(1)}\n\n` +

    `📊 RSI 15m: ${s.t15.rsi.toFixed(1)} | ` +
    `Vol: ${s.t15.volumeRatio.toFixed(2)}x\n` +

    `📈 OI: ${s.oiPct >= 0 ? '+' : ''}${s.oiPct.toFixed(2)}% | ` +
    `Funding: ${s.fundingRate.toFixed(4)}%\n\n` +

    `🧠 ${s.reasons.slice(0, 4).join(' • ')}\n\n` +

    `<i>V1.3.5: candles fechados + IA + watchlist + pendência técnica visível. ` +
    `Futuros envolvem risco elevado e liquidação.</i>`
  );
}
