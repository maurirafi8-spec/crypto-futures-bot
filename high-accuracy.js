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

function oiPolicyForSide(
  signal,
  strongContraryPct = 0.20
) {
  const side = upper(signal?.side);
  const confirmedClass =
    upper(signal?.confirmedEntry?.smartOiClass);
  const regime =
    upper(
      signal?.confirmedEntry?.smartOiRegime ||
      signal?.oiContext?.regime ||
      'NEUTRAL'
    );
  const oiPct = Math.abs(num(signal?.oiContext?.oiPct));

  if (confirmedClass) {
    if (confirmedClass === 'STRONG_CONTRARY') {
      return { level: 'STRONG_CONTRARY', regime, oiPct, accepted: false };
    }

    if (confirmedClass === 'MILD_CONTRARY') {
      return { level: 'MILD_CONTRARY', regime, oiPct, accepted: true };
    }

    return { level: confirmedClass, regime, oiPct, accepted: true };
  }

  if (signal?.oiContext?.confirmed === true) {
    return { level: 'FAVORABLE', regime, oiPct, accepted: true };
  }

  const neutral = new Set([
    'NEUTRAL',
    'OI_BUILDUP_NEUTRAL_PRICE',
    'OI_UNWIND_NEUTRAL_PRICE'
  ]);

  if (neutral.has(regime)) {
    return { level: 'NEUTRAL', regime, oiPct, accepted: true };
  }

  if (
    (side === 'LONG' && regime === 'SHORT_COVERING') ||
    (side === 'SHORT' && regime === 'LONG_UNWIND')
  ) {
    return { level: 'SUPPORTIVE', regime, oiPct, accepted: true };
  }

  const contrary =
    (side === 'LONG' && ['SHORT_BUILDUP', 'LONG_UNWIND'].includes(regime)) ||
    (side === 'SHORT' && ['LONG_BUILDUP', 'SHORT_COVERING'].includes(regime));

  if (contrary) {
    const strong = oiPct >= strongContraryPct;
    return {
      level: strong ? 'STRONG_CONTRARY' : 'MILD_CONTRARY',
      regime,
      oiPct,
      accepted: !strong
    };
  }

  return { level: 'NEUTRAL', regime, oiPct, accepted: true };
}

