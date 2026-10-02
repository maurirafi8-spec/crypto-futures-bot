export function oppositeOiRegime(
  side,
  oiContext
) {
  const s =
    String(side || '')
      .toUpperCase();

  const regime =
    String(
      oiContext?.regime ||
      ''
    ).toUpperCase();

  if (s === 'LONG') {
    return [
      'SHORT_BUILDUP',
      'LONG_UNWIND'
    ].includes(regime);
  }

  if (s === 'SHORT') {
    return [
      'LONG_BUILDUP',
      'SHORT_COVERING'
    ].includes(regime);
  }

  return false;
}

export function classifyAIEfficiencyCandidate(
  signal,
  {
    preCandidateMinScore = 60,
    hardMinVolumeRatio = 0.45,
    hardDistanceAtr = 1.70,
    contextualOiMinPct = 0.05
  } = {}
) {
  if (!signal) {
    return {
      class: 'HARD_REJECT',
      reasons: ['candidato ausente']
    };
  }

  if (
    String(
      signal.candidateTier ||
      ''
    ).toUpperCase() ===
      'STANDARD' ||
    signal?.gates?.mathApproved
  ) {
    return {
      class: 'AI_ELIGIBLE',
      reasons: []
    };
  }

  const reasons = [];
  const side =
    String(
      signal.side ||
      ''
    ).toUpperCase();

  const score =
    Number(
      signal.score ||
      0
    );

  if (
    score <
    preCandidateMinScore
  ) {
    reasons.push(
      `score ${score} abaixo do piso técnico ${preCandidateMinScore}`
    );
  }

  const volumeRatio =
    Number(
      signal?.t5?.volumeRatio ??
      signal?.volumeRatio ??
      0
    );

  if (
    signal?.confirmation?.volumeFloorOk ===
      false ||
    (
      Number.isFinite(
        volumeRatio
      ) &&
      volumeRatio <
        hardMinVolumeRatio
    )
  ) {
    reasons.push(
      `volume ${Number.isFinite(volumeRatio) ? volumeRatio.toFixed(2) : '—'}x abaixo do piso absoluto ${hardMinVolumeRatio.toFixed(2)}x`
    );
  }

  const structure1h =
    String(
      signal.structure1h ||
      signal?.pullback?.trend1h ||
      ''
    ).toUpperCase();

  const opposite1h =
    (
      side === 'LONG' &&
      (
        structure1h === 'SHORT' ||
        structure1h === 'BEARISH'
      )
    ) ||
    (
      side === 'SHORT' &&
      (
        structure1h === 'LONG' ||
        structure1h === 'BULLISH'
      )
    );

  if (opposite1h) {
    reasons.push(
      `1H ${structure1h} contrário a ${side}`
    );
  }

  const antiDistance =
    Number(
      signal?.antiChase?.distanceAtr
    );

  const antiRetest =
    Boolean(
      signal?.antiChase?.retest
    );

  if (
    Number.isFinite(
      antiDistance
    ) &&
    antiDistance >=
      hardDistanceAtr &&
    !antiRetest
  ) {
    reasons.push(
      `anti-chase ${antiDistance.toFixed(2)} ATR sem reteste`
    );
  }

  if (
    signal?.btcRegime?.strongOpposite ||
    signal?.btcRegime?.ok ===
      false
  ) {
    reasons.push(
      `regime BTC contrário a ${side}`
    );
  }

  const oiPct =
    Math.abs(
      Number(
        signal?.oiContext?.oiPct ??
        signal?.oiPct ??
        0
      )
    );

  if (
    oppositeOiRegime(
      side,
      signal?.oiContext
    ) &&
    oiPct >=
      contextualOiMinPct
  ) {
    reasons.push(
      `OI contextual ${signal?.oiContext?.regime || 'contrário'} a ${side}`
    );
  }

  if (
    reasons.length
  ) {
    return {
      class: 'HARD_REJECT',
      reasons
    };
  }

  return {
    class: 'WATCH_TECHNICAL',
    reasons: [
      'pré-candidato próximo, aguardando melhora técnica sem gastar IA'
    ]
  };
}

export function clampDailyUsage(
  used,
  added,
  limit
) {
  const safeLimit =
    Math.max(
      0,
      Number(limit || 0)
    );

  const safeUsed =
    Math.max(
      0,
      Number(used || 0)
    );

  const safeAdded =
    Math.max(
      0,
      Number(added || 0)
    );

  const counted =
    Math.min(
      safeAdded,
      Math.max(
        0,
        safeLimit -
        safeUsed
      )
    );

  return {
    nextUsed:
      Math.min(
        safeLimit,
        safeUsed +
        counted
      ),
    counted,
    overflow:
      Math.max(
        0,
        safeAdded -
        counted
      )
  };
}
