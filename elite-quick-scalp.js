function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function upper(value) {
  return String(value || '').toUpperCase();
}

function bool(value, fallback = false) {
  if (value === true || value === false) return value;
  return fallback;
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
      return { ok: false, label: 'STRONG_CONTRARY', regime, oiPct };
    }

    if (confirmedClass === 'MILD_CONTRARY') {
      return { ok: true, label: 'MILD_CONTRARY', regime, oiPct };
    }

    return { ok: true, label: confirmedClass, regime, oiPct };
  }

  if (signal?.oiContext?.confirmed === true) {
    return { ok: true, label: 'FAVORABLE', regime, oiPct };
  }

  const neutral = new Set([
    'NEUTRAL',
    'OI_BUILDUP_NEUTRAL_PRICE',
    'OI_UNWIND_NEUTRAL_PRICE'
  ]);

  if (neutral.has(regime)) {
    return { ok: true, label: 'NEUTRAL', regime, oiPct };
  }

  if (
    (side === 'LONG' && regime === 'SHORT_COVERING') ||
    (side === 'SHORT' && regime === 'LONG_UNWIND')
  ) {
    return { ok: true, label: 'SUPPORTIVE', regime, oiPct };
  }

  const contrary =
    (side === 'LONG' && ['SHORT_BUILDUP', 'LONG_UNWIND'].includes(regime)) ||
    (side === 'SHORT' && ['LONG_BUILDUP', 'SHORT_COVERING'].includes(regime));

  if (contrary) {
    const strong = oiPct >= strongContraryPct;
    return {
      ok: !strong,
      label: strong ? 'STRONG_CONTRARY' : 'MILD_CONTRARY',
      regime,
      oiPct
    };
  }

  return { ok: true, label: 'NEUTRAL', regime, oiPct };
}

