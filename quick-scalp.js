/**
 * QUICK SCALP OTIMIZADO (V2 - Alta Assertividade)
 * Resolve a armadilha matemática do payoff negativo.
 */

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function u(v) {
  return String(v || '').toUpperCase();
}

export function quickScalpLevelsOptimized({
  side,
  entryFill,
  qty,
  entryFee,
  initialNotional,
  initialMargin,
  targetNetPct = 1.20, // Otimizado: 1.20% líquido (em vez de 0.20%)
  stopNetPct = 0.80,   // Otimizado: 0.80% líquido (em vez de 0.35% que caía no ruído)
  feeRate = 0.00045,
  slippageBps = 4
} = {}) {
  const notional = n(initialNotional, NaN);
  const margin = n(initialMargin, NaN);

  if (!Number.isFinite(notional) || !Number.isFinite(margin) || notional <= 0 || margin <= 0) {
    return null;
  }

  // Alvo em USDC: +1.20% de notional (Ex: notional $200 -> ganho líquido de +$2.40)
  const targetNetUsdc = notional * Math.max(0, n(targetNetPct, 0)) / 100;
  // Stop em USDC: -0.80% de notional (Ex: notional $200 -> perda líquida de -$1.60)
  const stopNetUsdc = -notional * Math.max(0, n(stopNetPct, 0)) / 100;

  const targetReference = referenceForTargetNet({
    side, entryFill, qty, entryFee,
    targetNet: targetNetUsdc,
    feeRate, slippageBps
  });

  const stopReference = referenceForTargetNet({
    side, entryFill, qty, entryFee,
    targetNet: stopNetUsdc,
    feeRate, slippageBps
  });

  if (!Number.isFinite(targetReference) || !Number.isFinite(stopReference) || targetReference <= 0 || stopReference <= 0) {
    return null;
  }

  // R:R Líquido = 2.40 / 1.60 = 1.5:1
  const rewardRisk = targetNetUsdc / Math.abs(stopNetUsdc);
  // Break-even Winrate = 1.60 / (1.60 + 2.40) = 40% (Facilmente superável com boa confluência)
  const breakEvenWinRate = (Math.abs(stopNetUsdc) / (Math.abs(stopNetUsdc) + targetNetUsdc)) * 100;

  return {
    targetReference,
    stopReference,
    targetNetUsdc,
    stopNetUsdc,
    targetNetPct,
    stopNetPct,
    rewardRisk,
    breakEvenWinRate,
    targetRoiMarginPct: (targetNetUsdc / margin) * 100,
    stopRoiMarginPct: (stopNetUsdc / margin) * 100
  };
}

export function referenceForTargetNet({
  side,
  entryFill,
  qty,
  entryFee,
  targetNet,
  feeRate = 0.00045,
  slippageBps = 4
}) {
  const e = n(entryFill, NaN);
  const q = n(qty, NaN);
  const inFee = Math.max(0, n(entryFee, 0));
  const target = n(targetNet, NaN);
  const fee = Math.max(0, n(feeRate, 0));
  const slip = Math.max(0, n(slippageBps, 0)) / 10000;
  const s = u(side);

  if (s === 'LONG') {
    const exitFill = (target + e * q + inFee) / (q * (1 - fee));
    return exitFill / (1 - slip);
  } else {
    const exitFill = (e * q - inFee - target) / (q * (1 + fee));
    return exitFill / (1 + slip);
  }
}
