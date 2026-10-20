/**
 * CONFIRMED-ENTRY.JS — V2.0 OTIMIZADO
 * Confirmação em 2 etapas com proteção anti-compra de topo.
 * Em vez de comprar a mercado no fechamento da vela de rompimento (máxima do candle),
 * aguarda o micro-reteste saudável da máxima anterior ou da EMA20, evitando stops imediatos.
 */

const M5_MS = 5 * 60 * 1000;

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function keyOf(signal) {
  return (
    `${String(signal?.symbol || '').toUpperCase()}:` +
    `${String(signal?.side || '').toUpperCase()}`
  );
}

function baseOf(symbol) {
  return String(symbol || '')
    .toUpperCase()
    .replace(/[-_/]/g, '')
    .replace(/USDT.*$/, '')
    .replace(/PERP.*$/, '');
}

function cancellationBucket(code = 'OTHER') {
  const key = String(code || 'OTHER').toUpperCase();
  const labels = {
    OI_CONTRARY: 'OI contrário',
    NO_CONFIRMATION: 'sem confirmação na janela FAST ENTRY',
    EXHAUSTION: 'Trend Exhaustion',
    REGIME: 'regime',
    STRUCTURE_4H: '4H',
    BTC: 'BTC contrário',
    ANTI_CHASE: 'anti-chase',
    CHASE: 'chase / vela esticada',
    EXCURSION: 'excursão contrária excessiva',
    DIRECTION: 'direção virou',
    EXPIRED: 'janela perdida',
    LEVELS: 'níveis',
    OTHER: 'outros'
  };
  return labels[key] || labels.OTHER;
}

function snapshotMatches(armed, snapshot) {
  const armedSymbol = String(armed?.signal?.symbol || '').toUpperCase();
  const armedData = String(armed?.signal?.dataSymbol || '').toUpperCase();
  const snapSymbol = String(snapshot?.symbol || '').toUpperCase();
  const snapData = String(snapshot?.dataSymbol || '').toUpperCase();

  return (
    armedSymbol === snapSymbol ||
    armedSymbol === snapData ||
    armedData === snapSymbol ||
    armedData === snapData
  );
}

function cloneSignal(signal) {
  return {
    ...signal,
    ai: signal?.ai ? { ...signal.ai } : null,
    t5: signal?.t5 ? { ...signal.t5 } : null,
    t15: signal?.t15 ? { ...signal.t15 } : null,
    t1h: signal?.t1h ? { ...signal.t1h } : null,
    t4h: signal?.t4h ? { ...signal.t4h } : null,
    pullback: signal?.pullback ? { ...signal.pullback } : null,
    marketRegime: signal?.marketRegime ? { ...signal.marketRegime } : null,
    trendExhaustion: signal?.trendExhaustion ? { ...signal.trendExhaustion } : null,
    oiContext: signal?.oiContext ? { ...signal.oiContext } : null,
    momentum: signal?.momentum ? { ...signal.momentum } : null,
    antiChase: signal?.antiChase ? { ...signal.antiChase } : null,
    btcRegime: signal?.btcRegime ? { ...signal.btcRegime } : null
  };
}

function confirmationLevels(snapshot, armed) {
  const side = String(armed?.signal?.side || '').toUpperCase();
  const isLong = side === 'LONG';

  const triggerClose = finiteNumber(armed.triggerClose);
  const triggerHigh = finiteNumber(armed.triggerHigh);
  const triggerLow = finiteNumber(armed.triggerLow);
  const atr = Math.max(finiteNumber(snapshot?.t5?.atr, 0), armed.triggerAtr);

  const candleClose = finiteNumber(snapshot?.t5?.price, finiteNumber(snapshot?.entry));
  const candleLow = finiteNumber(snapshot?.t5?.low, candleClose);
  const candleHigh = finiteNumber(snapshot?.t5?.high, candleClose);

  // OTIMIZAÇÃO DE ENTRADA:
  // Se o candle rompeu e já fez o reteste do topo anterior (low <= triggerHigh),
  // assumimos o preço favorável de reteste em vez de comprar na máxima fechada.
  let optimalEntry = candleClose;
  if (isLong && candleLow <= triggerHigh + atr * 0.15) {
    optimalEntry = Math.max(candleLow, triggerHigh);
  } else if (!isLong && candleHigh >= triggerLow - atr * 0.15) {
    optimalEntry = Math.min(candleHigh, triggerLow);
  }

  // STOP ESTRUTURAL:
  // Protegido abaixo do fundo do candle gatilho + 0.25 ATR
  const structuralStop = isLong
    ? triggerLow - (atr * 0.25)
    : triggerHigh + (atr * 0.25);

  const stop = structuralStop > 0 ? structuralStop : finiteNumber(snapshot?.stop, armed.signal?.stop);
  const freshRisk = Math.abs(optimalEntry - stop);

  if (
    !Number.isFinite(optimalEntry) ||
    optimalEntry <= 0 ||
    !Number.isFinite(stop) ||
    stop <= 0 ||
    freshRisk <= 0
  ) {
    return null;
  }

  if (isLong && stop >= optimalEntry) return null;
  if (!isLong && stop <= optimalEntry) return null;

  const sign = isLong ? 1 : -1;

  return {
    entry: optimalEntry,
    stop,
    tp1: optimalEntry + sign * freshRisk * 1.20,
    tp2: optimalEntry + sign * freshRisk * 1.60,
    tp3: optimalEntry + sign * freshRisk * 2.20
  };
}

