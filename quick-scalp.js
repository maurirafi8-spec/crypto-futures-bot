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
