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
  const entry = finiteNumber(snapshot?.t5?.price, finiteNumber(snapshot?.entry));
  const stop = finiteNumber(snapshot?.stop, finiteNumber(armed?.signal?.stop));

  const side = String(armed?.signal?.side || '').toUpperCase();

  const originalEntry = finiteNumber(armed?.signal?.entry, entry);
  const originalStop = finiteNumber(armed?.signal?.stop, stop);
  const originalRisk = Math.abs(originalEntry - originalStop);

  const defaultR = {
    tp1: 0.90,
    tp2: 1.40,
    tp3: 2.10
  };

  const ratio = (target, fallback) => {
    if (originalRisk <= 0) return fallback;
    const t = finiteNumber(target, NaN);
    if (!Number.isFinite(t)) return fallback;
    return Math.abs(t - originalEntry) / originalRisk;
  };

  const r1 = ratio(armed?.signal?.tp1, defaultR.tp1);
  const r2 = ratio(armed?.signal?.tp2, defaultR.tp2);
  const r3 = ratio(armed?.signal?.tp3, defaultR.tp3);

  const freshRisk = Math.abs(entry - stop);

  if (
    !Number.isFinite(entry) ||
    entry <= 0 ||
    !Number.isFinite(stop) ||
    stop <= 0 ||
    freshRisk <= 0
  ) {
    return null;
  }

  if (side === 'LONG' && stop >= entry) return null;
  if (side === 'SHORT' && stop <= entry) return null;

  const sign = side === 'SHORT' ? -1 : 1;

  return {
    entry,
    stop,
    tp1: entry + sign * freshRisk * r1,
    tp2: entry + sign * freshRisk * r2,
    tp3: entry + sign * freshRisk * r3
  };
}

export class ConfirmedEntryManager {
  constructor({
    enabled = true,
    pullbackOnly = true,
    maxWaitBars = 1,
    minVolumeRatio = 0.55,
    volumeResumeMultiplier = 1.05,
    maxChaseAtr = 0.90,
    maxOppositeExcursionAtr = 0.55,
    requireTrend = true,
    require4h = true,
    requireOi = true,
    requireBtc = true,
    requireExhaustionOk = true
  } = {}) {
    this.enabled = enabled;
    this.pullbackOnly = pullbackOnly;
    this.maxWaitBars = Math.max(1, Math.min(3, Number(maxWaitBars || 1)));
    this.minVolumeRatio = Math.max(0.2, Number(minVolumeRatio || 0.55));
    this.volumeResumeMultiplier = Math.max(0.5, Number(volumeResumeMultiplier || 1.05));
    this.maxChaseAtr = Math.max(0.2, Number(maxChaseAtr || 0.90));
    this.maxOppositeExcursionAtr = Math.max(0.1, Number(maxOppositeExcursionAtr || 0.55));
    this.requireTrend = Boolean(requireTrend);
    this.require4h = Boolean(require4h);
    this.requireOi = Boolean(requireOi);
    this.requireBtc = Boolean(requireBtc);
    this.requireExhaustionOk = Boolean(requireExhaustionOk);
    this.armed = new Map();
    this.lastResolvedBar = new Map();
  }

