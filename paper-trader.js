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
      numEnv('PAPER_RISK_PER_TRADE_PCT', 0.75, 0.1, 10),

    leverage:
      intEnv('PAPER_LEVERAGE', 2, 1, 50),

    maxMarginPct:
      numEnv('PAPER_MAX_MARGIN_PCT', 15, 1, 100),

    maxOpenPositions:
      intEnv('PAPER_MAX_OPEN_POSITIONS', 4, 1, 20),

    targetTradesPerDayMin:
      intEnv('PAPER_TARGET_TRADES_MIN', 8, 1, 100),

    maxTradesPerDay:
      intEnv('PAPER_MAX_TRADES_PER_DAY', 15, 1, 100),

    onePositionPerSymbol:
      String(process.env.PAPER_ONE_POSITION_PER_SYMBOL || 'true')
        .toLowerCase() !== 'false',

    minNotional:
      numEnv('PAPER_MIN_NOTIONAL_USDC', 10, 1, 10000),

    minAiConfidence:
      numEnv('PAPER_MIN_AI_CONFIDENCE', 68, 0, 100),

    minScore:
      numEnv('PAPER_MIN_SCORE', 70, 0, 100),

    feeRate:
      numEnv('PAPER_FEE_RATE', 0.00045, 0, 0.01),

    slippageBps:
      numEnv('PAPER_SLIPPAGE_BPS', 5, 0, 500),

    dailyLossLimitPct:
      numEnv('PAPER_DAILY_LOSS_LIMIT_PCT', 3, 0.1, 50),

    cooldownMin:
      numEnv('PAPER_COOLDOWN_MINUTES', 15, 0, 1440),

    maxHoldHours:
      numEnv('PAPER_MAX_HOLD_HOURS', 2, 0.5, 720),

    scalpMode:
      String(process.env.PAPER_SCALP_MODE || 'true')
        .toLowerCase() !== 'false',

    scalpStaleMin:
      numEnv('PAPER_SCALP_STALE_MINUTES', 40, 15, 360),

    scalpStaleMaxMin:
      numEnv('PAPER_SCALP_STALE_MAX_MINUTES', 75, 30, 180),

    scalpStaleMinProgressR:
      numEnv('PAPER_SCALP_STALE_MIN_PROGRESS_R', 0.25, 0, 2),

    scalpStaleMinVolumeRatio:
      numEnv('PAPER_SCALP_STALE_MIN_VOLUME_RATIO', 0.45, 0, 5),

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

    profitProtectEnabled:
      String(process.env.PAPER_PROFIT_PROTECT_ENABLED || 'true')
        .toLowerCase() !== 'false',

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