export function eliteQuickScalpAssessment(
  signal,
  {
    strategyProfile = 'RUNNER',
    pullbackMinScore = 82,
    pullbackMinAi = 78,
    pullbackMaxChaseAtr = 0.65,
    pullbackMinConfirmVolume = 1.00,
    pullbackMinTriggerQuality = 4,
    minMomentumConfirmations = 2,
    breakoutMinScore = 88,
    breakoutMinAi = 78,
    breakoutMinVolume = 1.00,
    breakoutMinEdge = 8,
    breakoutMaxBodyAtr = 1.20,
    breakoutMaxDistanceAtr = 1.35,
    trendBreakoutEnabled = true,
    trendBreakoutMinVolume = 1.80,
    trendBreakoutMaxBodyAtr = 1.00,
    trendBreakoutMaxDistanceAtr = 1.10,
    unaligned4hScorePenalty = 4,
    mildOiScorePenalty = 4,
    strongOiContraryPct = 0.20
  } = {}
) {
  if (!signal) {
    return {
      eligible: false,
      setup: 'UNKNOWN',
      reasons: ['sinal ausente']
    };
  }

  const setup =
    upper(signal.entryMode || 'PULLBACK');

  const side =
    upper(signal.side);

  const rawScore =
    num(signal.score);

  const ai =
    num(signal?.ai?.confidence);

  const regime =
    upper(signal?.marketRegime?.regime);

  const confirmationRegime =
    upper(
      signal?.confirmedEntry?.confirmationRegime ||
      signal?.marketRegime?.confirmationRegime
    );

  const originRegime =
    upper(
      signal?.confirmedEntry?.originRegime ||
      signal?.marketRegime?.regime
    );

  const volume5 =
    num(signal?.t5?.volumeRatio);

  const confirmedVolume =
    num(
      signal?.confirmedEntry?.confirmationVolumeRatio,
      volume5
    );

  const edge =
    num(signal.directionEdge);

  const momentumCount =
    num(signal?.momentum?.confirmationCount);

  const chaseAtr =
    num(signal?.confirmedEntry?.chaseAtr, 99);

  const triggerQuality =
    num(signal?.pullback?.triggerQuality, 0);

  const breakoutBodyAtr =
    num(
      signal?.breakout?.bodyAtr,
      num(signal?.antiChase?.bodyAtr, 0)
    );

  const breakoutDistanceAtr =
    num(
      signal?.antiChase?.distanceAtr,
      num(signal?.pullback?.distanceAtr, 99)
    );

  const oi =
    oiPolicyForSide(signal, strongOiContraryPct);

  const aligned4h =
    bool(
      signal?.trendExhaustion?.aligned4h,
      bool(signal?.marketRegime?.aligned4h)
    );

  const scorePenalty4h =
    aligned4h ? 0 : Math.max(0, num(unaligned4hScorePenalty));
  const scorePenaltyOi =
    oi.label === 'MILD_CONTRARY'
      ? Math.max(0, num(mildOiScorePenalty))
      : 0;
  const effectiveScore =
    Math.max(0, rawScore - scorePenalty4h - scorePenaltyOi);

  const exhaustionOk =
    signal?.trendExhaustion?.ok !== false;

  const antiChaseOk =
    signal?.antiChase?.ok !== false;

  const btcOk =
    signal?.btcRegime?.ok !== false &&
    signal?.btcRegime?.strongOpposite !== true;

  const reasons = [];

  if (!['LONG', 'SHORT'].includes(side)) {
    reasons.push('direção inválida');
  }

  if (!exhaustionOk) {
    reasons.push(
      `Trend Exhaustion: ${signal?.trendExhaustion?.reason || 'bloqueado'}`
    );
  }

  if (!antiChaseOk) {
    reasons.push('anti-chase bloqueado');
  }

  if (!btcOk) {
    reasons.push('BTC contrário');
  }

  if (momentumCount < minMomentumConfirmations) {
    reasons.push(
      `momentum ${momentumCount}/3 < ${minMomentumConfirmations}/3`
    );
  }

  if (!oi.ok) {
    reasons.push(
      `OI fortemente contrário (${oi.regime || 'UNKNOWN'}; ${oi.oiPct.toFixed(2)}%)`
    );
  }

  const scoreReason = minScore => {
    const weights = [];
    if (scorePenalty4h > 0) weights.push(`4H -${scorePenalty4h}`);
    if (scorePenaltyOi > 0) weights.push(`OI leve -${scorePenaltyOi}`);
    return (
      `score efetivo ${effectiveScore} < ${minScore}` +
      `${weights.length ? ` (${rawScore} bruto; ${weights.join(', ')})` : ''}`
    );
  };

  if (setup === 'PULLBACK') {
    if (upper(strategyProfile) !== 'HIGH_ACCURACY') {
      reasons.push('Pullback Quick exige perfil HIGH_ACCURACY');
    }

    if (!signal.confirmedEntry) {
      reasons.push('Confirmed Entry obrigatório');
    }

    if (effectiveScore < pullbackMinScore) {
      reasons.push(scoreReason(pullbackMinScore));
    }

    if (ai < pullbackMinAi) {
      reasons.push(`IA ${ai}% < ${pullbackMinAi}%`);
    }

    if (chaseAtr > pullbackMaxChaseAtr) {
      reasons.push(
        `chase ${chaseAtr.toFixed(2)} ATR > ${pullbackMaxChaseAtr.toFixed(2)} ATR`
      );
    }

    if (confirmedVolume < pullbackMinConfirmVolume) {
      reasons.push(
        `volume confirmação ${confirmedVolume.toFixed(2)}x < ${pullbackMinConfirmVolume.toFixed(2)}x`
      );
    }

    if (triggerQuality < pullbackMinTriggerQuality) {
      reasons.push(
        `trigger na execução ${triggerQuality}/5 < ${pullbackMinTriggerQuality}/5`
      );
    }

    if (originRegime !== 'TREND') {
      reasons.push(
        `origem ${originRegime || 'UNKNOWN'}; Pullback Quick exige TREND`
      );
    }

    if (
      confirmationRegime &&
      !['TREND', 'EXPANSION'].includes(confirmationRegime)
    ) {
      reasons.push(
        `regime confirmação ${confirmationRegime} inválido`
      );
    }
  } else if (setup === 'BREAKOUT_STRONG') {
    if (effectiveScore < breakoutMinScore) {
      reasons.push(scoreReason(breakoutMinScore));
    }

    if (ai < breakoutMinAi) {
      reasons.push(`IA ${ai}% < ${breakoutMinAi}%`);
    }

    if (volume5 < breakoutMinVolume) {
      reasons.push(
        `volume ${volume5.toFixed(2)}x < ${breakoutMinVolume.toFixed(2)}x`
      );
    }

    if (edge < breakoutMinEdge) {
      reasons.push(`edge ${edge} < ${breakoutMinEdge}`);
    }

    const trendBoosted =
      trendBreakoutEnabled &&
      regime === 'TREND' &&
      volume5 >= trendBreakoutMinVolume &&
      breakoutBodyAtr <= trendBreakoutMaxBodyAtr &&
      breakoutDistanceAtr <= trendBreakoutMaxDistanceAtr;

    if (
      regime !== 'EXPANSION' &&
      !trendBoosted
    ) {
      if (
        trendBreakoutEnabled &&
        regime === 'TREND'
      ) {
        const missing = [];

        if (volume5 < trendBreakoutMinVolume) {
          missing.push(
            `vol ${volume5.toFixed(2)}x < ${trendBreakoutMinVolume.toFixed(2)}x`
          );
        }

        if (breakoutBodyAtr > trendBreakoutMaxBodyAtr) {
          missing.push(
            `corpo ${breakoutBodyAtr.toFixed(2)} ATR > ${trendBreakoutMaxBodyAtr.toFixed(2)}`
          );
        }

        if (breakoutDistanceAtr > trendBreakoutMaxDistanceAtr) {
          missing.push(
            `EMA ${breakoutDistanceAtr.toFixed(2)} ATR > ${trendBreakoutMaxDistanceAtr.toFixed(2)}`
          );
        }

        reasons.push(
          `TREND BOOSTED não qualificou: ${missing.join(' · ')}`
        );
      } else {
        reasons.push(
          `Breakout Quick exige EXPANSION${trendBreakoutEnabled ? ' ou TREND BOOSTED' : ''}; atual ${regime || 'UNKNOWN'}`
        );
      }
    }

    const maxBody =
      trendBoosted
        ? trendBreakoutMaxBodyAtr
        : breakoutMaxBodyAtr;

    const maxDistance =
      trendBoosted
        ? trendBreakoutMaxDistanceAtr
        : breakoutMaxDistanceAtr;

    if (breakoutBodyAtr > maxBody) {
      reasons.push(
        `corpo breakout ${breakoutBodyAtr.toFixed(2)} ATR > ${maxBody.toFixed(2)} ATR`
      );
    }

    if (breakoutDistanceAtr > maxDistance) {
      reasons.push(
        `distância EMA20 ${breakoutDistanceAtr.toFixed(2)} ATR > ${maxDistance.toFixed(2)} ATR`
      );
    }

    if (signal?.breakout?.qualified === false) {
      reasons.push('Breakout Strong não qualificado');
    }
  } else {
    reasons.push(`setup ${setup || 'UNKNOWN'} não suportado`);
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
    regime,
    originRegime,
    confirmationRegime,
    volume5,
    confirmedVolume,
    edge,
    momentumCount,
    minMomentumConfirmations,
    chaseAtr,
    triggerQuality,
    pullbackMinTriggerQuality,
    breakoutBodyAtr,
    breakoutDistanceAtr,
    breakoutMaxBodyAtr,
    breakoutMaxDistanceAtr,
    trendBreakoutEnabled,
    trendBreakoutMinVolume,
    trendBreakoutMaxBodyAtr,
    trendBreakoutMaxDistanceAtr,
    trendBoosted:
      setup === 'BREAKOUT_STRONG' &&
      trendBreakoutEnabled &&
      regime === 'TREND' &&
      volume5 >= trendBreakoutMinVolume &&
      breakoutBodyAtr <= trendBreakoutMaxBodyAtr &&
      breakoutDistanceAtr <= trendBreakoutMaxDistanceAtr,
    oiLevel: oi.label,
    oiRegime: oi.regime,
    aligned4h,
    exhaustionOk,
    antiChaseOk,
    btcOk,
    reasons
  };
}
