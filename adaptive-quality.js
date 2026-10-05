function n(
  value,
  fallback = 0
) {
  const x =
    Number(value);

  return Number.isFinite(x)
    ? x
    : fallback;
}

function bool(
  value,
  fallback = false
) {
  if (
    value === true ||
    value === false
  ) {
    return value;
  }

  return fallback;
}

export function adaptiveScoreTier(
  score
) {
  const s =
    n(score);

  if (s >= 80) {
    return 'HIGH_80_PLUS';
  }

  if (s >= 75) {
    return 'MID_75_79';
  }

  if (s >= 68) {
    return 'LOW_68_74';
  }

  return 'BELOW_68';
}

export function classifyAdaptiveQualityTechnical(
  signal,
  {
    lowMaxScore = 74,
    midMaxScore = 79,
    lowMinEdge = 8,
    midMinEdge = 6,
    lowMinVolumeRatio = 0.60,
    midMinVolumeRatio = 0.55
  } = {}
) {
  if (!signal) {
    return {
      aiEligible: false,
      class: 'QUALITY_WATCH',
      tier: 'UNKNOWN',
      reasons: ['candidato ausente']
    };
  }

  const score =
    n(signal.score);

  const tier =
    adaptiveScoreTier(
      score
    );

  if (score >= 80) {
    return {
      aiEligible: true,
      class: 'AI_ELIGIBLE_HIGH',
      tier,
      reasons: []
    };
  }

  if (score < 68) {
    return {
      aiEligible: false,
      class: 'QUALITY_WATCH',
      tier,
      reasons: [
        `score ${score} abaixo do piso PAPER 68`
      ]
    };
  }

  const pullback =
    signal.pullback || {};

  const momentum =
    signal.momentum || {};

  const oi =
    signal.oiContext || {};

  const anti =
    signal.antiChase || {};

  const btc =
    signal.btcRegime || {};

  const volumeRatio =
    n(
      signal?.t5?.volumeRatio ??
      momentum?.volumeRatio
    );

  const edge =
    n(
      signal.directionEdge
    );

  const entryMode =
    String(
      signal.entryMode ||
      ''
    ).toUpperCase();

  const pullbackOk =
    entryMode ===
      'PULLBACK' &&
    bool(
      pullback.confirmed
    );

  const strongTrigger =
    bool(
      pullback.strongTrigger,
      bool(
        pullback.confirmed
      )
    );

  const trendRegime =
    String(
      signal?.marketRegime?.regime ||
      ''
    ).toUpperCase() ===
    'TREND';

  const momentum3of3 =
    n(
      momentum.confirmationCount
    ) >= 3 &&
    bool(
      momentum.volumeOk
    ) &&
    bool(
      momentum.oiOk
    ) &&
    bool(
      momentum.macdOk
    );

  const oiOk =
    bool(
      oi.confirmed
    );

  const structureOk =
    bool(
      pullback.structure1hOk
    ) &&
    bool(
      pullback.structure15Ok
    );

  const antiOk =
    anti.ok !== false;

  const btcOk =
    btc.ok !== false &&
    !bool(
      btc.strongOpposite
    );

  const lowTier =
    score <=
    lowMaxScore;

  const requiredEdge =
    lowTier
      ? lowMinEdge
      : midMinEdge;

  const requiredVolume =
    lowTier
      ? lowMinVolumeRatio
      : midMinVolumeRatio;

  const reasons = [];

  if (!pullbackOk) {
    reasons.push(
      'score abaixo de 80 exige PULLBACK confirmado'
    );
  }

  if (!strongTrigger) {
    reasons.push(
      'trigger forte/reclaim da EMA20 não confirmado'
    );
  }

  if (!trendRegime) {
    reasons.push(
      `regime ${signal?.marketRegime?.regime || 'UNKNOWN'}; score <80 exige TREND`
    );
  }

  if (!momentum3of3) {
    reasons.push(
      `momentum ${n(momentum.confirmationCount)}/3; exige 3/3`
    );
  }

  if (!oiOk) {
    reasons.push(
      `OI contextual ${oi.regime || 'neutro'} não confirma`
    );
  }

  if (!structureOk) {
    reasons.push(
      '1H + 15m não estão ambos alinhados'
    );
  }

  if (!antiOk) {
    reasons.push(
      'anti-chase bloqueado'
    );
  }

  if (!btcOk) {
    reasons.push(
      'regime BTC contrário'
    );
  }

  if (edge < requiredEdge) {
    reasons.push(
      `edge ${edge} abaixo de ${requiredEdge}`
    );
  }

  if (volumeRatio < requiredVolume) {
    reasons.push(
      `volume ${volumeRatio.toFixed(2)}x abaixo de ${requiredVolume.toFixed(2)}x`
    );
  }

  if (reasons.length) {
    return {
      aiEligible: false,
      class: 'QUALITY_WATCH',
      tier,
      requiredEdge,
      requiredVolume,
      reasons
    };
  }

  return {
    aiEligible: true,
    class:
      lowTier
        ? 'AI_ELIGIBLE_LOW_ELITE'
        : 'AI_ELIGIBLE_MID_STRICT',
    tier,
    requiredEdge,
    requiredVolume,
    reasons: []
  };
}
