import http from 'node:http';
import { scanMarket, signalText } from './scanner.js';
import { sendMessage, getUpdates } from './telegram.js';
import { analyzeSignalWithAI, aiConfigured, aiModel } from './ai.js';

const cfg = {
  token: process.env.BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID || '',
  port: Number(process.env.PORT || 3000),
  intervalMin: Number(process.env.SCAN_INTERVAL_MINUTES || 5),
  topMarkets: Math.min(Number(process.env.TOP_MARKETS || 4), 4),
  minScore: Number(process.env.MIN_SCORE || 70),
  minVolume: Number(process.env.MIN_QUOTE_VOLUME_USDT || 20_000_000),
  cooldownMin: Number(process.env.COOLDOWN_MINUTES || 90),
  minVolumeRatio: Number(process.env.V122_VOLUME_CONFIRM_RATIO || 0.60),
  minOiPct: Number(process.env.V122_OI_CONFIRM_PCT || 0.50),
  hardMinVolumeRatio: Number(process.env.V122_HARD_MIN_VOLUME_RATIO || 0.40),
  oiRejectPct: Number(process.env.V122_OI_REJECT_PCT || -1.00),
  exceptionScore: Number(process.env.V122_EXCEPTION_SCORE || 82),
  exceptionVolumeRatio: Number(process.env.V122_EXCEPTION_VOLUME_RATIO || 1.00),
  aiEnabled: String(process.env.AI_ENABLED || 'true').toLowerCase() !== 'false',
  aiMinConfidence: Number(process.env.AI_MIN_CONFIDENCE || 65),
  aiFailOpen: String(process.env.AI_FAIL_OPEN || 'false').toLowerCase() === 'true',
  // V1.3.1 Free: no máximo 1 candidato por ciclo para poupar a cota gratuita.
  aiMaxCandidates: Math.min(Number(process.env.AI_MAX_CANDIDATES || 1), 1),
  // Reserva algumas chamadas abaixo do teto diário do plano gratuito.
  aiDailyLimit: Math.min(Number(process.env.AI_DAILY_LIMIT || 45), 45),
  // 30 min => no máximo ~48 janelas/dia; o limite diário corta em 45.
  aiMinGapMin: Math.max(Number(process.env.AI_MIN_GAP_MINUTES || 30), 1),
  // Reaproveita a decisão recente do mesmo ativo/lado sem gastar nova chamada.
  aiCacheMin: Math.max(Number(process.env.AI_CACHE_MINUTES || 30), 1)
};

if (!cfg.token) throw new Error('BOT_TOKEN não configurado');

let activeChatId = cfg.chatId;
let updateOffset = 0;
let scanning = false;
const cooldown = new Map();

// Rastreamento em memória. Reinicia quando o serviço é reiniciado/deployado.
const activeSignals = new Map();
const resultHistory = [];
const aiHistory = [];


// Controle de orçamento da camada IA para o plano gratuito.
let aiUsageDay = '';
let aiCallsToday = 0;
let aiLastCallAt = 0;
let lastAiSkipReason = '';
const aiDecisionCache = new Map();

function aiDayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function refreshAIBudgetDay() {
  const today = aiDayKey();
  if (today !== aiUsageDay) {
    aiUsageDay = today;
    aiCallsToday = 0;
    aiLastCallAt = 0;
    lastAiSkipReason = '';
    aiDecisionCache.clear();
  }
}

function aiBudgetStats() {
  refreshAIBudgetDay();
  return {
    used: aiCallsToday,
    limit: cfg.aiDailyLimit,
    remaining: Math.max(0, cfg.aiDailyLimit - aiCallsToday),
    minGapMin: cfg.aiMinGapMin,
    cacheMin: cfg.aiCacheMin
  };
}

function aiCacheKey(signal) {
  return `${signal.symbol}:${signal.side}`;
}

function getCachedAI(signal) {
  const item = aiDecisionCache.get(aiCacheKey(signal));
  if (!item) return null;

  if (Date.now() - item.at > cfg.aiCacheMin * 60_000) {
    aiDecisionCache.delete(aiCacheKey(signal));
    return null;
  }

  return {
    ...item.ai,
    cached: true
  };
}

function saveCachedAI(signal, ai) {
  aiDecisionCache.set(aiCacheKey(signal), {
    at: Date.now(),
    ai: { ...ai, cached: false }
  });
}

