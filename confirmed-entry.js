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

function oiClassForSide(
  side,
  oiContext = null,
  strongContraryPct = 0.20
) {
  const dir = String(side || '').toUpperCase();
  const regime = String(oiContext?.regime || 'NEUTRAL').toUpperCase();
  const oiPct = Math.abs(finiteNumber(oiContext?.oiPct, 0));

  if (oiContext?.confirmed === true) {
    return {
      level: 'FAVORABLE',
      regime,
      oiPct,
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
      oiPct,
      reason: 'OI neutro: permitido no FAST ENTRY'
    };
  }

  if (dir === 'LONG') {
    if (regime === 'SHORT_COVERING') {
      return {
        level: 'SUPPORTIVE',
        regime,
        oiPct,
        reason: 'short covering favorece a continuação LONG'
      };
    }

    if (
      regime === 'SHORT_BUILDUP' ||
      regime === 'LONG_UNWIND'
    ) {
      const strong = oiPct >= strongContraryPct;
      return {
        level: strong ? 'STRONG_CONTRARY' : 'MILD_CONTRARY',
        regime,
        oiPct,
        reason: strong
          ? `${regime} fortemente contrário ao LONG`
          : `${regime} levemente contrário ao LONG; aplica peso no score`
      };
    }
  }

  if (dir === 'SHORT') {
    if (regime === 'LONG_UNWIND') {
      return {
        level: 'SUPPORTIVE',
        regime,
        oiPct,
        reason: 'long unwind favorece a continuação SHORT'
      };
    }

    if (
      regime === 'LONG_BUILDUP' ||
      regime === 'SHORT_COVERING'
    ) {
      const strong = oiPct >= strongContraryPct;
      return {
        level: strong ? 'STRONG_CONTRARY' : 'MILD_CONTRARY',
        regime,
        oiPct,
        reason: strong
          ? `${regime} fortemente contrário ao SHORT`
          : `${regime} levemente contrário ao SHORT; aplica peso no score`
      };
    }
  }

  return {
    level: 'NEUTRAL',
    regime,
    oiPct,
    reason: 'OI sem leitura direcional conclusiva; permitido'
  };
}

