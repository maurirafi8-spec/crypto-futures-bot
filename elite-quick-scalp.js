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

  const earlyContrary =
    (side === 'LONG' && ['SHORT_BUILDUP', 'LONG_UNWIND'].includes(regime)) ||
    (side === 'SHORT' && ['LONG_BUILDUP', 'SHORT_COVERING'].includes(regime));
  if (earlyContrary) {
    return {
      ok: false,
      label: 'STRONG_CONTRARY',
      regime,
      oiPct
    };
  }

  if (confirmedClass) {
    if (confirmedClass === 'STRONG_CONTRARY') {
      return { ok: false, label: 'STRONG_CONTRARY', regime, oiPct };
    }

    if (confirmedClass === 'MILD_CONTRARY') {
      return { ok: false, label: 'STRONG_CONTRARY', regime, oiPct };
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
    return {
      ok: false,
      label: 'STRONG_CONTRARY',
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
    pullbackMinScore = 80,
    pullbackMinAi = 76,
    pullbackMaxChaseAtr = 1.25,
    pullbackMinConfirmVolume = 0.55,
    pullbackMinTriggerQuality = 3,
    minMomentumConfirmations = 2,
    breakoutMinScore = 84,
    breakoutMinAi = 78,
    breakoutMinVolume = 1.00,
    breakoutMinEdge = 8,
    breakoutMaxBodyAtr = 1.40,
    breakoutMaxDistanceAtr = 1.70,
    trendBreakoutEnabled = true,
    trendBreakoutMinVolume = 1.25,
    trendBreakoutMaxBodyAtr = 1.35,
    trendBreakoutMaxDistanceAtr = 1.55,
    unaligned4hScorePenalty = 2,
    mildOiScorePenalty = 2,
    strongOiContraryPct = 0.55
  } = {}
) {
  if (!signal) {
    return {
      eligible: false,
      setup: 'UNKNOWN',
      reasons: ['sinal ausente']
    };
  }

  // Clampa valores antigos de .env para evitar falsos bloqueios como CRV (1.17x < 1.40x) e ARB (1.15x < 1.15x)
  pullbackMinScore = Math.min(80, num(pullbackMinScore, 80));
  pullbackMinAi = Math.min(76, num(pullbackMinAi, 76));
  pullbackMaxChaseAtr = Math.max(1.25, num(pullbackMaxChaseAtr, 1.25));
  pullbackMinConfirmVolume = Math.min(0.55, num(pullbackMinConfirmVolume, 0.55));
  pullbackMinTriggerQuality = Math.min(3, num(pullbackMinTriggerQuality, 3));
  breakoutMinScore = Math.min(84, num(breakoutMinScore, 84));
  breakoutMinAi = Math.min(78, num(breakoutMinAi, 78));
  breakoutMinVolume = Math.min(1.00, num(breakoutMinVolume, 1.00));
  breakoutMaxBodyAtr = Math.max(1.40, num(breakoutMaxBodyAtr, 1.40));
  breakoutMaxDistanceAtr = Math.max(1.70, num(breakoutMaxDistanceAtr, 1.70));
  unaligned4hScorePenalty = Math.min(2, num(unaligned4hScorePenalty, 2));
  mildOiScorePenalty = Math.min(2, num(mildOiScorePenalty, 2));
  strongOiContraryPct = Math.max(0.55, num(strongOiContraryPct, 0.55));

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
    signal?.trendExhaustion?.ok !== false || rawScore >= 84;

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
      `OI contrário ao ${side} (${oi.regime || 'UNKNOWN'}; ${oi.oiPct.toFixed(2)}%)`
    );
  }

  if (!aligned4h) {
    reasons.push('4H contrário (Elite Quick exige 4H alinhado)');
  }

  const rsi5 = num(signal?.t5?.rsi, 50);
  const rsi15 = num(signal?.t15?.rsi, 50);
  if (side === 'SHORT' && (rsi5 < 41.0 || rsi15 < 40.5)) {
    reasons.push(`RSI exaurido para SHORT (5m ${rsi5.toFixed(1)} / 15m ${rsi15.toFixed(1)} < 40.5)`);
  }
  if (side === 'SHORT' && setup === 'PULLBACK' && rsi5 > 48.0 && rawScore < 85) {
    reasons.push(`RSI 5m sem pressão vendedora para SHORT (${rsi5.toFixed(1)} > 48.0 com Score < 85)`);
  }
  if (side === 'LONG' && (rsi5 > 59.0 || rsi15 > 59.5)) {
    reasons.push(`RSI exaurido para LONG (5m ${rsi5.toFixed(1)} / 15m ${rsi15.toFixed(1)} > 59.5)`);
  }
  if (side === 'LONG' && setup === 'PULLBACK' && rsi5 < 52.0 && rawScore < 85) {
    reasons.push(`RSI 5m sem força compradora para LONG (${rsi5.toFixed(1)} < 52.0 com Score < 85)`);
  }

  const btcMode = upper(signal?.btcRegime?.mode || signal?.btcRegime?.regime || 'ALIGNED');
  if (oi.label === 'NEUTRAL' && !['ALIGNED', 'BTC_SELF'].includes(btcMode)) {
    reasons.push(`OI neutro exige BTC ALIGNED (atual ${btcMode})`);
  }

  const macdOk = signal?.momentum?.macdOk === true || (side === 'LONG' ? num(signal?.t5?.macdHist, 0) > 0 : num(signal?.t5?.macdHist, 0) < 0);
  const pullbackDistAtr = num(signal?.pullback?.distanceAtr, 0.5);
  const candleBodyAtr = num(signal?.antiChase?.bodyAtr, breakoutBodyAtr);
  if (setup === 'PULLBACK' && !macdOk && !(rawScore >= 92 && pullbackDistAtr <= 0.25 && candleBodyAtr <= 0.85)) {
    reasons.push('MACD 5m não confirma o pullback');
  }
  const slope15 = Math.round(num(signal?.marketRegime?.slope15, num(signal?.pullback?.slope15, 0.15)) * 100) / 100;
  const slope1h = Math.round(num(signal?.marketRegime?.slope1h, num(signal?.pullback?.slope1h, 0.15)) * 100) / 100;
  if (setup === 'PULLBACK') {
    if (volume5 > 0 && volume5 < 0.52) {
      reasons.push(`volume 5m ${volume5.toFixed(2)}x < 0.52x`);
    }
    if (slope15 < 0.12) {
      reasons.push(`slope15 ${slope15.toFixed(2)} ATR < 0.12 ATR (15m sem inclinação/aceleração)`);
    }
    if (slope1h < 0.11) {
      reasons.push(`slope1H ${slope1h.toFixed(2)} ATR < 0.11 ATR (1H sem inclinação suficiente)`);
    }
    const effectiveChaseAtr = signal.confirmedEntry ? chaseAtr : pullbackDistAtr * 0.6;
    if ((pullbackDistAtr > 0.78 || effectiveChaseAtr > 0.48) && !(oi.label === 'FAVORABLE' && momentumCount >= 3 && slope1h >= 0.16 && slope15 >= 0.14)) {
      reasons.push(`pullback esticado (EMA ${pullbackDistAtr.toFixed(2)} ATR / chase ${effectiveChaseAtr.toFixed(2)} ATR) sem OI FAVORABLE + Momentum 3/3`);
    }
    if (!['ALIGNED', 'BTC_SELF'].includes(btcMode)) {
      const btcMixedEliteOk =
        rawScore >= 85 &&
        momentumCount >= 3 &&
        volume5 >= 0.75 &&
        slope15 >= 0.12 &&
        pullbackDistAtr <= 0.35 &&
        oi.label === 'FAVORABLE';
      if (!btcMixedEliteOk) {
        reasons.push(`BTC ${btcMode} exige Score >= 85, OI FAVORABLE, Momentum 3/3, vol >= 0.75x, slope15 >= 0.12 e EMA <= 0.35 ATR`);
      }
    }
  }
  if (setup === 'BREAKOUT_STRONG') {
    if (oi.label !== 'FAVORABLE') {
      reasons.push(`Breakout exige OI FAVORABLE (atual ${oi.regime || oi.label})`);
    }
    const hybridPullbackBreakout =
      signal?.pullback?.confirmed === true &&
      num(signal?.pullback?.triggerQuality, 0) >= 4 &&
      breakoutDistanceAtr <= 0.65 &&
      rawScore >= 95 &&
      ai >= 85 &&
      aligned4h &&
      ['ALIGNED', 'BTC_SELF'].includes(btcMode) &&
      oi.label === 'FAVORABLE' &&
      oi.oiPct >= 0.35;
    const minBreakoutVol = hybridPullbackBreakout ? 1.25 : 1.75;
    if (volume5 < minBreakoutVol) {
      reasons.push(`Breakout exige volume explosivo >= ${minBreakoutVol.toFixed(2)}x (atual ${volume5.toFixed(2)}x)`);
    }
    if (rawScore < 90) {
      reasons.push(`Breakout Quick exige Score >= 90 (atual ${rawScore})`);
    }
    if (!macdOk) {
      reasons.push('Breakout exige MACD 5m alinhado');
    }
    if (!['ALIGNED', 'BTC_SELF'].includes(btcMode)) {
      reasons.push(`Breakout exige BTC ALIGNED (atual ${btcMode})`);
    }
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

    if (signal.confirmedEntry && chaseAtr > pullbackMaxChaseAtr) {
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

    if (!['TREND', 'EXPANSION', 'TRANSITION'].includes(originRegime)) {
      reasons.push(
        `origem ${originRegime || 'UNKNOWN'}; Pullback Quick exige TREND/EXPANSION`
      );
    }

    if (
      confirmationRegime &&
      !['TREND', 'EXPANSION', 'TRANSITION'].includes(confirmationRegime)
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
