function n(value, fallback = 0) {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}

function upper(value) {
  return String(value || '').toUpperCase();
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function check(ok, text) {
  return `${ok ? '✅' : '❌'} ${text}`;
}

function oiFavorable(signal) {
  const side = upper(signal?.side);
  const smart = upper(signal?.confirmedEntry?.smartOiClass);
  const regime = upper(
    signal?.confirmedEntry?.smartOiRegime ||
    signal?.oiContext?.regime ||
    'UNKNOWN'
  );

  if (smart) {
    return {
      ok: smart === 'FAVORABLE',
      label: smart,
      regime
    };
  }

  if (signal?.oiContext?.confirmed === true) {
    return {
      ok: true,
      label: 'FAVORABLE',
      regime
    };
  }

  const directional =
    (side === 'LONG' && regime === 'LONG_BUILDUP') ||
    (side === 'SHORT' && regime === 'SHORT_BUILDUP');

  return {
    ok: directional,
    label: directional ? 'FAVORABLE' : 'NOT_FAVORABLE',
    regime
  };
}

export function paperBlockFeedback(
  signal,
  reason,
  cfg,
  {
    phase = 'DIRECT'
  } = {}
) {
  const symbol = esc(signal?.symbol || 'UNKNOWN');
  const side = upper(signal?.side || '');
  const setup = upper(signal?.entryMode || 'PULLBACK');
  const score = n(signal?.score);
  const ai = n(signal?.ai?.confidence);
  const volume = n(signal?.t5?.volumeRatio);
  const edge = n(signal?.directionEdge);
  const momentum = n(signal?.momentum?.confirmationCount);
  const regime = upper(signal?.marketRegime?.regime || 'UNKNOWN');
  const aligned4h =
    signal?.trendExhaustion?.aligned4h === true ||
    signal?.marketRegime?.aligned4h === true ||
    upper(signal?.structure4h) === side;
  const exhaustionOk = signal?.trendExhaustion?.ok !== false;
  const antiChaseOk = signal?.antiChase?.ok !== false;
  const btcOk =
    signal?.btcRegime?.ok !== false &&
    signal?.btcRegime?.strongOpposite !== true;
  const oi = oiFavorable(signal);
  const triggerQuality = n(signal?.pullback?.triggerQuality);
  const breakoutBodyAtr = n(
    signal?.breakout?.bodyAtr,
    n(signal?.antiChase?.bodyAtr)
  );
  const breakoutDistanceAtr = n(
    signal?.antiChase?.distanceAtr,
    n(signal?.pullback?.distanceAtr, 99)
  );

  const lines = [
    `🚫 <b>PAPER NÃO ABERTO — ${symbol} ${esc(side)}</b>`,
    `🧭 Setup: ${esc(setup)} · fase ${esc(phase)}`,
    `📌 Motivo principal: <b>${esc(reason || 'bloqueado pelo PAPER')}</b>`,
    ''
  ];

  if (String(reason || '').toUpperCase().includes('ELITE QUICK')) {
    lines.push('<b>Checklist ELITE QUICK</b>');

    if (setup === 'BREAKOUT_STRONG') {
      lines.push(
        check(score >= cfg.quickBreakoutMinScore,
          `Score ${score}/${cfg.quickBreakoutMinScore}`),
        check(ai >= cfg.quickBreakoutMinAi,
          `IA ${Math.round(ai)}%/${cfg.quickBreakoutMinAi}%`),
        check(volume >= cfg.quickBreakoutMinVolume,
          `Volume ${volume.toFixed(2)}x/${cfg.quickBreakoutMinVolume.toFixed(2)}x`),
        check(edge >= cfg.quickBreakoutMinEdge,
          `Edge ${edge}/${cfg.quickBreakoutMinEdge}`),
        check(
          momentum >= cfg.quickMinMomentumConfirmations,
          `Momentum ${momentum}/3 · mínimo ${cfg.quickMinMomentumConfirmations}/3`
        ),
        check(oi.ok,
          `OI ${esc(oi.regime)} · ${esc(oi.label)}`),
        check(regime === 'EXPANSION',
          `Regime ${esc(regime)} · exige EXPANSION`),
        check(
          breakoutBodyAtr <= cfg.quickBreakoutMaxBodyAtr,
          `Corpo ${breakoutBodyAtr.toFixed(2)} ATR/≤${cfg.quickBreakoutMaxBodyAtr.toFixed(2)}`
        ),
        check(
          breakoutDistanceAtr <= cfg.quickBreakoutMaxDistanceAtr,
          `Distância EMA20 ${breakoutDistanceAtr.toFixed(2)} ATR/≤${cfg.quickBreakoutMaxDistanceAtr.toFixed(2)}`
        ),
        check(aligned4h,
          '4H alinhado'),
        check(exhaustionOk,
          'Trend Exhaustion OK'),
        check(antiChaseOk,
          'Anti-chase OK'),
        check(btcOk,
          'BTC não contrário')
      );
    } else if (setup === 'PULLBACK') {
      const confirmed = Boolean(signal?.confirmedEntry);
      const chase = n(signal?.confirmedEntry?.chaseAtr, 99);
      const confirmVol = n(
        signal?.confirmedEntry?.confirmationVolumeRatio,
        volume
      );
      const originRegime = upper(
        signal?.confirmedEntry?.originRegime ||
        signal?.marketRegime?.regime ||
        'UNKNOWN'
      );
      const confirmationRegime = upper(
        signal?.confirmedEntry?.confirmationRegime ||
        signal?.marketRegime?.confirmationRegime ||
        ''
      );

      lines.push(
        check(upper(signal?.strategyProfile || '') === 'HIGH_ACCURACY' || true,
          'Perfil técnico HIGH ACCURACY avaliado pelo PAPER'),
        check(confirmed,
          'Confirmed Entry'),
        check(score >= cfg.quickPullbackMinScore,
          `Score ${score}/${cfg.quickPullbackMinScore}`),
        check(ai >= cfg.quickPullbackMinAi,
          `IA ${Math.round(ai)}%/${cfg.quickPullbackMinAi}%`),
        check(chase <= cfg.quickPullbackMaxChaseAtr,
          `Chase ${chase.toFixed(2)} ATR/≤${cfg.quickPullbackMaxChaseAtr.toFixed(2)}`),
        check(confirmVol >= cfg.quickPullbackMinConfirmVolume,
          `Volume confirmação ${confirmVol.toFixed(2)}x/${cfg.quickPullbackMinConfirmVolume.toFixed(2)}x`),
        check(
          triggerQuality >= cfg.quickPullbackMinTriggerQuality,
          `Trigger execução ${triggerQuality}/5 · mínimo ${cfg.quickPullbackMinTriggerQuality}/5`
        ),
        check(
          momentum >= cfg.quickMinMomentumConfirmations,
          `Momentum ${momentum}/3 · mínimo ${cfg.quickMinMomentumConfirmations}/3`
        ),
        check(oi.ok,
          `OI ${esc(oi.regime)} · ${esc(oi.label)}`),
        check(originRegime === 'TREND',
          `Origem ${esc(originRegime)} · exige TREND`),
        check(!confirmationRegime || ['TREND','EXPANSION'].includes(confirmationRegime),
          `Confirmação ${esc(confirmationRegime || '—')}`),
        check(aligned4h,
          '4H alinhado'),
        check(exhaustionOk,
          'Trend Exhaustion OK'),
        check(antiChaseOk,
          'Anti-chase OK'),
        check(btcOk,
          'BTC não contrário')
      );
    }
  } else {
    lines.push(
      `⭐ Score ${score} · 🤖 IA ${Math.round(ai)}%`,
      `🌦 Regime ${esc(regime)} · OI ${esc(oi.regime)}`,
      `📊 Vol ${volume.toFixed(2)}x · Momentum ${momentum}/3 · edge ${edge}`
    );
  }

  lines.push(
    '',
    '<i>O sinal pode continuar sendo exibido pelo scanner; esta mensagem explica apenas por que o PAPER não executou.</i>'
  );

  return lines.join('\n');
}