function canSpendAICall() {
  refreshAIBudgetDay();

  if (aiCallsToday >= cfg.aiDailyLimit) {
    lastAiSkipReason = `limite diário gratuito atingido (${aiCallsToday}/${cfg.aiDailyLimit})`;
    return false;
  }

  const waitMs = cfg.aiMinGapMin * 60_000 - (Date.now() - aiLastCallAt);
  if (aiLastCallAt && waitMs > 0) {
    const mins = Math.max(1, Math.ceil(waitMs / 60_000));
    lastAiSkipReason = `economia do plano grátis: próxima chamada em ~${mins} min`;
    return false;
  }

  return true;
}

function registerAICall() {
  refreshAIBudgetDay();
  aiCallsToday += 1;
  aiLastCallAt = Date.now();
  lastAiSkipReason = '';
}

function alertKey(s) {
  return `${s.symbol}:${s.side}`;
}

function trackKey(s) {
  return s.dataSymbol || s.symbol;
}

function canAlert(s) {
  const prev = cooldown.get(alertKey(s)) || 0;
  return Date.now() - prev >= cfg.cooldownMin * 60_000;
}

function markAlert(s) {
  cooldown.set(alertKey(s), Date.now());
}

function digitsFor(price) {
  if (price >= 1000) return 2;
  if (price >= 1) return 4;
  return 6;
}

function fmt(price, refPrice = price) {
  return Number(price).toFixed(digitsFor(refPrice));
}

function stageName(stage) {
  if (stage >= 3) return 'TP3';
  if (stage === 2) return 'TP2';
  if (stage === 1) return 'TP1';
  return 'sem alvo';
}

function addHistory(state, outcome) {
  resultHistory.unshift({
    symbol: state.signal.symbol,
    side: state.signal.side,
    outcome,
    openedAt: state.openedAt,
    closedAt: Date.now()
  });

  if (resultHistory.length > 30) {
    resultHistory.length = 30;
  }
}

async function notify(text) {
  if (!activeChatId) return;
  await sendMessage(cfg.token, activeChatId, text);
}

async function closeTracked(state, outcome, text) {
  activeSignals.delete(trackKey(state.signal));
  addHistory(state, outcome);
  await notify(text);
}

async function updateTrackedSignals(snapshots) {
  if (!activeSignals.size) return;

  const snapBySymbol = new Map(
    snapshots.map(s => [s.dataSymbol, s])
  );

  for (const state of [...activeSignals.values()]) {
    const s = state.signal;
    const snap = snapBySymbol.get(s.dataSymbol);
    if (!snap) continue;

    // Não usa o mesmo candle de 15m em que o sinal nasceu,
    // evitando contar movimento anterior à entrada como TP/STOP.
    if (snap.t15.openTime <= state.openBarTime) {
      continue;
    }

    const high = snap.t15.high;
    const low = snap.t15.low;

    const isLong = s.side === 'LONG';

    const hitStop = isLong
      ? low <= s.stop
      : high >= s.stop;

    const hitTp1 = isLong
      ? high >= s.tp1
      : low <= s.tp1;

    const hitTp2 = isLong
      ? high >= s.tp2
      : low <= s.tp2;

    const hitTp3 = isLong
      ? high >= s.tp3
      : low <= s.tp3;

    const highestNow = hitTp3 ? 3 : hitTp2 ? 2 : hitTp1 ? 1 : 0;

    // Se STOP e um alvo novo aparecem pela primeira vez no mesmo candle,
    // não inventamos a ordem intrabar.
    if (hitStop && highestNow > state.stage) {
      const known = state.stage > 0
        ? ` Já havia confirmado ${stageName(state.stage)} antes.`
        : '';

      await closeTracked(
        state,
        `AMBÍGUO após ${stageName(state.stage)}`,
        `⚠️ <b>${s.symbol} ${s.side}</b> — candle tocou STOP e ` +
        `${stageName(highestNow)} no mesmo período.${known}\n` +
        `Não é possível saber a ordem intrabar com segurança.`
      );
      continue;
    }

    if (hitStop) {
      const suffix = state.stage > 0
        ? ` após ${stageName(state.stage)}`
        : '';

      await closeTracked(
        state,
        `STOP${suffix}`,
        `🛑 <b>${s.symbol} ${s.side}</b> — STOP atingido${suffix}.\n` +
        `Entrada: ${fmt(s.entry)} | Stop: ${fmt(s.stop, s.entry)}`
      );
      continue;
    }

    if (highestNow > state.stage) {
      state.stage = highestNow;

      if (highestNow === 3) {
        await closeTracked(
          state,
          'TP3',
          `🏆 <b>${s.symbol} ${s.side}</b> — TP3 atingido!\n` +
          `🎯 ${fmt(s.tp3, s.entry)} | Sinal encerrado no alvo máximo.`
        );
        continue;
      }

      await notify(
        `🎯 <b>${s.symbol} ${s.side}</b> — ${stageName(highestNow)} atingido!\n` +
        `${stageName(highestNow) === 'TP1'
          ? fmt(s.tp1, s.entry)
          : fmt(s.tp2, s.entry)}\n` +
        `O acompanhamento continua para os próximos níveis.`
      );
    }
  }
}