export class ConfirmedEntryManager {
  constructor({
    enabled = true,
    pullbackOnly = true,
    maxWaitBars = 2,
    minVolumeRatio = 0.90,
    volumeResumeMultiplier = 1.00,
    maxChaseAtr = 0.70,
    maxOppositeExcursionAtr = 0.50,
    requireTrend = true,
    require4h = false,
    requireOi = true,
    requireBtc = true,
    requireExhaustionOk = true,
    smartOiEnabled = true,
    allowSupportiveOi = true,
    allowNeutralOi = true,
    neutralOiMinVolumeRatio = 0,
    neutralOiRequireMacd = false,
    strongOiContraryPct = 0.35
  } = {}) {
    this.enabled = enabled;
    this.pullbackOnly = pullbackOnly;
    this.maxWaitBars = Math.max(1, Math.min(4, Number(maxWaitBars || 2)));
    this.minVolumeRatio = Math.max(0.2, Number(minVolumeRatio || 0.90));
    this.volumeResumeMultiplier = Math.max(0.5, Number(volumeResumeMultiplier || 1.00));
    this.maxChaseAtr = Math.max(0.2, Number(maxChaseAtr || 0.70));
    this.maxOppositeExcursionAtr = Math.max(0.1, Number(maxOppositeExcursionAtr || 0.50));
    this.requireTrend = Boolean(requireTrend);
    this.require4h = Boolean(require4h);
    this.requireOi = Boolean(requireOi);
    this.requireBtc = Boolean(requireBtc);
    this.requireExhaustionOk = Boolean(requireExhaustionOk);
    this.smartOiEnabled = Boolean(smartOiEnabled);
    this.allowSupportiveOi = Boolean(allowSupportiveOi);
    this.allowNeutralOi = Boolean(allowNeutralOi);
    this.neutralOiMinVolumeRatio = Math.max(0, Number(neutralOiMinVolumeRatio || 0));
    this.neutralOiRequireMacd = Boolean(neutralOiRequireMacd);
    this.strongOiContraryPct = Math.max(0.05, Number(strongOiContraryPct || 0.35));
    this.armed = new Map();
    this.lastResolvedBar = new Map();
    this.stats = {
      armedCreated: 0,
      confirmed: 0,
      canceled: 0,
      extended: 0,
      cancelReasons: {}
    };
  }

  shouldArm(signal) {
    if (!this.enabled) return false;
    if (this.pullbackOnly && String(signal?.entryMode || '').toUpperCase() !== 'PULLBACK') {
      return false;
    }
    return true;
  }

  key(signal) {
    return keyOf(signal);
  }

  isArmed(signal) {
    return this.armed.has(keyOf(signal));
  }

  shouldSkipAi(signal) {
    const key = keyOf(signal);
    if (this.armed.has(key)) return true;

    const resolvedBar = finiteNumber(this.lastResolvedBar.get(key), 0);
    const signalBar = finiteNumber(signal?.t5?.openTime, 0);

    if (resolvedBar > 0 && signalBar > resolvedBar) {
      this.lastResolvedBar.delete(key);
      return false;
    }

    return resolvedBar > 0 && signalBar > 0 && signalBar <= resolvedBar;
  }

  size() {
    return this.armed.size;
  }

  bases() {
    const values = [];
    for (const item of this.armed.values()) {
      const base = baseOf(item?.signal?.symbol || item?.signal?.dataSymbol);
      if (base) values.push(base);
    }
    return [...new Set(values)];
  }