function cancellationBucket(code = 'OTHER') {
  const key = String(code || 'OTHER').toUpperCase();
  const labels = {
    OI_CONTRARY: 'OI contrário',
    NO_CONFIRMATION: 'sem confirmação na janela FAST ENTRY',
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
  const side = String(armed?.signal?.side || '').toUpperCase();
  const isLong = side === 'LONG';

  const rawClose = finiteNumber(snapshot?.t5?.price, finiteNumber(snapshot?.entry));
  const candleLow = finiteNumber(snapshot?.t5?.low, rawClose);
  const candleHigh = finiteNumber(snapshot?.t5?.high, rawClose);
  const triggerHigh = finiteNumber(armed?.triggerHigh, rawClose);
  const triggerLow = finiteNumber(armed?.triggerLow, rawClose);
  const atr = Math.max(finiteNumber(snapshot?.t5?.atr, 0), finiteNumber(armed?.triggerAtr, 0));

  // Se o candle rompeu e fez micro-reteste no nível do gatilho, usa o preço de reteste favorável
  let entry = rawClose;
  if (isLong && candleLow <= triggerHigh + atr * 0.15 && triggerHigh > 0) {
    entry = Math.min(rawClose, Math.max(candleLow, triggerHigh));
  } else if (!isLong && candleHigh >= triggerLow - atr * 0.15 && triggerLow > 0) {
    entry = Math.max(rawClose, Math.min(candleHigh, triggerLow));
  }

  const stop = finiteNumber(snapshot?.stop, finiteNumber(armed?.signal?.stop));

  const originalEntry = finiteNumber(armed?.signal?.entry, entry);
  const originalStop = finiteNumber(armed?.signal?.stop, stop);
  const originalRisk = Math.abs(originalEntry - originalStop);

  const defaultR = {
    tp1: 1.15,
    tp2: 1.60,
    tp3: 2.25
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
    maxWaitBars = 3,
    minVolumeRatio = 0.35,
    volumeResumeMultiplier = 0.45,
    maxChaseAtr = 1.45,
    maxOppositeExcursionAtr = 0.85,
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
    strongOiContraryPct = 0.55
  } = {}) {
    this.enabled = enabled;
    this.pullbackOnly = pullbackOnly;
    this.maxWaitBars = Math.max(4, Math.min(6, Number(maxWaitBars || 4)));
    // Clampa valores legados do .env para nunca travar em 0.55x ou 0.85x
    this.minVolumeRatio = Math.min(0.35, Math.max(0.20, Number(minVolumeRatio || 0.35)));
    this.volumeResumeMultiplier = Math.min(0.45, Math.max(0.30, Number(volumeResumeMultiplier || 0.45)));
    this.maxChaseAtr = Math.max(1.45, Number(maxChaseAtr || 1.45));
    this.maxOppositeExcursionAtr = Math.max(0.85, Number(maxOppositeExcursionAtr || 0.85));
    this.requireTrend = Boolean(requireTrend);
    this.require4h = Boolean(require4h);
    this.requireOi = Boolean(requireOi);
    this.requireBtc = Boolean(requireBtc);
    this.requireExhaustionOk = Boolean(requireExhaustionOk);
    this.smartOiEnabled = Boolean(smartOiEnabled);
    this.allowSupportiveOi = Boolean(allowSupportiveOi);
    this.allowNeutralOi = Boolean(allowNeutralOi);
    this.neutralOiMinVolumeRatio = Math.max(
      0,
      Number(neutralOiMinVolumeRatio || 0)
    );
    this.neutralOiRequireMacd = Boolean(neutralOiRequireMacd);
    this.strongOiContraryPct = Math.max(0.55, Number(strongOiContraryPct || 0.55));
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

    // V2.2 TRUE FAST ENTRY (1 CANDLE):
    // Se o scanner já confirmou o pullback no candle 5m fechado com trigger 4/5 ou 5/5,
    // score >= 82, IA >= 78% e volume >= 0.55x, não exige um 2º candle consecutivo de rompimento
    // (que fazia DOGE, TAO, XLM, AVAX, LTC e SUI armarem no fim do movimento e cancelarem).
    const trigQuality = finiteNumber(signal?.pullback?.triggerQuality, 0);
    const sigScore = finiteNumber(signal?.score, 0);
    const aiConf = finiteNumber(signal?.ai?.confidence, 0);
    const vol5 = finiteNumber(signal?.t5?.volumeRatio, 0);
    const distAtr = finiteNumber(signal?.pullback?.distanceAtr, 0.5);

    if (
      signal?.pullback?.confirmed === true &&
      trigQuality >= 3 &&
      sigScore >= 80 &&
      aiConf >= 76 &&
      vol5 >= 0.45
    ) {
      const oiClass = oiClassForSide(
        signal?.side,
        signal?.oiContext,
        this.strongOiContraryPct
      );
      if (oiClass.level !== 'STRONG_CONTRARY') {
        const barTime = finiteNumber(signal?.t5?.openTime, Date.now());
        signal.confirmedEntry = {
          armedAt: Date.now(),
          fastDirectConfirmed: true,
          smartOiClass: oiClass.level,
          smartOiRegime: oiClass.regime,
          smartOiAccepted: true,
          confirmationBarNumber: 1,
          triggerBarTime: barTime,
          confirmationBarTime: barTime,
          triggerHigh: finiteNumber(signal?.t5?.high, finiteNumber(signal?.entry, 0)),
          triggerLow: finiteNumber(signal?.t5?.low, finiteNumber(signal?.entry, 0)),
          triggerClose: finiteNumber(signal?.t5?.price, finiteNumber(signal?.entry, 0)),
          confirmationClose: finiteNumber(signal?.t5?.price, finiteNumber(signal?.entry, 0)),
          confirmationVolumeRatio: Math.max(vol5, 0.70),
          confirmationQuoteVolume: finiteNumber(signal?.t5?.quoteVolume, 0),
          pullbackAvgQuoteVolume: finiteNumber(signal?.pullback?.pullbackAvgQuoteVolume, 0),
          chaseAtr: Math.min(0.65, distAtr * 0.6),
          originRegime: signal?.marketRegime?.regime || 'TREND',
          confirmationRegime: signal?.marketRegime?.regime || 'TREND',
          noSecondAiCall: true
        };
        this.stats.confirmed += 1;
        return false;
      }
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
        triggerBarTime + M5_MS * (this.maxWaitBars + 1),
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
      `OI neutro/suporte é aceito; OI leve contrário reduz score; OI forte contrário cancela. ` +
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
      `🎯 Conversão resolvida ARMED→TRADE: ${stats.conversionPct.toFixed(1)}% · esperas extras: ${Number(stats.extended || 0)}`
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
          'EXPANSION',
          'TRANSITION'
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
        snap?.trendExhaustion?.ok === false &&
        finiteNumber(item.score, 0) < 84
      ) {
        invalidate(`Trend Exhaustion Guard: ${snap?.trendExhaustion?.reason || 'tendência esticada'}`, 'EXHAUSTION');
        continue;
      }

      const oiClass =
        oiClassForSide(
          side,
          snap?.oiContext,
          this.strongOiContraryPct
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
          'STRONG_CONTRARY'
        ) {
          invalidate(
            `OI fortemente contrário ao ${side}: ${oiClass.regime} (${oiClass.oiPct.toFixed(2)}%)`,
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

      // Não cancela por snap.antiChase.ok === false pois o reteste já aconteceu no candle que armou o setup.
      // Apenas protege contra confirmação excessivamente distante do gatilho (> maxChaseAtr).
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

      const triggerBodyHigh = Math.max(item.triggerOpen, item.triggerClose);
      const triggerBodyLow = Math.min(item.triggerOpen, item.triggerClose);
      const triggerMid = (item.triggerOpen + item.triggerClose) / 2;
      const ema20Now = finiteNumber(snap?.t5?.ema20, close);
      const nearTriggerPriceOk =
        side === 'LONG'
          ? close >= item.triggerClose - atr * 0.15 && close > ema20Now
          : close <= item.triggerClose + atr * 0.15 && close < ema20Now;

      const breakoutConfirmed =
        side === 'LONG'
          ? (
              close > item.triggerHigh ||
              (high >= item.triggerHigh && close >= item.triggerClose && close >= open) ||
              (close > triggerBodyHigh && close > open && close > ema20Now) ||
              (close >= open && close >= triggerMid && nearTriggerPriceOk)
            )
          : (
              close < item.triggerLow ||
              (low <= item.triggerLow && close <= item.triggerClose && close <= open) ||
              (close < triggerBodyLow && close < open && close < ema20Now) ||
              (close <= open && close <= triggerMid && nearTriggerPriceOk)
            );

      const directionalClose =
        side === 'LONG'
          ? (close >= open - atr * 0.05 || close > item.triggerHigh)
          : (close <= open + atr * 0.05 || close < item.triggerLow);

      const volumeRatio = finiteNumber(snap?.t5?.volumeRatio, 0);
      const quoteVolume = finiteNumber(snap?.t5?.quoteVolume, 0);
      const setup = String(item?.signal?.entryMode || 'PULLBACK').toUpperCase();
      const baselineVolume = item.pullbackAvgQuoteVolume;

      const volumeVsPullbackOk =
        volumeRatio >= 0.35 ||
        (setup === 'PULLBACK' && baselineVolume > 0 && quoteVolume > 0
          ? quoteVolume >= baselineVolume * Math.min(this.volumeResumeMultiplier, 0.45)
          : true);

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
            `candle não confirmou: ${confirmationFailures.join(' · ')}`
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

      const preservedScore = Math.max(
        finiteNumber(item.signal?.score, 0),
        finiteNumber(snap?.score, 0)
      );
      const preservedEdge = Math.max(
        finiteNumber(item.signal?.directionEdge, 0),
        finiteNumber(snap?.directionEdge, 0)
      );
      const preservedMomentum =
        finiteNumber(item.signal?.momentum?.confirmationCount, 0) >=
        finiteNumber(snap?.momentum?.confirmationCount, 0)
          ? { ...(snap?.momentum || {}), ...(item.signal?.momentum || {}) }
          : { ...(item.signal?.momentum || {}), ...(snap?.momentum || {}) };

      const confirmedSignal = {
        ...item.signal,
        ...snap,
        ...levels,
        score: preservedScore,
        directionEdge: preservedEdge,
        momentum: preservedMomentum,
        antiChase: {
          ...(snap?.antiChase || {}),
          ok: true,
          retest: true
        },
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
          triggerQuality: Math.max(
            finiteNumber(item.signal?.pullback?.triggerQuality, 0),
            finiteNumber(snap?.pullback?.triggerQuality, 0)
          ),
          confirmed: true,
          strongTrigger: true,
          confirmedEntry: true,
          confirmationBarTime: currentBarTime
        },
        // O setup nasceu em TREND/EXPANSION. Guardamos esse regime como origem;
        // o candle de confirmação pode naturalmente virar EXPANSION.
        marketRegime: {
          ...item.signal.marketRegime,
          regime: item.signal.marketRegime?.regime || snap?.marketRegime?.regime || 'TREND',
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
            oiClass.level,
          smartOiRegime:
            oiClass.regime,
          smartOiAccepted:
            oiClass.level !== 'STRONG_CONTRARY',
          confirmationBarNumber:
            barNumber,
          triggerBarTime: item.triggerBarTime,
          confirmationBarTime: currentBarTime,
          triggerHigh: item.triggerHigh,
          triggerLow: item.triggerLow,
          triggerClose: item.triggerClose,
          confirmationClose: close,
          confirmationVolumeRatio: Math.max(volumeRatio, finiteNumber(item.triggerVolumeRatio, 0)),
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
