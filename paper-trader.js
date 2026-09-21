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
      numEnv('PAPER_STARTING_BALANCE_USDC', 1000, 10, 1_000_000),

    riskPct:
      numEnv('PAPER_RISK_PER_TRADE_PCT', 1.0, 0.1, 10),

    leverage:
      intEnv('PAPER_LEVERAGE', 2, 1, 50),

    maxMarginPct:
      numEnv('PAPER_MAX_MARGIN_PCT', 10, 1, 100),

    maxOpenPositions:
      intEnv('PAPER_MAX_OPEN_POSITIONS', 1, 1, 20),

    minNotional:
      numEnv('PAPER_MIN_NOTIONAL_USDC', 10, 1, 10000),

    minAiConfidence:
      numEnv('PAPER_MIN_AI_CONFIDENCE', 70, 0, 100),

    minScore:
      numEnv('PAPER_MIN_SCORE', 75, 0, 100),

    feeRate:
      numEnv('PAPER_FEE_RATE', 0.00045, 0, 0.01),

    slippageBps:
      numEnv('PAPER_SLIPPAGE_BPS', 5, 0, 500),

    dailyLossLimitPct:
      numEnv('PAPER_DAILY_LOSS_LIMIT_PCT', 3, 0.1, 50),

    cooldownMin:
      numEnv('PAPER_COOLDOWN_MINUTES', 90, 0, 1440),

    maxHoldHours:
      numEnv('PAPER_MAX_HOLD_HOURS', 24, 1, 720),

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
    `${signal.t15?.openTime || 0}`
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

function cooldownBlocked(signal) {
  const cfg = paperConfig();
  const last =
    Number(state.lastOpenAt?.[signal.symbol] || 0);

  if (!last || cfg.cooldownMin <= 0) {
    return false;
  }

  return (
    Date.now() - last <
    cfg.cooldownMin * 60_000
  );
}

function eligibility(signal) {
  const cfg = paperConfig();

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
    cfg.minAiConfidence
  ) {
    return {
      ok: false,
      reason:
        `IA ${Math.round(signal?.ai?.confidence || 0)}% < ` +
        `${cfg.minAiConfidence}%`
    };
  }

  if (
    Number(signal?.score || 0) <
    cfg.minScore
  ) {
    return {
      ok: false,
      reason:
        `score ${signal?.score || 0} < ${cfg.minScore}`
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

    const levels =
      validateLevels(
        signal,
        entryFill
      );

    const stopDistance =
      Math.abs(entryFill - levels.stop);

    if (stopDistance <= 0) {
      return {
        opened: false,
        reason: 'distância do stop inválida'
      };
    }

    const riskBudget =
      Math.max(
        0,
        state.balance *
        cfg.riskPct / 100
      );

    const qtyByRisk =
      riskBudget / stopDistance;

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

      openedAt: Date.now(),
      openBarTime:
        Number(signal.t15?.openTime || 0),
      lastProcessedBarTime:
        Number(signal.t15?.openTime || 0),

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

      stage: 0,
      realizedGrossPnl: 0,
      exitFees: 0,
      lastMark:
        rawEntry,
      exitLegs: []
    };

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
        `🎯 TP1 ${round(position.tp1)} · TP2 ${round(position.tp2)} · TP3 ${round(position.tp3)}\n` +
        `📦 Notional: ${notional.toFixed(2)} USDC · Margem: ${margin.toFixed(2)} USDC · ${cfg.leverage}x\n` +
        `⚖️ Risco-alvo: ${riskBudget.toFixed(2)} USDC (${cfg.riskPct.toFixed(1)}%)\n` +
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

function updateOnePosition(position, snap) {
  const cfg = paperConfig();
  const events = [];

  if (
    !snap?.t15 ||
    Number(snap.t15.openTime || 0) <=
    Number(position.lastProcessedBarTime || 0)
  ) {
    return events;
  }

  const high =
    Number(snap.t15.high);

  const low =
    Number(snap.t15.low);

  const mark =
    Number(
      snap.t15.price ??
      snap.t15.close ??
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
    Number(snap.t15.openTime || 0);

  if (
    Number.isFinite(mark) &&
    mark > 0
  ) {
    position.lastMark = mark;
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

  // Conservador: se STOP e novo alvo ocorreram no mesmo candle,
  // assume STOP primeiro. Evita inflar artificialmente o paper PnL.
  if (stopHit && nextTargetHit) {
    const result =
      closeRemainingAt(
        position,
        position.stopCurrent,
        `STOP CONSERVADOR após TP${position.stage || 0}`
      );

    events.push(
      positionCloseMessage(result.closed)
    );

    return events;
  }

  if (stopHit) {
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

    // Depois do TP1, protege o restante no breakeven.
    position.stopCurrent =
      position.entryFill;

    if (leg) {
      events.push(
        partialMessage(
          position,
          leg,
          'TP1 (30%)'
        )
      );
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

    // Depois do TP2, protege o restante no TP1.
    position.stopCurrent =
      position.tp1;

    if (leg) {
      events.push(
        partialMessage(
          position,
          leg,
          'TP2 (30%)'
        )
      );
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
    '🧪 <b>PAPER TRADING — V1.4.3</b>',
    '',
    `Status: ${cfg.enabled ? '✅ ATIVO' : '⛔ DESATIVADO'} · ${state.paused ? '⏸ PAUSADO' : '▶️ RODANDO'}`,
    `💰 Banca inicial: ${state.startingBalance.toFixed(2)} USDC`,
    `🏦 Saldo realizado: ${state.balance.toFixed(2)} USDC`,
    `📈 Equity: ${equity.toFixed(2)} USDC`,
    `🟡 PnL não realizado: ${unrealized >= 0 ? '+' : ''}${unrealized.toFixed(2)} USDC`,
    `💵 Retorno total: ${pnlFromStart >= 0 ? '+' : ''}${pnlFromStart.toFixed(2)} USDC (${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%)`,
    '',
    `📌 Posições abertas: ${state.openPositions.length}/${cfg.maxOpenPositions}`,
    `🔒 Margem usada: ${used.toFixed(2)} USDC`,
    `💳 Disponível: ${available.toFixed(2)} USDC`,
    `⚖️ Risco por trade: ${cfg.riskPct.toFixed(1)}%`,
    `⚙️ Alavancagem simulada: ${cfg.leverage}x`,
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