  shouldArm(signal) {
    if (!this.enabled) return false;

    if (
      this.pullbackOnly &&
      String(signal?.entryMode || '').toUpperCase() !== 'PULLBACK'
    ) {
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

    if (this.armed.has(key)) {
      return true;
    }

    const resolvedBar =
      finiteNumber(
        this.lastResolvedBar.get(key),
        0
      );

    const signalBar =
      finiteNumber(
        signal?.t5?.openTime,
        0
      );

    if (
      resolvedBar > 0 &&
      signalBar > resolvedBar
    ) {
      this.lastResolvedBar.delete(key);
      return false;
    }

    return (
      resolvedBar > 0 &&
      signalBar > 0 &&
      signalBar <= resolvedBar
    );
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

  arm(signal) {
    if (!this.shouldArm(signal)) {
      return {
        armed: false,
        reason: 'confirmed entry não se aplica a este setup'
      };
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
      return {
        armed: false,
        reason: 'candle gatilho inválido para ARMED'
      };
    }

    const key = keyOf(signal);

    const resolvedBar =
      finiteNumber(
        this.lastResolvedBar.get(key),
        0
      );

    if (
      resolvedBar > 0 &&
      triggerBarTime <= resolvedBar
    ) {
      return {
        armed: false,
        reason: 'este candle já encerrou um ciclo ARMED; aguarde um novo 5m'
      };
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

    if (
      current &&
      current.triggerBarTime === triggerBarTime
    ) {
      return {
        armed: true,
        created: false,
        item: current,
        message: this.armMessage(current)
      };
    }

    const item = {
      key,
      signal: cloneSignal(signal),
      armedAt: Date.now(),
      triggerBarTime,
      expectedConfirmationBarTime:
        triggerBarTime + M5_MS,
      expiresAfterBarTime:
        triggerBarTime + M5_MS * this.maxWaitBars,
      triggerOpen,
      triggerHigh,
      triggerLow,
      triggerClose,
      triggerAtr: atr,
      triggerVolumeRatio:
        finiteNumber(signal?.t5?.volumeRatio, 0),
      triggerQuoteVolume:
        finiteNumber(signal?.t5?.quoteVolume, 0),
      pullbackAvgQuoteVolume:
        finiteNumber(signal?.pullback?.pullbackAvgQuoteVolume, 0),
      pullbackAvgVolumeRatio:
        finiteNumber(signal?.pullback?.pullbackAvgVolumeRatio, 0),
      aiConfidence:
        finiteNumber(signal?.ai?.confidence, 0),
      score:
        finiteNumber(signal?.score, 0),
      status: 'ARMED'
    };

    this.armed.set(key, item);

    return {
      armed: true,
      created: true,
      item,
      message: this.armMessage(item)
    };
  }

  armMessage(item) {
    const s = item.signal;
    const side = String(s?.side || '').toUpperCase();

    return (
      `🟠 <b>PAPER ARMED — ${s.symbol} ${side}</b>\n` +
      `Setup IA aprovado, mas a entrada ainda NÃO foi aberta.\n` +
      `⭐ Score ${Math.round(item.score)} · 🤖 IA ${Math.round(item.aiConfidence)}%\n` +
      `🌦 Regime ${s?.marketRegime?.regime || '—'} · trigger ${Number(s?.pullback?.triggerQuality || 0)}/5\n` +
      `🧱 Candle gatilho: ${side === 'LONG' ? 'romper/fechar acima de' : 'romper/fechar abaixo de'} ` +
      `${side === 'LONG' ? item.triggerHigh : item.triggerLow}\n` +
      `⏳ Aguarda o próximo candle 5m FECHADO. Nenhuma nova chamada de IA será feita enquanto estiver ARMED.`
    );
  }

  statusText() {
    if (!this.armed.size) {
      return (
        '🟠 <b>CONFIRMED ENTRY — ARMED</b>\n' +
        'Nenhum setup aguardando o segundo candle agora.'
      );
    }

    const lines = [
      `🟠 <b>CONFIRMED ENTRY — ARMED</b> · ${this.armed.size}`,
      '<i>IA já aprovada. Agora só falta o próximo candle 5m confirmar o rompimento.</i>',
      ''
    ];

    for (const item of this.list().slice(0, 10)) {
      const s = item.signal;
      const side = String(s?.side || '').toUpperCase();
      lines.push(
        `• ${s.symbol} ${side} · score ${Math.round(item.score)} · IA ${Math.round(item.aiConfidence)}% · ` +
        `${side === 'LONG' ? '>' : '<'} ${side === 'LONG' ? item.triggerHigh : item.triggerLow}`
      );
    }

    return lines.join('\n');
  }

  processSnapshots(snapshots = []) {
    const confirmed = [];
    const invalidated = [];
    const waiting = [];

    if (!this.enabled || !this.armed.size) {
      return {
        confirmed,
        invalidated,
        waiting
      };
    }

    for (const [key, item] of [...this.armed.entries()]) {
      const snap = (snapshots || []).find(s => snapshotMatches(item, s));

      if (!snap) {
        waiting.push(item);
        continue;
      }

      const currentBarTime = finiteNumber(snap?.t5?.openTime, 0);

      if (
        !currentBarTime ||
        currentBarTime <= item.triggerBarTime
      ) {
        waiting.push(item);
        continue;
      }

      if (
        currentBarTime >
        item.expiresAfterBarTime
      ) {
        this.armed.delete(key);
        this.lastResolvedBar.set(
          key,
          currentBarTime
        );
        invalidated.push({
          item,
          reason:
            'o scanner perdeu a janela do próximo candle 5m; setup expirado'
        });
        continue;
      }

      const side = String(item?.signal?.side || '').toUpperCase();
      const currentSide = String(snap?.side || '').toUpperCase();
      const close = finiteNumber(snap?.t5?.price, NaN);
      const open = finiteNumber(snap?.t5?.open, close);
      const high = finiteNumber(snap?.t5?.high, close);
      const low = finiteNumber(snap?.t5?.low, close);
      const atr = Math.max(
        finiteNumber(snap?.t5?.atr, 0),
        item.triggerAtr,
        close > 0 ? close * 0.001 : 0
      );

      const invalidate = reason => {
        this.armed.delete(key);
        this.lastResolvedBar.set(
          key,
          currentBarTime
        );
        invalidated.push({
          item,
          snapshot: snap,
          reason
        });
      };

      if (
        currentSide &&
        currentSide !== side
      ) {
        invalidate(`direção técnica virou para ${currentSide}`);
        continue;
      }

      const confirmationRegime =
        String(
          snap?.marketRegime?.regime ||
          ''
        ).toUpperCase();

      if (
        this.requireTrend &&
        ![
          'TREND',
          'EXPANSION'
        ].includes(
          confirmationRegime
        )
      ) {
        invalidate(`regime saiu de TREND/EXPANSION para ${snap?.marketRegime?.regime || 'UNKNOWN'}`);
        continue;
      }

      if (
        this.require4h &&
        snap?.marketRegime?.aligned4h !== true
      ) {
        invalidate('4H deixou de confirmar a direção');
        continue;
      }

      if (
        this.requireExhaustionOk &&
        snap?.trendExhaustion?.ok === false
      ) {
        invalidate(`Trend Exhaustion Guard: ${snap?.trendExhaustion?.reason || 'tendência esticada'}`);
        continue;
      }

      if (
        this.requireOi &&
        snap?.oiContext?.confirmed === false
      ) {
        invalidate(`OI contextual perdeu confirmação (${snap?.oiContext?.regime || 'neutro'})`);
        continue;
      }

      if (
        this.requireBtc &&
        snap?.btcRegime?.ok === false
      ) {
        invalidate('regime BTC ficou contrário');
        continue;
      }

      if (snap?.antiChase?.ok === false) {
        invalidate(`anti-chase bloqueou: ${snap?.antiChase?.reason || 'movimento esticado'}`);
        continue;
      }

      const chaseAtr =
        atr > 0
          ? Math.abs(close - item.triggerClose) / atr
          : 99;

      if (chaseAtr > this.maxChaseAtr) {
        invalidate(`confirmação chegou esticada (${chaseAtr.toFixed(2)} ATR do trigger)`);
        continue;
      }

      const oppositeExcursionAtr =
        side === 'LONG'
          ? Math.max(0, item.triggerLow - low) / atr
          : Math.max(0, high - item.triggerHigh) / atr;

      if (
        oppositeExcursionAtr >
        this.maxOppositeExcursionAtr
      ) {
        invalidate(`candle confirmou depois de excursionar ${oppositeExcursionAtr.toFixed(2)} ATR contra o setup`);
        continue;
      }

      const breakoutConfirmed =
        side === 'LONG'
          ? close > item.triggerHigh
          : close < item.triggerLow;

      const directionalClose =
        side === 'LONG'
          ? close > open
          : close < open;

      const volumeRatio = finiteNumber(snap?.t5?.volumeRatio, 0);
      const quoteVolume = finiteNumber(snap?.t5?.quoteVolume, 0);
      const setup = String(item?.signal?.entryMode || 'PULLBACK').toUpperCase();
      const baselineVolume = item.pullbackAvgQuoteVolume;

      const volumeVsPullbackOk =
        setup === 'PULLBACK' &&
        baselineVolume > 0 && quoteVolume > 0
          ? quoteVolume >= baselineVolume * this.volumeResumeMultiplier
          : true;

      const volumeFloorOk =
        volumeRatio >= this.minVolumeRatio;

      if (!breakoutConfirmed) {
        invalidate(
          side === 'LONG'
            ? `próximo 5m fechou em ${close}, sem fechar acima da máxima gatilho ${item.triggerHigh}`
            : `próximo 5m fechou em ${close}, sem fechar abaixo da mínima gatilho ${item.triggerLow}`
        );
        continue;
      }

      if (!directionalClose) {
        invalidate('rompimento sem fechamento direcional');
        continue;
      }

      if (!volumeFloorOk) {
        invalidate(`rompimento sem retomada mínima de volume (${volumeRatio.toFixed(2)}x abaixo de ${this.minVolumeRatio.toFixed(2)}x)`);
        continue;
      }

      if (!volumeVsPullbackOk) {
        invalidate(
          `volume da confirmação não superou o pullback em ${this.volumeResumeMultiplier.toFixed(2)}x`
        );
        continue;
      }

      const levels = confirmationLevels(snap, item);

      if (!levels) {
        invalidate('níveis de stop/TP ficaram incoerentes após a confirmação');
        continue;
      }

      const confirmedSignal = {
        ...item.signal,
        ...snap,
        ...levels,
        ai: item.signal.ai,
        entryMode:
          item.signal.entryMode ||
          'PULLBACK',
        t5: {
          ...snap.t5
        },
        pullback: {
          ...item.signal.pullback,
          ...snap.pullback,
          confirmed: true,
          strongTrigger: true,
          confirmedEntry: true,
          confirmationBarTime: currentBarTime
        },
        // O setup nasceu em TREND. Guardamos esse regime como origem;
        // o candle de confirmação pode naturalmente virar EXPANSION.
        marketRegime: {
          ...item.signal.marketRegime,
          confirmationRegime:
            snap?.marketRegime?.regime ||
            item.signal.marketRegime?.regime ||
            null,
          confirmationReason:
            snap?.marketRegime?.reason ||
            null,
          aligned4h:
            snap?.marketRegime?.aligned4h ??
            item.signal.marketRegime?.aligned4h
        },
        trendExhaustion: {
          ...snap.trendExhaustion
        },
        confirmedEntry: {
          armedAt: item.armedAt,
          triggerBarTime: item.triggerBarTime,
          confirmationBarTime: currentBarTime,
          triggerHigh: item.triggerHigh,
          triggerLow: item.triggerLow,
          triggerClose: item.triggerClose,
          confirmationClose: close,
          confirmationVolumeRatio: volumeRatio,
          confirmationQuoteVolume: quoteVolume,
          pullbackAvgQuoteVolume: baselineVolume,
          chaseAtr,
          originRegime:
            item.signal.marketRegime?.regime ||
            null,
          confirmationRegime:
            snap?.marketRegime?.regime ||
            null,
          noSecondAiCall: true
        }
      };

      this.armed.delete(key);
      this.lastResolvedBar.set(
        key,
        currentBarTime
      );

      confirmed.push({
        item,
        snapshot: snap,
        signal: confirmedSignal,
        message:
          `✅ <b>CONFIRMED ENTRY — ${confirmedSignal.symbol} ${side}</b>\n` +
          `Segundo candle 5m confirmou o setup.\n` +
          `${side === 'LONG' ? 'Fechou acima da máxima gatilho' : 'Fechou abaixo da mínima gatilho'}: ${close}\n` +
          `📊 Volume ${volumeRatio.toFixed(2)}x · chase ${chaseAtr.toFixed(2)} ATR\n` +
          `🤖 IA reaproveitada: ${Math.round(item.aiConfidence)}% · sem nova chamada.`
      });
    }

    return {
      confirmed,
      invalidated,
      waiting
    };
  }
}