function eligibility(signal) {
  const cfg = paperConfig();
  const brake =
    lossBrakeStatus();

  const effectiveMinAiConfidence =
    brake.active
      ? brake.effectiveMinAiConfidence
      : cfg.minAiConfidence;

  const effectiveMinScore =
    brake.active
      ? brake.effectiveMinScore
      : cfg.minScore;

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
        `${brake.active ? ` (LOSS BRAKE ${brake.count} perdas · ${brake.remainingMin.toFixed(0)}m)` : ''}`
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

  const weights =
    [0.30, 0.30, 0.40];

  const targets =
    [tp1, tp2, tp3];

  let targetGross = 0;
  let targetFees = 0;

  for (
    let i = 0;
    i < targets.length;
    i += 1
  ) {
    const leg =
      projectedExitLeg({
        side,
        entryFill,
        exitReference:
          targets[i],
        qty:
          qty * weights[i]
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

    const riskBudget =
      Math.max(
        0,
        state.balance *
        cfg.riskPct / 100
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
        `💰 Entrada simulada: ${round(entryFill)}\n` +
        `🛑 Stop: ${round(position.stopCurrent)}\n` +
        `${position.smartStopMode ? `🧠 Smart Stop: ${position.smartStopMode}` +
          `${Number.isFinite(position.smartStopAtrMultiple) ? ` · ${position.smartStopAtrMultiple.toFixed(2)} ATR` : ''}` +
          `${Number.isFinite(position.smartStopPct) ? ` · ${position.smartStopPct.toFixed(2)}%` : ''}\n` : ''}` +
        `🎯 TP1 ${round(position.tp1)} · TP2 ${round(position.tp2)} · TP3 ${round(position.tp3)}\n` +
        `${position.targetsAutoAdjusted ? `🧮 TPs autoajustados: x${position.targetScale.toFixed(2)} para respeitar R/R líquido\n` : ''}` +
        `📦 Notional: ${notional.toFixed(2)} USDC · Margem: ${margin.toFixed(2)} USDC · ${cfg.leverage}x\n` +
        `🛑 Risco líquido projetado no STOP: -${position.projectedStopLossUsdc.toFixed(3)} USDC\n` +
        `🏆 Lucro líquido projetado TP1+TP2+TP3: +${position.projectedFullTpNetUsdc.toFixed(3)} USDC\n` +
        `⚖️ R/R líquido projetado: ${Number(position.projectedNetRR).toFixed(2)} · mínimo ${cfg.minNetRR.toFixed(2)}\n` +
        `🎚 Teto de risco da banca: ${riskBudget.toFixed(3)} USDC (${cfg.riskPct.toFixed(2)}%)\n` +
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

  // V1.7.0 STALE INTELIGENTE:
  // revisa em 40m. Só sai cedo quando o progresso é fraco
  // E o momentum deteriorou. Se a estrutura continua viva,
  // dá espaço até 75m.
  if (
    cfg.scalpMode &&
    position.stage === 0 &&
    Date.now() - position.openedAt >=
      cfg.scalpStaleMin * 60 * 1000
  ) {
    const directionalMove =
      directionSign(position.side) *
      (mark - position.entryFill);

    const initialRiskDistance =
      Math.abs(
        position.entryFill -
        position.stopInitial
      );

    const progressR =
      initialRiskDistance > 0
        ? directionalMove /
          initialRiskDistance
        : 0;

    const currentVolumeRatio =
      Number(
        snap?.t5?.volumeRatio ||
        0
      );

    const currentOiPct =
      Number(
        snap?.oiPct ||
        0
      );

    const currentMacd =
      Number(
        snap?.t5?.macdHist ||
        0
      );

    const macdStillAligned =
      position.side === 'LONG'
        ? currentMacd > 0
        : currentMacd < 0;

    const momentumDeteriorated =
      currentVolumeRatio <
        cfg.scalpStaleMinVolumeRatio ||
      currentOiPct < 0 ||
      !macdStillAligned;

    const ageMin =
      (
        Date.now() -
        position.openedAt
      ) /
      60_000;

    const weakProgress =
      progressR <
      cfg.scalpStaleMinProgressR;

    const hardStale =
      ageMin >=
      cfg.scalpStaleMaxMin;

    if (
      weakProgress &&
      (
        momentumDeteriorated ||
        hardStale
      )
    ) {
      const reason =
        hardStale
          ? `SCALP STALE MAX ${Math.round(cfg.scalpStaleMaxMin)}m`
          : `SCALP STALE QUALITY ${Math.round(cfg.scalpStaleMin)}m`;

      const result =
        closeRemainingAt(
          position,
          mark,
          reason
        );

      events.push(
        positionCloseMessage(result.closed)
      );

      return events;
    }
  }

  // Timeout: encerra pela marca atual após o máximo de permanência.
  if (
    Date.now() - position.openedAt >=
    cfg.maxHoldHours * 60 * 60 * 1000
  ) {
    const result =
      closeRemainingAt(
        position,
        mark,
        `TIMEOUT ${cfg.maxHoldHours}h`
      );

    events.push(
      positionCloseMessage(result.closed)
    );

    return events;
  }

  const nextTarget =
    position.stage === 0
      ? position.tp1
      : position.stage === 1
        ? position.tp2
        : position.stage === 2
          ? position.tp3
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
      position.stage > 0
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

export function paperStatusText() {
  ensureDay();

  const cfg = paperConfig();
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
    '🎯 <b>PAPER TRADING — V1.7.0 QUALITY AGGRESSIVE</b>',
    '',
    `Status: ${cfg.enabled ? '✅ ATIVO' : '⛔ DESATIVADO'} · ${state.paused ? '⏸ PAUSADO' : '▶️ RODANDO'}`,
    `💰 Banca inicial: ${state.startingBalance.toFixed(2)} USDC`,
    `🏦 Saldo realizado: ${state.balance.toFixed(2)} USDC`,
    `📈 Equity: ${equity.toFixed(2)} USDC`,
    `🟡 PnL não realizado: ${unrealized >= 0 ? '+' : ''}${unrealized.toFixed(2)} USDC`,
    `💵 Retorno total: ${pnlFromStart >= 0 ? '+' : ''}${pnlFromStart.toFixed(2)} USDC (${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%)`,
    '',
    `📌 Posições abertas: ${state.openPositions.length}/${cfg.maxOpenPositions}`,
    `🎯 Meta diária: ${cfg.targetTradesPerDayMin}–12 entradas · cap ${cfg.maxTradesPerDay} · hoje ${todayEntryCount()}/${cfg.maxTradesPerDay}`,
    `🔒 1 posição por moeda: ${cfg.onePositionPerSymbol ? 'ATIVO' : 'INATIVO'}`,
    `🧯 Loss Brake: ${cfg.lossBrakeEnabled ? 'ATIVO' : 'INATIVO'} · após ${cfg.lossBrakeConsecutive} perdas: +${cfg.lossBrakeScoreBoost} score / +${cfg.lossBrakeAiBoost}% IA por ${cfg.lossBrakeMinutes}m`,
    `🔒 Margem usada: ${used.toFixed(2)} USDC`,
    `💳 Disponível: ${available.toFixed(2)} USDC`,
    `⚖️ Risco por trade: ${cfg.riskPct.toFixed(2)}%`,
    `⚙️ Alavancagem simulada: ${cfg.leverage}x`,
    `⚡ Scalp: ${cfg.scalpMode ? 'ATIVO' : 'INATIVO'} · stale inteligente ${cfg.scalpStaleMin}→${cfg.scalpStaleMaxMin} min · máx ${cfg.maxHoldHours}h`,
    `🧠 Smart Stop: estrutura 5m + ATR · alvo 1.25–2.00 ATR`,
    `🛡 Profit Protect: ${cfg.profitProtectEnabled ? 'ATIVO' : 'INATIVO'} · buffer ${cfg.profitProtectBufferPctNotional.toFixed(2)}% do notional`,
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
      `${p.side === 'LONG' ? '🟢' : '🔴'} <b>${p.symbol} ${p.side}</b> · TP estágio ${p.stage}/3\n` +
      `🤖 IA ${Math.round(p.aiConfidence)}% · ⭐ ${p.score}\n` +
      `Entrada ${round(p.entryFill)} · Mark ${round(mark)}\n` +
      `Stop atual ${round(p.stopCurrent)}\n` +
      `TP1 ${round(p.tp1)} · TP2 ${round(p.tp2)} · TP3 ${round(p.tp3)}\n` +
      `⚖️ R/R líquido projetado ${Number(p.projectedNetRR || 0).toFixed(2)} · ` +
      `STOP -${Number(p.projectedStopLossUsdc || 0).toFixed(3)} / TP total +${Number(p.projectedFullTpNetUsdc || 0).toFixed(3)} USDC\n` +
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
