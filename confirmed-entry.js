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

function oiClassForSide(side, oiContext = null) {
  const dir = String(side || '').toUpperCase();
  const regime = String(oiContext?.regime || 'NEUTRAL').toUpperCase();

  if (oiContext?.confirmed === true) {
    return {
      level: 'FAVORABLE',
      regime,
      reason: 'OI confirmou a direção'
    };
  }

  const neutral = new Set([
    'NEUTRAL',
    'OI_BUILDUP_NEUTRAL_PRICE',
    'OI_UNWIND_NEUTRAL_PRICE'
  ]);

  if (neutral.has(regime)) {
    return {
      level: 'NEUTRAL',
      regime,
      reason: 'OI sem confirmação, mas também sem oposição direcional clara'
    };
  }

  if (dir === 'LONG') {
    if (regime === 'SHORT_COVERING') {
      return {
        level: 'SUPPORTIVE',
        regime,
        reason: 'short covering favorece a continuação LONG, embora sem novo OI comprador'
      };
    }

    if (
      regime === 'SHORT_BUILDUP' ||
      regime === 'LONG_UNWIND'
    ) {
      return {
        level: 'CONTRARY',
        regime,
        reason: `${regime} é contrário ao LONG`
      };
    }
  }

  if (dir === 'SHORT') {
    if (regime === 'LONG_UNWIND') {
      return {
        level: 'SUPPORTIVE',
        regime,
        reason: 'long unwind favorece a continuação SHORT, embora sem novo OI vendedor'
      };
    }

    if (
      regime === 'LONG_BUILDUP' ||
      regime === 'SHORT_COVERING'
    ) {
      return {
        level: 'CONTRARY',
        regime,
        reason: `${regime} é contrário ao SHORT`
      };
    }
  }

  return {
    level: 'NEUTRAL',
    regime,
    reason: 'OI sem leitura direcional conclusiva'
  };
}

