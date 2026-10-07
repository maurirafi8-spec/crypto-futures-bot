function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback = false) {
  if (value === true || value === false) return value;
  return fallback;
}

function upper(value) {
  return String(value || '').toUpperCase();
}

export function highAccuracyAssessment(
  signal,
  {
    pullbackMinScore = 84,
    pullbackMinAi = 78,
    breakoutMinScore = 88,
    breakoutMinAi = 80,
    pullbackMinVolume = 0.65,
    breakoutMinVolume = 1.10,
    pullbackMinEdge = 8,
    breakoutMinEdge = 10,
    requireConfirmedPullback = true,
    breakoutExpansionOnly = true
  } = {}
) {
  if (!signal) {
    return { eligible: false, setup: 'UNKNOWN', reasons: ['sinal ausente'] };
  }

  const setup = upper(signal.entryMode || 'PULLBACK');
  const side = upper(signal.side);
  const isPullback = setup === 'PULLBACK';
  const isBreakout = setup === 'BREAKOUT_STRONG';

  if (!isPullback && !isBreakout) {
    return {
      eligible: false,
      setup,
      side,
      reasons: [`setup ${setup || 'UNKNOWN'} não suportado`]
    };
  }

  const score = num(signal.score);
  const ai = num(signal?.ai?.confidence);
  const volume = Math.max(
    num(signal?.t5?.volumeRatio),
    num(signal?.t15?.volumeRatio)
  );
  const edge = num(signal.directionEdge);
  const momentumCount = num(signal?.momentum?.confirmationCount);
  const oiOk = bool(signal?.oiContext?.confirmed);
  const btcOk =
    signal?.btcRegime?.ok !== false &&
    !bool(signal?.btcRegime?.strongOpposite);
  const antiChaseOk = signal?.antiChase?.ok !== false;
  const exhaustionOk = signal?.trendExhaustion?.ok !== false;
  const aligned4h = bool(
    signal?.trendExhaustion?.aligned4h,
    upper(signal?.structure4h) === side
  );
  const regime = upper(signal?.marketRegime?.regime);
  const confirmedPullback = Boolean(signal?.confirmedEntry);
  const strongTrigger = bool(
    signal?.pullback?.strongTrigger,
    bool(signal?.pullback?.confirmed)
  );

  const minScore = isBreakout ? breakoutMinScore : pullbackMinScore;
  const minAi = isBreakout ? breakoutMinAi : pullbackMinAi;
  const minVolume = isBreakout ? breakoutMinVolume : pullbackMinVolume;
  const minEdge = isBreakout ? breakoutMinEdge : pullbackMinEdge;

  const reasons = [];

  if (score < minScore) reasons.push(`score ${score} < ${minScore}`);
  if (ai < minAi) reasons.push(`IA ${ai}% < ${minAi}%`);
  if (volume < minVolume) {
    reasons.push(`volume ${volume.toFixed(2)}x < ${minVolume.toFixed(2)}x`);
  }
  if (edge < minEdge) reasons.push(`edge ${edge} < ${minEdge}`);
  if (momentumCount < 3) reasons.push(`momentum ${momentumCount}/3`);
  if (!oiOk) reasons.push(`OI ${signal?.oiContext?.regime || 'não confirmado'}`);
  if (!btcOk) reasons.push('BTC contrário');
  if (!antiChaseOk) reasons.push('anti-chase bloqueado');
  if (!exhaustionOk) {
    reasons.push(`exaustão: ${signal?.trendExhaustion?.reason || 'bloqueado'}`);
  }
  if (!aligned4h) reasons.push('4H não alinhado');

  if (isPullback) {
    if (regime !== 'TREND') {
      reasons.push(`Pullback HA exige TREND; atual ${regime || 'UNKNOWN'}`);
    }
    if (!strongTrigger) reasons.push('trigger forte não confirmado');
    if (requireConfirmedPullback && !confirmedPullback) {
      reasons.push('Pullback HA exige CONFIRMED ENTRY 2x5m');
    }
  }

  if (isBreakout) {
    if (breakoutExpansionOnly && regime !== 'EXPANSION') {
      reasons.push(`Breakout HA exige EXPANSION; atual ${regime || 'UNKNOWN'}`);
    }
    if (signal?.breakout?.qualified === false) {
      reasons.push('Breakout Strong não qualificado');
    }
  }

  return {
    eligible: reasons.length === 0,
    setup, side, score, ai, volume, edge, momentumCount,
    oiOk, btcOk, antiChaseOk, exhaustionOk, aligned4h,
    confirmedPullback, regime,
    minScore, minAi, minVolume, minEdge,
    reasons
  };
}

export function highAccuracyTargets({
  side,
  entry,
  stop,
  tp1R = 0.75,
  tp2R = 1.10,
  tp3R = 1.60
} = {}) {
  const e = num(entry, NaN);
  const s = num(stop, NaN);

  if (!Number.isFinite(e) || !Number.isFinite(s) || e <= 0 || s <= 0) {
    return null;
  }

  const risk = Math.abs(e - s);
  if (!(risk > 0)) return null;

  const direction = upper(side) === 'SHORT' ? -1 : 1;

  return {
    stop: s,
    tp1: e + direction * risk * tp1R,
    tp2: e + direction * risk * tp2R,
    tp3: e + direction * risk * tp3R,
    risk, tp1R, tp2R, tp3R
  };
}

export function strategyProfileDecision(
  signal,
  {
    enabled = true,
    mode = 'AUTO',
    ...assessmentOptions
  } = {}
) {
  const normalizedMode = upper(mode || 'AUTO');
  const assessment = highAccuracyAssessment(signal, assessmentOptions);

  if (!enabled || normalizedMode === 'RUNNER') {
    return { profile: 'RUNNER', forced: false, assessment };
  }

  if (normalizedMode === 'HIGH_ACCURACY') {
    return {
      profile: assessment.eligible ? 'HIGH_ACCURACY' : 'BLOCKED_HIGH_ACCURACY',
      forced: true,
      assessment
    };
  }

  return {
    profile: assessment.eligible ? 'HIGH_ACCURACY' : 'RUNNER',
    forced: false,
    assessment
  };
}