  list() {
    return [...this.armed.values()]
      .sort((a, b) => b.armedAt - a.armedAt)
      .map(item => ({ ...item }));
  }

  clear() {
    this.armed.clear();
    this.lastResolvedBar.clear();
  }

  recordCancel(code = 'OTHER') {
    const bucket = cancellationBucket(code);
    this.stats.canceled += 1;
    this.stats.cancelReasons[bucket] = Number(this.stats.cancelReasons[bucket] || 0) + 1;
  }

  arm(signal) {
    if (!this.shouldArm(signal)) {
      return { armed: false, reason: 'confirmed entry não se aplica a este setup' };
    }

    const triggerBarTime = finiteNumber(signal?.t5?.openTime, 0);
    const triggerHigh = finiteNumber(signal?.t5?.high, NaN);
    const triggerLow = finiteNumber(signal?.t5?.low, NaN);
    const triggerClose = finiteNumber(signal?.t5?.price, finiteNumber(signal?.entry, NaN));
    const triggerOpen = finiteNumber(signal?.t5?.open, triggerClose);
    const atr = Math.max(
      finiteNumber(signal?.t5?.atr, 0),
      triggerClose > 0 ? triggerClose * 0.001 : 0
    );

    if (
      !triggerBarTime ||
      !Number.isFinite(triggerHigh) ||
      !Number.isFinite(triggerLow) ||
      !Number.isFinite(triggerClose) ||
      triggerClose <= 0 ||
      atr <= 0
    ) {
      return { armed: false, reason: 'candle gatilho inválido para ARMED' };
    }

    const key = keyOf(signal);
    const resolvedBar = finiteNumber(this.lastResolvedBar.get(key), 0);

    if (resolvedBar > 0 && triggerBarTime <= resolvedBar) {
      return { armed: false, reason: 'este candle já encerrou um ciclo ARMED; aguarde um novo 5m' };
    }

    for (const [otherKey, other] of this.armed.entries()) {
      if (
        String(other?.signal?.symbol || '').toUpperCase() ===
          String(signal?.symbol || '').toUpperCase() &&
        otherKey !== key
      ) {
        this.armed.delete(otherKey);
      }
    }

    const current = this.armed.get(key);
    if (current && current.triggerBarTime === triggerBarTime) {
      return { armed: true, created: false, item: current, message: this.armMessage(current) };
    }

    const item = {
      key,
      signal: cloneSignal(signal),
      armedAt: Date.now(),
      triggerBarTime,
      expectedConfirmationBarTime: triggerBarTime + M5_MS,
      expiresAfterBarTime: triggerBarTime + M5_MS * this.maxWaitBars,
      triggerOpen,
      triggerHigh,
      triggerLow,
      triggerClose,
      triggerAtr: atr,
      triggerVolumeRatio: finiteNumber(signal?.t5?.volumeRatio, 0),
      aiConfidence: finiteNumber(signal?.ai?.confidence, 0),
      score: finiteNumber(signal?.score, 0),
      barsObserved: 0,
      lastWaitReason: null,
      status: 'ARMED'
    };

    this.armed.set(key, item);
    this.stats.armedCreated += 1;

    return { armed: true, created: true, item, message: this.armMessage(item) };
  }

  armMessage(item) {
    const s = item.signal;
    const side = String(s?.side || '').toUpperCase();
    return (
      `🟠 <b>PAPER ARMED — ${s.symbol} ${side}</b>\n` +
      `Setup aprovado. Aguardando reteste/confirmação inteligente.\n` +
      `⭐ Score ${Math.round(item.score)} · 🤖 IA ${Math.round(item.aiConfidence)}%\n` +
      `🧱 Nível do gatilho: ${side === 'LONG' ? item.triggerHigh : item.triggerLow}\n` +
      `⏳ Janela: até ${this.maxWaitBars} candles de 5m. Entrada otimizada no reteste.`
    );
  }

  statusText() {
    if (!this.armed.size) {
      return '🟠 <b>CONFIRMED ENTRY</b>: Nenhum setup aguardando confirmação no momento.';
    }
    const lines = [`🟠 <b>CONFIRMED ENTRY ARMED (${this.armed.size})</b>`, ''];
    for (const item of this.list().slice(0, 8)) {
      const s = item.signal;
      lines.push(`• ${s.symbol} ${s.side} · Score ${item.score} · Barra ${item.barsObserved + 1}/${this.maxWaitBars}`);
    }
    return lines.join('\n');
  }