async function trackSignal(s) {
  const k = trackKey(s);
  const existing = activeSignals.get(k);

  if (existing) {
    // Não duplica acompanhamento do mesmo ativo.
    if (existing.signal.side === s.side) return;

    activeSignals.delete(k);
    addHistory(existing, 'REVERSÃO');

    await notify(
      `🔄 <b>${s.symbol}</b> — direção mudou de ` +
      `${existing.signal.side} para ${s.side}. ` +
      `O acompanhamento anterior foi encerrado como reversão.`
    );
  }

  activeSignals.set(k, {
    signal: { ...s },
    openedAt: Date.now(),
    openBarTime: s.t15.openTime,
    stage: 0
  });
}

function activeSignalsText() {
  if (!activeSignals.size) {
    return '📭 Nenhum sinal está em acompanhamento agora.';
  }

  const lines = ['📡 <b>Sinais em acompanhamento</b>', ''];

  for (const state of activeSignals.values()) {
    const s = state.signal;
    lines.push(
      `${s.side === 'LONG' ? '🟢' : '🔴'} <b>${s.symbol} ${s.side}</b> — ` +
      `${stageName(state.stage)}\n` +
      `Entrada ${fmt(s.entry)} | Stop ${fmt(s.stop, s.entry)} | ` +
      `TP3 ${fmt(s.tp3, s.entry)}`
    );
  }

  return lines.join('\n');
}

function resultsText() {
  if (!resultHistory.length) {
    return '📊 Ainda não há resultados encerrados nesta execução do bot.';
  }

  const lines = ['📊 <b>Últimos resultados</b>', ''];

  for (const r of resultHistory.slice(0, 10)) {
    const icon = r.outcome === 'TP3'
      ? '🏆'
      : r.outcome.startsWith('STOP')
        ? '🛑'
        : r.outcome.startsWith('AMBÍGUO')
          ? '⚠️'
          : '🔄';

    lines.push(`${icon} ${r.symbol} ${r.side} — ${r.outcome}`);
  }

  lines.push('', '<i>Histórico reinicia quando o serviço reinicia ou recebe novo deploy.</i>');
  return lines.join('\n');
}


function aiEnabledNow() {
  return cfg.aiEnabled && aiConfigured();
}

function aiDecisionIcon(decision) {
  if (decision === 'APPROVE') return '✅';
  if (decision === 'WAIT') return '⏳';
  return '🚫';
}

function rememberAI(signal, ai) {
  aiHistory.unshift({
    symbol: signal.symbol,
    side: signal.side,
    score: signal.score,
    decision: ai.decision,
    confidence: ai.confidence,
    reason: ai.reason,
    model: ai.model,
    at: Date.now()
  });

  if (aiHistory.length > 30) aiHistory.length = 30;
}

function aiHistoryText() {
  if (!aiHistory.length) {
    return aiEnabledNow()
      ? '🤖 A IA ainda não avaliou nenhum candidato nesta execução.'
      : '🤖 Analista IA está desativado ou sem OPENROUTER_API_KEY.';
  }

  const budget = aiBudgetStats();
  const lines = [
    `🤖 <b>Últimas decisões da IA</b>`,
    `Modelo: <code>${aiModel()}</code>`,
    `🆓 Uso IA hoje: ${budget.used}/${budget.limit} (${budget.remaining} restantes)`,
    `⏳ Intervalo mínimo: ${budget.minGapMin} min | Cache: ${budget.cacheMin} min`,
    ''
  ];

  for (const r of aiHistory.slice(0, 10)) {
    lines.push(
      `${aiDecisionIcon(r.decision)} <b>${r.symbol} ${r.side}</b> — ` +
      `${r.decision} ${Math.round(r.confidence)}%\n` +
      `${r.reason}`
    );
  }

  return lines.join('\n');
}

