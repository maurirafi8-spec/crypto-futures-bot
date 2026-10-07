import fs from 'node:fs';
import path from 'node:path';

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
}

function numEnv(name, fallback, min = -Infinity, max = Infinity) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function intEnv(name, fallback, min = 0, max = 1000000) {
  return Math.trunc(numEnv(name, fallback, min, max));
}

function round(value, digits = 8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function paperConfig() {
  return {
    enabled:
      String(process.env.PAPER_TRADING_ENABLED || 'true')
        .toLowerCase() !== 'false',

    startingBalance:
      numEnv('PAPER_STARTING_BALANCE_USDC', 50, 10, 1_000_000),

    riskPct:
      numEnv('PAPER_RISK_PER_TRADE_PCT', 0.50, 0.1, 10),

    leverage:
      intEnv('PAPER_LEVERAGE', 2, 1, 50),

    maxMarginPct:
      numEnv('PAPER_MAX_MARGIN_PCT', 15, 1, 100),

    maxOpenPositions:
      intEnv('PAPER_MAX_OPEN_POSITIONS', 4, 1, 20),

    targetTradesPerDayMin:
      intEnv('PAPER_TARGET_TRADES_MIN', 4, 1, 100),

    maxTradesPerDay:
      intEnv('PAPER_MAX_TRADES_PER_DAY', 10, 1, 100),

    onePositionPerSymbol:
      String(process.env.PAPER_ONE_POSITION_PER_SYMBOL || 'true')
        .toLowerCase() !== 'false',

    minNotional:
      numEnv('PAPER_MIN_NOTIONAL_USDC', 10, 1, 10000),

    minAiConfidence:
      numEnv('PAPER_MIN_AI_CONFIDENCE', 65, 0, 100),

    minScore:
      numEnv('PAPER_MIN_SCORE', 68, 0, 100),

    breakoutMinAiConfidence:
      numEnv('PAPER_BREAKOUT_MIN_AI_CONFIDENCE', 75, 0, 100),

    breakoutMinScore:
      numEnv('PAPER_BREAKOUT_MIN_SCORE', 82, 0, 100),

    feeRate:
      numEnv('PAPER_FEE_RATE', 0.00045, 0, 0.01),

    slippageBps:
      numEnv('PAPER_SLIPPAGE_BPS', 5, 0, 500),

    dailyLossLimitPct:
      numEnv('PAPER_DAILY_LOSS_LIMIT_PCT', 3, 0.1, 50),

    cooldownMin:
      numEnv('PAPER_COOLDOWN_MINUTES', 12, 0, 1440),

    // V1.8.2 ADAPTIVE HOLD
    // PAPER_MAX_HOLD_HOURS agora é CHECKPOINT, não encerramento cego.
    maxHoldHours:
      numEnv('PAPER_MAX_HOLD_HOURS', 2, 0.5, 720),

    adaptiveHoldEnabled:
      String(process.env.PAPER_ADAPTIVE_HOLD_ENABLED || 'true')
        .toLowerCase() !== 'false',

    adaptiveHoldHardMaxHours:
      numEnv('PAPER_ADAPTIVE_HOLD_HARD_MAX_HOURS', 6, 0, 720),

    adaptiveHoldNoTimeoutAfterTp1:
      String(process.env.PAPER_ADAPTIVE_HOLD_NO_TIMEOUT_AFTER_TP1 || 'true')
        .toLowerCase() !== 'false',

    adaptiveHoldNotifyCheckpoint:
      String(process.env.PAPER_ADAPTIVE_HOLD_NOTIFY_CHECKPOINT || 'true')
        .toLowerCase() !== 'false',

    scalpMode:
      String(process.env.PAPER_SCALP_MODE || 'true')
        .toLowerCase() !== 'false',

    scalpStaleMin:
      numEnv('PAPER_SCALP_STALE_MINUTES', 60, 15, 360),

    scalpStaleMaxMin:
      numEnv('PAPER_SCALP_STALE_MAX_MINUTES', 90, 30, 180),

    scalpStaleMinProgressR:
      numEnv('PAPER_SCALP_STALE_MIN_PROGRESS_R', 0.20, 0, 2),

    scalpStaleMinVolumeRatio:
      numEnv('PAPER_SCALP_STALE_MIN_VOLUME_RATIO', 0.45, 0, 5),

    scalpStaleHardProgressR:
      numEnv('PAPER_SCALP_STALE_HARD_PROGRESS_R', 0.25, 0, 2),

    scalpStaleDeteriorationCount:
      intEnv('PAPER_SCALP_STALE_DETERIORATION_COUNT', 2, 2, 3),

    scalpStaleConsecutiveChecks:
      intEnv('PAPER_SCALP_STALE_CONSECUTIVE_CHECKS', 2, 1, 6),

    lossBrakeEnabled:
      String(process.env.PAPER_LOSS_BRAKE_ENABLED || 'true')
        .toLowerCase() !== 'false',

    lossBrakeConsecutive:
      intEnv('PAPER_LOSS_BRAKE_CONSECUTIVE', 2, 2, 10),

    lossBrakeMinutes:
      numEnv('PAPER_LOSS_BRAKE_MINUTES', 45, 10, 240),

    lossBrakeScoreBoost:
      numEnv('PAPER_LOSS_BRAKE_SCORE_BOOST', 8, 0, 30),

    lossBrakeAiBoost:
      numEnv('PAPER_LOSS_BRAKE_AI_BOOST', 5, 0, 30),

    // V1.7.6 PERFORMANCE GUARD
    performanceGuardEnabled:
      String(process.env.PAPER_PERFORMANCE_GUARD_ENABLED || 'true')
        .toLowerCase() !== 'false',

    performanceLookback:
      intEnv('PAPER_PERFORMANCE_LOOKBACK', 6, 4, 30),

    performanceMinTrades:
      intEnv('PAPER_PERFORMANCE_MIN_TRADES', 5, 3, 30),

    performanceMinProfitFactor:
      numEnv('PAPER_PERFORMANCE_MIN_PROFIT_FACTOR', 0.60, 0, 5),

    performanceMaxWinRatePct:
      numEnv('PAPER_PERFORMANCE_MAX_WIN_RATE_PCT', 40, 0, 100),

    performanceRecentLosses:
      intEnv('PAPER_PERFORMANCE_RECENT_LOSSES', 2, 1, 6),

    performancePauseMin:
      numEnv('PAPER_PERFORMANCE_PAUSE_MINUTES', 90, 15, 720),

    setupGuardEnabled:
      String(process.env.PAPER_SETUP_GUARD_ENABLED || 'true')
        .toLowerCase() !== 'false',

    performanceQualityEnabled:
      String(process.env.PAPER_PERFORMANCE_QUALITY_ENABLED || 'true')
        .toLowerCase() !== 'false',

    performanceQualityLookback:
      intEnv('PAPER_PERFORMANCE_QUALITY_LOOKBACK', 10, 6, 30),

    performanceQualityMinTrades:
      intEnv('PAPER_PERFORMANCE_QUALITY_MIN_TRADES', 8, 5, 30),

    performanceQualityMinPf:
      numEnv('PAPER_PERFORMANCE_QUALITY_MIN_PF', 0.80, 0, 5),

    performanceQualityMinPayoff:
      numEnv('PAPER_PERFORMANCE_QUALITY_MIN_PAYOFF', 0.70, 0, 5),

    performanceQualityScoreBoost:
      numEnv('PAPER_PERFORMANCE_QUALITY_SCORE_BOOST', 5, 0, 30),

    performanceQualityAiBoost:
      numEnv('PAPER_PERFORMANCE_QUALITY_AI_BOOST', 4, 0, 30),

    // V1.7.9 ADAPTIVE QUALITY
    // Um lado degradado não volta direto ao filtro normal após a pausa.
    // Ele entra em PROBATION até a janela recente recuperar PF + win rate.
    sideProbationEnabled:
      String(process.env.PAPER_SIDE_PROBATION_ENABLED || 'true')
        .toLowerCase() !== 'false',

    sideRecoveryMinProfitFactor:
      numEnv('PAPER_SIDE_RECOVERY_MIN_PF', 0.80, 0, 5),

    sideRecoveryMinWinRatePct:
      numEnv('PAPER_SIDE_RECOVERY_MIN_WIN_RATE_PCT', 40, 0, 100),

    sideProbationMinScore:
      numEnv('PAPER_SIDE_PROBATION_MIN_SCORE', 82, 68, 100),

    sideProbationMinAi:
      numEnv('PAPER_SIDE_PROBATION_MIN_AI', 72, 0, 100),

    sideProbationRequireMomentum3:
      String(process.env.PAPER_SIDE_PROBATION_REQUIRE_MOMENTUM3 || 'true')
        .toLowerCase() !== 'false',

    sideProbationRequirePullback:
      String(process.env.PAPER_SIDE_PROBATION_REQUIRE_PULLBACK || 'true')
        .toLowerCase() !== 'false',

    sideProbationRequireOi:
      String(process.env.PAPER_SIDE_PROBATION_REQUIRE_OI || 'true')
        .toLowerCase() !== 'false',

    // V1.8.0 SETUP HEALTH
    setupProbationEnabled:
      String(process.env.PAPER_SETUP_PROBATION_ENABLED || 'true')
        .toLowerCase() !== 'false',

    setupRecoveryMinProfitFactor:
      numEnv('PAPER_SETUP_RECOVERY_MIN_PF', 0.80, 0, 5),

    setupRecoveryMinWinRatePct:
      numEnv('PAPER_SETUP_RECOVERY_MIN_WIN_RATE_PCT', 35, 0, 100),

    setupProbationMinScore:
      numEnv('PAPER_SETUP_PROBATION_MIN_SCORE', 88, 68, 100),

    setupProbationMinAi:
      numEnv('PAPER_SETUP_PROBATION_MIN_AI', 78, 0, 100),

    setupProbationRequireMomentum3:
      String(process.env.PAPER_SETUP_PROBATION_REQUIRE_MOMENTUM3 || 'true')
        .toLowerCase() !== 'false',

    setupProbationRequireOi:
      String(process.env.PAPER_SETUP_PROBATION_REQUIRE_OI || 'true')
        .toLowerCase() !== 'false',

    setupProbationRequireTrend:
      String(process.env.PAPER_SETUP_PROBATION_REQUIRE_TREND || 'true')
        .toLowerCase() !== 'false',

    setupProbationRequireStrongTrigger:
      String(process.env.PAPER_SETUP_PROBATION_REQUIRE_STRONG_TRIGGER || 'true')
        .toLowerCase() !== 'false',

    performanceRiskThrottleEnabled:
      String(process.env.PAPER_PERFORMANCE_RISK_THROTTLE_ENABLED || 'true')
        .toLowerCase() !== 'false',

    performanceRiskPct:
      numEnv('PAPER_PERFORMANCE_RISK_PCT', 0.50, 0.1, 10),

    // Tiers de score: a amostra atual mostrou os trades <80 muito mais frágeis.
    scoreTierEnabled:
      String(process.env.PAPER_SCORE_TIER_ENABLED || 'true')
        .toLowerCase() !== 'false',

    scoreTierLowMax:
      numEnv('PAPER_SCORE_TIER_LOW_MAX', 74, 68, 79),

    scoreTierMidMax:
      numEnv('PAPER_SCORE_TIER_MID_MAX', 79, 75, 84),

    scoreTierLowMinAi:
      numEnv('PAPER_SCORE_TIER_LOW_MIN_AI', 78, 0, 100),

    scoreTierMidMinAi:
      numEnv('PAPER_SCORE_TIER_MID_MIN_AI', 72, 0, 100),

    scoreTierLowMinEdge:
      numEnv('PAPER_SCORE_TIER_LOW_MIN_EDGE', 8, 0, 50),

    scoreTierMidMinEdge:
      numEnv('PAPER_SCORE_TIER_MID_MIN_EDGE', 6, 0, 50),

    scoreTierRequireMomentum3:
      String(process.env.PAPER_SCORE_TIER_REQUIRE_MOMENTUM3 || 'true')
        .toLowerCase() !== 'false',

    profitProtectEnabled:
      String(process.env.PAPER_PROFIT_PROTECT_ENABLED || 'true')
        .toLowerCase() !== 'false',

    // V1.7.2 STOP GAIN RUNNER
    // TP1 e TP2 realizam 30% cada.
    // No TP3 realiza apenas uma parte e deixa um runner aberto.
    // O stop do runner sobe por degraus até ser atingido em lucro.
    trailingRunnerEnabled:
      String(process.env.PAPER_TRAILING_RUNNER_ENABLED || 'true')
        .toLowerCase() !== 'false',

    tp3ClosePct:
      numEnv('PAPER_TP3_CLOSE_PCT', 20, 5, 35),

    runnerStepGapMultiplier:
      numEnv('PAPER_RUNNER_STEP_GAP_MULTIPLIER', 1.00, 0.50, 3.00),

    // V1.6.2:
    // buffer proporcional ao tamanho da posição, em vez de piso fixo em USDC.
    // 0.05% de um notional de 10 USDC = 0.005 USDC.
    profitProtectBufferPctNotional:
      numEnv(
        'PAPER_PROFIT_PROTECT_BUFFER_PCT_NOTIONAL',
        0.05,
        0,
        5
      ),

    // V1.6.5 NET R/R GUARD
    // O trade só abre se o lucro líquido projetado dos 3 TPs
    // compensar o prejuízo líquido projetado do STOP.
    netRrGuardEnabled:
      String(process.env.PAPER_NET_RR_GUARD_ENABLED || 'true')
        .toLowerCase() !== 'false',

    minNetRR:
      numEnv('PAPER_MIN_NET_RR', 1.50, 0.25, 10),

    autoAdjustTargets:
      String(process.env.PAPER_AUTO_ADJUST_TPS || 'true')
        .toLowerCase() !== 'false',

    maxTargetScale:
      numEnv('PAPER_MAX_TP_SCALE', 4.00, 1, 10),

    requireTp1NetProtectable:
      String(process.env.PAPER_REQUIRE_TP1_NET_PROTECT || 'true')
        .toLowerCase() !== 'false',

    statePath:
      process.env.PAPER_STATE_PATH ||
      path.resolve(process.cwd(), 'paper-state.json')
  };
}

function freshState() {
  const cfg = paperConfig();
  return {
    schema: 1,
    createdAt: Date.now(),
    startingBalance: cfg.startingBalance,
    balance: cfg.startingBalance,
    peakEquity: cfg.startingBalance,
    maxDrawdownPct: 0,
    totalFees: 0,
    totalGrossPnl: 0,
    totalNetPnl: 0,
    paused: false,
    openPositions: [],
    closedTrades: [],
    seenSignalKeys: [],
    lastOpenAt: {},
    day: {
      key: dayKey(),
      startBalance: cfg.startingBalance,
      realizedPnl: 0,
      trades: 0
    }
  };
}

function sanitizeState(raw) {
  const base = freshState();

  if (!raw || typeof raw !== 'object') {
    return base;
  }

  return {
    ...base,
    ...raw,
    openPositions:
      Array.isArray(raw.openPositions)
        ? raw.openPositions
        : [],
    closedTrades:
      Array.isArray(raw.closedTrades)
        ? raw.closedTrades
        : [],
    seenSignalKeys:
      Array.isArray(raw.seenSignalKeys)
        ? raw.seenSignalKeys.slice(-500)
        : [],
    lastOpenAt:
      raw.lastOpenAt && typeof raw.lastOpenAt === 'object'
        ? raw.lastOpenAt
        : {},
    day: {
      ...base.day,
      ...(raw.day || {})
    }
  };
}

function loadState() {
  const cfg = paperConfig();

  try {
    if (!fs.existsSync(cfg.statePath)) {
      return freshState();
    }

    const raw =
      JSON.parse(
        fs.readFileSync(cfg.statePath, 'utf8')
      );

    return sanitizeState(raw);
  } catch (error) {
    console.error(
      '[paper] falha ao carregar estado:',
      error.message
    );
    return freshState();
  }
}

let state = loadState();

function ensureDay() {
  const key = dayKey();

  if (state.day?.key === key) {
    return;
  }

  const equity = currentEquity();

  state.day = {
    key,
    startBalance: equity,
    realizedPnl: 0,
    trades: 0
  };

  saveState();
}

function saveState() {
  const cfg = paperConfig();

  try {
    fs.mkdirSync(
      path.dirname(cfg.statePath),
      { recursive: true }
    );

    const tmp = `${cfg.statePath}.tmp`;

    fs.writeFileSync(
      tmp,
      JSON.stringify(state, null, 2),
      'utf8'
    );

    fs.renameSync(tmp, cfg.statePath);
  } catch (error) {
    console.error(
      '[paper] falha ao salvar estado:',
      error.message
    );
  }
}

function directionSign(side) {
  return side === 'SHORT' ? -1 : 1;
}

function adverseFill(price, side, isEntry) {
  const cfg = paperConfig();
  const slip = cfg.slippageBps / 10000;
  const p = Number(price);

  if (side === 'LONG') {
    return p * (isEntry ? 1 + slip : 1 - slip);
  }

  return p * (isEntry ? 1 - slip : 1 + slip);
}

function marginUsed() {
  return state.openPositions.reduce(
    (sum, p) => {
      const fraction =
        p.initialQty > 0
          ? p.remainingQty / p.initialQty
          : 0;

      return sum + p.initialMargin * fraction;
    },
    0
  );
}

function currentUnrealized() {
  return state.openPositions.reduce(
    (sum, p) => {
      const mark =
        Number(p.lastMark ?? p.entryFill);

      const gross =
        directionSign(p.side) *
        (mark - p.entryFill) *
        p.remainingQty;

      return sum + gross;
    },
    0
  );
}

function currentEquity() {
  return state.balance + currentUnrealized();
}

function updateDrawdown() {
  const equity = currentEquity();

  if (equity > state.peakEquity) {
    state.peakEquity = equity;
  }

  if (state.peakEquity > 0) {
    const dd =
      ((state.peakEquity - equity) / state.peakEquity) * 100;

    state.maxDrawdownPct =
      Math.max(
        Number(state.maxDrawdownPct || 0),
        dd
      );
  }
}

function availableBalance() {
  return Math.max(
    0,
    state.balance - marginUsed()
  );
}

function signalKey(signal) {
  return (
    `${signal.symbol}:${signal.side}:` +
    `${signal.t5?.openTime ?? signal.t15?.openTime ?? 0}`
  );
}

function isDailyLossLocked() {
  ensureDay();

  const limit =
    Math.max(
      0,
      Number(state.day.startBalance || 0) *
      paperConfig().dailyLossLimitPct / 100
    );

  return (
    Number(state.day.realizedPnl || 0) <=
    -limit
  );
}

function todayEntryCount() {
  ensureDay();

  const today =
    state.day?.key ||
    dayKey();

  const openToday =
    state.openPositions.filter(position =>
      dayKey(position.openedAt) === today
    ).length;

  return (
    Number(state.day?.trades || 0) +
    openToday
  );
}

function sameSymbolOpen(signal) {
  const symbol =
    String(signal?.symbol || '')
      .toUpperCase();

  if (!symbol) {
    return false;
  }

  return state.openPositions.some(position =>
    String(position.symbol || '')
      .toUpperCase() === symbol
  );
}

function cooldownBlocked(signal) {
  const cfg = paperConfig();

  if (cfg.cooldownMin <= 0) {
    return false;
  }

  const symbol =
    String(signal?.symbol || '')
      .toUpperCase();

  const lastOpen =
    Number(state.lastOpenAt?.[signal.symbol] || 0);

  const lastClosed =
    state.closedTrades.find(trade =>
      String(trade.symbol || '')
        .toUpperCase() === symbol
    );

  const lastClose =
    Number(lastClosed?.closedAt || 0);

  const last =
    Math.max(
      lastOpen,
      lastClose
    );

  if (!last) {
    return false;
  }

  return (
    Date.now() - last <
    cfg.cooldownMin * 60_000
  );
}



function tradeMetrics(
  trades
) {
  const list =
    Array.isArray(trades)
      ? trades
      : [];

  const wins =
    list.filter(
      t =>
        Number(t?.netPnl || 0) >
        0.000001
    );

  const losses =
    list.filter(
      t =>
        Number(t?.netPnl || 0) <
        -0.000001
    );

  const grossProfit =
    wins.reduce(
      (sum, t) =>
        sum +
        Number(t?.netPnl || 0),
      0
    );

  const grossLossAbs =
    Math.abs(
      losses.reduce(
        (sum, t) =>
          sum +
          Number(t?.netPnl || 0),
        0
      )
    );

  const avgWin =
    wins.length
      ? grossProfit /
        wins.length
      : 0;

  const avgLossAbs =
    losses.length
      ? grossLossAbs /
        losses.length
      : 0;

  const profitFactor =
    grossLossAbs > 0
      ? grossProfit /
        grossLossAbs
      : grossProfit > 0
        ? Infinity
        : 0;

  const payoffRatio =
    avgLossAbs > 0
      ? avgWin /
        avgLossAbs
      : avgWin > 0
        ? Infinity
        : 0;

  let recentLossStreak = 0;

  for (const trade of list) {
    if (
      Number(trade?.netPnl || 0) <
      -0.000001
    ) {
      recentLossStreak += 1;
    } else {
      break;
    }
  }

  const avgField = (
    source,
    field
  ) =>
    source.length
      ? source.reduce(
          (sum, t) =>
            sum +
            Number(t?.[field] || 0),
          0
        ) /
        source.length
      : 0;

  return {
    total:
      list.length,
    wins:
      wins.length,
    losses:
      losses.length,
    flat:
      list.length -
      wins.length -
      losses.length,
    pnl:
      list.reduce(
        (sum, t) =>
          sum +
          Number(t?.netPnl || 0),
        0
      ),
    winRate:
      list.length
        ? wins.length /
          list.length *
          100
        : 0,
    grossProfit,
    grossLossAbs,
    profitFactor,
    avgWin,
    avgLossAbs,
    payoffRatio,
    avgNet:
      list.length
        ? list.reduce(
            (sum, t) =>
              sum +
              Number(t?.netPnl || 0),
            0
          ) /
          list.length
        : 0,
    avgMfe:
      avgField(
        list,
        'mfeR'
      ),
    avgMae:
      avgField(
        list,
        'maeR'
      ),
    winnersMfe:
      avgField(
        wins,
        'mfeR'
      ),
    winnersMae:
      avgField(
        wins,
        'maeR'
      ),
    losersMfe:
      avgField(
        losses,
        'mfeR'
      ),
    losersMae:
      avgField(
        losses,
        'maeR'
      ),
    recentLossStreak,
    newestClosedAt:
      Number(
        list?.[0]?.closedAt ||
        0
      )
  };
}

function recentTradesMatching(
  predicate,
  limit
) {
  const out = [];

  for (
    const trade of
    state.closedTrades
  ) {
    if (
      predicate(trade)
    ) {
      out.push(trade);
    }

    if (
      out.length >=
      limit
    ) {
      break;
    }
  }

  return out;
}

function performanceCircuitStatus(
  kind,
  value
) {
  const cfg =
    paperConfig();

  const normalized =
    String(value || '')
      .toUpperCase();

  if (
    !cfg.performanceGuardEnabled ||
    !normalized
  ) {
    return {
      active: false,
      probation: false,
      poor: false,
      degraded: false,
      recovered: true,
      kind,
      value: normalized,
      metrics: tradeMetrics([])
    };
  }

  if (
    kind === 'SETUP' &&
    !cfg.setupGuardEnabled
  ) {
    return {
      active: false,
      probation: false,
      poor: false,
      degraded: false,
      recovered: true,
      kind,
      value: normalized,
      metrics: tradeMetrics([])
    };
  }

  const trades =
    recentTradesMatching(
      trade => {
        if (kind === 'SIDE') {
          return (
            String(trade?.side || '')
              .toUpperCase() ===
            normalized
          );
        }

        return (
          String(
            trade?.setupEntryMode ||
            'PULLBACK'
          ).toUpperCase() ===
          normalized
        );
      },
      cfg.performanceLookback
    );

  const metrics =
    tradeMetrics(trades);

  const enough =
    metrics.total >=
    cfg.performanceMinTrades;

  const pfBad =
    metrics.profitFactor !== Infinity &&
    metrics.profitFactor <
      cfg.performanceMinProfitFactor;

  const winRateBad =
    metrics.winRate <=
    cfg.performanceMaxWinRatePct;

  const lossStreakBad =
    metrics.recentLossStreak >=
    cfg.performanceRecentLosses;

  const poor =
    enough &&
    pfBad &&
    winRateBad &&
    lossStreakBad;

  const elapsedMin =
    metrics.newestClosedAt
      ? (
        Date.now() -
        metrics.newestClosedAt
      ) / 60_000
      : Infinity;

  const remainingMin =
    poor
      ? Math.max(
          0,
          cfg.performancePauseMin -
          elapsedMin
        )
      : 0;

  const probationEnabled =
    kind === 'SIDE'
      ? cfg.sideProbationEnabled
      : cfg.setupProbationEnabled;

  const recoveryPf =
    kind === 'SIDE'
      ? cfg.sideRecoveryMinProfitFactor
      : cfg.setupRecoveryMinProfitFactor;

  const recoveryWinRate =
    kind === 'SIDE'
      ? cfg.sideRecoveryMinWinRatePct
      : cfg.setupRecoveryMinWinRatePct;

  if (!probationEnabled) {
    return {
      active:
        poor &&
        remainingMin > 0,
      probation: false,
      poor,
      degraded: poor,
      recovered: !poor,
      kind,
      value: normalized,
      metrics,
      remainingMin,
      elapsedMin
    };
  }

  const pfRecovered =
    metrics.profitFactor === Infinity ||
    metrics.profitFactor >=
      recoveryPf;

  const winRateRecovered =
    metrics.winRate >=
    recoveryWinRate;

  const recovered =
    !enough ||
    (
      pfRecovered &&
      winRateRecovered
    );

  const degraded =
    enough &&
    !recovered;

  const active =
    poor &&
    remainingMin > 0;

  const probation =
    degraded &&
    !active;

  return {
    active,
    probation,
    poor,
    degraded,
    recovered,
    kind,
    value: normalized,
    metrics,
    remainingMin,
    elapsedMin,
    recoveryPf,
    recoveryWinRate
  };
}

function overallPerformanceQualityStatus() {
  const cfg =
    paperConfig();

  if (
    !cfg.performanceQualityEnabled
  ) {
    return {
      active: false,
      metrics:
        tradeMetrics([])
    };
  }

  const trades =
    state.closedTrades.slice(
      0,
      cfg.performanceQualityLookback
    );

  const metrics =
    tradeMetrics(
      trades
    );

  const pfBad =
    metrics.profitFactor !==
      Infinity &&
    metrics.profitFactor <
      cfg.performanceQualityMinPf;

  const payoffBad =
    metrics.payoffRatio !==
      Infinity &&
    metrics.payoffRatio <
      cfg.performanceQualityMinPayoff;

  const active =
    metrics.total >=
      cfg.performanceQualityMinTrades &&
    (
      pfBad ||
      payoffBad
    );

  return {
    active,
    metrics,
    pfBad,
    payoffBad,
    scoreBoost:
      active
        ? cfg.performanceQualityScoreBoost
        : 0,
    aiBoost:
      active
        ? cfg.performanceQualityAiBoost
        : 0
  };
}

function effectiveRiskStatus() {
  const cfg =
    paperConfig();

  const quality =
    overallPerformanceQualityStatus();

  const throttled =
    cfg.performanceRiskThrottleEnabled &&
    quality.active;

  const riskPct =
    throttled
      ? Math.min(
          cfg.riskPct,
          cfg.performanceRiskPct
        )
      : cfg.riskPct;

  return {
    riskPct,
    throttled,
    configuredRiskPct:
      cfg.riskPct,
    quality
  };
}


export function paperPerformanceGuardPreview({
  side = 'LONG',
  setup = 'PULLBACK'
} = {}) {
  return {
    side:
      performanceCircuitStatus(
        'SIDE',
        side
      ),
    setup:
      performanceCircuitStatus(
        'SETUP',
        setup
      ),
    overall:
      overallPerformanceQualityStatus()
  };
}

function lossBrakeStatus() {
  const cfg = paperConfig();

  if (!cfg.lossBrakeEnabled) {
    return {
      active: false,
      count: 0,
      remainingMin: 0
    };
  }

  let count = 0;
  let newestLossAt = 0;

  for (const trade of state.closedTrades) {
    const pnl =
      Number(trade?.netPnl || 0);

    if (pnl < -0.000001) {
      count += 1;

      if (!newestLossAt) {
        newestLossAt =
          Number(trade?.closedAt || 0);
      }
    } else {
      break;
    }
  }

  if (
    count < cfg.lossBrakeConsecutive ||
    !newestLossAt
  ) {
    return {
      active: false,
      count,
      remainingMin: 0
    };
  }

  const elapsedMin =
    (
      Date.now() -
      newestLossAt
    ) /
    60_000;

  const remainingMin =
    Math.max(
      0,
      cfg.lossBrakeMinutes -
      elapsedMin
    );

  return {
    active:
      remainingMin > 0,
    count,
    remainingMin,
    effectiveMinScore:
      cfg.minScore +
      cfg.lossBrakeScoreBoost,
    effectiveMinAiConfidence:
      cfg.minAiConfidence +
      cfg.lossBrakeAiBoost
  };
}


function signalMomentumCount(
  signal
) {
  return Number(
    signal?.momentum?.confirmationCount ||
    0
  );
}

function signalOiConfirmed(
  signal
) {
  return Boolean(
    signal?.oiContext?.confirmed
  );
}

function signalPullbackConfirmed(
  signal
) {
  return (
    String(
      signal?.entryMode ||
      ''
    ).toUpperCase() ===
      'PULLBACK' &&
    Boolean(
      signal?.pullback?.confirmed
    )
  );
}

function signalStructureAligned(
  signal
) {
  return (
    Boolean(
      signal?.pullback?.structure1hOk
    ) &&
    Boolean(
      signal?.pullback?.structure15Ok
    )
  );
}

function scoreTierRequirements(
  signal,
  cfg
) {
  const score =
    Number(
      signal?.score ||
      0
    );

  if (
    !cfg.scoreTierEnabled ||
    score >= 80
  ) {
    return {
      tier:
        score >= 80
          ? 'HIGH_80_PLUS'
          : 'OFF',
      strict: false,
      minAi:
        cfg.minAiConfidence,
      minEdge: 0
    };
  }

  const low =
    score <=
    cfg.scoreTierLowMax;

  return {
    tier:
      low
        ? 'LOW_68_74'
        : 'MID_75_79',
    strict: true,
    minAi:
      low
        ? cfg.scoreTierLowMinAi
        : cfg.scoreTierMidMinAi,
    minEdge:
      low
        ? cfg.scoreTierLowMinEdge
        : cfg.scoreTierMidMinEdge
  };
}

function strictTechnicalQuality(
  signal,
  {
    minEdge = 0,
    requireMomentum3 = true,
    requirePullback = true,
    requireOi = true,
    requireTrendRegime = false,
    requireStrongTrigger = false
  } = {}
) {
  const reasons = [];

  if (
    requirePullback &&
    !signalPullbackConfirmed(
      signal
    )
  ) {
    reasons.push(
      'pullback confirmado obrigatório'
    );
  }

  if (
    requireMomentum3 &&
    signalMomentumCount(
      signal
    ) < 3
  ) {
    reasons.push(
      `momentum ${signalMomentumCount(signal)}/3`
    );
  }

  if (
    requireOi &&
    !signalOiConfirmed(
      signal
    )
  ) {
    reasons.push(
      `OI ${signal?.oiContext?.regime || 'neutro'}`
    );
  }

  if (
    !signalStructureAligned(
      signal
    )
  ) {
    reasons.push(
      '1H+15m não alinhados'
    );
  }

  if (
    requireTrendRegime &&
    String(
      signal?.marketRegime?.regime ||
      ''
    ).toUpperCase() !==
      'TREND'
  ) {
    reasons.push(
      `regime ${signal?.marketRegime?.regime || 'UNKNOWN'}; exige TREND`
    );
  }

  if (
    requireStrongTrigger &&
    !Boolean(
      signal?.pullback?.strongTrigger
    )
  ) {
    reasons.push(
      'trigger forte/reclaim EMA20 não confirmado'
    );
  }

  if (
    signal?.antiChase?.ok ===
      false
  ) {
    reasons.push(
      'anti-chase bloqueado'
    );
  }

  if (
    signal?.btcRegime?.ok ===
      false ||
    signal?.btcRegime?.strongOpposite
  ) {
    reasons.push(
      'BTC contrário'
    );
  }

  const edge =
    Number(
      signal?.directionEdge ||
      0
    );

  if (
    edge <
    minEdge
  ) {
    reasons.push(
      `edge ${edge} < ${minEdge}`
    );
  }

  return {
    ok:
      reasons.length ===
      0,
    reasons
  };
}

function eligibility(signal) {
  const cfg = paperConfig();
  const brake =
    lossBrakeStatus();

  const signalSide =
    String(
      signal?.side ||
      ''
    ).toUpperCase();

  const signalSetup =
    String(
      signal?.entryMode ||
      'PULLBACK'
    ).toUpperCase();

  const sideGuard =
    performanceCircuitStatus(
      'SIDE',
      signalSide
    );

  if (
    sideGuard.active
  ) {
    const m =
      sideGuard.metrics;

    return {
      ok: false,
      reason:
        `PERFORMANCE GUARD ${signalSide}: ` +
        `${m.wins}W/${m.losses}L · PF ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞'} · ` +
        `pausa ${sideGuard.remainingMin.toFixed(0)}m`
    };
  }

  const setupGuard =
    performanceCircuitStatus(
      'SETUP',
      signalSetup
    );

  if (
    setupGuard.active
  ) {
    const m =
      setupGuard.metrics;

    return {
      ok: false,
      reason:
        `SETUP GUARD ${signalSetup}: ` +
        `${m.wins}W/${m.losses}L · PF ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞'} · ` +
        `pausa ${setupGuard.remainingMin.toFixed(0)}m`
    };
  }

  const quality =
    overallPerformanceQualityStatus();

  const isBreakout =
    signalSetup ===
      'BREAKOUT_STRONG';

  const tier =
    scoreTierRequirements(
      signal,
      cfg
    );

  if (
    tier.strict
  ) {
    const strict =
      strictTechnicalQuality(
        signal,
        {
          minEdge:
            tier.minEdge,
          requireMomentum3:
            cfg.scoreTierRequireMomentum3,
          requirePullback:
            true,
          requireOi:
            true,
          requireTrendRegime:
            true,
          requireStrongTrigger:
            true
        }
      );

    if (!strict.ok) {
      return {
        ok: false,
        reason:
          `SCORE TIER ${tier.tier}: ` +
          strict.reasons.join(' · ')
      };
    }
  }

  if (
    sideGuard.probation
  ) {
    const probationStrict =
      strictTechnicalQuality(
        signal,
        {
          minEdge:
            Math.max(
              8,
              tier.minEdge ||
              0
            ),
          requireMomentum3:
            cfg.sideProbationRequireMomentum3,
          requirePullback:
            cfg.sideProbationRequirePullback &&
            signalSetup === 'PULLBACK',
          requireOi:
            cfg.sideProbationRequireOi,
          requireTrendRegime:
            signalSetup === 'PULLBACK',
          requireStrongTrigger:
            signalSetup === 'PULLBACK'
        }
      );

    if (!probationStrict.ok) {
      const m =
        sideGuard.metrics;

      return {
        ok: false,
        reason:
          `SIDE PROBATION ${signalSide}: ` +
          `${m.wins}W/${m.losses}L · PF ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞'} · ` +
          probationStrict.reasons.join(' · ')
      };
    }
  }

  if (
    setupGuard.probation
  ) {
    const isPullback =
      signalSetup === 'PULLBACK';

    const setupStrict =
      strictTechnicalQuality(
        signal,
        {
          minEdge:
            isPullback
              ? 8
              : 10,
          requireMomentum3:
            cfg.setupProbationRequireMomentum3,
          requirePullback:
            isPullback,
          requireOi:
            cfg.setupProbationRequireOi,
          requireTrendRegime:
            isPullback &&
            cfg.setupProbationRequireTrend,
          requireStrongTrigger:
            isPullback &&
            cfg.setupProbationRequireStrongTrigger
        }
      );

    if (!setupStrict.ok) {
      const m =
        setupGuard.metrics;

      return {
        ok: false,
        reason:
          `SETUP PROBATION ${signalSetup}: ` +
          `${m.wins}W/${m.losses}L · ` +
          `PF ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞'} · ` +
          setupStrict.reasons.join(' · ')
      };
    }
  }

  const baseMinAiConfidence =
    Math.max(
      isBreakout
        ? Math.max(
            cfg.minAiConfidence,
            cfg.breakoutMinAiConfidence
          )
        : cfg.minAiConfidence,
      tier.strict
        ? tier.minAi
        : 0,
      sideGuard.probation
        ? cfg.sideProbationMinAi
        : 0,
      setupGuard.probation
        ? cfg.setupProbationMinAi
        : 0
    );

  const baseMinScore =
    Math.max(
      isBreakout
        ? Math.max(
            cfg.minScore,
            cfg.breakoutMinScore
          )
        : cfg.minScore,
      sideGuard.probation
        ? cfg.sideProbationMinScore
        : 0,
      setupGuard.probation
        ? cfg.setupProbationMinScore
        : 0
    );

  const effectiveMinAiConfidence =
    baseMinAiConfidence +
    (
      brake.active
        ? cfg.lossBrakeAiBoost
        : 0
    ) +
    (
      quality.active
        ? cfg.performanceQualityAiBoost
        : 0
    );

  const effectiveMinScore =
    baseMinScore +
    (
      brake.active
        ? cfg.lossBrakeScoreBoost
        : 0
    ) +
    (
      quality.active
        ? cfg.performanceQualityScoreBoost
        : 0
    );

  if (!cfg.enabled) {
    return {
      ok: false,
      reason: 'paper trading desativado'
    };
  }

  if (state.paused) {
    return {
      ok: false,
      reason: 'paper trading pausado'
    };
  }

  if (
    String(signal?.ai?.decision || '') !== 'APPROVE'
  ) {
    return {
      ok: false,
      reason:
        `IA ${signal?.ai?.decision || 'sem decisão'}`
    };
  }

  if (
    Number(signal?.ai?.confidence || 0) <
    effectiveMinAiConfidence
  ) {
    return {
      ok: false,
      reason:
        `IA ${Math.round(signal?.ai?.confidence || 0)}% < ` +
        `${effectiveMinAiConfidence}%` +
        `${isBreakout ? ' (BREAKOUT FORTE)' : ''}` +
        `${brake.active ? ` (LOSS BRAKE ${brake.count} perdas · ${brake.remainingMin.toFixed(0)}m)` : ''}` +
        `${quality.active ? ' (PERFORMANCE QUALITY)' : ''}` +
        `${tier.strict ? ` (${tier.tier})` : ''}` +
        `${sideGuard.probation ? ` (SIDE PROBATION ${signalSide})` : ''}` +
        `${setupGuard.probation ? ` (SETUP PROBATION ${signalSetup})` : ''}`
    };
  }

  if (
    Number(signal?.score || 0) <
    effectiveMinScore
  ) {
    return {
      ok: false,
      reason:
        `score ${signal?.score || 0} < ${effectiveMinScore}` +
        `${isBreakout ? ' (BREAKOUT FORTE)' : ''}` +
        `${tier.strict ? ` (${tier.tier})` : ''}` +
        `${sideGuard.probation ? ` (SIDE PROBATION ${signalSide})` : ''}` +
        `${setupGuard.probation ? ` (SETUP PROBATION ${signalSetup})` : ''}` +
        `${brake.active ? ` (LOSS BRAKE ${brake.count} perdas · ${brake.remainingMin.toFixed(0)}m)` : ''}`
    };
  }

  if (
    state.openPositions.length >=
    cfg.maxOpenPositions
  ) {
    return {
      ok: false,
      reason:
        `limite de posições ` +
        `${state.openPositions.length}/${cfg.maxOpenPositions}`
    };
  }

  if (
    cfg.onePositionPerSymbol &&
    sameSymbolOpen(signal)
  ) {
    return {
      ok: false,
      reason:
        `já existe posição aberta em ${signal.symbol}`
    };
  }

  const entriesToday =
    todayEntryCount();

  if (
    entriesToday >=
    cfg.maxTradesPerDay
  ) {
    return {
      ok: false,
      reason:
        `limite diário de entradas ` +
        `${entriesToday}/${cfg.maxTradesPerDay}`
    };
  }

  if (isDailyLossLocked()) {
    return {
      ok: false,
      reason:
        `limite diário de perda atingido ` +
        `(${cfg.dailyLossLimitPct.toFixed(1)}%)`
    };
  }

  if (cooldownBlocked(signal)) {
    return {
      ok: false,
      reason:
        `cooldown de ${cfg.cooldownMin} min`
    };
  }

  const key = signalKey(signal);

  if (state.seenSignalKeys.includes(key)) {
    return {
      ok: false,
      reason:
        'este sinal/candle já foi processado'
    };
  }

  return {
    ok: true,
    reason: 'aprovado para paper trading'
  };
}

export function paperEligibilityPreview(signal) {
  ensureDay();
  return eligibility(signal);
}

function validateLevels(signal, entryFill) {
  const stop = Number(signal.stop);
  const tp1 = Number(signal.tp1);
  const tp2 = Number(signal.tp2);
  const tp3 = Number(signal.tp3);

  const all =
    [stop, tp1, tp2, tp3];

  if (
    !all.every(Number.isFinite) ||
    !Number.isFinite(entryFill) ||
    entryFill <= 0
  ) {
    throw new Error(
      'níveis de entrada/stop/TP inválidos'
    );
  }

  if (signal.side === 'LONG') {
    if (!(stop < entryFill &&
          tp1 > entryFill &&
          tp2 >= tp1 &&
          tp3 >= tp2)) {
      throw new Error(
        'níveis LONG incoerentes'
      );
    }
  } else {
    if (!(stop > entryFill &&
          tp1 < entryFill &&
          tp2 <= tp1 &&
          tp3 <= tp2)) {
      throw new Error(
        'níveis SHORT incoerentes'
      );
    }
  }

  return {
    stop,
    tp1,
    tp2,
    tp3
  };
}

function projectedExitLeg({
  side,
  entryFill,
  exitReference,
  qty
}) {
  const cfg = paperConfig();

  const exitFill =
    adverseFill(
      exitReference,
      side,
      false
    );

  const gross =
    directionSign(side) *
    (exitFill - entryFill) *
    qty;

  const fee =
    exitFill *
    qty *
    cfg.feeRate;

  return {
    exitFill,
    gross,
    fee,
    netBeforeEntryFee:
      gross - fee
  };
}

function projectedTradeEconomics({
  side,
  entryFill,
  stop,
  tp1,
  tp2,
  tp3,
  qty = 1
}) {
  const cfg = paperConfig();

  const entryFee =
    entryFill *
    qty *
    cfg.feeRate;

  const stopLeg =
    projectedExitLeg({
      side,
      entryFill,
      exitReference: stop,
      qty
    });

  const stopNet =
    stopLeg.gross -
    stopLeg.fee -
    entryFee;

  const tp1Weight =
    0.30;

  const tp2Weight =
    0.30;

  const tp3Weight =
    cfg.trailingRunnerEnabled
      ? cfg.tp3ClosePct / 100
      : 0.40;

  const runnerWeight =
    cfg.trailingRunnerEnabled
      ? Math.max(
          0,
          1 -
          tp1Weight -
          tp2Weight -
          tp3Weight
        )
      : 0;

  const plannedLegs = [
    {
      reference: tp1,
      weight: tp1Weight
    },
    {
      reference: tp2,
      weight: tp2Weight
    },
    {
      reference: tp3,
      weight: tp3Weight
    }
  ];

  // Projeção conservadora:
  // após TP3 o runner ganha stop em TP2.
  // Para o Net R/R Guard, assume que o runner restante
  // acaba saindo em TP2. Qualquer extensão TP4+ é bônus.
  if (
    cfg.trailingRunnerEnabled &&
    runnerWeight > 0
  ) {
    plannedLegs.push({
      reference: tp2,
      weight: runnerWeight
    });
  }

  let targetGross = 0;
  let targetFees = 0;

  for (
    const planned of
    plannedLegs
  ) {
    if (
      !(planned.weight > 0)
    ) {
      continue;
    }

    const leg =
      projectedExitLeg({
        side,
        entryFill,
        exitReference:
          planned.reference,
        qty:
          qty *
          planned.weight
      });

    targetGross +=
      leg.gross;

    targetFees +=
      leg.fee;
  }

  const fullTpNet =
    targetGross -
    targetFees -
    entryFee;

  const stopLoss =
    Math.max(
      0,
      -stopNet
    );

  const netRR =
    stopLoss > 0
      ? fullTpNet / stopLoss
      : fullTpNet > 0
        ? Infinity
        : 0;

  // Pós-TP1, o stop não pode ultrapassar o próprio TP1.
  // Portanto, o melhor resultado líquido garantível naquele estágio
  // é equivalente a toda a posição sair no preço de referência TP1.
  const tp1AllExit =
    projectedExitLeg({
      side,
      entryFill,
      exitReference: tp1,
      qty
    });

  const netIfAllExitAtTp1 =
    tp1AllExit.gross -
    tp1AllExit.fee -
    entryFee;

  const protectTargetNet =
    entryFill *
    qty *
    cfg.profitProtectBufferPctNotional /
    100;

  return {
    entryFee,
    stopNet,
    stopLoss,
    fullTpNet,
    netRR,
    netIfAllExitAtTp1,
    protectTargetNet,
    tp1Protectable:
      netIfAllExitAtTp1 + 1e-12 >=
      protectTargetNet
  };
}

function scaledTargets(
  side,
  entryFill,
  levels,
  scale
) {
  const adjust = target =>
    entryFill +
    (Number(target) - entryFill) *
    scale;

  return {
    stop:
      Number(levels.stop),
    tp1:
      adjust(levels.tp1),
    tp2:
      adjust(levels.tp2),
    tp3:
      adjust(levels.tp3)
  };
}

function planMeetsNetGuard(
  economics,
  cfg
) {
  const rrOk =
    !cfg.netRrGuardEnabled ||
    (
      economics.fullTpNet > 0 &&
      economics.netRR >=
        cfg.minNetRR
    );

  const tp1Ok =
    !cfg.requireTp1NetProtectable ||
    economics.tp1Protectable;

  return rrOk && tp1Ok;
}

function prepareNetRRPlan({
  side,
  entryFill,
  levels
}) {
  const cfg = paperConfig();

  const originalEconomics =
    projectedTradeEconomics({
      side,
      entryFill,
      ...levels,
      qty: 1
    });

  if (
    planMeetsNetGuard(
      originalEconomics,
      cfg
    )
  ) {
    return {
      ok: true,
      levels,
      economics:
        originalEconomics,
      targetScale: 1,
      adjusted: false,
      originalEconomics
    };
  }

  if (!cfg.autoAdjustTargets) {
    return {
      ok: false,
      reason:
        `R/R líquido ${Number(originalEconomics.netRR || 0).toFixed(2)} ` +
        `< ${cfg.minNetRR.toFixed(2)} ou TP1 sem espaço para proteção líquida`,
      economics:
        originalEconomics,
      targetScale: 1,
      adjusted: false,
      originalEconomics
    };
  }

  const maxLevels =
    scaledTargets(
      side,
      entryFill,
      levels,
      cfg.maxTargetScale
    );

  const maxEconomics =
    projectedTradeEconomics({
      side,
      entryFill,
      ...maxLevels,
      qty: 1
    });

  if (
    !planMeetsNetGuard(
      maxEconomics,
      cfg
    )
  ) {
    return {
      ok: false,
      reason:
        `R/R líquido insuficiente mesmo com TPs x${cfg.maxTargetScale.toFixed(2)} ` +
        `(R/R ${Number(maxEconomics.netRR || 0).toFixed(2)})`,
      economics:
        maxEconomics,
      targetScale:
        cfg.maxTargetScale,
      adjusted: false,
      originalEconomics
    };
  }

  // Busca o menor multiplicador que satisfaz as duas condições:
  // R/R líquido mínimo e proteção líquida possível após TP1.
  let low = 1;
  let high =
    cfg.maxTargetScale;

  let bestScale =
    high;

  let bestLevels =
    maxLevels;

  let bestEconomics =
    maxEconomics;

  for (
    let i = 0;
    i < 36;
    i += 1
  ) {
    const mid =
      (low + high) / 2;

    const candidateLevels =
      scaledTargets(
        side,
        entryFill,
        levels,
        mid
      );

    const candidateEconomics =
      projectedTradeEconomics({
        side,
        entryFill,
        ...candidateLevels,
        qty: 1
      });

    if (
      planMeetsNetGuard(
        candidateEconomics,
        cfg
      )
    ) {
      bestScale =
        mid;

      bestLevels =
        candidateLevels;

      bestEconomics =
        candidateEconomics;

      high =
        mid;
    } else {
      low =
        mid;
    }
  }

  return {
    ok: true,
    levels:
      bestLevels,
    economics:
      bestEconomics,
    targetScale:
      bestScale,
    adjusted:
      bestScale > 1.0001,
    originalEconomics
  };
}

export function paperNetRRPreview(signal) {
  const rawEntry =
    Number(signal?.entry);

  if (
    !Number.isFinite(rawEntry) ||
    rawEntry <= 0
  ) {
    return {
      ok: false,
      reason: 'entrada inválida'
    };
  }

  const entryFill =
    adverseFill(
      rawEntry,
      signal.side,
      true
    );

  const levels =
    validateLevels(
      signal,
      entryFill
    );

  return {
    entryFill,
    ...prepareNetRRPlan({
      side:
        signal.side,
      entryFill,
      levels
    })
  };
}

export function maybeOpenPaperPosition(signal) {
  ensureDay();

  const gate = eligibility(signal);

  if (!gate.ok) {
    return {
      opened: false,
      reason: gate.reason
    };
  }

  const cfg = paperConfig();
  const rawEntry =
    Number(signal.entry);

  if (
    !Number.isFinite(rawEntry) ||
    rawEntry <= 0
  ) {
    return {
      opened: false,
      reason: 'entrada inválida'
    };
  }

  try {
    const entryFill =
      adverseFill(
        rawEntry,
        signal.side,
        true
      );

    const originalLevels =
      validateLevels(
        signal,
        entryFill
      );

    const netPlan =
      prepareNetRRPlan({
        side:
          signal.side,
        entryFill,
        levels:
          originalLevels
      });

    if (!netPlan.ok) {
      return {
        opened: false,
        reason:
          `NET R/R GUARD: ${netPlan.reason}`
      };
    }

    const levels =
      validateLevels(
        {
          ...signal,
          stop:
            netPlan.levels.stop,
          tp1:
            netPlan.levels.tp1,
          tp2:
            netPlan.levels.tp2,
          tp3:
            netPlan.levels.tp3
        },
        entryFill
      );

    const riskStatus =
      effectiveRiskStatus();

    const effectiveRiskPct =
      riskStatus.riskPct;

    const riskBudget =
      Math.max(
        0,
        state.balance *
        effectiveRiskPct / 100
      );

    // V1.6.5:
    // sizing baseado no prejuízo LÍQUIDO por unidade,
    // incluindo taxa de entrada, taxa de saída e slippage.
    const perUnitEconomics =
      projectedTradeEconomics({
        side:
          signal.side,
        entryFill,
        ...levels,
        qty: 1
      });

    const netRiskPerUnit =
      perUnitEconomics.stopLoss;

    if (
      !Number.isFinite(netRiskPerUnit) ||
      netRiskPerUnit <= 0
    ) {
      return {
        opened: false,
        reason:
          'risco líquido do stop inválido'
      };
    }

    const qtyByRisk =
      riskBudget /
      netRiskPerUnit;

    const maxMargin =
      state.balance *
      cfg.maxMarginPct / 100;

    const maxNotional =
      Math.min(
        maxMargin * cfg.leverage,
        availableBalance() * cfg.leverage
      );

    const riskNotional =
      qtyByRisk * entryFill;

    const notional =
      Math.min(
        riskNotional,
        maxNotional
      );

    if (
      !Number.isFinite(notional) ||
      notional < cfg.minNotional
    ) {
      return {
        opened: false,
        reason:
          `notional calculado ${Number(notional || 0).toFixed(2)} < ` +
          `${cfg.minNotional.toFixed(2)} USDC`
      };
    }

    const qty =
      notional / entryFill;

    const margin =
      notional / cfg.leverage;

    const entryFee =
      notional * cfg.feeRate;

    if (
      margin + entryFee >
      availableBalance()
    ) {
      return {
        opened: false,
        reason:
          'saldo disponível insuficiente para margem + taxa'
      };
    }

    state.balance -= entryFee;
    state.totalFees += entryFee;

    const key =
      signalKey(signal);

    const position = {
      id:
        `paper_${Date.now()}_` +
        String(signal.symbol)
          .replace(/[^A-Z0-9]/gi, ''),
      signalKey: key,
      symbol: signal.symbol,
      dataSymbol:
        signal.dataSymbol || signal.symbol,
      side: signal.side,
      score: Number(signal.score || 0),
      aiDecision:
        signal.ai?.decision || 'APPROVE',
      aiConfidence:
        Number(signal.ai?.confidence || 0),
      tradeStyle:
        signal.tradeStyle || 'SCALP_5M',

      smartStopMode:
        signal.stopMode || null,
      smartStopAtrMultiple:
        Number.isFinite(Number(signal.stopAtrMultiple))
          ? Number(signal.stopAtrMultiple)
          : null,
      smartStopPct:
        Number.isFinite(Number(signal.stopPct))
          ? Number(signal.stopPct)
          : null,
      smartStopStructure:
        Number.isFinite(Number(signal.structurePrice))
          ? Number(signal.structurePrice)
          : null,

      setupDirectionEdge:
        Number(signal.directionEdge || 0),
      setupLongScore:
        Number(signal.longScore || 0),
      setupShortScore:
        Number(signal.shortScore || 0),
      setupStructure1h:
        signal.structure1h || null,
      setupStructure4h:
        signal.structure4h || null,
      setupVolumeRatio:
        Number(signal.t5?.volumeRatio || 0),
      setupOiPct:
        Number(signal.oiPct || 0),
      setupBtcRegime:
        signal.btcRegime?.regime || null,
      setupBtcExceptional:
        Boolean(signal.btcRegime?.exceptional),
      setupAntiChaseRetest:
        Boolean(signal.antiChase?.retest),
      setupEntryMode:
        signal.entryMode || 'PULLBACK',
      setupPullbackConfirmed:
        Boolean(signal.pullback?.confirmed),
      setupPullbackBodyAtr:
        Number(signal.pullback?.bodyAtr || 0),
      setupPullbackDistanceAtr:
        Number(signal.pullback?.distanceAtr || 0),
      setupOiContextRegime:
        signal.oiContext?.regime || null,
      setupOiRecentPct:
        Number(signal.oiContext?.oiPct ?? signal.oiPct ?? 0),
      setupPrice30mPct:
        Number(signal.oiContext?.pricePct || 0),
      setupMarketRegime:
        signal.marketRegime?.regime || null,
      setupMarketRegimeReason:
        signal.marketRegime?.reason || null,
      setupPullbackStrongTrigger:
        Boolean(signal.pullback?.strongTrigger),
      setupPullbackTriggerQuality:
        Number(signal.pullback?.triggerQuality || 0),
      setupEmaSlope15:
        Number(signal.pullback?.slope15 || signal.marketRegime?.slope15 || 0),
      setupEmaSlope1h:
        Number(signal.pullback?.slope1h || signal.marketRegime?.slope1h || 0),
      effectiveRiskPct:
        Number(effectiveRiskPct),
      confirmedEntryUsed:
        Boolean(signal.confirmedEntry),
      confirmedEntryTriggerBarTime:
        Number(signal.confirmedEntry?.triggerBarTime || 0),
      confirmedEntryBarTime:
        Number(signal.confirmedEntry?.confirmationBarTime || 0),
      confirmedEntryChaseAtr:
        Number(signal.confirmedEntry?.chaseAtr || 0),
      confirmedEntryVolumeRatio:
        Number(signal.confirmedEntry?.confirmationVolumeRatio || 0),
      confirmedEntryOriginRegime:
        signal.confirmedEntry?.originRegime || null,
      confirmedEntryConfirmationRegime:
        signal.confirmedEntry?.confirmationRegime || null,
      confirmedEntryNoSecondAi:
        Boolean(signal.confirmedEntry?.noSecondAiCall),
      adaptiveHoldCheckpointNotified: false,
      adaptiveHoldCheckpointAt: 0,
      adaptiveHoldCheckpointStage: 0,

      mfeR: 0,
      maeR: 0,
      mfePct: 0,
      maePct: 0,
      maxFavorablePrice:
        entryFill,
      maxAdversePrice:
        entryFill,

      staleBadChecks: 0,
      staleLastDeteriorationCount: 0,
      staleLastStructureAligned: true,
      staleLastProgressR: 0,
      staleLastAssessmentAt: 0,

      openedAt: Date.now(),
      openBarTime:
        Number(signal.t5?.openTime ?? signal.t15?.openTime ?? 0),
      lastProcessedBarTime:
        Number(signal.t5?.openTime ?? signal.t15?.openTime ?? 0),

      entryReference:
        rawEntry,
      entryFill,
      stopInitial:
        levels.stop,
      stopCurrent:
        levels.stop,
      tp1:
        levels.tp1,
      tp2:
        levels.tp2,
      tp3:
        levels.tp3,

      initialQty:
        qty,
      remainingQty:
        qty,
      initialNotional:
        notional,
      initialMargin:
        margin,
      leverage:
        cfg.leverage,
      riskBudget,
      entryFee,

      // V1.6.5: economia projetada do trade já com custos.
      targetScale:
        netPlan.targetScale,
      targetsAutoAdjusted:
        netPlan.adjusted,
      originalTp1:
        originalLevels.tp1,
      originalTp2:
        originalLevels.tp2,
      originalTp3:
        originalLevels.tp3,

      trailingRunnerEnabled:
        cfg.trailingRunnerEnabled,
      tp3ClosePct:
        cfg.tp3ClosePct,
      runnerPct:
        cfg.trailingRunnerEnabled
          ? Math.max(
              0,
              40 -
              cfg.tp3ClosePct
            )
          : 0,
      runnerStepGapMultiplier:
        cfg.runnerStepGapMultiplier,
      runnerActive:
        false,
      runnerTrailStage:
        3,
      runnerLastTrigger:
        null,
      runnerNextTrigger:
        null,
      runnerStepDistance:
        null,

      stage: 0,
      realizedGrossPnl: 0,
      exitFees: 0,
      lastMark:
        rawEntry,
      exitLegs: []
    };

    const actualEconomics =
      projectedTradeEconomics({
        side:
          position.side,
        entryFill:
          position.entryFill,
        stop:
          position.stopInitial,
        tp1:
          position.tp1,
        tp2:
          position.tp2,
        tp3:
          position.tp3,
        qty:
          position.initialQty
      });

    position.projectedStopNetUsdc =
      actualEconomics.stopNet;

    position.projectedStopLossUsdc =
      actualEconomics.stopLoss;

    position.projectedFullTpNetUsdc =
      actualEconomics.fullTpNet;

    position.projectedNetRR =
      actualEconomics.netRR;

    position.projectedTp1ProtectNetUsdc =
      actualEconomics.netIfAllExitAtTp1;

    position.tp1NetProtectable =
      actualEconomics.tp1Protectable;

    state.openPositions.push(position);
    state.seenSignalKeys.push(key);

    if (state.seenSignalKeys.length > 500) {
      state.seenSignalKeys =
        state.seenSignalKeys.slice(-500);
    }

    state.lastOpenAt[signal.symbol] =
      Date.now();

    updateDrawdown();
    saveState();

    return {
      opened: true,
      position,
      message:
        `🧪 <b>PAPER TRADE ABERTO</b>\n` +
        `${signal.side === 'LONG' ? '🟢' : '🔴'} ` +
        `<b>${signal.symbol} ${signal.side}</b>\n` +
        `⭐ Score ${position.score} · 🤖 IA ${Math.round(position.aiConfidence)}%\n` +
        `🧭 Entrada: ${position.setupEntryMode || 'PULLBACK'}\n` +
        `💰 Entrada simulada: ${round(entryFill)}\n` +
        `🛑 Stop: ${round(position.stopCurrent)}\n` +
        `${position.smartStopMode ? `🧠 Smart Stop: ${position.smartStopMode}` +
          `${Number.isFinite(position.smartStopAtrMultiple) ? ` · ${position.smartStopAtrMultiple.toFixed(2)} ATR` : ''}` +
          `${Number.isFinite(position.smartStopPct) ? ` · ${position.smartStopPct.toFixed(2)}%` : ''}\n` : ''}` +
        `🎯 TP1 ${round(position.tp1)} · TP2 ${round(position.tp2)} · TP3 ${round(position.tp3)}\n` +
        `${position.targetsAutoAdjusted ? `🧮 TPs autoajustados: x${position.targetScale.toFixed(2)} para respeitar R/R líquido\n` : ''}` +
        `📦 Notional: ${notional.toFixed(2)} USDC · Margem: ${margin.toFixed(2)} USDC · ${cfg.leverage}x\n` +
        `🛑 Risco líquido projetado no STOP: -${position.projectedStopLossUsdc.toFixed(3)} USDC\n` +
        `🏆 Lucro líquido projetado TP ladder: +${position.projectedFullTpNetUsdc.toFixed(3)} USDC\n` +
        `⚖️ R/R líquido projetado: ${Number(position.projectedNetRR).toFixed(2)} · mínimo ${cfg.minNetRR.toFixed(2)}\n` +
        `${cfg.trailingRunnerEnabled ? `🪜 Stop Gain: TP1→BE líquido · TP2→TP1 · TP3→TP2 · depois runner sobe por degraus\n` : ''}` +
        `${cfg.trailingRunnerEnabled ? `🏃 Saídas: 30% / 30% / ${cfg.tp3ClosePct.toFixed(0)}% · runner ${Math.max(0, 40 - cfg.tp3ClosePct).toFixed(0)}%\n` : ''}` +
        `🌦 Regime: ${position.setupMarketRegime || 'UNKNOWN'} · trigger ${position.setupPullbackTriggerQuality || 0}/5\n` +
        `${position.confirmedEntryUsed ? `✅ Confirmed Entry: 2º candle 5m · ${position.confirmedEntryOriginRegime || 'TREND'}→${position.confirmedEntryConfirmationRegime || '—'} · chase ${position.confirmedEntryChaseAtr.toFixed(2)} ATR · vol ${position.confirmedEntryVolumeRatio.toFixed(2)}x\n` : ''}` +
        `🎚 Teto de risco da banca: ${riskBudget.toFixed(3)} USDC (${effectiveRiskPct.toFixed(2)}%)${riskStatus.throttled ? ' · THROTTLE QUALIDADE' : ''}\n` +
        `💸 Taxa de entrada simulada: ${entryFee.toFixed(4)} USDC`
    };
  } catch (error) {
    return {
      opened: false,
      reason:
        String(error.message || error)
    };
  }
}

function hitLevel(position, high, low, price) {
  if (position.side === 'LONG') {
    return high >= price;
  }

  return low <= price;
}

function hitStop(position, high, low) {
  if (position.side === 'LONG') {
    return low <= position.stopCurrent;
  }

  return high >= position.stopCurrent;
}

function closeQty(position, qty, exitReference, label) {
  const cfg = paperConfig();

  const actualQty =
    Math.min(
      position.remainingQty,
      Math.max(0, qty)
    );

  if (actualQty <= 0) {
    return null;
  }

  const exitFill =
    adverseFill(
      exitReference,
      position.side,
      false
    );

  const gross =
    directionSign(position.side) *
    (exitFill - position.entryFill) *
    actualQty;

  const fee =
    exitFill *
    actualQty *
    cfg.feeRate;

  const net =
    gross - fee;

  state.balance += net;
  state.totalGrossPnl += gross;
  state.totalNetPnl += net;
  state.totalFees += fee;
  state.day.realizedPnl += net;

  position.realizedGrossPnl += gross;
  position.exitFees += fee;
  position.remainingQty -= actualQty;

  if (position.remainingQty < 1e-12) {
    position.remainingQty = 0;
  }

  const leg = {
    label,
    at: Date.now(),
    qty: actualQty,
    exitReference,
    exitFill,
    grossPnl: gross,
    fee,
    netPnl: net
  };

  position.exitLegs.push(leg);

  return leg;
}

function finalizePosition(position, outcome, exitMark) {
  const idx =
    state.openPositions.findIndex(
      p => p.id === position.id
    );

  if (idx >= 0) {
    state.openPositions.splice(idx, 1);
  }

  const gross =
    Number(position.realizedGrossPnl || 0);

  const fees =
    Number(position.entryFee || 0) +
    Number(position.exitFees || 0);

  const net =
    gross - fees;

  const closed = {
    ...position,
    outcome,
    closedAt: Date.now(),
    exitMark:
      Number(exitMark || position.lastMark || 0),
    grossPnl: gross,
    totalFees: fees,
    netPnl: net,
    returnOnMarginPct:
      position.initialMargin > 0
        ? net / position.initialMargin * 100
        : 0
  };

  delete closed.remainingQty;

  state.closedTrades.unshift(closed);

  if (state.closedTrades.length > 300) {
    state.closedTrades =
      state.closedTrades.slice(0, 300);
  }

  state.day.trades += 1;

  updateDrawdown();
  saveState();

  return closed;
}

function positionCloseMessage(closed) {
  const icon =
    closed.netPnl > 0.000001
      ? '✅'
      : closed.netPnl < -0.000001
        ? '🛑'
        : '➖';

  return (
    `${icon} <b>PAPER TRADE ENCERRADO</b>\n` +
    `${closed.side === 'LONG' ? '🟢' : '🔴'} ` +
    `<b>${closed.symbol} ${closed.side}</b>\n` +
    `Motivo: ${closed.outcome}\n` +
    `💵 PnL líquido: ${closed.netPnl >= 0 ? '+' : ''}${closed.netPnl.toFixed(2)} USDC\n` +
    `💸 Taxas simuladas: ${closed.totalFees.toFixed(4)} USDC\n` +
    `📊 Retorno sobre margem: ${closed.returnOnMarginPct >= 0 ? '+' : ''}${closed.returnOnMarginPct.toFixed(2)}%\n` +
    `📈 MFE: +${Number(closed.mfeR || 0).toFixed(2)}R · 📉 MAE: -${Number(closed.maeR || 0).toFixed(2)}R\n` +
    `${closed.setupOiContextRegime ? `🧭 Setup: ${closed.setupEntryMode || 'PULLBACK'} · ${closed.setupOiContextRegime} · pullback ${closed.setupPullbackConfirmed ? 'SIM' : 'NÃO'}\n` : ''}` +
    `${closed.setupMarketRegime ? `🌦 Regime: ${closed.setupMarketRegime} · trigger ${Number(closed.setupPullbackTriggerQuality || 0)}/5\n` : ''}` +
    `${closed.confirmedEntryUsed ? `✅ Confirmed Entry: SIM · chase ${Number(closed.confirmedEntryChaseAtr || 0).toFixed(2)} ATR · vol ${Number(closed.confirmedEntryVolumeRatio || 0).toFixed(2)}x\n` : ''}` +
    `🏦 Banca: ${state.balance.toFixed(2)} USDC`
  );
}

function profitProtectTargetNet(position) {
  const cfg = paperConfig();

  const notional =
    Number(position?.initialNotional || 0);

  if (
    !Number.isFinite(notional) ||
    notional <= 0
  ) {
    return 0;
  }

  return (
    notional *
    cfg.profitProtectBufferPctNotional /
    100
  );
}

function clampProtectedStop(
  position,
  desiredStop,
  stage
) {
  const desired =
    Number(desiredStop);

  if (!Number.isFinite(desired)) {
    return Number(position.entryFill);
  }

  const entry =
    Number(position.entryFill);

  const tp1 =
    Number(position.tp1);

  const tp2 =
    Number(position.tp2);

  if (position.side === 'LONG') {
    if (stage <= 1) {
      // Pós-TP1: entre entrada e TP1.
      return Math.min(
        tp1,
        Math.max(entry, desired)
      );
    }

    // Pós-TP2: nunca abaixo de TP1 nem acima de TP2.
    return Math.min(
      tp2,
      Math.max(tp1, desired)
    );
  }

  if (stage <= 1) {
    // SHORT pós-TP1: entre TP1 e entrada.
    return Math.max(
      tp1,
      Math.min(entry, desired)
    );
  }

  // SHORT pós-TP2: nunca acima de TP1 nem abaixo de TP2.
  return Math.max(
    tp2,
    Math.min(tp1, desired)
  );
}

function profitProtectStopReference(
  position,
  targetNetUsdc = 0
) {
  const cfg = paperConfig();

  if (
    !cfg.profitProtectEnabled ||
    !position ||
    !(position.remainingQty > 0)
  ) {
    return Number(position?.entryFill || 0);
  }

  const qty =
    Number(position.remainingQty || 0);

  const entry =
    Number(position.entryFill || 0);

  const realizedGross =
    Number(position.realizedGrossPnl || 0);

  const feesPaid =
    Number(position.entryFee || 0) +
    Number(position.exitFees || 0);

  const fee =
    Number(cfg.feeRate || 0);

  const slip =
    Number(cfg.slippageBps || 0) /
    10000;

  let desiredExitFill;

  if (position.side === 'LONG') {
    // target =
    // realizedGross + (exit-entry)*qty
    // - feesPaid - exit*qty*fee
    const numerator =
      targetNetUsdc -
      realizedGross +
      entry * qty +
      feesPaid;

    desiredExitFill =
      numerator /
      (qty * (1 - fee));

    // LONG: adverseFill(ref) = ref * (1-slip)
    const ref =
      desiredExitFill /
      Math.max(1e-9, 1 - slip);

    // Nunca deixa a proteção pós-TP1 pior que a própria entrada.
    return Math.max(
      entry,
      ref
    );
  }

  // SHORT:
  // target =
  // realizedGross + (entry-exit)*qty
  // - feesPaid - exit*qty*fee
  const numerator =
    realizedGross +
    entry * qty -
    feesPaid -
    targetNetUsdc;

  desiredExitFill =
    numerator /
    (qty * (1 + fee));

  // SHORT: adverseFill(ref) = ref * (1+slip)
  const ref =
    desiredExitFill /
    (1 + slip);

  // Nunca deixa a proteção pós-TP1 pior que a própria entrada.
  return Math.min(
    entry,
    ref
  );
}

function moreProtectiveStop(
  position,
  a,
  b
) {
  if (position.side === 'LONG') {
    return Math.max(
      Number(a),
      Number(b)
    );
  }

  return Math.min(
    Number(a),
    Number(b)
  );
}


function clampBetween(
  value,
  a,
  b
) {
  const low =
    Math.min(
      Number(a),
      Number(b)
    );

  const high =
    Math.max(
      Number(a),
      Number(b)
    );

  return Math.min(
    high,
    Math.max(
      low,
      Number(value)
    )
  );
}

function runnerAdvance(
  position,
  price
) {
  const step =
    Number(
      position.runnerStepDistance ||
      0
    );

  if (!(step > 0)) {
    return null;
  }

  return position.side === 'LONG'
    ? Number(price) + step
    : Number(price) - step;
}

function setupRunnerAfterTp3(
  position
) {
  const cfg =
    paperConfig();

  if (
    !cfg.trailingRunnerEnabled ||
    !(position.remainingQty > 0)
  ) {
    return false;
  }

  const gap32 =
    Math.abs(
      Number(position.tp3) -
      Number(position.tp2)
    );

  const gap21 =
    Math.abs(
      Number(position.tp2) -
      Number(position.tp1)
    );

  const initialRisk =
    Math.abs(
      Number(position.entryFill) -
      Number(position.stopInitial)
    );

  const baseStep =
    gap32 > 0
      ? gap32
      : gap21 > 0
        ? gap21
        : initialRisk > 0
          ? initialRisk * 0.70
          : 0;

  if (!(baseStep > 0)) {
    return false;
  }

  position.runnerActive =
    true;

  position.runnerTrailStage =
    3;

  position.runnerLastTrigger =
    Number(position.tp3);

  position.runnerStepDistance =
    baseStep *
    cfg.runnerStepGapMultiplier;

  position.runnerNextTrigger =
    runnerAdvance(
      position,
      position.runnerLastTrigger
    );

  return (
    Number.isFinite(
      position.runnerNextTrigger
    )
  );
}

function runnerMessage(
  position,
  leg
) {
  return (
    `🏃 <b>PAPER ${position.symbol} ${position.side}</b> — TP3 + RUNNER\\n` +
    `Fechou ${round(leg.qty, 8)} unidade(s) @ ${round(leg.exitFill)}\\n` +
    `PnL líquido desta perna: ${leg.netPnl >= 0 ? '+' : ''}${leg.netPnl.toFixed(2)} USDC\\n` +
    `📦 Runner restante: ${(position.remainingQty / position.initialQty * 100).toFixed(0)}%\\n` +
    `🛡 Stop Gain: ${round(position.stopCurrent)}\\n` +
    `🎯 Próximo degrau TP${position.runnerTrailStage + 1}: ${round(position.runnerNextTrigger)}`
  );
}

function runnerStepMessage(
  position,
  fromStage,
  toStage,
  oldStop
) {
  const crossed =
    toStage > fromStage
      ? `TP${fromStage + 1}→TP${toStage}`
      : `TP${toStage}`;

  return (
    `🪜 <b>STOP GAIN SUBIU</b> — ${position.symbol} ${position.side}\\n` +
    `🎯 Degrau(s): ${crossed}\\n` +
    `🛡 Stop: ${round(oldStop)} → <b>${round(position.stopCurrent)}</b>\\n` +
    `🏃 Runner: ${(position.remainingQty / position.initialQty * 100).toFixed(0)}% restante\\n` +
    `➡️ Próximo TP${position.runnerTrailStage + 1}: ${round(position.runnerNextTrigger)}`
  );
}

function partialMessage(position, leg, levelName) {
  return (
    `🎯 <b>PAPER ${position.symbol} ${position.side}</b> — ${levelName}\n` +
    `Fechou ${round(leg.qty, 8)} unidade(s) @ ${round(leg.exitFill)}\n` +
    `PnL líquido desta perna: ${leg.netPnl >= 0 ? '+' : ''}${leg.netPnl.toFixed(2)} USDC\n` +
    `🛡 Novo stop: ${round(position.stopCurrent)}`
  );
}

function closeRemainingAt(position, reference, outcome) {
  const leg =
    closeQty(
      position,
      position.remainingQty,
      reference,
      outcome
    );

  const closed =
    finalizePosition(
      position,
      outcome,
      reference
    );

  return {
    leg,
    closed
  };
}

function moderateTargetFirst(
  position,
  fastTf,
  nextTarget
) {
  const stop =
    Number(position.stopCurrent);

  const target =
    Number(nextTarget);

  const close =
    Number(
      fastTf?.close ??
      fastTf?.price
    );

  if (
    !Number.isFinite(stop) ||
    !Number.isFinite(target) ||
    !Number.isFinite(close)
  ) {
    return false;
  }

  // Critério MODERADO:
  // se STOP e alvo foram tocados no mesmo candle de 5m,
  // usa a posição do fechamento entre os dois níveis para inferir
  // qual lado teve mais domínio no candle.
  const midpoint =
    (stop + target) / 2;

  if (position.side === 'LONG') {
    return close >= midpoint;
  }

  return close <= midpoint;
}


function tfStructureSide(
  tf
) {
  const price =
    Number(
      tf?.price ??
      tf?.close
    );

  const ema20 =
    Number(
      tf?.ema20
    );

  const ema50 =
    Number(
      tf?.ema50
    );

  if (
    !Number.isFinite(price) ||
    !Number.isFinite(ema20) ||
    !Number.isFinite(ema50)
  ) {
    return 'MIXED';
  }

  if (
    price >
      ema20 &&
    ema20 >
      ema50
  ) {
    return 'LONG';
  }

  if (
    price <
      ema20 &&
    ema20 <
      ema50
  ) {
    return 'SHORT';
  }

  return 'MIXED';
}

function oiDeterioratedForSide(
  side,
  snap
) {
  const regime =
    String(
      snap?.oiContext?.regime ||
      ''
    ).toUpperCase();

  if (regime) {
    if (side === 'LONG') {
      return [
        'SHORT_BUILDUP',
        'LONG_UNWIND',
        'OI_UNWIND_NEUTRAL_PRICE'
      ].includes(
        regime
      );
    }

    return [
      'LONG_BUILDUP',
      'SHORT_COVERING',
      'OI_UNWIND_NEUTRAL_PRICE'
    ].includes(
      regime
    );
  }

  const oiPct =
    Number(
      snap?.oiPct ||
      0
    );

  return (
    Number.isFinite(oiPct) &&
    oiPct < 0
  );
}

function adaptiveStaleAssessment(
  position,
  snap,
  mark,
  ageMin,
  cfg,
  {
    stopTouched = false,
    targetTouched = false
  } = {}
) {
  const initialRiskDistance =
    Math.abs(
      Number(position.entryFill) -
      Number(position.stopInitial)
    );

  const directionalMove =
    directionSign(
      position.side
    ) *
    (
      Number(mark) -
      Number(position.entryFill)
    );

  const progressR =
    initialRiskDistance > 0
      ? directionalMove /
        initialRiskDistance
      : 0;

  const mfeR =
    Math.max(
      0,
      Number(
        position.mfeR ||
        0
      )
    );

  const currentVolumeRatio =
    Number(
      snap?.t5?.volumeRatio ||
      0
    );

  const currentMacd =
    Number(
      snap?.t5?.macdHist ||
      0
    );

  const volumeBad =
    currentVolumeRatio <
    cfg.scalpStaleMinVolumeRatio;

  const oiBad =
    oiDeterioratedForSide(
      position.side,
      snap
    );

  const macdBad =
    position.side === 'LONG'
      ? !(currentMacd > 0)
      : !(currentMacd < 0);

  const deteriorationCount =
    [
      volumeBad,
      oiBad,
      macdBad
    ].filter(Boolean).length;

  const structure15 =
    tfStructureSide(
      snap?.t15
    );

  const structure1h =
    tfStructureSide(
      snap?.t1h
    );

  const structureAligned =
    structure15 ===
      position.side &&
    structure1h ===
      position.side;

  const tradePositive =
    progressR > 0;

  const protectedByPriceEvent =
    Boolean(
      stopTouched ||
      targetTouched
    );

  const earlyCandidate =
    Number(position.stage || 0) === 0 &&
    ageMin >=
      cfg.scalpStaleMin &&
    ageMin <
      cfg.scalpStaleMaxMin &&
    mfeR <
      cfg.scalpStaleMinProgressR &&
    !tradePositive &&
    deteriorationCount >=
      cfg.scalpStaleDeteriorationCount &&
    !structureAligned &&
    !protectedByPriceEvent;

  const hardStale =
    Number(position.stage || 0) === 0 &&
    ageMin >=
      cfg.scalpStaleMaxMin &&
    mfeR <
      cfg.scalpStaleHardProgressR &&
    !protectedByPriceEvent;

  return {
    earlyCandidate,
    hardStale,
    progressR,
    mfeR,
    tradePositive,
    deteriorationCount,
    volumeBad,
    oiBad,
    macdBad,
    structure15,
    structure1h,
    structureAligned,
    protectedByPriceEvent,
    currentVolumeRatio
  };
}

export function adaptiveStalePreview({
  side = 'LONG',
  entryFill = 100,
  stopInitial = 99,
  stage = 0,
  mfeR = 0,
  mark = 100,
  ageMin = 60,
  badChecks = 0,
  volumeRatio = 0.30,
  macdHist = -0.1,
  oiRegime = 'LONG_UNWIND',
  oiPct = -0.10,
  t15 = null,
  t1h = null,
  stopTouched = false,
  targetTouched = false,
  config = {}
} = {}) {
  const cfg = {
    ...paperConfig(),
    ...config
  };

  const position = {
    side,
    entryFill,
    stopInitial,
    stage,
    mfeR,
    staleBadChecks:
      badChecks
  };

  const snap = {
    oiPct,
    oiContext: {
      regime:
        oiRegime
    },
    t5: {
      volumeRatio,
      macdHist
    },
    t15,
    t1h
  };

  return adaptiveStaleAssessment(
    position,
    snap,
    mark,
    ageMin,
    cfg,
    {
      stopTouched,
      targetTouched
    }
  );
}

function adaptiveHoldAssessment(
  position,
  {
    ageHours = 0,
    config = null
  } = {}
) {
  const cfg =
    config || paperConfig();

  const checkpointHours =
    Number(
      cfg.maxHoldHours ||
      2
    );

  const hardMaxHours =
    Number(
      cfg.adaptiveHoldHardMaxHours ||
      0
    );

  const stage =
    Number(
      position?.stage ||
      0
    );

  const runnerActive =
    Boolean(
      position?.runnerActive
    );

  const protectedTrade =
    stage >= 1 ||
    runnerActive;

  if (
    !cfg.adaptiveHoldEnabled
  ) {
    return {
      action: 'LEGACY_TIMEOUT',
      protectedTrade,
      checkpointHours,
      hardMaxHours
    };
  }

  if (
    ageHours <
    checkpointHours
  ) {
    return {
      action: 'WAIT',
      protectedTrade,
      checkpointHours,
      hardMaxHours
    };
  }

  if (
    protectedTrade &&
    cfg.adaptiveHoldNoTimeoutAfterTp1
  ) {
    return {
      action: 'HOLD_PROTECTED',
      protectedTrade: true,
      checkpointHours,
      hardMaxHours
    };
  }

  if (
    !protectedTrade &&
    hardMaxHours > 0 &&
    ageHours >=
      hardMaxHours
  ) {
    return {
      action: 'CLOSE_HARD_MAX',
      protectedTrade: false,
      checkpointHours,
      hardMaxHours
    };
  }

  return {
    action: 'HOLD_UNPROTECTED',
    protectedTrade: false,
    checkpointHours,
    hardMaxHours
  };
}

export function adaptiveHoldPreview({
  stage = 0,
  runnerActive = false,
  ageHours = 2,
  config = {}
} = {}) {
  const cfg = {
    ...paperConfig(),
    ...config
  };

  return adaptiveHoldAssessment(
    {
      stage,
      runnerActive
    },
    {
      ageHours,
      config: cfg
    }
  );
}

function adaptiveHoldCheckpointMessage(
  position,
  assessment
) {
  const checkpoint =
    Number(
      assessment.checkpointHours ||
      0
    );

  if (
    assessment.action ===
    'HOLD_PROTECTED'
  ) {
    return (
      `⏳ <b>ADAPTIVE HOLD — ${position.symbol} ${position.side}</b>\n` +
      `Checkpoint ${checkpoint.toFixed(1)}h atingido.\n` +
      `🛡 Trade já protegido após TP${Math.max(1, Number(position.stage || 1))}: timeout por tempo DESLIGADO.\n` +
      `➡️ Continua até STOP / STOP GAIN / Runner.`
    );
  }

  const hardMax =
    Number(
      assessment.hardMaxHours ||
      0
    );

  return (
    `⏳ <b>ADAPTIVE HOLD — ${position.symbol} ${position.side}</b>\n` +
    `Checkpoint ${checkpoint.toFixed(1)}h atingido sem fechamento forçado.\n` +
    `📈 Posição ainda sem TP1: continua com STOP/TP e gerenciamento normal.` +
    (
      hardMax > 0
        ? `\n🧯 Segurança: máximo ${hardMax.toFixed(1)}h apenas se nunca alcançar TP1.`
        : `\n🧯 Limite máximo por tempo: DESLIGADO.`
    )
  );
}

function updateOnePosition(position, snap) {
  const cfg = paperConfig();
  const events = [];

  const fastTf =
    snap?.t5 || snap?.t15;

  if (
    !fastTf ||
    Number(fastTf.openTime || 0) <=
    Number(position.lastProcessedBarTime || 0)
  ) {
    return events;
  }

  const high =
    Number(fastTf.high);

  const low =
    Number(fastTf.low);

  const mark =
    Number(
      fastTf.price ??
      fastTf.close ??
      position.lastMark ??
      position.entryFill
    );

  if (
    !Number.isFinite(high) ||
    !Number.isFinite(low)
  ) {
    return events;
  }

  position.lastProcessedBarTime =
    Number(fastTf.openTime || 0);

  if (
    Number.isFinite(mark) &&
    mark > 0
  ) {
    position.lastMark = mark;
  }

  // V1.7.3 MFE/MAE:
  // mede a melhor e a pior excursão intratrade em múltiplos de R.
  // Isso permite separar entrada ruim de gestão ruim.
  const initialRiskDistance =
    Math.abs(
      Number(position.entryFill) -
      Number(position.stopInitial)
    );

  if (
    initialRiskDistance > 0
  ) {
    const favorablePrice =
      position.side === 'LONG'
        ? high
        : low;

    const adversePrice =
      position.side === 'LONG'
        ? low
        : high;

    const favorableMove =
      position.side === 'LONG'
        ? favorablePrice -
          position.entryFill
        : position.entryFill -
          favorablePrice;

    const adverseMove =
      position.side === 'LONG'
        ? position.entryFill -
          adversePrice
        : adversePrice -
          position.entryFill;

    const mfeR =
      Math.max(
        0,
        favorableMove /
          initialRiskDistance
      );

    const maeR =
      Math.max(
        0,
        adverseMove /
          initialRiskDistance
      );

    position.mfeR =
      Math.max(
        Number(position.mfeR || 0),
        mfeR
      );

    position.maeR =
      Math.max(
        Number(position.maeR || 0),
        maeR
      );

    position.mfePct =
      Math.max(
        Number(position.mfePct || 0),
        position.entryFill > 0
          ? Math.max(
              0,
              favorableMove /
                position.entryFill *
                100
            )
          : 0
      );

    position.maePct =
      Math.max(
        Number(position.maePct || 0),
        position.entryFill > 0
          ? Math.max(
              0,
              adverseMove /
                position.entryFill *
                100
            )
          : 0
      );

    if (
      position.side === 'LONG'
    ) {
      position.maxFavorablePrice =
        Math.max(
          Number(position.maxFavorablePrice || position.entryFill),
          high
        );

      position.maxAdversePrice =
        Math.min(
          Number(position.maxAdversePrice || position.entryFill),
          low
        );
    } else {
      position.maxFavorablePrice =
        Math.min(
          Number(position.maxFavorablePrice || position.entryFill),
          low
        );

      position.maxAdversePrice =
        Math.max(
          Number(position.maxAdversePrice || position.entryFill),
          high
        );
    }
  }

  // V1.7.4 ADAPTIVE STALE:
  // 60m = primeira revisão, sem sair por uma única leitura ruim.
  // Early exit exige:
  // - nunca ter alcançado +0.20R;
  // - trade não estar positivo;
  // - pelo menos 2 de 3 deteriorados: volume / OI contextual / MACD;
  // - 1H + 15m não estarem ambos alinhados;
  // - 2 candles fechados consecutivos com a mesma condição ruim.
  //
  // 90m = hard stale somente se o trade nunca alcançou +0.25R.
  // 2h = checkpoint Adaptive Hold; não fecha mais cegamente.
  if (
    cfg.scalpMode &&
    position.stage === 0 &&
    Date.now() - position.openedAt >=
      cfg.scalpStaleMin * 60 * 1000
  ) {
    const ageMin =
      (
        Date.now() -
        position.openedAt
      ) /
      60_000;

    // Não deixa o stale "roubar" um candle que tocou STOP ou TP1.
    // Nesse caso, a lógica normal de STOP/TP logo abaixo decide o candle.
    const stopTouched =
      hitStop(
        position,
        high,
        low
      );

    const targetTouched =
      hitLevel(
        position,
        high,
        low,
        position.tp1
      );

    const stale =
      adaptiveStaleAssessment(
        position,
        snap,
        mark,
        ageMin,
        cfg,
        {
          stopTouched,
          targetTouched
        }
      );

    position.staleLastDeteriorationCount =
      stale.deteriorationCount;

    position.staleLastStructureAligned =
      stale.structureAligned;

    position.staleLastProgressR =
      stale.progressR;

    position.staleLastAssessmentAt =
      Date.now();

    if (stale.hardStale) {
      position.staleBadChecks = 0;

      const result =
        closeRemainingAt(
          position,
          mark,
          `SCALP STALE HARD ${Math.round(cfg.scalpStaleMaxMin)}m`
        );

      events.push(
        positionCloseMessage(
          result.closed
        )
      );

      return events;
    }

    if (
      stale.earlyCandidate
    ) {
      position.staleBadChecks =
        Number(
          position.staleBadChecks ||
          0
        ) + 1;

      if (
        position.staleBadChecks >=
        cfg.scalpStaleConsecutiveChecks
      ) {
        const result =
          closeRemainingAt(
            position,
            mark,
            `SCALP STALE QUALITY ${Math.round(cfg.scalpStaleMin)}m · ${position.staleBadChecks}/${cfg.scalpStaleConsecutiveChecks} checks`
          );

        events.push(
          positionCloseMessage(
            result.closed
          )
        );

        return events;
      }
    } else {
      // Uma leitura boa quebra a sequência ruim.
      position.staleBadChecks = 0;
    }
  }

  // V1.8.2 ADAPTIVE HOLD:
  // 2h (ou PAPER_MAX_HOLD_HOURS) agora é checkpoint, não saída cega.
  // Após TP1 não existe timeout absoluto; o trade segue até STOP/STOP GAIN/Runner.
  // Antes do TP1 existe apenas um hard max de segurança (default 6h).
  const ageHours =
    (
      Date.now() -
      position.openedAt
    ) /
    3_600_000;

  const holdAssessment =
    adaptiveHoldAssessment(
      position,
      {
        ageHours,
        config: cfg
      }
    );

  if (
    holdAssessment.action ===
    'LEGACY_TIMEOUT'
  ) {
    const result =
      closeRemainingAt(
        position,
        mark,
        `TIMEOUT LEGADO ${cfg.maxHoldHours}h`
      );

    events.push(
      positionCloseMessage(
        result.closed
      )
    );

    return events;
  }

  if (
    holdAssessment.action ===
    'CLOSE_HARD_MAX'
  ) {
    const result =
      closeRemainingAt(
        position,
        mark,
        `ADAPTIVE HOLD MAX ${holdAssessment.hardMaxHours}h sem TP1`
      );

    events.push(
      positionCloseMessage(
        result.closed
      )
    );

    return events;
  }

  if (
    cfg.adaptiveHoldNotifyCheckpoint &&
    ageHours >=
      cfg.maxHoldHours &&
    !position.adaptiveHoldCheckpointNotified
  ) {
    position.adaptiveHoldCheckpointNotified =
      true;

    position.adaptiveHoldCheckpointAt =
      Date.now();

    position.adaptiveHoldCheckpointStage =
      Number(
        position.stage ||
        0
      );

    events.push(
      adaptiveHoldCheckpointMessage(
        position,
        holdAssessment
      )
    );

    saveState();
  }

  const nextTarget =
    position.stage === 0
      ? position.tp1
      : position.stage === 1
        ? position.tp2
        : position.stage === 2
          ? position.tp3
          : (
            position.stage >= 3 &&
            position.runnerActive
          )
            ? position.runnerNextTrigger
            : null;

  const stopHit =
    hitStop(
      position,
      high,
      low
    );

  const nextTargetHit =
    nextTarget != null &&
    hitLevel(
      position,
      high,
      low,
      nextTarget
    );

  let moderateConflictTargetFirst = false;

  // V1.6.2 MODERADO:
  // se STOP e próximo alvo aparecem no mesmo candle fechado de 5m,
  // não assume mais automaticamente o pior caso.
  // Usa o fechamento do candle em relação ao ponto médio STOP↔ALVO.
  if (stopHit && nextTargetHit) {
    moderateConflictTargetFirst =
      moderateTargetFirst(
        position,
        fastTf,
        nextTarget
      );

    if (!moderateConflictTargetFirst) {
      const result =
        closeRemainingAt(
          position,
          position.stopCurrent,
          `STOP MODERADO após TP${position.stage || 0}`
        );

      events.push(
        positionCloseMessage(result.closed)
      );

      return events;
    }

    console.log(
      `[paper] ${position.symbol} ${position.side}: ` +
      `candle ambíguo STOP+TP — critério MODERADO escolheu alvo primeiro`
    );
  }

  if (
    stopHit &&
    !moderateConflictTargetFirst
  ) {
    const outcome =
      position.runnerActive &&
      position.stage >= 3
        ? `STOP GAIN RUNNER após TP${position.runnerTrailStage || 3}`
        : position.stage > 0
          ? `STOP após TP${position.stage}`
          : 'STOP';

    const result =
      closeRemainingAt(
        position,
        position.stopCurrent,
        outcome
      );

    events.push(
      positionCloseMessage(result.closed)
    );

    return events;
  }

  // Sem stop: pode atravessar vários TPs no mesmo candle.
  if (
    position.stage < 1 &&
    hitLevel(position, high, low, position.tp1)
  ) {
    const qty =
      position.initialQty * 0.30;

    const leg =
      closeQty(
        position,
        qty,
        position.tp1,
        'TP1'
      );

    position.stage = 1;

    // V1.5.8 PROFIT PROTECT:
    // breakeven líquido — leva em conta fee de entrada, fee de saída
    // já paga, fee futura e slippage da saída restante.
    const targetNetUsdc =
      profitProtectTargetNet(
        position
      );

    const costProtectedStop =
      profitProtectStopReference(
        position,
        targetNetUsdc
      );

    position.stopCurrent =
      clampProtectedStop(
        position,
        moreProtectiveStop(
          position,
          position.entryFill,
          costProtectedStop
        ),
        1
      );

    if (leg) {
      events.push(
        partialMessage(
          position,
          leg,
          'TP1 (30%)'
        )
      );
    }

    // Candle ambíguo: no modo moderado processa somente o próximo alvo.
    // O novo stop só passa a valer a partir do próximo candle fechado.
    if (moderateConflictTargetFirst) {
      saveState();
      return events;
    }
  }

  if (
    position.remainingQty > 0 &&
    position.stage < 2 &&
    hitLevel(position, high, low, position.tp2)
  ) {
    const qty =
      position.initialQty * 0.30;

    const leg =
      closeQty(
        position,
        qty,
        position.tp2,
        'TP2'
      );

    position.stage = 2;

    // Depois do TP2, mantém pelo menos o TP1 como proteção,
    // mas nunca afrouxa abaixo do piso líquido calculado.
    const targetNetUsdc =
      profitProtectTargetNet(
        position
      );

    const costProtectedStop =
      profitProtectStopReference(
        position,
        targetNetUsdc
      );

    position.stopCurrent =
      clampProtectedStop(
        position,
        moreProtectiveStop(
          position,
          position.tp1,
          costProtectedStop
        ),
        2
      );

    if (leg) {
      events.push(
        partialMessage(
          position,
          leg,
          'TP2 (30%)'
        )
      );
    }

    if (moderateConflictTargetFirst) {
      saveState();
      return events;
    }
  }

  if (
    position.remainingQty > 0 &&
    position.stage < 3 &&
    hitLevel(position, high, low, position.tp3)
  ) {
    const cfgNow =
      paperConfig();

    if (
      cfgNow.trailingRunnerEnabled
    ) {
      const qty =
        position.initialQty *
        cfgNow.tp3ClosePct /
        100;

      const leg =
        closeQty(
          position,
          qty,
          position.tp3,
          'TP3'
        );

      position.stage = 3;

      // TP3 sobe o stop para TP2.
      // O cost protect continua como piso líquido.
      const targetNetUsdc =
        profitProtectTargetNet(
          position
        );

      const costProtectedStop =
        profitProtectStopReference(
          position,
          targetNetUsdc
        );

      const desiredStop =
        moreProtectiveStop(
          position,
          position.tp2,
          costProtectedStop
        );

      position.stopCurrent =
        clampBetween(
          desiredStop,
          position.tp2,
          position.tp3
        );

      const runnerReady =
        setupRunnerAfterTp3(
          position
        );

      if (
        leg &&
        runnerReady
      ) {
        events.push(
          runnerMessage(
            position,
            leg
          )
        );
      } else if (leg) {
        events.push(
          partialMessage(
            position,
            leg,
            `TP3 (${cfgNow.tp3ClosePct.toFixed(0)}%)`
          )
        );
      }

      // O stop novo só passa a valer a partir do próximo candle.
      updateDrawdown();
      saveState();
      return events;
    }

    const leg =
      closeQty(
        position,
        position.remainingQty,
        position.tp3,
        'TP3'
      );

    position.stage = 3;

    const closed =
      finalizePosition(
        position,
        'TP3',
        position.tp3
      );

    if (leg) {
      events.push(
        `🏆 <b>PAPER ${position.symbol} ${position.side}</b> — TP3 atingido\n` +
        `PnL líquido da última perna: ${leg.netPnl >= 0 ? '+' : ''}${leg.netPnl.toFixed(2)} USDC`
      );
    }

    events.push(
      positionCloseMessage(closed)
    );

    return events;
  }

  // RUNNER pós-TP3:
  // cada novo degrau favorável move o stop para o degrau anterior.
  // Exemplo:
  // TP3 atingido -> stop TP2
  // TP4 atingido -> stop TP3
  // TP5 atingido -> stop TP4
  // ... até o stop gain ser acionado.
  if (
    position.remainingQty > 0 &&
    position.stage >= 3 &&
    position.runnerActive &&
    Number.isFinite(
      Number(position.runnerNextTrigger)
    ) &&
    hitLevel(
      position,
      high,
      low,
      position.runnerNextTrigger
    )
  ) {
    const fromStage =
      Number(
        position.runnerTrailStage ||
        3
      );

    const oldStop =
      Number(position.stopCurrent);

    let loops = 0;

    while (
      loops < 20 &&
      Number.isFinite(
        Number(position.runnerNextTrigger)
      ) &&
      hitLevel(
        position,
        high,
        low,
        position.runnerNextTrigger
      )
    ) {
      const reached =
        Number(
          position.runnerNextTrigger
        );

      const stopCandidate =
        Number(
          position.runnerLastTrigger
        );

      if (
        Number.isFinite(
          stopCandidate
        )
      ) {
        position.stopCurrent =
          moreProtectiveStop(
            position,
            position.stopCurrent,
            stopCandidate
          );
      }

      position.runnerTrailStage =
        Number(
          position.runnerTrailStage ||
          3
        ) + 1;

      position.runnerLastTrigger =
        reached;

      position.runnerNextTrigger =
        runnerAdvance(
          position,
          reached
        );

      loops += 1;
    }

    events.push(
      runnerStepMessage(
        position,
        fromStage,
        position.runnerTrailStage,
        oldStop
      )
    );

    updateDrawdown();
    saveState();
    return events;
  }

  updateDrawdown();
  saveState();

  return events;
}

export function updatePaperTrading(snapshots) {
  ensureDay();

  const events = [];

  if (!Array.isArray(snapshots)) {
    return { events };
  }

  const bySymbol =
    new Map(
      snapshots.map(
        s => [s.dataSymbol || s.symbol, s]
      )
    );

  for (const position of [...state.openPositions]) {
    const snap =
      bySymbol.get(position.dataSymbol) ||
      bySymbol.get(position.symbol);

    if (!snap) {
      continue;
    }

    events.push(
      ...updateOnePosition(
        position,
        snap
      )
    );
  }

  updateDrawdown();
  saveState();

  return {
    events,
    equity:
      currentEquity(),
    balance:
      state.balance,
    openPositions:
      state.openPositions.length
  };
}

function closedStats() {
  const trades =
    state.closedTrades;

  const wins =
    trades.filter(
      t => Number(t.netPnl || 0) > 0.000001
    );

  const losses =
    trades.filter(
      t => Number(t.netPnl || 0) < -0.000001
    );

  const grossProfit =
    wins.reduce(
      (sum, t) =>
        sum + Number(t.netPnl || 0),
      0
    );

  const grossLossAbs =
    Math.abs(
      losses.reduce(
        (sum, t) =>
          sum + Number(t.netPnl || 0),
        0
      )
    );

  const profitFactor =
    grossLossAbs > 0
      ? grossProfit / grossLossAbs
      : grossProfit > 0
        ? Infinity
        : 0;

  const longTrades =
    trades.filter(t => t.side === 'LONG');

  const shortTrades =
    trades.filter(t => t.side === 'SHORT');

  const statSide = arr => ({
    total: arr.length,
    pnl:
      arr.reduce(
        (s, t) =>
          s + Number(t.netPnl || 0),
        0
      ),
    wins:
      arr.filter(
        t => Number(t.netPnl || 0) > 0
      ).length
  });

  return {
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    flat:
      trades.length -
      wins.length -
      losses.length,
    winRate:
      trades.length
        ? wins.length / trades.length * 100
        : 0,
    grossProfit,
    grossLossAbs,
    profitFactor,
    avgNet:
      trades.length
        ? trades.reduce(
            (sum, t) =>
              sum + Number(t.netPnl || 0),
            0
          ) / trades.length
        : 0,
    long: statSide(longTrades),
    short: statSide(shortTrades)
  };
}

function coinStats() {
  const map = new Map();

  for (const t of state.closedTrades) {
    if (!map.has(t.symbol)) {
      map.set(
        t.symbol,
        {
          symbol: t.symbol,
          pnl: 0,
          total: 0,
          wins: 0
        }
      );
    }

    const item =
      map.get(t.symbol);

    item.pnl +=
      Number(t.netPnl || 0);

    item.total += 1;

    if (
      Number(t.netPnl || 0) > 0
    ) {
      item.wins += 1;
    }
  }

  return [...map.values()]
    .sort(
      (a, b) => b.pnl - a.pnl
    );
}


function performanceGroup(
  label,
  predicate,
  limit = 20
) {
  const trades =
    recentTradesMatching(
      predicate,
      limit
    );

  return {
    label,
    metrics:
      tradeMetrics(
        trades
      )
  };
}

function fmtPf(
  value
) {
  return value === Infinity
    ? '∞'
    : Number(value || 0)
        .toFixed(2);
}

function fmtSigned(
  value,
  digits = 2
) {
  const n =
    Number(value || 0);

  return (
    `${n >= 0 ? '+' : ''}` +
    n.toFixed(digits)
  );
}

function groupLine(
  icon,
  label,
  metrics
) {
  return (
    `${icon} ${label}: ${metrics.total} · ` +
    `${metrics.wins}W/${metrics.losses}L · ` +
    `PF ${fmtPf(metrics.profitFactor)} · ` +
    `PnL ${fmtSigned(metrics.pnl)}`
  );
}

export function paperPerformanceText() {
  const cfg =
    paperConfig();

  const overall =
    tradeMetrics(
      state.closedTrades.slice(
        0,
        Math.max(
          20,
          cfg.performanceQualityLookback
        )
      )
    );

  const quality =
    overallPerformanceQualityStatus();

  const longGroup =
    performanceGroup(
      'LONG',
      t =>
        t.side ===
        'LONG'
    );

  const shortGroup =
    performanceGroup(
      'SHORT',
      t =>
        t.side ===
        'SHORT'
    );

  const pullbackGroup =
    performanceGroup(
      'PULLBACK',
      t =>
        String(
          t.setupEntryMode ||
          'PULLBACK'
        ).toUpperCase() ===
        'PULLBACK'
    );

  const breakoutGroup =
    performanceGroup(
      'BREAKOUT',
      t =>
        String(
          t.setupEntryMode ||
          ''
        ).toUpperCase() ===
        'BREAKOUT_STRONG'
    );

  const longGuard =
    performanceCircuitStatus(
      'SIDE',
      'LONG'
    );

  const shortGuard =
    performanceCircuitStatus(
      'SIDE',
      'SHORT'
    );

  const pullbackGuard =
    performanceCircuitStatus(
      'SETUP',
      'PULLBACK'
    );

  const breakoutGuard =
    performanceCircuitStatus(
      'SETUP',
      'BREAKOUT_STRONG'
    );

  const scoreBands = [
    {
      label: 'score 60–69',
      min: 60,
      max: 69
    },
    {
      label: 'score 70–79',
      min: 70,
      max: 79
    },
    {
      label: 'score 80–89',
      min: 80,
      max: 89
    },
    {
      label: 'score 90+',
      min: 90,
      max: 999
    }
  ].map(
    band => ({
      label:
        band.label,
      metrics:
        tradeMetrics(
          state.closedTrades
            .filter(t => {
              const score =
                Number(
                  t?.score ||
                  0
                );

              return (
                score >=
                  band.min &&
                score <=
                  band.max
              );
            })
            .slice(
              0,
              20
            )
        )
    })
  );

  const aiBands = [
    {
      label: 'IA 60–69%',
      min: 60,
      max: 69
    },
    {
      label: 'IA 70–79%',
      min: 70,
      max: 79
    },
    {
      label: 'IA 80–89%',
      min: 80,
      max: 89
    },
    {
      label: 'IA 90%+',
      min: 90,
      max: 100
    }
  ].map(
    band => ({
      label:
        band.label,
      metrics:
        tradeMetrics(
          state.closedTrades
            .filter(t => {
              const confidence =
                Number(
                  t?.aiConfidence ||
                  0
                );

              return (
                confidence >=
                  band.min &&
                confidence <=
                  band.max
              );
            })
            .slice(
              0,
              20
            )
        )
    })
  );

  const guardLabel = (
    guard
  ) =>
    guard.active
      ? `⛔ PAUSA ${guard.remainingMin.toFixed(0)}m`
      : guard.probation
        ? `🟠 PROBATION · precisa PF ${Number(guard.recoveryPf || 0).toFixed(2)}+ / WR ${Number(guard.recoveryWinRate || 0).toFixed(0)}%+`
        : guard.poor
          ? '🟡 janela ruim, pausa cumprida'
          : '✅ OK';


  const scoreSideGroups = [
    {
      label: 'LONG score 60–69',
      side: 'LONG',
      min: 60,
      max: 69
    },
    {
      label: 'LONG score 70–79',
      side: 'LONG',
      min: 70,
      max: 79
    },
    {
      label: 'LONG score 80+',
      side: 'LONG',
      min: 80,
      max: 999
    },
    {
      label: 'SHORT score 60–69',
      side: 'SHORT',
      min: 60,
      max: 69
    },
    {
      label: 'SHORT score 70–79',
      side: 'SHORT',
      min: 70,
      max: 79
    },
    {
      label: 'SHORT score 80+',
      side: 'SHORT',
      min: 80,
      max: 999
    }
  ].map(
    item => ({
      label:
        item.label,
      metrics:
        tradeMetrics(
          state.closedTrades
            .filter(t => {
              const side =
                String(
                  t?.side ||
                  ''
                ).toUpperCase();

              const score =
                Number(
                  t?.score ||
                  0
                );

              return (
                side ===
                  item.side &&
                score >=
                  item.min &&
                score <=
                  item.max
              );
            })
            .slice(
              0,
              20
            )
        )
    })
  );

  const setupSideGroups = [
    ['PULLBACK LONG', 'PULLBACK', 'LONG'],
    ['PULLBACK SHORT', 'PULLBACK', 'SHORT'],
    ['BREAKOUT LONG', 'BREAKOUT_STRONG', 'LONG'],
    ['BREAKOUT SHORT', 'BREAKOUT_STRONG', 'SHORT']
  ].map(
    ([label, setup, side]) => ({
      label,
      metrics:
        tradeMetrics(
          state.closedTrades
            .filter(t =>
              String(
                t?.setupEntryMode ||
                'PULLBACK'
              ).toUpperCase() ===
                setup &&
              String(t?.side || '')
                .toUpperCase() ===
                side
            )
            .slice(0, 20)
        )
    })
  );

  const regimeGroups = [
    'TREND',
    'CHOP',
    'EXPANSION',
    'TRANSITION'
  ].map(
    regime => ({
      label: regime,
      metrics:
        tradeMetrics(
          state.closedTrades
            .filter(
              t =>
                String(
                  t?.setupMarketRegime ||
                  ''
                ).toUpperCase() ===
                regime
            )
            .slice(0, 20)
        )
    })
  );

  const confirmedEntryMetrics =
    tradeMetrics(
      state.closedTrades
        .filter(
          t =>
            Boolean(
              t?.confirmedEntryUsed
            )
        )
        .slice(0, 20)
    );

  const breakoutDirectMetrics =
    tradeMetrics(
      state.closedTrades
        .filter(
          t =>
            !Boolean(
              t?.confirmedEntryUsed
            ) &&
            String(
              t?.setupEntryMode ||
              ''
            ).toUpperCase() ===
              'BREAKOUT_STRONG'
        )
        .slice(0, 20)
    );

  const legacyOtherMetrics =
    tradeMetrics(
      state.closedTrades
        .filter(
          t =>
            !Boolean(
              t?.confirmedEntryUsed
            ) &&
            String(
              t?.setupEntryMode ||
              ''
            ).toUpperCase() !==
              'BREAKOUT_STRONG'
        )
        .slice(0, 20)
    );

  const lines = [
    '🧠 <b>PERFORMANCE GUARD</b>',
    '',
    `📊 Amostra recente: ${overall.total} trade(s)`,
    `🎯 Win rate: ${overall.winRate.toFixed(1)}% · PF ${fmtPf(overall.profitFactor)}`,
    `💰 Média win: +${overall.avgWin.toFixed(3)} · média loss: -${overall.avgLossAbs.toFixed(3)} USDC`,
    `⚖️ Payoff real: ${fmtPf(overall.payoffRatio)} · expectativa/trade ${fmtSigned(overall.avgNet, 3)} USDC`,
    `📈 MFE médio: +${overall.avgMfe.toFixed(2)}R · 📉 MAE médio: -${overall.avgMae.toFixed(2)}R`,
    `✅ Winners MFE/MAE: +${overall.winnersMfe.toFixed(2)}R / -${overall.winnersMae.toFixed(2)}R`,
    `🛑 Losers MFE/MAE: +${overall.losersMfe.toFixed(2)}R / -${overall.losersMae.toFixed(2)}R`,
    '',
    '<b>Por direção</b>',
    groupLine('🟢', 'LONG', longGroup.metrics),
    `   Guard LONG: ${guardLabel(longGuard)}`,
    groupLine('🔴', 'SHORT', shortGroup.metrics),
    `   Guard SHORT: ${guardLabel(shortGuard)}`,
    '',
    '<b>Por setup</b>',
    groupLine('↩️', 'PULLBACK', pullbackGroup.metrics),
    `   Guard PULLBACK: ${guardLabel(pullbackGuard)}`,
    groupLine('🚀', 'BREAKOUT', breakoutGroup.metrics),
    `   Guard BREAKOUT: ${guardLabel(breakoutGuard)}`,
    '',
    `<b>Quality boost:</b> ${quality.active ? `🟠 ATIVO · +${cfg.performanceQualityScoreBoost} score / +${cfg.performanceQualityAiBoost}% IA` : '✅ INATIVO'}`,
    '',
    '<b>Setup + direção</b>',
    ...setupSideGroups
      .filter(x => x.metrics.total > 0)
      .map(
        x =>
          `• ${x.label}: ${x.metrics.total} · ` +
          `${x.metrics.wins}W/${x.metrics.losses}L · ` +
          `PF ${fmtPf(x.metrics.profitFactor)} · ${fmtSigned(x.metrics.pnl)} USDC · ` +
          `MFE +${x.metrics.avgMfe.toFixed(2)}R / MAE -${x.metrics.avgMae.toFixed(2)}R`
      ),
    '',
    '<b>Market Regime</b>',
    ...regimeGroups
      .filter(x => x.metrics.total > 0)
      .map(
        x =>
          `• ${x.label}: ${x.metrics.total} · ` +
          `${x.metrics.wins}W/${x.metrics.losses}L · ` +
          `PF ${fmtPf(x.metrics.profitFactor)} · ${fmtSigned(x.metrics.pnl)} USDC · ` +
          `MFE +${x.metrics.avgMfe.toFixed(2)}R / MAE -${x.metrics.avgMae.toFixed(2)}R`
      ),
    '',
    '<b>Confirmação de entrada</b>',
    `• CONFIRMED PULLBACK 2x5m: ${confirmedEntryMetrics.total} · ` +
      `${confirmedEntryMetrics.wins}W/${confirmedEntryMetrics.losses}L · ` +
      `PF ${fmtPf(confirmedEntryMetrics.profitFactor)} · ${fmtSigned(confirmedEntryMetrics.pnl)} USDC · ` +
      `MFE +${confirmedEntryMetrics.avgMfe.toFixed(2)}R / MAE -${confirmedEntryMetrics.avgMae.toFixed(2)}R`,
    `• BREAKOUT DIRETO: ${breakoutDirectMetrics.total} · ` +
      `${breakoutDirectMetrics.wins}W/${breakoutDirectMetrics.losses}L · ` +
      `PF ${fmtPf(breakoutDirectMetrics.profitFactor)} · ${fmtSigned(breakoutDirectMetrics.pnl)} USDC · ` +
      `MFE +${breakoutDirectMetrics.avgMfe.toFixed(2)}R / MAE -${breakoutDirectMetrics.avgMae.toFixed(2)}R`,
    `• LEGADO/OUTROS: ${legacyOtherMetrics.total} · ` +
      `${legacyOtherMetrics.wins}W/${legacyOtherMetrics.losses}L · ` +
      `PF ${fmtPf(legacyOtherMetrics.profitFactor)} · ${fmtSigned(legacyOtherMetrics.pnl)} USDC`,
    '',
    '<b>Faixa de score</b>',
    ...scoreBands
      .filter(
        x =>
          x.metrics.total >
          0
      )
      .map(
        x =>
          `• ${x.label}: ${x.metrics.total} · PF ${fmtPf(x.metrics.profitFactor)} · ${fmtSigned(x.metrics.pnl)} USDC`
      ),
    '',
    '<b>Score + direção</b>',
    ...scoreSideGroups
      .filter(
        x =>
          x.metrics.total >
          0
      )
      .map(
        x =>
          `• ${x.label}: ${x.metrics.total} · ` +
          `${x.metrics.wins}W/${x.metrics.losses}L · ` +
          `PF ${fmtPf(x.metrics.profitFactor)} · ${fmtSigned(x.metrics.pnl)} USDC`
      ),
    '',
    '<b>Faixa da IA</b>',
    ...aiBands
      .filter(
        x =>
          x.metrics.total >
          0
      )
      .map(
        x =>
          `• ${x.label}: ${x.metrics.total} · PF ${fmtPf(x.metrics.profitFactor)} · ${fmtSigned(x.metrics.pnl)} USDC`
      ),
    '',
    `<i>Circuit breaker: ${cfg.performanceLookback} últimos do grupo · mínimo ${cfg.performanceMinTrades} · PF abaixo de ${cfg.performanceMinProfitFactor.toFixed(2)} · loss streak ${cfg.performanceRecentLosses}+ · pausa ${cfg.performancePauseMin.toFixed(0)}m.</i>`
  ];

  return lines.join(
    '\n'
  );
}

export function paperStatusText() {
  ensureDay();

  const cfg = paperConfig();
  const currentRisk =
    effectiveRiskStatus();
  const stats = closedStats();
  const equity = currentEquity();
  const unrealized = currentUnrealized();
  const used = marginUsed();
  const available = availableBalance();
  const pnlFromStart =
    equity - state.startingBalance;
  const returnPct =
    state.startingBalance > 0
      ? pnlFromStart / state.startingBalance * 100
      : 0;

  const pf =
    stats.profitFactor === Infinity
      ? '∞'
      : stats.profitFactor.toFixed(2);

  const topCoins =
    coinStats();

  const best =
    topCoins[0] || null;

  const worst =
    topCoins.length
      ? topCoins[topCoins.length - 1]
      : null;

  return [
    '⏳ <b>PAPER TRADING — V1.8.2 ADAPTIVE HOLD</b>',
    '',
    `Status: ${cfg.enabled ? '✅ ATIVO' : '⛔ DESATIVADO'} · ${state.paused ? '⏸ PAUSADO' : '▶️ RODANDO'}`,
    `💰 Banca inicial: ${state.startingBalance.toFixed(2)} USDC`,
    `🏦 Saldo realizado: ${state.balance.toFixed(2)} USDC`,
    `📈 Equity: ${equity.toFixed(2)} USDC`,
    `🟡 PnL não realizado: ${unrealized >= 0 ? '+' : ''}${unrealized.toFixed(2)} USDC`,
    `💵 Retorno total: ${pnlFromStart >= 0 ? '+' : ''}${pnlFromStart.toFixed(2)} USDC (${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%)`,
    '',
    `📌 Posições abertas: ${state.openPositions.length}/${cfg.maxOpenPositions}`,
    `⚖️ Meta diária: ${cfg.targetTradesPerDayMin}–8 entradas · cap ${cfg.maxTradesPerDay} · hoje ${todayEntryCount()}/${cfg.maxTradesPerDay}`,
    `🔒 1 posição por moeda: ${cfg.onePositionPerSymbol ? 'ATIVO' : 'INATIVO'}`,
    `🧯 Loss Brake: ${cfg.lossBrakeEnabled ? 'ATIVO' : 'INATIVO'} · após ${cfg.lossBrakeConsecutive} perdas: +${cfg.lossBrakeScoreBoost} score / +${cfg.lossBrakeAiBoost}% IA por ${cfg.lossBrakeMinutes}m`,
    `🧠 Performance Guard: ${cfg.performanceGuardEnabled ? 'ATIVO' : 'INATIVO'} · lado/setup · janela ${cfg.performanceLookback} · pausa ${cfg.performancePauseMin.toFixed(0)}m`,
    `🟠 Side Probation: ${cfg.sideProbationEnabled ? 'ATIVO' : 'INATIVO'} · recuperação PF ${cfg.sideRecoveryMinProfitFactor.toFixed(2)}+ / WR ${cfg.sideRecoveryMinWinRatePct.toFixed(0)}%+`,
    `🧭 Setup Probation: ${cfg.setupProbationEnabled ? 'ATIVO' : 'INATIVO'} · recuperação PF ${cfg.setupRecoveryMinProfitFactor.toFixed(2)}+ / WR ${cfg.setupRecoveryMinWinRatePct.toFixed(0)}%+`,
    `🌦 Regime Filter: PULLBACK só TREND · 4H obrigatório · BREAKOUT priorizado EXPANSION`,
    `✅ Confirmed Entry: Pullback abre somente após o próximo 5m fechar além do candle gatilho`,
    `🎚 Score Tiers: ${cfg.scoreTierEnabled ? 'ATIVO' : 'INATIVO'} · 68–74 elite · 75–79 estrito · 80+ normal`,
    `📈 Performance Quality: ${cfg.performanceQualityEnabled ? 'ATIVO' : 'INATIVO'} · PF ${cfg.performanceQualityMinPf.toFixed(2)} / payoff ${cfg.performanceQualityMinPayoff.toFixed(2)}`,
    `🔒 Margem usada: ${used.toFixed(2)} USDC`,
    `💳 Disponível: ${available.toFixed(2)} USDC`,
    `⚖️ Risco por trade: ${currentRisk.riskPct.toFixed(2)}%${currentRisk.throttled ? ` · THROTTLE (config ${cfg.riskPct.toFixed(2)}%)` : ''}`,
    `⚙️ Alavancagem simulada: ${cfg.leverage}x`,
    `⚡ Scalp: ${cfg.scalpMode ? 'ATIVO' : 'INATIVO'} · stale adaptativo ${cfg.scalpStaleMin}/${cfg.scalpStaleMaxMin} min`,
    `⏳ Adaptive Hold: ${cfg.adaptiveHoldEnabled ? 'ATIVO' : 'INATIVO'} · checkpoint ${cfg.maxHoldHours.toFixed(1)}h · após TP1 sem timeout · sem TP1 máx ${cfg.adaptiveHoldHardMaxHours > 0 ? `${cfg.adaptiveHoldHardMaxHours.toFixed(1)}h` : 'OFF'}`,
    `⏳ Stale: ${cfg.scalpStaleConsecutiveChecks} checks · ${cfg.scalpStaleDeteriorationCount}/3 deteriorações · MFE ${cfg.scalpStaleMinProgressR.toFixed(2)}R/${cfg.scalpStaleHardProgressR.toFixed(2)}R`,
    `🧠 Smart Stop: estrutura 5m + ATR · alvo 1.25–2.00 ATR`,
    `🧭 Entradas: PULLBACK preferencial + BREAKOUT FORTE`,
    `🌐 Scanner: universo dinâmico 40–50 líquidos · frequência vem da cobertura, não de afrouxar risco`,
    `🚀 Breakout PAPER: score ${cfg.breakoutMinScore}+ · IA ${cfg.breakoutMinAiConfidence}%+`,
    `📊 Diagnóstico: MFE/MAE por trade ATIVO`,
    `🛡 Profit Protect: ${cfg.profitProtectEnabled ? 'ATIVO' : 'INATIVO'} · buffer ${cfg.profitProtectBufferPctNotional.toFixed(2)}% do notional`,
    `🪜 Stop Gain Runner: ${cfg.trailingRunnerEnabled ? 'ATIVO' : 'INATIVO'} · TP3 fecha ${cfg.tp3ClosePct.toFixed(0)}% · runner ${Math.max(0, 40 - cfg.tp3ClosePct).toFixed(0)}%`,
    `⚖️ Candle STOP+TP: critério MODERADO`,
    `🧮 Net R/R Guard: ${cfg.netRrGuardEnabled ? 'ATIVO' : 'INATIVO'} · mínimo ${cfg.minNetRR.toFixed(2)}x`,
    `🎯 Autoajuste TPs: ${cfg.autoAdjustTargets ? 'ATIVO' : 'INATIVO'} · máximo x${cfg.maxTargetScale.toFixed(2)}`,
    '',
    `📊 Trades fechados: ${stats.total}`,
    `✅ Wins: ${stats.wins} · 🛑 Losses: ${stats.losses} · ➖ Flat: ${stats.flat}`,
    `🎯 Win rate: ${stats.winRate.toFixed(1)}%`,
    `⚗️ Profit factor: ${pf}`,
    `📉 Max drawdown: ${Number(state.maxDrawdownPct || 0).toFixed(2)}%`,
    `💸 Taxas simuladas: ${Number(state.totalFees || 0).toFixed(2)} USDC`,
    '',
    `🟢 LONG: ${stats.long.total} trade(s) · ${stats.long.pnl >= 0 ? '+' : ''}${stats.long.pnl.toFixed(2)} USDC`,
    `🔴 SHORT: ${stats.short.total} trade(s) · ${stats.short.pnl >= 0 ? '+' : ''}${stats.short.pnl.toFixed(2)} USDC`,
    ...(best
      ? [
          `🏆 Melhor ativo: ${best.symbol} ${best.pnl >= 0 ? '+' : ''}${best.pnl.toFixed(2)} USDC`,
          `📉 Pior ativo: ${worst.symbol} ${worst.pnl >= 0 ? '+' : ''}${worst.pnl.toFixed(2)} USDC`
        ]
      : []),
    '',
    `📅 Hoje: ${Number(state.day.realizedPnl || 0) >= 0 ? '+' : ''}${Number(state.day.realizedPnl || 0).toFixed(2)} USDC · ${state.day.trades || 0} trade(s)`,
    `🛡 Limite perda diária: ${cfg.dailyLossLimitPct.toFixed(1)}%`,
    '',
    `<i>Paper trading é simulação: taxas/slippage são aproximações e não garantem resultado real.</i>`
  ].join('\n');
}

export function paperPositionsText() {
  const cfg =
    paperConfig();

  if (!state.openPositions.length) {
    return '📭 Nenhuma posição paper aberta.';
  }

  const lines = [
    '📌 <b>Posições paper abertas</b>',
    ''
  ];

  for (const p of state.openPositions) {
    const mark =
      Number(p.lastMark || p.entryFill);

    const unrealized =
      directionSign(p.side) *
      (mark - p.entryFill) *
      p.remainingQty;

    lines.push(
      `${p.side === 'LONG' ? '🟢' : '🔴'} <b>${p.symbol} ${p.side}</b> · ` +
      `${p.runnerActive ? `🏃 RUNNER TP${p.runnerTrailStage || 3}` : `TP estágio ${p.stage}/3`}\n` +
      `🤖 IA ${Math.round(p.aiConfidence)}% · ⭐ ${p.score}\n` +
      `Entrada ${round(p.entryFill)} · Mark ${round(mark)}\n` +
      `Stop atual ${round(p.stopCurrent)}\n` +
      `TP1 ${round(p.tp1)} · TP2 ${round(p.tp2)} · TP3 ${round(p.tp3)}\n` +
      `${p.runnerActive ? `➡️ Próximo TP${(p.runnerTrailStage || 3) + 1}: ${round(p.runnerNextTrigger)}\n` : ''}` +
      `${p.stage === 0 ? `⏳ Stale checks ${Number(p.staleBadChecks || 0)}/${cfg.scalpStaleConsecutiveChecks} · MFE +${Number(p.mfeR || 0).toFixed(2)}R · estrutura ${p.staleLastStructureAligned === false ? 'NÃO ALINHADA' : 'OK'}\n` : ''}` +
      `${p.adaptiveHoldCheckpointNotified ? `⏳ Adaptive Hold: checkpoint cumprido · ${p.stage >= 1 ? 'SEM TIMEOUT após TP1' : `aguarda STOP/TP · segurança ${cfg.adaptiveHoldHardMaxHours > 0 ? `${cfg.adaptiveHoldHardMaxHours.toFixed(1)}h` : 'OFF'}`}\n` : ''}` +
      `⚖️ R/R líquido projetado ${Number(p.projectedNetRR || 0).toFixed(2)} · ` +
      `STOP -${Number(p.projectedStopLossUsdc || 0).toFixed(3)} / ladder +${Number(p.projectedFullTpNetUsdc || 0).toFixed(3)} USDC\n` +
      `📦 Restante ${(p.remainingQty / p.initialQty * 100).toFixed(0)}% · ` +
      `PnL não realizado ${unrealized >= 0 ? '+' : ''}${unrealized.toFixed(2)} USDC`
    );
  }

  return lines.join('\n\n');
}

export function paperTradesText(limit = 10) {
  if (!state.closedTrades.length) {
    return '📊 Ainda não há trades paper encerrados.';
  }

  const lines = [
    '📊 <b>Últimos trades paper</b>',
    ''
  ];

  for (const t of state.closedTrades.slice(0, limit)) {
    const icon =
      t.netPnl > 0
        ? '✅'
        : t.netPnl < 0
          ? '🛑'
          : '➖';

    lines.push(
      `${icon} <b>${t.symbol} ${t.side}</b> — ${t.outcome}\n` +
      `🤖 IA ${Math.round(t.aiConfidence || 0)}% · ⭐ ${t.score || 0}\n` +
      `PnL ${t.netPnl >= 0 ? '+' : ''}${Number(t.netPnl || 0).toFixed(2)} USDC · ` +
      `ROM ${Number(t.returnOnMarginPct || 0) >= 0 ? '+' : ''}${Number(t.returnOnMarginPct || 0).toFixed(2)}%\n` +
      `📈 MFE +${Number(t.mfeR || 0).toFixed(2)}R · 📉 MAE -${Number(t.maeR || 0).toFixed(2)}R\n` +
      `${t.setupOiContextRegime ? `🧭 ${t.setupEntryMode || 'PULLBACK'} · ${t.setupOiContextRegime} · pullback ${t.setupPullbackConfirmed ? 'SIM' : 'NÃO'}\n` : ''}` +
      `Taxas ${Number(t.totalFees || 0).toFixed(4)} USDC`
    );
  }

  return lines.join('\n\n');
}

export function paperPause() {
  state.paused = true;
  saveState();
  return state.paused;
}

export function paperResume() {
  state.paused = false;
  saveState();
  return state.paused;
}

export function paperReset() {
  state = freshState();
  saveState();
  return state;
}

export function paperStateInfo() {
  const cfg = paperConfig();

  return {
    enabled: cfg.enabled,
    paused: state.paused,
    balance: state.balance,
    equity: currentEquity(),
    openPositions: state.openPositions.length,
    closedTrades: state.closedTrades.length,
    statePath: cfg.statePath,
    dailyLossLocked: isDailyLossLocked()
  };
}


export function paperOpenSymbols() {
  return [
    ...new Set(
      state.openPositions
        .map(p => String(p.symbol || '').toUpperCase())
        .filter(Boolean)
    )
  ];
}


export function paperHasOpenPosition(symbol, side = null) {
  const target =
    String(symbol || '')
      .toUpperCase();

  const targetSide =
    side == null
      ? null
      : String(side).toUpperCase();

  return state.openPositions.some(p => {
    const sameSymbol =
      String(p.symbol || '').toUpperCase() === target ||
      String(p.dataSymbol || '').toUpperCase() === target;

    const sameSide =
      targetSide == null ||
      String(p.side || '').toUpperCase() === targetSide;

    return sameSymbol && sameSide;
  });
}

export function paperPositionSnapshot(symbol, side = null) {
  const target =
    String(symbol || '')
      .toUpperCase();

  const targetSide =
    side == null
      ? null
      : String(side).toUpperCase();

  const found =
    state.openPositions.find(p => {
      const sameSymbol =
        String(p.symbol || '').toUpperCase() === target ||
        String(p.dataSymbol || '').toUpperCase() === target;

      const sameSide =
        targetSide == null ||
        String(p.side || '').toUpperCase() === targetSide;

      return sameSymbol && sameSide;
    });

  return found
    ? { ...found }
    : null;
}