  processSnapshots(snapshots = []) {
    const confirmed = [];
    const invalidated = [];
    const waiting = [];

    if (!this.enabled || !this.armed.size) {
      return { confirmed, invalidated, waiting };
    }

    for (const [key, item] of [...this.armed.entries()]) {
      const snap = (snapshots || []).find(s => snapshotMatches(item, s));
      if (!snap) {
        waiting.push(item);
        continue;
      }

      const currentBarTime = finiteNumber(snap?.t5?.openTime, 0);
      if (!currentBarTime || currentBarTime <= item.triggerBarTime) {
        waiting.push(item);
        continue;
      }

      if (currentBarTime > item.expiresAfterBarTime) {
        this.armed.delete(key);
        this.lastResolvedBar.set(key, currentBarTime);
        this.recordCancel('EXPIRED');
        invalidated.push({ item, reason: `janela de ${this.maxWaitBars} candles expirada sem reteste` });
        continue;
      }

      const side = String(item?.signal?.side || '').toUpperCase();
      const isLong = side === 'LONG';
      const close = finiteNumber(snap?.t5?.price, NaN);
      const high = finiteNumber(snap?.t5?.high, close);
      const low = finiteNumber(snap?.t5?.low, close);
      const atr = Math.max(finiteNumber(snap?.t5?.atr, 0), item.triggerAtr);

      const invalidate = (reason, code = 'OTHER') => {
        this.armed.delete(key);
        this.lastResolvedBar.set(key, currentBarTime);
        this.recordCancel(code);
        invalidated.push({ item, snapshot: snap, reason });
      };

      if (snap?.side && String(snap.side).toUpperCase() !== side) {
        invalidate(`direção técnica virou para ${snap.side}`, 'DIRECTION');
        continue;
      }

      const chaseAtr = atr > 0 ? Math.abs(close - item.triggerClose) / atr : 99;
      if (chaseAtr > this.maxChaseAtr) {
        invalidate(`movimento muito esticado (${chaseAtr.toFixed(2)} ATR > ${this.maxChaseAtr} ATR)`, 'CHASE');
        continue;
      }

      const breakoutOrRetest = isLong
        ? (close >= item.triggerHigh || high >= item.triggerHigh)
        : (close <= item.triggerLow || low <= item.triggerLow);

      if (!breakoutOrRetest) {
        waiting.push(item);
        continue;
      }

      const volumeRatio = finiteNumber(snap?.t5?.volumeRatio, 0);
      if (volumeRatio < this.minVolumeRatio) {
        waiting.push(item);
        continue;
      }

      const levels = confirmationLevels(snap, item);
      if (!levels) {
        invalidate('níveis de stop/alvo incoerentes', 'LEVELS');
        continue;
      }

      const confirmedSignal = {
        ...item.signal,
        ...snap,
        ...levels,
        ai: item.signal.ai,
        entryMode: 'PULLBACK_RETEST',
        t5: { ...snap.t5 },
        pullback: {
          ...item.signal.pullback,
          confirmed: true,
          strongTrigger: true,
          confirmedEntry: true,
          confirmationBarTime: currentBarTime
        },
        confirmedEntry: {
          armedAt: item.armedAt,
          confirmationBarTime: currentBarTime,
          triggerHigh: item.triggerHigh,
          triggerLow: item.triggerLow,
          triggerClose: item.triggerClose,
          confirmationClose: levels.entry,
          confirmationVolumeRatio: volumeRatio,
          chaseAtr,
          retestExecuted: true
        }
      };

      this.armed.delete(key);
      this.lastResolvedBar.set(key, currentBarTime);
      this.stats.confirmed += 1;

      confirmed.push({
        item,
        snapshot: snap,
        signal: confirmedSignal,
        message:
          `✅ <b>CONFIRMED RETEST ENTRY — ${confirmedSignal.symbol} ${side}</b>\n` +
          `Entrada executada no reteste estrutural: <b>${levels.entry.toFixed(4)}</b>\n` +
          `🛑 Stop Estrutural: <b>${levels.stop.toFixed(4)}</b> | 🎯 TP1: ${levels.tp1.toFixed(4)}\n` +
          `📊 Volume ${volumeRatio.toFixed(2)}x · Chase controlado ${chaseAtr.toFixed(2)} ATR`
      });
    }

    return { confirmed, invalidated, waiting };
  }
}