async function validateSignalsWithAI(signals) {
  if (!cfg.aiEnabled) {
    return signals.map(s => ({
      ...s,
      ai: {
        decision: 'APPROVE',
        confidence: 0,
        risk: 'MEDIUM',
        style: 'NORMAL',
        reason: 'Validação IA desativada por AI_ENABLED=false',
        model: 'OFF'
      }
    }));
  }

  if (!aiConfigured()) {
    if (cfg.aiFailOpen) {
      console.log('[ai] OPENROUTER_API_KEY ausente; fail-open ativo');
      return signals.map(s => ({
        ...s,
        ai: {
          decision: 'APPROVE',
          confidence: 0,
          risk: 'MEDIUM',
          style: 'NORMAL',
          reason: 'IA indisponível; aprovado pelo filtro matemático (fail-open)',
          model: 'OFF'
        }
      }));
    }

    console.log('[ai] OPENROUTER_API_KEY ausente; sinais bloqueados');
    return [];
  }

  // No modo gratuito, apenas o melhor candidato matemático chega à camada IA.
  const selected = signals.slice(0, cfg.aiMaxCandidates);
  const approved = [];

  for (const s of selected) {
    const cached = getCachedAI(s);
    if (cached) {
      console.log(`[ai] cache ${s.symbol}: ${cached.decision} ${Math.round(cached.confidence)}%`);
      rememberAI(s, cached);

      if (
        cached.decision === 'APPROVE' &&
        cached.confidence >= cfg.aiMinConfidence
      ) {
        approved.push({ ...s, ai: cached });
      }
      continue;
    }

    if (!canSpendAICall()) {
      console.log(`[ai] ${s.symbol}: chamada pulada — ${lastAiSkipReason}`);
      continue;
    }

    try {
      console.log(`[ai] avaliando ${s.symbol} ${s.side} com ${aiModel()}`);

      // Conta a tentativa antes da requisição, pois chamadas com erro também podem consumir cota.
      registerAICall();
      const ai = await analyzeSignalWithAI(s);
      saveCachedAI(s, ai);
      rememberAI(s, ai);

      console.log(
        `[ai] ${s.symbol}: ${ai.decision} ${Math.round(ai.confidence)}% — ${ai.reason}`
      );

      if (
        ai.decision === 'APPROVE' &&
        ai.confidence >= cfg.aiMinConfidence
      ) {
        approved.push({ ...s, ai });
      }
    } catch (error) {
      console.error(`[ai] ${s.symbol}: ${error.message}`);

      if (cfg.aiFailOpen) {
        approved.push({
          ...s,
          ai: {
            decision: 'APPROVE',
            confidence: 0,
            risk: 'MEDIUM',
            style: 'NORMAL',
            reason: `IA falhou; liberado pelo filtro matemático: ${error.message}`.slice(0, 220),
            model: 'ERROR'
          }
        });
      }
    }
  }

  return approved;
}

async function doScan({ forceReply = false } = {}) {
  if (scanning) {
    if (forceReply && activeChatId) {
      await sendMessage(
        cfg.token,
        activeChatId,
        '⏳ Já existe uma varredura em andamento. Aguarde ela terminar.'
      );
    }
    return [];
  }

  scanning = true;

  try {
    console.log(`[scan] iniciando ${new Date().toISOString()}`);

    const { signals: mathSignals, snapshots } = await scanMarket({
      topMarkets: cfg.topMarkets,
      minQuoteVolume: cfg.minVolume,
      minScore: cfg.minScore,
      minVolumeRatio: cfg.minVolumeRatio,
      minOiPct: cfg.minOiPct,
      hardMinVolumeRatio: cfg.hardMinVolumeRatio,
      oiRejectPct: cfg.oiRejectPct,
      exceptionScore: cfg.exceptionScore,
      exceptionVolumeRatio: cfg.exceptionVolumeRatio
    });

    // Primeiro atualiza sinais antigos com os preços/candles deste scan.
    await updateTrackedSignals(snapshots);

    console.log(`[scan] ${mathSignals.length} sinais matemáticos >= ${cfg.minScore}`);

    const signals = await validateSignalsWithAI(mathSignals);

    console.log(
      `[scan] ${signals.length} sinais liberados após camada IA`
    );

    if (activeChatId) {
      const fresh = forceReply
        ? signals.slice(0, 5)
        : signals.filter(canAlert).slice(0, 5);

      if (forceReply && fresh.length === 0) {
        await sendMessage(
          cfg.token,
          activeChatId,
          aiEnabledNow()
            ? (
                mathSignals.length > 0 && lastAiSkipReason
                  ? `🆓 Candidato encontrado, mas a chamada da IA foi economizada: ${lastAiSkipReason}.`
                  : '🤖 Nenhum candidato foi aprovado pela camada IA agora.'
              )
            : '🔎 Nenhum sinal passou pelo score + confirmação de Volume/OI agora.'
        );
      }

      for (const s of fresh) {
        await sendMessage(cfg.token, activeChatId, signalText(s));
        markAlert(s);
        await trackSignal(s);
      }
    }

    return signals;
  } catch (error) {
    console.error('[scan]', error.message);

    if (forceReply && activeChatId) {
      await sendMessage(
        cfg.token,
        activeChatId,
        `⚠️ Falha na varredura: ${error.message}`
      );
    }

    return [];
  } finally {
    scanning = false;
  }
}

