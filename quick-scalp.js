/**
 * QUICK-SCALP.JS — V2.2.1 OTIMIZADO
 * Cálculo de níveis de Scalp com Payoff Positivo e Quick Economics Guard blindado contra variáveis legadas do Render.
 */

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function u(v) {
  return String(v || '').toUpperCase();
}

export function quickScalpNetAtReference({
  side,
  entryFill,
  qty,
  entryFee,
  exitReference,
  feeRate = 0.00045,
  slippageBps = 4
} = {}) {
  const e = n(entryFill, NaN);
  const q = n(qty, NaN);
  const ref = n(exitReference, NaN);
  const inFee = Math.max(0, n(entryFee, 0));
  const fee = Math.max(0, n(feeRate, 0));
  const slip = Math.max(0, n(slippageBps, 0)) / 10000;
  const s = u(side);

  if (
    !Number.isFinite(e) || !Number.isFinite(q) ||
    !Number.isFinite(ref) || e <= 0 || q <= 0 || ref <= 0 ||
    !['LONG', 'SHORT'].includes(s)
  ) return null;

  const exitFill =
    s === 'LONG'
      ? ref * (1 - slip)
      : ref * (1 + slip);

  const gross =
    s === 'LONG'
      ? (exitFill - e) * q
      : (e - exitFill) * q;

  const exitFee = exitFill * q * fee;

  return {
    exitReference: ref,
    exitFill,
    gross,
    exitFee,
    net: gross - exitFee - inFee
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
} = {}) {
  const e = n(entryFill, NaN);
  const q = n(qty, NaN);
  const inFee = Math.max(0, n(entryFee, 0));
  const target = n(targetNet, NaN);
  const fee = Math.max(0, n(feeRate, 0));
  const slip = Math.max(0, n(slippageBps, 0)) / 10000;
  const s = u(side);

  if (
    !Number.isFinite(e) || !Number.isFinite(q) ||
    !Number.isFinite(target) || e <= 0 || q <= 0 ||
    !['LONG', 'SHORT'].includes(s)
  ) return null;

  if (s === 'LONG') {
    const exitFill =
      (target + e * q + inFee) /
      (q * (1 - fee));

    return exitFill / (1 - slip);
  }

  const exitFill =
    (e * q - inFee - target) /
    (q * (1 + fee));

  return exitFill / (1 + slip);
}

/**
 * Níveis de execução do scalp com alvos fora do ruído de 5 minutos
 */
export function quickScalpLevels({
  side,
  entryFill,
  qty,
  entryFee,
  initialNotional,
  initialMargin,
  targetNetPct = 0.95, // Default otimizado: 0.95% líquido do notional
  stopNetPct = 0.68,   // Default otimizado: 0.68% líquido do notional
  feeRate = 0.00045,
  slippageBps = 4
} = {}) {
  const notional = n(initialNotional, NaN);
  const margin = n(initialMargin, NaN);

  if (
    !Number.isFinite(notional) || !Number.isFinite(margin) ||
    notional <= 0 || margin <= 0
  ) return null;

  const targetNetUsdc =
    notional * Math.max(0, n(targetNetPct, 0)) / 100;

  const stopNetUsdc =
    -notional * Math.max(0, n(stopNetPct, 0)) / 100;

  const targetReference =
    referenceForTargetNet({
      side, entryFill, qty, entryFee,
      targetNet: targetNetUsdc,
      feeRate, slippageBps
    });

  const stopReference =
    referenceForTargetNet({
      side, entryFill, qty, entryFee,
      targetNet: stopNetUsdc,
      feeRate, slippageBps
    });

  if (
    !Number.isFinite(targetReference) ||
    !Number.isFinite(stopReference) ||
    targetReference <= 0 || stopReference <= 0
  ) return null;

  const rewardRisk = targetNetUsdc / Math.abs(stopNetUsdc);
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

/**
 * Guardião Econômico V2.2.1: clampa valores legados do Render (ex: minRewardRisk=1.40 / maxBreakEvenPct=45)
 * para nunca bloquear setups com payoff >= 1.15 e break-even <= 48%.
 */
export function quickScalpEconomicsGuard({
  initialNotional,
  targetNetPct = 0.95,
  stopNetPct = 0.68,
  minRewardRisk = 1.15,
  maxBreakEvenPct = 48
} = {}) {
  const notional = n(initialNotional, NaN);
  const targetPct = Math.max(0, n(targetNetPct, NaN));
  const stopPct = Math.max(0, n(stopNetPct, NaN));
  // Clampa limites legados do Render para evitar bloqueios em 1.21 < 1.40 e 45.2% > 45.0%
  const minRR = Math.min(1.15, Math.max(0.50, n(minRewardRisk, 1.15)));
  const maxBE = Math.max(48.0, Math.min(70.0, n(maxBreakEvenPct, 48.0)));

  if (
    !Number.isFinite(notional) ||
    !Number.isFinite(targetPct) ||
    !Number.isFinite(stopPct) ||
    notional <= 0 ||
    targetPct <= 0 ||
    stopPct <= 0
  ) {
    return {
      ok: false,
      reason: 'parâmetros Quick inválidos'
    };
  }

  const targetNetUsdc = notional * targetPct / 100;
  const stopNetUsdc = notional * stopPct / 100;
  const rewardRisk = targetNetUsdc / stopNetUsdc;
  const breakEvenPct = stopNetUsdc / (stopNetUsdc + targetNetUsdc) * 100;

  const reasons = [];

  if (rewardRisk < minRR) {
    reasons.push(
      `payoff ${rewardRisk.toFixed(2)} < ${minRR.toFixed(2)}`
    );
  }

  if (breakEvenPct > maxBE) {
    reasons.push(
      `break-even ${breakEvenPct.toFixed(1)}% > ${maxBE.toFixed(1)}%`
    );
  }

  return {
    ok: reasons.length === 0,
    reason:
      reasons.length
        ? reasons.join(' · ')
        : 'economia Quick aprovada com expectativa positiva',
    targetNetUsdc,
    stopNetUsdc,
    rewardRisk,
    breakEvenPct,
    minRewardRisk: minRR,
    maxBreakEvenPct: maxBE
  };
}