function cancellationBucket(code = 'OTHER') {
  const key = String(code || 'OTHER').toUpperCase();
  const labels = {
    OI_CONTRARY: 'OI contrário',
    NO_CONFIRMATION: 'sem confirmação em 2 candles',
    EXHAUSTION: 'Trend Exhaustion',
    REGIME: 'regime',
    STRUCTURE_4H: '4H',
    BTC: 'BTC',
    ANTI_CHASE: 'anti-chase',
    CHASE: 'chase',
    EXCURSION: 'excursão contrária',
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
    maxWaitBars = 2,
    minVolumeRatio = 0.55,
    volumeResumeMultiplier = 1.05,
    maxChaseAtr = 0.90,
    maxOppositeExcursionAtr = 0.55,
    requireTrend = true,
    require4h = true,
    requireOi = true,
    requireBtc = true,
    requireExhaustionOk = true,
    smartOiEnabled = true,
    allowSupportiveOi = true,
    allowNeutralOi = true,
    neutralOiMinVolumeRatio = 0.70,
    neutralOiRequireMacd = true
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
    this.smartOiEnabled = Boolean(smartOiEnabled);
    this.allowSupportiveOi = Boolean(allowSupportiveOi);
    this.allowNeutralOi = Boolean(allowNeutralOi);
    this.neutralOiMinVolumeRatio = Math.max(
      this.minVolumeRatio,
      Number(neutralOiMinVolumeRatio || 0.70)
    );
    this.neutralOiRequireMacd = Boolean(neutralOiRequireMacd);
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
    this.stats = {
      armedCreated: 0,
      confirmed: 0,
      canceled: 0,
      extended: 0,
      cancelReasons: {}
    };
  }

  recordCancel(code = 'OTHER') {
    const bucket = cancellationBucket(code);
    this.stats.canceled += 1;
    this.stats.cancelReasons[bucket] =
      Number(this.stats.cancelReasons[bucket] || 0) + 1;
  }

  statsSnapshot() {
    const created = Number(this.stats.armedCreated || 0);
    const confirmed = Number(this.stats.confirmed || 0);
    const canceled = Number(this.stats.canceled || 0);
    const resolved = confirmed + canceled;

    return {
      ...this.stats,
      created,
      resolved,
      conversionPct:
        resolved > 0
          ? confirmed / resolved * 100
          : 0,
      pending: this.armed.size
    };
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
      barsObserved: 0,
      lastWaitReason: null,
      lastOiClass: null,
      status: 'ARMED'
    };

    this.armed.set(key, item);
    this.stats.armedCreated += 1;

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
      `⏳ Janela inteligente: até ${this.maxWaitBars} candles 5m FECHADOS para confirmar. ` +
      `OI neutro/suporte não cancela sozinho; OI realmente contrário cancela. ` +
      `Nenhuma nova chamada de IA enquanto estiver ARMED.`
    );
  }

  statusText() {
    const stats = this.statsSnapshot();
    const reasonEntries = Object.entries(
      stats.cancelReasons || {}
    ).sort((a, b) => b[1] - a[1]);

    const statsLines = [
      `📊 Desde o deploy: ${stats.created} ARMED · ${stats.confirmed} confirmados · ${stats.canceled} cancelados · ${stats.pending} aguardando`,
      `🎯 Conversão resolvida ARMED→TRADE: ${stats.conversionPct.toFixed(1)}% · extensões para 2º candle: ${Number(stats.extended || 0)}`
    ];

    if (reasonEntries.length) {
      statsLines.push(
        `🧾 Cancelamentos: ` +
        reasonEntries
          .slice(0, 6)
          .map(([name, count]) => `${name} ${count}`)
          .join(' · ')
      );
    }

    if (!this.armed.size) {
      return (
        '🟠 <b>CONFIRMED ENTRY — SMART ARMED</b>\n' +
        `Nenhum setup aguardando confirmação agora.\n` +
        statsLines.join('\n')
      );
    }

    const lines = [
      `🟠 <b>CONFIRMED ENTRY — SMART ARMED</b> · ${this.armed.size}`,
      `<i>IA já aprovada. A janela agora aceita até ${this.maxWaitBars} candles 5m sem repetir IA.</i>`,
      ...statsLines,
      ''
    ];

    for (const item of this.list().slice(0, 10)) {
      const s = item.signal;
      const side = String(s?.side || '').toUpperCase();
      lines.push(
        `• ${s.symbol} ${side} · score ${Math.round(item.score)} · IA ${Math.round(item.aiConfidence)}% · ` +
        `${side === 'LONG' ? '>' : '<'} ${side === 'LONG' ? item.triggerHigh : item.triggerLow} · ` +
        `barra ${Math.min(this.maxWaitBars, Number(item.barsObserved || 0) + 1)}/${this.maxWaitBars}` +
        `${item.lastOiClass ? ` · OI ${item.lastOiClass}` : ''}` +
        `${item.lastWaitReason ? ` · ${item.lastWaitReason}` : ''}`
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
        this.recordCancel('EXPIRED');
        invalidated.push({
          item,
          reason:
            `o scanner perdeu a janela de ${this.maxWaitBars} candles 5m; setup expirado`
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

      const invalidate = (reason, code = 'OTHER') => {
        this.armed.delete(key);
        this.lastResolvedBar.set(
          key,
          currentBarTime
        );
        this.recordCancel(code);
        invalidated.push({
          item,
          snapshot: snap,
          reason
        });
      };

      const barNumber =
        Math.max(
          1,
          Math.round(
            (
              currentBarTime -
              item.triggerBarTime
            ) /
            M5_MS
          )
        );

      item.barsObserved =
        Math.max(
          Number(item.barsObserved || 0),
          barNumber
        );

      const lastAllowedBar =
        currentBarTime >=
        item.expiresAfterBarTime;

      const softWait = reason => {
        item.lastWaitReason = reason;
        if (!item.extendedOnce) {
          item.extendedOnce = true;
          this.stats.extended += 1;
        }
        waiting.push(item);
      };

      if (
        currentSide &&
        currentSide !== side
      ) {
        invalidate(`direção técnica virou para ${currentSide}`, 'DIRECTION');
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
        invalidate(`regime saiu de TREND/EXPANSION para ${snap?.marketRegime?.regime || 'UNKNOWN'}`, 'REGIME');
        continue;
      }

      if (
        this.require4h &&
        snap?.marketRegime?.aligned4h !== true
      ) {
        invalidate('4H deixou de confirmar a direção', 'STRUCTURE_4H');
        continue;
      }

      if (
        this.requireExhaustionOk &&
        snap?.trendExhaustion?.ok === false
      ) {
        invalidate(`Trend Exhaustion Guard: ${snap?.trendExhaustion?.reason || 'tendência esticada'}`, 'EXHAUSTION');
        continue;
      }

      const oiClass =
        oiClassForSide(
          side,
          snap?.oiContext
        );

      item.lastOiClass =
        oiClass.level;

      if (
        this.requireOi &&
        !this.smartOiEnabled &&
        snap?.oiContext?.confirmed === false
      ) {
        invalidate(
          `OI contextual perdeu confirmação (${snap?.oiContext?.regime || 'neutro'})`,
          'OI_CONTRARY'
        );
        continue;
      }

      if (
        this.requireOi &&
        this.smartOiEnabled
      ) {
        if (
          oiClass.level ===
          'CONTRARY'
        ) {
          invalidate(
            `OI realmente contrário ao ${side}: ${oiClass.regime}`,
            'OI_CONTRARY'
          );
          continue;
        }

        if (
          oiClass.level ===
            'SUPPORTIVE' &&
          !this.allowSupportiveOi
        ) {
          invalidate(
            `OI de suporte não permitido (${oiClass.regime})`,
            'OI_CONTRARY'
          );
          continue;
        }

        if (
          oiClass.level ===
            'NEUTRAL' &&
          !this.allowNeutralOi
        ) {
          invalidate(
            `OI neutro não permitido (${oiClass.regime})`,
            'OI_CONTRARY'
          );
          continue;
        }
      }

      if (
        this.requireBtc &&
        snap?.btcRegime?.ok === false
      ) {
        invalidate('regime BTC ficou contrário', 'BTC');
        continue;
      }

      if (snap?.antiChase?.ok === false) {
        invalidate(`anti-chase bloqueou: ${snap?.antiChase?.reason || 'movimento esticado'}`, 'ANTI_CHASE');
        continue;
      }

      const chaseAtr =
        atr > 0
          ? Math.abs(close - item.triggerClose) / atr
          : 99;

      if (chaseAtr > this.maxChaseAtr) {
        invalidate(`confirmação chegou esticada (${chaseAtr.toFixed(2)} ATR do trigger)`, 'CHASE');
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
        invalidate(`candle confirmou depois de excursionar ${oppositeExcursionAtr.toFixed(2)} ATR contra o setup`, 'EXCURSION');
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

      const macdAligned =
        snap?.momentum?.macdOk === true ||
        (
          side === 'LONG'
            ? finiteNumber(snap?.t5?.macdHist, 0) > 0
            : finiteNumber(snap?.t5?.macdHist, 0) < 0
        );

      const neutralOiStrongEnough =
        oiClass.level !== 'NEUTRAL' ||
        (
          volumeRatio >=
            this.neutralOiMinVolumeRatio &&
          (
            !this.neutralOiRequireMacd ||
            macdAligned
          )
        );

      const confirmationFailures = [];

      if (!breakoutConfirmed) {
        confirmationFailures.push(
          side === 'LONG'
            ? `fechou ${close} sem superar ${item.triggerHigh}`
            : `fechou ${close} sem perder ${item.triggerLow}`
        );
      }

      if (!directionalClose) {
        confirmationFailures.push(
          'fechamento não direcional'
        );
      }

      if (!volumeFloorOk) {
        confirmationFailures.push(
          `volume ${volumeRatio.toFixed(2)}x < ${this.minVolumeRatio.toFixed(2)}x`
        );
      }

      if (!volumeVsPullbackOk) {
        confirmationFailures.push(
          `volume não retomou ${this.volumeResumeMultiplier.toFixed(2)}x sobre o pullback`
        );
      }

      if (!neutralOiStrongEnough) {
        confirmationFailures.push(
          `OI ${oiClass.regime} exige volume >= ${this.neutralOiMinVolumeRatio.toFixed(2)}x` +
          `${this.neutralOiRequireMacd ? ' + MACD alinhado' : ''}`
        );
      }

      if (confirmationFailures.length) {
        if (!lastAllowedBar) {
          softWait(
            `1º candle não confirmou: ${confirmationFailures.join(' · ')}; aguarda o 2º`
          );
          continue;
        }

        invalidate(
          `janela de ${this.maxWaitBars} candles terminou sem confirmação: ` +
          confirmationFailures.join(' · '),
          'NO_CONFIRMATION'
        );
        continue;
      }

      const levels = confirmationLevels(snap, item);

      if (!levels) {
        invalidate('níveis de stop/TP ficaram incoerentes após a confirmação', 'LEVELS');
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
          smartOiClass:
            oiClass.level === 'NEUTRAL'
              ? 'NEUTRAL_STRONG'
              : oiClass.level,
          smartOiRegime:
            oiClass.regime,
          smartOiAccepted:
            oiClass.level !== 'CONTRARY',
          confirmationBarNumber:
            barNumber,
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

      this.stats.confirmed += 1;

      confirmed.push({
        item,
        snapshot: snap,
        signal: confirmedSignal,
        message:
          `✅ <b>CONFIRMED ENTRY — ${confirmedSignal.symbol} ${side}</b>\n` +
          `Candle ${barNumber}/${this.maxWaitBars} confirmou o setup.\n` +
          `${side === 'LONG' ? 'Fechou acima da máxima gatilho' : 'Fechou abaixo da mínima gatilho'}: ${close}\n` +
          `📊 Volume ${volumeRatio.toFixed(2)}x · chase ${chaseAtr.toFixed(2)} ATR · OI ${oiClass.level} (${oiClass.regime})\n` +
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
