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
  slippageBps = 5
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
  slippageBps = 5
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

export function quickScalpLevels({
  side,
  entryFill,
  qty,
  entryFee,
  initialNotional,
  initialMargin,
  targetNetPct = 0.08,
  stopNetPct = 0.35,
  feeRate = 0.00045,
  slippageBps = 5
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

  return {
    targetReference,
    stopReference,
    targetNetUsdc,
    stopNetUsdc,
    targetNetPct,
    stopNetPct,
    targetRoiMarginPct: targetNetUsdc / margin * 100,
    stopRoiMarginPct: stopNetUsdc / margin * 100
  };
}


export function quickScalpEconomicsGuard({
  initialNotional,
  targetNetPct = 0.20,
  stopNetPct = 0.35,
  minRewardRisk = 0.50,
  maxBreakEvenPct = 70
} = {}) {
  const notional = n(initialNotional, NaN);
  const targetPct = Math.max(0, n(targetNetPct, NaN));
  const stopPct = Math.max(0, n(stopNetPct, NaN));
  const minRR = Math.max(0, n(minRewardRisk, 0));
  const maxBE = Math.max(0, n(maxBreakEvenPct, 100));

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

  const targetNetUsdc =
    notional * targetPct / 100;

  const stopNetUsdc =
    notional * stopPct / 100;

  const rewardRisk =
    targetNetUsdc /
    stopNetUsdc;

  const breakEvenPct =
    stopNetUsdc /
    (stopNetUsdc + targetNetUsdc) *
    100;

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
        : 'economia Quick aprovada',
    targetNetUsdc,
    stopNetUsdc,
    rewardRisk,
    breakEvenPct,
    minRewardRisk: minRR,
    maxBreakEvenPct: maxBE
  };
}