async function handleMessage(msg) {
  const text = (msg.text || '').trim();
  if (!text.startsWith('/')) return;

  activeChatId = String(msg.chat.id);

  if (text.startsWith('/start')) {
    await sendMessage(
      cfg.token,
      activeChatId,
      '🤖 <b>Crypto Futures Scanner V1.3.1 FREE</b>\n\n' +
      'Comandos:\n' +
      '/scan — varrer o mercado agora\n' +
      '/status — ver configuração\n' +
      '/top — mostrar os melhores sinais atuais\n' +
      '/ativos — sinais em acompanhamento\n' +
      '/resultados — últimos resultados acompanhados\n' +
      '/ia — últimas decisões do Analista IA'
    );
  } else if (text.startsWith('/status')) {
    await sendMessage(
      cfg.token,
      activeChatId,
      `✅ Online — V1.3.1 FREE\n` +
      `⏱ Scan: ${cfg.intervalMin} min\n` +
      `🪙 Top mercados: ${cfg.topMarkets}\n` +
      `⭐ Score mínimo: ${cfg.minScore}\n` +
      `💵 Volume mínimo 24h: $${Math.round(cfg.minVolume / 1e6)}M\n` +
      `📊 Volume para confirmar: ${cfg.minVolumeRatio.toFixed(2)}x\n` +
      `🚫 Piso absoluto de volume: ${cfg.hardMinVolumeRatio.toFixed(2)}x\n` +
      `📈 OI para confirmar: +${cfg.minOiPct.toFixed(2)}%\n` +
      `🛡 Bloqueio OI: abaixo de ${cfg.oiRejectPct.toFixed(2)}%\n` +
      `⚡ Exceção: score ${cfg.exceptionScore}+ e volume ${cfg.exceptionVolumeRatio.toFixed(2)}x+\n` +
      `🧊 Cooldown: ${cfg.cooldownMin} min\n` +
      `📡 Dados: Coinalyze\n` +
      `🤖 IA: ${aiEnabledNow() ? 'ATIVA' : 'INATIVA'}\n` +
      `🧠 Modelo: ${aiEnabledNow() ? aiModel() : '—'}\n` +
      `✅ Confiança mínima IA: ${cfg.aiMinConfidence}%\n` +
      `🆓 IA grátis: ${aiBudgetStats().used}/${aiBudgetStats().limit} chamadas hoje\n` +
      `⏳ Economia IA: 1 candidato / mínimo ${cfg.aiMinGapMin} min / cache ${cfg.aiCacheMin} min\n` +
      `🎯 Acompanhando: ${activeSignals.size} sinal(is)`
    );
  } else if (text.startsWith('/ativos')) {
    await sendMessage(cfg.token, activeChatId, activeSignalsText());
  } else if (text.startsWith('/resultados')) {
    await sendMessage(cfg.token, activeChatId, resultsText());
  } else if (text.startsWith('/ia')) {
    await sendMessage(cfg.token, activeChatId, aiHistoryText());
  } else if (text.startsWith('/scan') || text.startsWith('/top')) {
    if (!scanning) {
      await sendMessage(
        cfg.token,
        activeChatId,
        '🔎 Analisando mercado de Futuros...'
      );
    }

    await doScan({ forceReply: true });
  }
}

async function pollingLoop() {
  while (true) {
    try {
      const data = await getUpdates(cfg.token, updateOffset, 25);

      for (const u of data.result || []) {
        updateOffset = u.update_id + 1;
        if (u.message) await handleMessage(u.message);
      }
    } catch (e) {
      console.error('[telegram]', e.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    service: 'crypto-futures-scanner',
    version: '1.3.1-free',
    scanning,
    activeSignals: activeSignals.size,
    results: resultHistory.length,
    aiEnabled: aiEnabledNow(),
    aiModel: aiEnabledNow() ? aiModel() : null,
    aiHistory: aiHistory.length,
    time: new Date().toISOString()
  }));
}).listen(cfg.port, () => console.log(`HTTP :${cfg.port}`));

console.log('Crypto Futures Scanner V1.3.1 FREE pronto ✅');

setTimeout(() => doScan().catch(console.error), 5000);
setInterval(() => doScan().catch(console.error), cfg.intervalMin * 60_000);
pollingLoop();
