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

function oiFavorableForSide(signal) {
  const side = upper(signal?.side);
  const confirmedClass =
    upper(signal?.confirmedEntry?.smartOiClass);

  if (confirmedClass) {
    return {
      ok: confirmedClass === 'FAVORABLE',
      label: confirmedClass,
      regime:
        upper(signal?.confirmedEntry?.smartOiRegime) ||
        upper(signal?.oiContext?.regime)
    };
  }

  const regime =
    upper(signal?.oiContext?.regime);

  const confirmed =
    signal?.oiContext?.confirmed === true;

  if (confirmed) {
    return {
      ok: true,
      label: 'FAVORABLE',
      regime
    };
  }

  // Fallback explícito para snapshots que não carregam confirmed=true.
  const directional =
    (side === 'LONG' && regime === 'LONG_BUILDUP') ||
    (side === 'SHORT' && regime === 'SHORT_BUILDUP');

  return {
    ok: directional,
    label: directional ? 'FAVORABLE' : 'NOT_FAVORABLE',
    regime
  };
}

export function eliteQuickScalpAssessment(
  signal,
  {
    strategyProfile = 'RUNNER',
    pullbackMinScore = 88,
    pullbackMinAi = 82,
    pullbackMaxChaseAtr = 0.55,
    pullbackMinConfirmVolume = 0.80,
    breakoutMinScore = 90,
    breakoutMinAi = 80,
    breakoutMinVolume = 1.25,
    breakoutMinEdge = 10
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

  const score =
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

  const oi =
    oiFavorableForSide(signal);

  const aligned4h =
    bool(
      signal?.trendExhaustion?.aligned4h,
      bool(signal?.marketRegime?.aligned4h)
    );

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

  if (!aligned4h) {
    reasons.push('4H não alinhado');
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

  if (momentumCount < 3) {
    reasons.push(`momentum ${momentumCount}/3`);
  }

  if (!oi.ok) {
    reasons.push(`OI não FAVORABLE (${oi.regime || 'UNKNOWN'})`);
  }

  if (setup === 'PULLBACK') {
    if (upper(strategyProfile) !== 'HIGH_ACCURACY') {
      reasons.push('Pullback Quick exige perfil HIGH_ACCURACY');
    }

    if (!signal.confirmedEntry) {
      reasons.push('Confirmed Entry obrigatório');
    }

    if (score < pullbackMinScore) {
      reasons.push(`score ${score} < ${pullbackMinScore}`);
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
    if (score < breakoutMinScore) {
      reasons.push(`score ${score} < ${breakoutMinScore}`);
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

    if (regime !== 'EXPANSION') {
      reasons.push(
        `Breakout Quick exige EXPANSION; atual ${regime || 'UNKNOWN'}`
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
    score,
    ai,
    regime,
    originRegime,
    confirmationRegime,
    volume5,
    confirmedVolume,
    edge,
    momentumCount,
    chaseAtr,
    oiLevel: oi.label,
    oiRegime: oi.regime,
    aligned4h,
    exhaustionOk,
    antiChaseOk,
    btcOk,
    reasons
  };
}