export function highAccuracyAssessment(
  signal,
  {
    pullbackMinScore = 80,
    pullbackMinAi = 76,
    breakoutMinScore = 84,
    breakoutMinAi = 78,
    pullbackMinVolume = 0.55,
    breakoutMinVolume = 1.00,
    pullbackMinEdge = 6,
    breakoutMinEdge = 8,
    minMomentumConfirmations = 2,
    requireConfirmedPullback = true,
    breakoutExpansionOnly = false,
    unaligned4hScorePenalty = 2,
    mildOiScorePenalty = 2,
    strongOiContraryPct = 0.55
  } = {}
) {
  if (!signal) {
    return { eligible: false, setup: 'UNKNOWN', reasons: ['sinal ausente'] };
  }

  pullbackMinScore = Math.min(80, num(pullbackMinScore, 80));
  pullbackMinAi = Math.min(76, num(pullbackMinAi, 76));
  breakoutMinScore = Math.min(84, num(breakoutMinScore, 84));
  breakoutMinAi = Math.min(78, num(breakoutMinAi, 78));
  pullbackMinVolume = Math.min(0.55, num(pullbackMinVolume, 0.55));
  breakoutMinVolume = Math.min(1.00, num(breakoutMinVolume, 1.00));
  unaligned4hScorePenalty = Math.min(2, num(unaligned4hScorePenalty, 2));
  mildOiScorePenalty = Math.min(2, num(mildOiScorePenalty, 2));
  strongOiContraryPct = Math.max(0.55, num(strongOiContraryPct, 0.55));

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

  const rawScore = num(signal.score);
  const ai = num(signal?.ai?.confidence);
  const volume = Math.max(
    num(signal?.t5?.volumeRatio),
    num(signal?.t15?.volumeRatio),
    num(signal?.confirmedEntry?.confirmationVolumeRatio)
  );
  const edge = num(signal.directionEdge);
  const momentumCount = num(signal?.momentum?.confirmationCount);
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

  const oiPolicy =
    oiPolicyForSide(signal, strongOiContraryPct);

  const scorePenalty4h =
    aligned4h ? 0 : Math.max(0, num(unaligned4hScorePenalty));
  const scorePenaltyOi =
    oiPolicy.level === 'MILD_CONTRARY'
      ? Math.max(0, num(mildOiScorePenalty))
      : 0;
  const effectiveScore =
    Math.max(0, rawScore - scorePenalty4h - scorePenaltyOi);

  const minScore = isBreakout ? breakoutMinScore : pullbackMinScore;
  const minAi = isBreakout ? breakoutMinAi : pullbackMinAi;
  const minVolume = isBreakout ? breakoutMinVolume : pullbackMinVolume;
  const minEdge = isBreakout ? breakoutMinEdge : pullbackMinEdge;

  const reasons = [];

  if (effectiveScore < minScore) {
    const weights = [];
    if (scorePenalty4h > 0) weights.push(`4H -${scorePenalty4h}`);
    if (scorePenaltyOi > 0) weights.push(`OI leve -${scorePenaltyOi}`);
    reasons.push(
      `score efetivo ${effectiveScore} < ${minScore}` +
      `${weights.length ? ` (${rawScore} bruto; ${weights.join(', ')})` : ''}`
    );
  }
  if (ai < minAi) reasons.push(`IA ${ai}% < ${minAi}%`);
  if (volume < minVolume) {
    reasons.push(`volume ${volume.toFixed(2)}x < ${minVolume.toFixed(2)}x`);
  }
  if (edge < minEdge) reasons.push(`edge ${edge} < ${minEdge}`);
  if (momentumCount < minMomentumConfirmations) {
    reasons.push(
      `momentum ${momentumCount}/3 < ${minMomentumConfirmations}/3`
    );
  }
  if (oiPolicy.level === 'STRONG_CONTRARY') {
    reasons.push(
      `OI fortemente contrário (${oiPolicy.regime}; ${oiPolicy.oiPct.toFixed(2)}%)`
    );
  }
  if (!btcOk) reasons.push('BTC contrário');
  if (!antiChaseOk) reasons.push('anti-chase bloqueado');
  if (!exhaustionOk) {
    reasons.push(`exaustão: ${signal?.trendExhaustion?.reason || 'bloqueado'}`);
  }

  if (isPullback) {
    if (!['TREND', 'EXPANSION', 'TRANSITION'].includes(regime)) {
      reasons.push(`Pullback HA exige TREND/EXPANSION; atual ${regime || 'UNKNOWN'}`);
    }
    if (!strongTrigger) reasons.push('trigger forte não confirmado');
    if (requireConfirmedPullback && !confirmedPullback) {
      reasons.push('Pullback HA exige CONFIRMED ENTRY 1x5m');
    }
  }

  if (isBreakout) {
    if (breakoutExpansionOnly && !['EXPANSION', 'TREND'].includes(regime)) {
      reasons.push(`Breakout HA exige EXPANSION/TREND; atual ${regime || 'UNKNOWN'}`);
    }
    if (signal?.breakout?.qualified === false) {
      reasons.push('Breakout Strong não qualificado');
    }
  }

  return {
    eligible: reasons.length === 0,
    setup,
    side,
    score: rawScore,
    rawScore,
    effectiveScore,
    scorePenalty4h,
    scorePenaltyOi,
    ai,
    volume,
    edge,
    momentumCount,
    oiOk: oiPolicy.accepted,
    oiLevel: oiPolicy.level,
    oiRegime: oiPolicy.regime,
    btcOk,
    antiChaseOk,
    exhaustionOk,
    aligned4h,
    confirmedPullback,
    regime,
    minScore,
    minAi,
    minVolume,
    minEdge,
    minMomentumConfirmations,
    reasons
  };
}

export function highAccuracyTargets({
  side,
  entry,
  stop,
  tp1R = 0.55,
  tp2R = 0.95,
  tp3R = 1.45
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
