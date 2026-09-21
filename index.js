import http from 'node:http';
import { scanMarket, signalText } from './scanner.js';
import { sendMessage, getUpdates } from './telegram.js';
import {
  analyzeSignalWithAI,
  aiConfigured,
  aiModel,
  aiRescueEnabled,
  aiRescueModel,
  aiToolCallingEnabled,
  aiReasoningMode,
  aiPrimaryMaxTokens,
  aiRescueMaxTokens
} from './ai.js';
import {
  buildHyperDryRunPlan,
  hyperExecutionEligibility,
  hyperConfig,
  hyperStatusText,
  testHyperliquidConnectivity,
  testHyperliquidAccount,
  getHyperAgentStatus,
  placeSignalSignedTestnet,
  placeManualSignedTestnet
} from './hyperliquid-executor.js';
import {
  paperConfig,
  maybeOpenPaperPosition,
  updatePaperTrading,
  paperStatusText,
  paperPositionsText,
  paperTradesText,
  paperPause,
  paperResume,
  paperReset,
  paperStateInfo,
  paperOpenSymbols
} from './paper-trader.js';

const cfg = {
  token: process.env.BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID || '',
  port: Number(process.env.PORT || 3000),
  intervalMin: Math.max(
    Number(process.env.SCAN_INTERVAL_MINUTES || 1),
    1
  ),
  scanBatchSize: Math.min(
    Math.max(Number(process.env.SCAN_BATCH_SIZE || 4), 2),
    4
  ),
  topMarkets: Math.min(
    Math.max(Number(process.env.V133_TOP_MARKETS || 12), 1),
    12
  ),
  minScore: Number(process.env.MIN_SCORE || 70),
  preCandidateMinScore: Number(process.env.PRE_CANDIDATE_MIN_SCORE || 60),
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
  // 30 min para candidatos normais.
  aiMinGapMin: Math.max(Number(process.env.AI_MIN_GAP_MINUTES || 20), 1),

  // V1.5.4: prioridade adaptativa para SCALP.
  // NORMAL: usa o gap econômico de 20 min.
  // SCALP_FORTE: score 85+ / vol 0.60x+ / OI +1.00%+ -> gap 5 min.
  // SUPER_SCALP: score 90+ / vol 0.60x+ / OI +1.50%+ -> gap 2 min.
  aiPriorityEnabled:
    String(process.env.AI_PRIORITY_ENABLED || 'true').toLowerCase() !== 'false',

  aiPriorityScore: Number(process.env.AI_PRIORITY_SCORE || 85),
  aiPriorityVolumeRatio: Number(process.env.AI_PRIORITY_VOLUME_RATIO || 0.60),
  aiPriorityOiPct: Number(process.env.AI_PRIORITY_OI_PCT || 1.00),
  aiPriorityGapMin: Math.max(
    Number(process.env.AI_PRIORITY_GAP_MINUTES || 5),
    1
  ),

  aiSuperScalpScore:
    Number(process.env.AI_SUPER_SCALP_SCORE || 90),
  aiSuperScalpVolumeRatio:
    Number(process.env.AI_SUPER_SCALP_VOLUME_RATIO || 0.60),
  aiSuperScalpOiPct:
    Number(process.env.AI_SUPER_SCALP_OI_PCT || 1.50),
  aiSuperScalpGapMin: Math.max(
    Number(process.env.AI_SUPER_SCALP_GAP_MINUTES || 2),
    1
  ),

  // SCALP_FORTE + SUPER_SCALP compartilham este teto.
  // O limite global de 45 requests/dia continua soberano.
  aiPriorityDailyLimit: Math.min(
    Math.max(Number(process.env.AI_PRIORITY_DAILY_LIMIT || 12), 0),
    20
  ),

  // Cache normal.
  aiCacheMin: Math.max(Number(process.env.AI_CACHE_MINUTES || 30), 1),

  // Cache curto para mercado rápido.
  aiPriorityCacheMin: Math.max(
    Number(process.env.AI_PRIORITY_CACHE_MINUTES || 5),
    1
  ),
  aiSuperScalpCacheMin: Math.max(
    Number(process.env.AI_SUPER_SCALP_CACHE_MINUTES || 2),
    1
  ),

  // V1.3.9: WAIT não é esquecido. O bot observa o próximo candle fechado
  // e só gasta uma nova chamada quando houver mudança útil.
  aiWaitRecheckEnabled:
    String(process.env.AI_WAIT_RECHECK_ENABLED || 'true').toLowerCase() !== 'false',
  aiWaitRecheckGapMin: Math.max(
    Number(process.env.AI_WAIT_RECHECK_GAP_MINUTES || 10),
    5
  ),
  aiWaitRecheckDailyLimit: Math.min(
    Math.max(Number(process.env.AI_WAIT_RECHECK_DAILY_LIMIT || 8), 0),
    20
  ),
  aiWaitRecheckMaxAttempts: Math.min(
    Math.max(Number(process.env.AI_WAIT_RECHECK_MAX_ATTEMPTS || 3), 1),
    6
  ),
  aiWaitRecheckMinConfidence: Math.max(
    Number(process.env.AI_WAIT_RECHECK_MIN_CONFIDENCE || 60),
    0
  ),

  // V1.3.9.2: WAIT 55–59% só entra na watchlist quando o setup
  // técnico já estiver forte o suficiente.
  aiWaitConditionalMinConfidence: Math.max(
    Number(process.env.AI_WAIT_CONDITIONAL_MIN_CONFIDENCE || 55),
    0
  ),
  aiWaitConditionalScore: Math.max(
    Number(process.env.AI_WAIT_CONDITIONAL_SCORE || 80),
    0
  ),
  aiWaitConditionalOiPct: Number(
    process.env.AI_WAIT_CONDITIONAL_OI_PCT || 1.00
  ),
  aiWaitConditionalVolumeRatio: Math.max(
    Number(process.env.AI_WAIT_CONDITIONAL_VOLUME_RATIO || 0.60),
    0
  ),

  // V1.3.9.3: WATCH é uma observação ativa, não entrada.
  // WATCH >= 60% pode ficar na mesma watchlist de recheck.
  aiWatchRecheckMinConfidence: Math.max(
    Number(process.env.AI_WATCH_RECHECK_MIN_CONFIDENCE || 60),
    0
  ),

  aiWaitRecheckStaleMin: Math.max(
    Number(process.env.AI_WAIT_RECHECK_STALE_MINUTES || 20),
    15
  ),
  aiWaitWatchMaxAgeMin: Math.max(
    Number(process.env.AI_WAIT_WATCH_MAX_AGE_MINUTES || 90),
    30
  )
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

// V1.4.1: executor Hyperliquid TESTNET em DRY_RUN.
// Nenhuma chave privada é necessária nesta etapa.
const hyperExecutionHistory = [];
const hyperExecutionKeys = new Set();
let hyperExecutionPaused = false;

// Segurança: sempre inicia desarmado após deploy/restart.
// /harm arma somente TESTNET e somente se agent estiver aprovada.
let hyperSignedArmed = false;
let lastAiEvent = null;

// Último candidato que passou 100% pelo filtro técnico,
// mas ficou aguardando a janela gratuita da IA.
// Isso NÃO é sinal de entrada e nunca entra em activeSignals.
let pendingAiCandidate = null;

let lastScanReport = null;


// Controle de orçamento da camada IA para o plano gratuito.
let aiUsageDay = '';
let aiCallsToday = 0;              // tentativas/chamadas consumidas
let aiCompletedToday = 0;          // decisões válidas concluídas
let aiFailedToday = 0;             // análises que terminaram em falha
let aiRescueCallsToday = 0;        // requests extras feitos pelo rescue
let aiPriorityCallsToday = 0;
let aiWaitRecheckCallsToday = 0;
let aiLastCallAt = 0;
let lastAiSkipReason = '';
let lastAiCallMode = 'NORMAL';
const aiDecisionCache = new Map();

// V1.3.9: sinais que receberam WAIT ficam numa watchlist técnica.
// O registro guarda o estado do mercado na hora da decisão para comparar
// com os próximos candles fechados.
const aiWaitWatchlist = new Map();

const FAST_CORE_BASES = [
  'BTC',
  'ETH',
  'SOL'
];

const ROTATION_SCAN_BASES = [
  'XRP',
  'BNB',
  'DOGE',
  'ADA',
  'LINK',
  'AVAX',
  'SUI',
  'LTC',
  'BCH',
  'DOT',
  'NEAR',
  'UNI',
  'AAVE',
  'ETC',
  'ATOM',
  'INJ',
  'HBAR',
  'TRX',
  'FIL',
  'ARB',
  'OP'
];

let scanCoreCursor = 0;
let scanRotationCursor = 0;
let scanUrgentCursor = 0;
let lastScanBatch = [];

function baseFromSymbol(symbol) {
  return String(symbol || '')
    .toUpperCase()
    .replace(/[-_/]/g, '')
    .replace(/USDT.*$/, '')
    .replace(/PERP.*$/, '');
}

function urgentScanBases() {
  const values = [];

  for (const symbol of paperOpenSymbols()) {
    const base = baseFromSymbol(symbol);
    if (base) values.push(base);
  }

  for (const watch of aiWaitWatchlist.values()) {
    const base = baseFromSymbol(watch.symbol);
    if (base) values.push(base);
  }

  if (pendingAiCandidate?.symbol) {
    const base = baseFromSymbol(pendingAiCandidate.symbol);
    if (base) values.push(base);
  }

  return [...new Set(values)]
    .filter(base => base && base !== 'USDT');
}

function takeRotating(items, cursor, count, blocked = new Set()) {
  const out = [];

  if (!items.length || count <= 0) {
    return {
      values: out,
      nextCursor: cursor
    };
  }

  let checked = 0;
  let idx = cursor % items.length;

  while (
    out.length < count &&
    checked < items.length * 2
  ) {
    const value = items[idx];

    if (
      value &&
      !blocked.has(value) &&
      !out.includes(value)
    ) {
      out.push(value);
    }

    idx = (idx + 1) % items.length;
    checked += 1;
  }

  return {
    values: out,
    nextCursor: idx
  };
}

function nextAutomaticScanBatch() {
  const size = cfg.scanBatchSize;
  const batch = [];
  const blocked = new Set();

  const urgent = urgentScanBases();

  if (urgent.length) {
    const urgentPick =
      takeRotating(
        urgent,
        scanUrgentCursor,
        Math.min(2, size),
        blocked
      );

    for (const base of urgentPick.values) {
      batch.push(base);
      blocked.add(base);
    }

    scanUrgentCursor =
      urgentPick.nextCursor;
  }

  if (batch.length < size) {
    let attempts = 0;

    while (
      attempts < FAST_CORE_BASES.length &&
      batch.length < size
    ) {
      const base =
        FAST_CORE_BASES[
          scanCoreCursor %
          FAST_CORE_BASES.length
        ];

      scanCoreCursor =
        (
          scanCoreCursor + 1
        ) %
        FAST_CORE_BASES.length;

      attempts += 1;

      if (!blocked.has(base)) {
        batch.push(base);
        blocked.add(base);
        break;
      }
    }
  }

  if (batch.length < size) {
    const rotationPick =
      takeRotating(
        ROTATION_SCAN_BASES,
        scanRotationCursor,
        size - batch.length,
        blocked
      );

    for (const base of rotationPick.values) {
      batch.push(base);
      blocked.add(base);
    }

    scanRotationCursor =
      rotationPick.nextCursor;
  }

  lastScanBatch = batch;
  return batch;
}

function scanSchedulerText() {
  const urgent = urgentScanBases();

  return (
    `⏱ <b>Scheduler 1 minuto</b>\n` +
    `Lote: ${cfg.scanBatchSize} moedas por scan\n` +
    `Cotação: USDT em todos os contratos\n` +
    `Prioridade rápida: BTC / ETH / SOL\n` +
    `WATCH/PAPER prioritários: ${urgent.length ? urgent.join(', ') : 'nenhum'}\n` +
    `Último lote: ${lastScanBatch.length ? lastScanBatch.join(', ') : 'ainda não executado'}`
  );
}

function aiDayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function refreshAIBudgetDay() {
  const today = aiDayKey();
  if (today !== aiUsageDay) {
    aiUsageDay = today;
    aiCallsToday = 0;
    aiCompletedToday = 0;
    aiFailedToday = 0;
    aiRescueCallsToday = 0;
    aiPriorityCallsToday = 0;
    aiWaitRecheckCallsToday = 0;
    aiLastCallAt = 0;
    lastAiSkipReason = '';
    lastAiCallMode = 'NORMAL';
    aiDecisionCache.clear();
  }
}

function aiBudgetStats() {
  refreshAIBudgetDay();
  return {
    used: aiCallsToday,
    completed: aiCompletedToday,
    failed: aiFailedToday,
    rescueCalls: aiRescueCallsToday,
    limit: cfg.aiDailyLimit,
    remaining: Math.max(0, cfg.aiDailyLimit - aiCallsToday),
    minGapMin: cfg.aiMinGapMin,
    cacheMin: cfg.aiCacheMin,
    priorityEnabled: cfg.aiPriorityEnabled,
    priorityUsed: aiPriorityCallsToday,
    priorityLimit: cfg.aiPriorityDailyLimit,
    priorityGapMin: cfg.aiPriorityGapMin,
    priorityScore: cfg.aiPriorityScore,
    priorityVolumeRatio: cfg.aiPriorityVolumeRatio,
    priorityOiPct: cfg.aiPriorityOiPct,
    priorityCacheMin: cfg.aiPriorityCacheMin,
    superScalpGapMin: cfg.aiSuperScalpGapMin,
    superScalpScore: cfg.aiSuperScalpScore,
    superScalpVolumeRatio: cfg.aiSuperScalpVolumeRatio,
    superScalpOiPct: cfg.aiSuperScalpOiPct,
    superScalpCacheMin: cfg.aiSuperScalpCacheMin,
    waitRecheckEnabled: cfg.aiWaitRecheckEnabled,
    waitRecheckUsed: aiWaitRecheckCallsToday,
    waitRecheckLimit: cfg.aiWaitRecheckDailyLimit,
    waitRecheckGapMin: cfg.aiWaitRecheckGapMin,
    waitRecheckMaxAttempts: cfg.aiWaitRecheckMaxAttempts,
    waitWatching: aiWaitWatchlist.size
  };
}

function aiCacheKey(signal) {
  return `${signal.symbol}:${signal.side}`;
}

function cacheTtlMin(signal, item = null) {
  const modeNow = aiPriorityClass(signal);
  const modeAtSave = String(item?.priorityClassAtSave || '');

  if (
    modeNow === 'SUPER_SCALP' ||
    modeAtSave === 'SUPER_SCALP'
  ) {
    return Math.min(
      cfg.aiCacheMin,
      cfg.aiSuperScalpCacheMin
    );
  }

  const priorityNow =
    modeNow === 'SCALP_STRONG';

  const priorityAtSave =
    Boolean(item?.priorityAtSave) ||
    modeAtSave === 'SCALP_STRONG';

  return (priorityNow || priorityAtSave)
    ? Math.min(cfg.aiCacheMin, cfg.aiPriorityCacheMin)
    : cfg.aiCacheMin;
}


function waitWatchKey(signal) {
  return `${signal.symbol}:${signal.side}`;
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function directionalRsiHeat(signal) {
  const values = [
    signal?.t5?.rsi,
    signal?.t15?.rsi,
    signal?.t1h?.rsi,
    signal?.t4h?.rsi
  ]
    .map(Number)
    .filter(Number.isFinite);

  if (!values.length) return 50;

  // Quanto maior, mais "esticado" na direção da operação.
  if (signal.side === 'SHORT') {
    return 100 - Math.min(...values);
  }

  return Math.max(...values);
}

function emaStretchPct(signal) {
  const price = finiteNumber(signal?.t5?.price ?? signal?.t15?.price, NaN);
  const ema20 = finiteNumber(signal?.t5?.ema20 ?? signal?.t15?.ema20, NaN);

  if (!Number.isFinite(price) || !Number.isFinite(ema20) || ema20 === 0) {
    return 0;
  }

  return Math.abs((price - ema20) / ema20) * 100;
}

function waitSnapshot(signal) {
  return {
    score: finiteNumber(signal?.score),
    volumeRatio: finiteNumber(signal?.t5?.volumeRatio ?? signal?.t15?.volumeRatio),
    oiPct: finiteNumber(signal?.oiPct),
    rsiHeat: directionalRsiHeat(signal),
    stretchPct: emaStretchPct(signal),
    barTime: finiteNumber(signal?.t5?.openTime ?? signal?.t15?.openTime),
    rsi5: finiteNumber(signal?.t5?.rsi, 50),
    rsi15: finiteNumber(signal?.t15?.rsi, 50),
    rsi1h: finiteNumber(signal?.t1h?.rsi, 50),
    rsi4h: finiteNumber(signal?.t4h?.rsi, 50)
  };
}

function clearWaitWatch(signalOrKey) {
  const key = typeof signalOrKey === 'string'
    ? signalOrKey
    : waitWatchKey(signalOrKey);

  aiWaitWatchlist.delete(key);
}


function waitWatchEligibility(signal, ai) {
  if (!cfg.aiWaitRecheckEnabled) {
    return {
      eligible: false,
      mode: 'OFF',
      reason: 'recheck de observação desativado'
    };
  }

  const decision = String(ai?.decision || '').toUpperCase();

  if (!['WAIT', 'WATCH'].includes(decision)) {
    return {
      eligible: false,
      mode: 'NOT_OBSERVATION',
      reason: `decisão ${decision || 'vazia'}`
    };
  }

  if (signal?.candidateTier === 'PRE_CANDIDATE') {
    return {
      eligible: false,
      mode: 'PRE_CANDIDATE',
      reason: 'pré-candidato não entra na watchlist ativa'
    };
  }

  const confidence = Number(ai?.confidence || 0);
  const score = Number(signal?.score || 0);
  const oiPct = Number(signal?.oiPct || 0);
  const volumeRatio = Number(signal?.t15?.volumeRatio || 0);

  // WATCH: é observação explícita da IA. Não vira entrada,
  // mas WATCH >= 60% fica acompanhado para nova análise.
  if (decision === 'WATCH') {
    if (confidence >= cfg.aiWatchRecheckMinConfidence) {
      return {
        eligible: true,
        mode: 'WATCH',
        reason:
          `WATCH ${Math.round(confidence)}% >= ` +
          `${cfg.aiWatchRecheckMinConfidence}%`
      };
    }

    return {
      eligible: false,
      mode: 'WATCH_LOW_CONFIDENCE',
      reason:
        `WATCH ${Math.round(confidence)}% abaixo de ` +
        `${cfg.aiWatchRecheckMinConfidence}%`
    };
  }

  // WAIT padrão: >=60%.
  if (confidence >= cfg.aiWaitRecheckMinConfidence) {
    return {
      eligible: true,
      mode: 'WAIT_STANDARD',
      reason:
        `WAIT ${Math.round(confidence)}% >= ` +
        `${cfg.aiWaitRecheckMinConfidence}%`
    };
  }

  // WAIT condicional: 55–59% + setup técnico forte.
  const conditional =
    confidence >= cfg.aiWaitConditionalMinConfidence &&
    confidence < cfg.aiWaitRecheckMinConfidence &&
    score >= cfg.aiWaitConditionalScore &&
    oiPct >= cfg.aiWaitConditionalOiPct &&
    volumeRatio >= cfg.aiWaitConditionalVolumeRatio;

  if (conditional) {
    return {
      eligible: true,
      mode: 'WAIT_CONDITIONAL',
      reason:
        `WAIT ${Math.round(confidence)}% aceito por setup forte · ` +
        `score ${score} · vol ${volumeRatio.toFixed(2)}x · ` +
        `OI ${oiPct >= 0 ? '+' : ''}${oiPct.toFixed(2)}%`
    };
  }

  return {
    eligible: false,
    mode: 'WAIT_LOW_CONFIDENCE',
    reason:
      `WAIT ${Math.round(confidence)}% abaixo do mínimo; ` +
      `regra condicional exige ${cfg.aiWaitConditionalMinConfidence}%+ · ` +
      `score ${cfg.aiWaitConditionalScore}+ · ` +
      `vol ${cfg.aiWaitConditionalVolumeRatio.toFixed(2)}x+ · ` +
      `OI +${cfg.aiWaitConditionalOiPct.toFixed(2)}%+`
  };
}

function registerWaitDecision(signal, ai) {
  const eligibility = waitWatchEligibility(signal, ai);
  const key = waitWatchKey(signal);

  if (!eligibility.eligible) {
    clearWaitWatch(key);

    console.log(
      `[wait-recheck] ${signal.symbol}: fora da watchlist — ` +
      `${eligibility.reason}`
    );

    return;
  }

  const previous = aiWaitWatchlist.get(key);
  const wasRecheck = ai.callMode === 'RECHECK';

  aiWaitWatchlist.set(key, {
    symbol: signal.symbol,
    side: signal.side,
    createdAt: previous?.createdAt || Date.now(),
    lastDecisionAt: Date.now(),
    lastBarTime: finiteNumber(signal?.t5?.openTime ?? signal?.t15?.openTime),
    attempts: wasRecheck
      ? Math.min((previous?.attempts || 0) + 1, cfg.aiWaitRecheckMaxAttempts)
      : (previous?.attempts || 0),
    decision: String(ai.decision || 'WAIT').toUpperCase(),
    confidence: Number(ai.confidence || 0),
    reason: String(ai.reason || '').slice(0, 260),
    eligibilityMode: eligibility.mode,
    eligibilityReason: eligibility.reason,
    baseline: waitSnapshot(signal)
  });

  console.log(
    `[wait-recheck] ${signal.symbol}: entrou na watchlist ` +
    `[${eligibility.mode}] — ${eligibility.reason}`
  );
}

function waitRecheckAssessment(signal) {
  if (!cfg.aiWaitRecheckEnabled) {
    return { ready: false, reason: 'recheck de observação desativado' };
  }

  const key = waitWatchKey(signal);
  const watch = aiWaitWatchlist.get(key);

  if (!watch) {
    return { ready: false, reason: 'não está na watchlist de observação' };
  }

  const ageMin = (Date.now() - watch.createdAt) / 60_000;

  if (ageMin > cfg.aiWaitWatchMaxAgeMin) {
    aiWaitWatchlist.delete(key);
    aiDecisionCache.delete(key);

    return {
      ready: false,
      expired: true,
      reason: `${watch.decision || 'OBSERVAÇÃO'} expirou após ${Math.round(ageMin)} min`
    };
  }

  if ((watch.attempts || 0) >= cfg.aiWaitRecheckMaxAttempts) {
    return {
      ready: false,
      exhausted: true,
      reason:
        `máximo de ${cfg.aiWaitRecheckMaxAttempts} rechecks atingido`
    };
  }

  if (aiWaitRecheckCallsToday >= cfg.aiWaitRecheckDailyLimit) {
    return {
      ready: false,
      quota: true,
      reason:
        `cota diária de recheck de observação atingida ` +
        `(${aiWaitRecheckCallsToday}/${cfg.aiWaitRecheckDailyLimit})`
    };
  }

  const nowSnap = waitSnapshot(signal);
  const base = watch.baseline || {};

  if (
    !nowSnap.barTime ||
    !watch.lastBarTime ||
    nowSnap.barTime <= watch.lastBarTime
  ) {
    return {
      ready: false,
      reason: 'aguardando novo candle fechado de 5m'
    };
  }

  const sinceDecisionMin =
    (Date.now() - watch.lastDecisionAt) / 60_000;

  if (sinceDecisionMin < cfg.aiWaitRecheckGapMin) {
    return {
      ready: false,
      reason:
        `novo candle detectado; janela de recheck em ~` +
        `${Math.max(1, Math.ceil(cfg.aiWaitRecheckGapMin - sinceDecisionMin))} min`
    };
  }

  const scoreDelta = nowSnap.score - finiteNumber(base.score);
  const volumeDelta =
    nowSnap.volumeRatio - finiteNumber(base.volumeRatio);
  const oiDelta = nowSnap.oiPct - finiteNumber(base.oiPct);
  const heatReduction =
    finiteNumber(base.rsiHeat, 50) - nowSnap.rsiHeat;
  const stretchReduction =
    finiteNumber(base.stretchPct) - nowSnap.stretchPct;

  const wasHot = finiteNumber(base.rsiHeat, 50) >= 70;
  const cooledBelow70 =
    wasHot && nowSnap.rsiHeat < 70;

  const meaningfulReasons = [];

  if (cooledBelow70) {
    meaningfulReasons.push('RSI saiu da zona esticada');
  } else if (heatReduction >= 2) {
    meaningfulReasons.push(`RSI esfriou ${heatReduction.toFixed(1)} pts`);
  }

  if (scoreDelta >= 5) {
    meaningfulReasons.push(`score melhorou +${scoreDelta.toFixed(0)}`);
  }

  if (volumeDelta >= 0.20) {
    meaningfulReasons.push(`volume melhorou +${volumeDelta.toFixed(2)}x`);
  }

  if (oiDelta >= 0.25) {
    meaningfulReasons.push(`OI melhorou +${oiDelta.toFixed(2)} p.p.`);
  }

  if (stretchReduction >= 0.25) {
    meaningfulReasons.push(
      `distância da EMA20 reduziu ${stretchReduction.toFixed(2)} p.p.`
    );
  }

  // Mesmo sem melhora numérica clara, não deixamos WAIT/WATCH preso para sempre:
  // após 30 min e com novo candle fechado, a IA pode revisar o contexto.
  if (
    !meaningfulReasons.length &&
    sinceDecisionMin >= cfg.aiWaitRecheckStaleMin
  ) {
    meaningfulReasons.push(
      `${watch.decision || 'OBSERVAÇÃO'} com ${Math.round(sinceDecisionMin)} min e novo candle fechado`
    );
  }

  if (!meaningfulReasons.length) {
    return {
      ready: false,
      reason: 'novo candle fechado, mas ainda sem melhora suficiente',
      scoreDelta,
      volumeDelta,
      oiDelta,
      heatReduction,
      stretchReduction
    };
  }

  return {
    ready: true,
    reason: meaningfulReasons.join(' · '),
    scoreDelta,
    volumeDelta,
    oiDelta,
    heatReduction,
    stretchReduction,
    previousConfidence: watch.confidence,
    previousReason: watch.reason,
    attempts: watch.attempts || 0
  };
}

function reconcileWaitWatchlist(snapshots) {
  const bySymbol = new Map(
    (snapshots || []).map(s => [s.symbol, s])
  );

  for (const [key, watch] of [...aiWaitWatchlist.entries()]) {
    const current = bySymbol.get(watch.symbol);

    if (!current) continue;

    // Se a direção mudou ou o filtro técnico deixou de aprovar,
    // aquele WAIT perdeu validade.
    if (
      current.side !== watch.side ||
      !current.gates?.mathApproved
    ) {
      aiWaitWatchlist.delete(key);
      aiDecisionCache.delete(key);

      console.log(
        `[wait-recheck] ${watch.symbol}: removido da watchlist — ` +
        `${current.side !== watch.side ? 'direção mudou' : 'filtro técnico perdeu confirmação'}`
      );
    }
  }
}

function waitWatchlistText() {
  if (!aiWaitWatchlist.size) {
    return '⏳ Nenhum WAIT/WATCH está em observação para recheck.';
  }

  const lines = [
    '🔄 <b>Observações ativas da IA</b>',
    ''
  ];

  for (const watch of [...aiWaitWatchlist.values()].slice(0, 5)) {
    const ageMin = Math.max(
      0,
      Math.floor((Date.now() - watch.lastDecisionAt) / 60_000)
    );

    let entryRule = 'PADRÃO';

    if (watch.eligibilityMode === 'WAIT_CONDITIONAL') {
      entryRule = 'WAIT CONDICIONAL 55–59%';
    } else if (watch.eligibilityMode === 'WAIT_STANDARD') {
      entryRule = 'WAIT PADRÃO 60%+';
    } else if (watch.eligibilityMode === 'WATCH') {
      entryRule = 'WATCH 60%+';
    }

    lines.push(
      `👀 <b>${watch.symbol} ${watch.side}</b> — ` +
      `${watch.decision || 'OBS'} ${Math.round(watch.confidence)}%\n` +
      `🕯 Aguardando novo candle + melhora · ${ageMin} min desde a decisão\n` +
      `🔁 Rechecks: ${watch.attempts}/${cfg.aiWaitRecheckMaxAttempts}\n` +
      `🧷 Entrada na watchlist: ${entryRule}\n` +
      `${watch.reason}`
    );
  }

  return lines.join('\n');
}


function getCachedAI(signal) {
  const key = aiCacheKey(signal);
  const item = aiDecisionCache.get(key);

  if (!item) return null;

  const ttlMin = cacheTtlMin(signal, item);
  const ageMs = Date.now() - item.at;

  // WAIT/WATCH usam uma política especial: permanecem em cache até surgir
  // um gatilho real de recheck. Assim evitamos gastar chamadas apenas
  // porque o TTL comum venceu antes de fechar um candle.
  if (['WAIT', 'WATCH'].includes(item.ai?.decision)) {
    const assessment = waitRecheckAssessment(signal);

    if (assessment.ready) {
      aiDecisionCache.delete(key);
      signal._aiWaitRecheck = assessment;

      console.log(
        `[wait-recheck] ${signal.symbol}: gatilho — ${assessment.reason}`
      );

      return null;
    }

    const watch = aiWaitWatchlist.get(key);

    if (watch) {
      return {
        ...item.ai,
        cached: true,
        cacheAgeMin: ageMs / 60_000,
        cacheTtlMin: cfg.aiWaitWatchMaxAgeMin,
        waitWatching: true,
        waitRecheckReason: assessment.reason
      };
    }
  }

  if (ageMs > ttlMin * 60_000) {
    aiDecisionCache.delete(key);
    return null;
  }

  return {
    ...item.ai,
    cached: true,
    cacheAgeMin: ageMs / 60_000,
    cacheTtlMin: ttlMin
  };
}

function saveCachedAI(signal, ai) {
  aiDecisionCache.set(aiCacheKey(signal), {
    at: Date.now(),
    priorityAtSave: isPriorityAICandidate(signal),
    priorityClassAtSave: aiPriorityClass(signal),
    ai: { ...ai, cached: false }
  });
}

function adaptiveVolumeRatio(signal) {
  return Math.max(
    Number(signal?.t5?.volumeRatio || 0),
    Number(signal?.t15?.volumeRatio || 0)
  );
}

function aiPriorityClass(signal) {
  if (!cfg.aiPriorityEnabled) return 'NORMAL';
  if (!signal || signal.candidateTier !== 'STANDARD') return 'NORMAL';

  const score = Number(signal.score || 0);
  const volumeRatio = adaptiveVolumeRatio(signal);
  const oiPct = Number(signal.oiPct || 0);

  if (
    score >= cfg.aiSuperScalpScore &&
    volumeRatio >= cfg.aiSuperScalpVolumeRatio &&
    oiPct >= cfg.aiSuperScalpOiPct
  ) {
    return 'SUPER_SCALP';
  }

  if (
    score >= cfg.aiPriorityScore &&
    volumeRatio >= cfg.aiPriorityVolumeRatio &&
    oiPct >= cfg.aiPriorityOiPct
  ) {
    return 'SCALP_STRONG';
  }

  return 'NORMAL';
}

function aiPriorityRank(signal) {
  const mode = aiPriorityClass(signal);

  if (mode === 'SUPER_SCALP') return 2;
  if (mode === 'SCALP_STRONG') return 1;
  return 0;
}

function isPriorityAICandidate(signal) {
  return aiPriorityClass(signal) !== 'NORMAL';
}

function aiCallPermission(signal) {
  refreshAIBudgetDay();

  if (aiCallsToday >= cfg.aiDailyLimit) {
    lastAiSkipReason =
      `limite diário gratuito atingido (${aiCallsToday}/${cfg.aiDailyLimit})`;

    return {
      allowed: false,
      mode: 'BLOCKED',
      priorityEligible: isPriorityAICandidate(signal),
      reason: lastAiSkipReason
    };
  }

  const now = Date.now();
  const elapsedMs = aiLastCallAt
    ? now - aiLastCallAt
    : Number.POSITIVE_INFINITY;

  // V1.3.9.3: WAIT/WATCH com novo candle/melhora podem usar uma janela própria.
  if (signal?._aiWaitRecheck?.ready) {
    if (aiWaitRecheckCallsToday >= cfg.aiWaitRecheckDailyLimit) {
      lastAiSkipReason =
        `cota de recheck de observação atingida ` +
        `(${aiWaitRecheckCallsToday}/${cfg.aiWaitRecheckDailyLimit})`;

      return {
        allowed: false,
        mode: 'BLOCKED',
        priorityEligible: isPriorityAICandidate(signal),
        recheckEligible: true,
        reason: lastAiSkipReason
      };
    }

    const recheckGapMs = cfg.aiWaitRecheckGapMin * 60_000;

    if (!aiLastCallAt || elapsedMs >= recheckGapMs) {
      lastAiSkipReason = '';

      return {
        allowed: true,
        mode: 'RECHECK',
        priorityEligible: isPriorityAICandidate(signal),
        recheckEligible: true,
        reason: signal._aiWaitRecheck.reason
      };
    }

    const waitMs = Math.max(0, recheckGapMs - elapsedMs);
    const mins = Math.max(1, Math.ceil(waitMs / 60_000));

    lastAiSkipReason =
      `recheck de observação em ~${mins} min`;

    return {
      allowed: false,
      mode: 'BLOCKED',
      priorityEligible: isPriorityAICandidate(signal),
      recheckEligible: true,
      reason: lastAiSkipReason
    };
  }

  const normalGapMs = cfg.aiMinGapMin * 60_000;

  if (!aiLastCallAt || elapsedMs >= normalGapMs) {
    lastAiSkipReason = '';

    return {
      allowed: true,
      mode: 'NORMAL',
      priorityEligible: isPriorityAICandidate(signal),
      reason: ''
    };
  }

  const priorityClass =
    aiPriorityClass(signal);

  const priorityEligible =
    priorityClass !== 'NORMAL';

  if (priorityEligible) {
    if (aiPriorityCallsToday >= cfg.aiPriorityDailyLimit) {
      const normalWaitMs = Math.max(0, normalGapMs - elapsedMs);
      const mins = Math.max(1, Math.ceil(normalWaitMs / 60_000));

      lastAiSkipReason =
        `cota rápida da IA atingida ` +
        `(${aiPriorityCallsToday}/${cfg.aiPriorityDailyLimit}); ` +
        `janela normal em ~${mins} min`;

      return {
        allowed: false,
        mode: 'BLOCKED',
        priorityEligible: true,
        priorityClass,
        reason: lastAiSkipReason
      };
    }

    const fastGapMin =
      priorityClass === 'SUPER_SCALP'
        ? cfg.aiSuperScalpGapMin
        : cfg.aiPriorityGapMin;

    const fastGapMs =
      fastGapMin * 60_000;

    if (elapsedMs >= fastGapMs) {
      lastAiSkipReason = '';

      return {
        allowed: true,
        mode: priorityClass,
        priorityEligible: true,
        priorityClass,
        reason: ''
      };
    }

    const priorityWaitMs =
      Math.max(0, fastGapMs - elapsedMs);

    const mins =
      Math.max(
        1,
        Math.ceil(priorityWaitMs / 60_000)
      );

    const label =
      priorityClass === 'SUPER_SCALP'
        ? 'SUPER SCALP'
        : 'SCALP FORTE';

    lastAiSkipReason =
      `${label}: próxima chamada IA em ~${mins} min`;

    return {
      allowed: false,
      mode: 'BLOCKED',
      priorityEligible: true,
      priorityClass,
      reason: lastAiSkipReason
    };
  }

  const waitMs = Math.max(0, normalGapMs - elapsedMs);
  const mins = Math.max(1, Math.ceil(waitMs / 60_000));

  lastAiSkipReason =
    `economia do plano grátis: próxima chamada em ~${mins} min`;

  return {
    allowed: false,
    mode: 'BLOCKED',
    priorityEligible: false,
    reason: lastAiSkipReason
  };
}

function registerAICall(mode = 'NORMAL') {
  refreshAIBudgetDay();

  aiCallsToday += 1;
  aiLastCallAt = Date.now();
  lastAiCallMode = mode;

  if (
    mode === 'SCALP_STRONG' ||
    mode === 'SUPER_SCALP' ||
    mode === 'PRIORITY'
  ) {
    aiPriorityCallsToday += 1;
  }

  if (mode === 'RECHECK') {
    aiWaitRecheckCallsToday += 1;
  }

  lastAiSkipReason = '';
}

function aiWaitInfo(signal = null) {
  refreshAIBudgetDay();

  if (aiCallsToday >= cfg.aiDailyLimit) {
    return {
      blocked: true,
      minutes: null,
      mode: 'BLOCKED',
      priority: Boolean(signal && isPriorityAICandidate(signal)),
      text: `limite diário gratuito atingido (${aiCallsToday}/${cfg.aiDailyLimit})`
    };
  }

  if (!aiLastCallAt) {
    return {
      blocked: false,
      minutes: 0,
      mode: 'NORMAL',
      priority: Boolean(signal && isPriorityAICandidate(signal)),
      text: 'IA disponível agora'
    };
  }

  const elapsedMs = Date.now() - aiLastCallAt;
  const normalWaitMs =
    cfg.aiMinGapMin * 60_000 - elapsedMs;

  if (normalWaitMs <= 0) {
    return {
      blocked: false,
      minutes: 0,
      mode: 'NORMAL',
      priority: Boolean(signal && isPriorityAICandidate(signal)),
      text: 'IA disponível agora'
    };
  }

  const priorityClass =
    signal
      ? aiPriorityClass(signal)
      : 'NORMAL';

  const priority =
    priorityClass !== 'NORMAL' &&
    aiPriorityCallsToday < cfg.aiPriorityDailyLimit;

  if (priority) {
    const fastGapMin =
      priorityClass === 'SUPER_SCALP'
        ? cfg.aiSuperScalpGapMin
        : cfg.aiPriorityGapMin;

    const priorityWaitMs =
      fastGapMin * 60_000 - elapsedMs;

    const label =
      priorityClass === 'SUPER_SCALP'
        ? '🚀 SUPER SCALP'
        : '⚡ SCALP FORTE';

    if (priorityWaitMs <= 0) {
      return {
        blocked: false,
        minutes: 0,
        mode: priorityClass,
        priority: true,
        text: `${label}: IA disponível agora`
      };
    }

    const minutes = Math.max(
      1,
      Math.ceil(priorityWaitMs / 60_000)
    );

    return {
      blocked: true,
      minutes,
      mode: priorityClass,
      priority: true,
      text: `${label}: janela IA em ~${minutes} min`
    };
  }

  const minutes = Math.max(
    1,
    Math.ceil(normalWaitMs / 60_000)
  );

  return {
    blocked: true,
    minutes,
    mode: 'NORMAL',
    priority: false,
    text: `próxima chamada normal em ~${minutes} min`
  };
}

function setPendingAI(signal, reason = '') {
  const wait = aiWaitInfo(signal);

  pendingAiCandidate = {
    symbol: signal.symbol,
    dataSymbol: signal.dataSymbol,
    exchange: signal.exchange,
    side: signal.side,
    score: signal.score,
    entry: signal.entry,
    stop: signal.stop,
    tp1: signal.tp1,
    tp2: signal.tp2,
    tp3: signal.tp3,
    volumeRatio: adaptiveVolumeRatio(signal),
    oiPct: Number(signal.oiPct || 0),
    fundingRate: Number(signal.fundingRate || 0),
    quoteVolume: Number(signal.quoteVolume || 0),
    confirmation: signal.confirmation?.label || '',
    priorityEligible: isPriorityAICandidate(signal),
    waitMode: wait.mode,
    reason: reason || wait.text,
    lastAttemptError: null,
    lastAttemptAt: null,
    createdAt: Date.now()
  };
}

function clearPendingAI() {
  pendingAiCandidate = null;
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
  const s = state.signal;
  const ai = s.ai || null;

  resultHistory.unshift({
    symbol: s.symbol,
    side: s.side,
    outcome,
    openedAt: state.openedAt,
    closedAt: Date.now(),

    // V1.3.6: guarda contexto do sinal para medir qualidade depois.
    score: Number(s.score || 0),
    aiDecision: ai?.decision || '—',
    aiConfidence: Number(ai?.confidence ?? NaN),
    aiModel: ai?.model || '—',
    aiCached: Boolean(ai?.cached),
    aiStyle: ai?.style || '—',
    aiRisk: ai?.risk || '—',

    entry: Number(s.entry || 0),
    stop: Number(s.stop || 0),
    tp1: Number(s.tp1 || 0),
    tp2: Number(s.tp2 || 0),
    tp3: Number(s.tp3 || 0)
  });

  if (resultHistory.length > 50) {
    resultHistory.length = 50;
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


function hyperExecutionKey(signal) {
  return `${signal.symbol}:${signal.side}:${signal.t15?.openTime || 0}`;
}

function hyperExecutionHistoryText() {
  if (!hyperExecutionHistory.length) {
    return '🧪 Nenhuma execução Hyperliquid registrada desde o último deploy.';
  }

  const lines = [
    '🟣 <b>Hyperliquid Testnet — execuções</b>',
    ''
  ];

  for (const e of hyperExecutionHistory.slice(0, 10)) {
    const icon =
      e.mode === 'SIGNED_TESTNET'
        ? '🧾'
        : '🧪';

    lines.push(
      `${icon} <b>${e.coin || e.symbol} ${e.side}</b>\n` +
      `Modo: ${e.mode}\n` +
      `🤖 IA ${Math.round(e.aiConfidence || 0)}% · ⭐ Score ${e.score || 0}\n` +
      `📦 Notional ~${Number(e.notionalUsdc || 0).toFixed(2)} USDC\n` +
      `${e.quantity ? `Qty: ${e.quantity}\n` : ''}` +
      `${e.entryLimit ? `Entrada IOC: ${e.entryLimit}\n` : `Entrada ref.: ${e.entry ?? '—'}\n`}` +
      `${e.stop ? `STOP: ${e.stop}\n` : ''}` +
      `${e.tp ? `TP: ${e.tp}\n` : ''}` +
      `${e.resultSummary?.oid ? `OID: ${e.resultSummary.oid}` : ''}`
    );
  }

  return lines.join('\n\n');
}

async function maybeExecuteHyper(signal) {
  // V1.4.3: paper trading é o executor padrão.
  // Hyperliquid só participa se o usuário habilitar explicitamente no ENV.
  if (
    String(process.env.HYPERLIQUID_EXECUTION_ENABLED || 'false')
      .toLowerCase() !== 'true'
  ) {
    return null;
  }

  const key = hyperExecutionKey(signal);

  if (hyperExecutionPaused) {
    console.log(
      `[hyper] ${signal.symbol}: ignorado — executor pausado`
    );
    return null;
  }

  if (hyperExecutionKeys.has(key)) {
    console.log(
      `[hyper] ${signal.symbol}: execução já registrada neste candle`
    );
    return null;
  }

  const eligibility =
    hyperExecutionEligibility(signal);

  if (!eligibility.ok) {
    console.log(
      `[hyper] ${signal.symbol}: não executado — ${eligibility.reason}`
    );
    return null;
  }

  const cfgHyper =
    hyperConfig();

  try {
    // Se estiver explicitamente habilitado no ENV + armado via Telegram,
    // executa ordem REAL apenas na TESTNET.
    if (
      cfgHyper.signedTestnetEnabled &&
      hyperSignedArmed
    ) {
      const result =
        await placeSignalSignedTestnet(signal);

      const record = {
        ...result,
        mode: 'SIGNED_TESTNET',
        symbol: signal.symbol,
        aiConfidence:
          Number(signal.ai?.confidence || 0),
        score:
          Number(signal.score || 0)
      };

      hyperExecutionKeys.add(key);
      hyperExecutionHistory.unshift(record);

      if (hyperExecutionHistory.length > 50) {
        hyperExecutionHistory.length = 50;
      }

      console.log(
        `[hyper][SIGNED_TESTNET] ${record.coin} ${record.side} · ` +
        `notional ${record.notionalUsdc} USDC · qty ${record.quantity} · ` +
        `status ${record.resultSummary?.status || '—'}`
      );

      await notify(
        `🧾 <b>HYPERLIQUID TESTNET — ORDEM ASSINADA</b>\n` +
        `${record.side === 'LONG' ? '🟢' : '🔴'} ` +
        `<b>${record.coin}-PERP ${record.side}</b>\n` +
        `🤖 IA ${Math.round(record.aiConfidence)}% · ⭐ Score ${record.score}\n` +
        `📦 Notional: ${Number(record.notionalUsdc).toFixed(2)} USDC\n` +
        `⚙️ Alavancagem: ${record.leverage}x\n` +
        `📐 Qty: ${record.quantity}\n` +
        `💰 Entrada IOC: ${record.entryLimit}\n` +
        `🛑 STOP: ${record.stop} (${record.stopPct}%)\n` +
        `🎯 TP: ${record.tp} (${record.tpPct}%)\n` +
        `${record.resultSummary?.oid ? `🆔 OID: ${record.resultSummary.oid}\n` : ''}` +
        `✅ Resposta: ${record.resultSummary?.status || 'ok'}\n\n` +
        `<i>TESTNET — sem dinheiro real.</i>`
      );

      return record;
    }

    // Caso ainda não esteja armado, continua registrando DRY-RUN.
    const plan = {
      ...buildHyperDryRunPlan(signal),
      mode: 'TESTNET_DRY_RUN'
    };

    hyperExecutionKeys.add(key);
    hyperExecutionHistory.unshift(plan);

    if (hyperExecutionHistory.length > 50) {
      hyperExecutionHistory.length = 50;
    }

    console.log(
      `[hyper][TESTNET_DRY_RUN] ${plan.coin}-PERP ${plan.side} · ` +
      `notional ${plan.notionalUsdc} USDC`
    );

    await notify(
      `🧪 <b>HYPERLIQUID TESTNET — DRY-RUN</b>\n` +
      `${plan.side === 'LONG' ? '🟢' : '🔴'} ` +
      `<b>${plan.coin}-PERP ${plan.side}</b>\n` +
      `🤖 IA ${Math.round(plan.aiConfidence)}% · ⭐ Score ${plan.score}\n` +
      `📦 Notional simulado: ${Number(plan.notionalUsdc).toFixed(2)} USDC\n` +
      `💰 Entrada ref.: ${plan.entry}\n` +
      `🛑 STOP ref.: ${plan.stop}\n` +
      `🎯 TP1 ref.: ${plan.tp1}\n\n` +
      `<i>Assinatura testnet não está armada.</i>`
    );

    return plan;
  } catch (error) {
    console.error(
      `[hyper] falha em ${signal.symbol}:`,
      error
    );

    await notify(
      `⚠️ <b>Falha no executor Hyperliquid Testnet</b>\n` +
      `${signal.symbol} ${signal.side}\n` +
      `${String(error.message || error).slice(0, 700)}`
    );

    return null;
  }
}


function activeSignalsText() {
  if (!activeSignals.size) {
    return '📭 Nenhum sinal está em acompanhamento agora.';
  }

  const lines = ['📡 <b>Sinais em acompanhamento</b>', ''];

  for (const state of activeSignals.values()) {
    const s = state.signal;
    const ai = s.ai || null;
    const aiSource = ai
      ? (
          ai.cached
            ? `♻️ CACHE ${Number.isFinite(ai.cacheAgeMin) ? `${ai.cacheAgeMin.toFixed(0)}m` : ''}`.trim()
            : ai.rescueUsed
              ? '🛟 RESCUE OPENROUTER'
              : ai.callMode === 'RECHECK'
                ? '🔄 RECHECK INTELIGENTE'
                : ai.callMode === 'PRIORITY'
                  ? '⚡ NOVA ANÁLISE PRIORITÁRIA'
                  : '🧠 NOVA ANÁLISE NORMAL'
        )
      : '—';

    lines.push(
      `${s.side === 'LONG' ? '🟢' : '🔴'} <b>${s.symbol} ${s.side}</b> — ` +
      `${stageName(state.stage)}\n` +
      `⭐ Score ${s.score}/100\n` +
      (ai
        ? `🤖 IA ${ai.decision} ${Math.round(ai.confidence)}% · ${aiSource}\n`
        : '') +
      `Entrada ${fmt(s.entry)} | Stop ${fmt(s.stop, s.entry)} | ` +
      `TP3 ${fmt(s.tp3, s.entry)}`
    );
  }

  return lines.join('\n');
}

function resultClass(outcome) {
  if (outcome === 'TP3') return 'WIN';
  if (outcome === 'STOP') return 'LOSS';
  if (outcome.startsWith('STOP após')) return 'MIXED';
  return 'OTHER';
}

function confidenceBucket(confidence) {
  if (!Number.isFinite(confidence)) return null;
  if (confidence >= 85) return '85–100%';
  if (confidence >= 75) return '75–84%';
  return '65–74%';
}

function confidenceStatsText() {
  const stats = new Map();

  for (const r of resultHistory) {
    if (!Number.isFinite(r.aiConfidence)) continue;

    const bucket = confidenceBucket(r.aiConfidence);
    if (!bucket) continue;

    if (!stats.has(bucket)) {
      stats.set(bucket, {
        total: 0,
        win: 0,
        loss: 0,
        mixed: 0,
        other: 0
      });
    }

    const st = stats.get(bucket);
    st.total += 1;

    const cls = resultClass(r.outcome);
    if (cls === 'WIN') st.win += 1;
    else if (cls === 'LOSS') st.loss += 1;
    else if (cls === 'MIXED') st.mixed += 1;
    else st.other += 1;
  }

  if (!stats.size) {
    return '📐 Ainda não há amostra suficiente para comparar confiança da IA × resultado.';
  }

  const order = ['65–74%', '75–84%', '85–100%'];
  const lines = ['🧪 <b>Confiança IA × resultados</b>'];

  for (const bucket of order) {
    const st = stats.get(bucket);
    if (!st) continue;

    lines.push(
      `• ${bucket}: ${st.total} encerrado(s) · ` +
      `🏆 ${st.win} · 🛑 ${st.loss} · 🟡 ${st.mixed} · ⚪ ${st.other}`
    );
  }

  lines.push(
    '<i>TP3=🏆; STOP direto=🛑; STOP após alvo=🟡; ambíguo/reversão=⚪.</i>'
  );

  return lines.join('\n');
}

function resultsText() {
  if (!resultHistory.length) {
    return '📊 Ainda não há resultados encerrados nesta execução do bot.';
  }

  const lines = [
    '📊 <b>Últimos resultados</b>',
    '',
    confidenceStatsText(),
    ''
  ];

  for (const r of resultHistory.slice(0, 10)) {
    const icon = r.outcome === 'TP3'
      ? '🏆'
      : r.outcome.startsWith('STOP')
        ? '🛑'
        : r.outcome.startsWith('AMBÍGUO')
          ? '⚠️'
          : '🔄';

    const aiText = Number.isFinite(r.aiConfidence)
      ? ` · 🤖 ${Math.round(r.aiConfidence)}%`
      : '';

    const source = r.aiDecision !== '—'
      ? (r.aiCached ? '♻️' : '🧠')
      : '';

    lines.push(
      `${icon} <b>${r.symbol} ${r.side}</b> — ${r.outcome}\n` +
      `⭐ Score ${r.score}/100${aiText} ${source}`
    );
  }

  lines.push(
    '',
    '<i>Histórico reinicia quando o serviço reinicia ou recebe novo deploy. ' +
    'As estatísticas acima são descritivas e ficam mais úteis com uma amostra maior.</i>'
  );

  return lines.join('\n');
}


function aiEnabledNow() {
  return cfg.aiEnabled && aiConfigured();
}

function aiDecisionIcon(decision) {
  if (decision === 'APPROVE') return '✅';
  if (decision === 'WATCH') return '👀';
  if (decision === 'WAIT') return '⏳';
  return '🚫';
}

function rememberAI(signal, ai) {
  const item = {
    symbol: signal.symbol,
    side: signal.side,
    score: signal.score,
    tier: signal.candidateTier || 'STANDARD',
    decision: ai.decision,
    confidence: ai.confidence,
    reason: ai.reason,
    model: ai.model,
    provider: ai.provider || null,
    cached: Boolean(ai.cached),
    source: ai.cached ? 'CACHE' : 'NEW',
    callMode: ai.callMode || 'NORMAL',
    rescueUsed: Boolean(ai.rescueUsed),
    responseMode: ai.responseMode || null,
    at: Date.now()
  };

  // V1.3.6: não duplica no histórico uma decisão que veio do cache
  // se a mesma análise original já estiver registrada.
  if (item.cached) {
    const duplicate = aiHistory.find(r =>
      r.symbol === item.symbol &&
      r.side === item.side &&
      r.decision === item.decision &&
      Math.round(r.confidence) === Math.round(item.confidence) &&
      r.reason === item.reason &&
      r.model === item.model
    );

    if (duplicate) {
      lastAiEvent = {
        type: 'CACHE_HIT',
        ...item,
        message: `${item.symbol} ${item.side}: decisão reaproveitada do cache`
      };
      return;
    }
  }

  aiHistory.unshift(item);
  lastAiEvent = {
    type: item.cached ? 'CACHE_HIT' : 'NEW_ANALYSIS',
    ...item
  };

  if (aiHistory.length > 30) aiHistory.length = 30;
}

function aiHistoryText() {
  if (!aiEnabledNow()) {
    return '🤖 Analista IA está desativado ou sem OPENROUTER_API_KEY.';
  }

  const budget = aiBudgetStats();
  const lines = [];

  if (pendingAiCandidate) {
    lines.push(
      '⏳ <b>PENDENTE DE IA</b>',
      `${pendingAiCandidate.symbol} ${pendingAiCandidate.side}`,
      `⭐ Score: ${pendingAiCandidate.score}/100`,
      `📊 Volume: ${pendingAiCandidate.volumeRatio.toFixed(2)}x`,
      `📈 OI: ${pendingAiCandidate.oiPct >= 0 ? '+' : ''}${pendingAiCandidate.oiPct.toFixed(2)}%`,
      ...(pendingAiCandidate.priorityEligible
        ? ['⚡ PRIORIDADE IA ATIVA']
        : []),
      ...(pendingAiCandidate.lastAttemptError
        ? [`⚠️ Última tentativa: ${pendingAiCandidate.lastAttemptError}`]
        : []),
      `🤖 ${aiWaitInfo({
        score: pendingAiCandidate.score,
        oiPct: pendingAiCandidate.oiPct,
        candidateTier: 'STANDARD',
        t5: { volumeRatio: pendingAiCandidate.volumeRatio },
        t15: { volumeRatio: pendingAiCandidate.volumeRatio }
      }).text}`,
      '',
      '<i>Este candidato passou no filtro técnico, mas ainda NÃO é entrada.</i>'
    );
  }

  if (aiWaitWatchlist.size) {
    lines.push(
      ...(lines.length ? ['', '────────────'] : []),
      waitWatchlistText()
    );
  }

  if (!aiHistory.length) {
    const extra = lastAiEvent?.message
      ? `Último evento: ${lastAiEvent.message}`
      : 'Nenhuma decisão concluída desde o último deploy.';

    lines.push(
      ...(lines.length ? ['', '────────────'] : []),
      '🤖 <b>Histórico da IA</b>',
      extra,
      `🆓 Tentativas IA hoje: ${budget.used}/${budget.limit}`,
      `✅ Concluídas: ${budget.completed} · ⚠️ Falhas: ${budget.failed} · 🛟 Rescue: ${budget.rescueCalls}`
    );

    return lines.join('\n');
  }

  lines.push(
    ...(lines.length ? ['', '────────────'] : []),
    `🤖 <b>Histórico da IA desde o último deploy</b>`,
    `Modelo: <code>${aiModel()}</code>`,
    `🆓 Tentativas IA hoje: ${budget.used}/${budget.limit} (${budget.remaining} restantes)`,
    `✅ Análises concluídas: ${budget.completed} · ⚠️ Falhas: ${budget.failed}`,
    `🛟 Requests de rescue: ${budget.rescueCalls}`,
    `⚡ Scalp rápido hoje: ${budget.priorityUsed}/${budget.priorityLimit}`,
    `🚀 SUPER: score ${budget.superScalpScore}+ · vol ${budget.superScalpVolumeRatio.toFixed(2)}x+ · OI +${budget.superScalpOiPct.toFixed(2)}%+ · gap ${budget.superScalpGapMin} min`,
    `⚡ FORTE: score ${budget.priorityScore}+ · vol ${budget.priorityVolumeRatio.toFixed(2)}x+ · OI +${budget.priorityOiPct.toFixed(2)}%+ · gap ${budget.priorityGapMin} min`,
    `⏳ Normal: ${budget.minGapMin} min`,
    `♻️ Cache: normal ${budget.cacheMin}m · forte ${budget.priorityCacheMin}m · super ${budget.superScalpCacheMin}m`,
    ''
  );

  for (const r of aiHistory.slice(0, 10)) {
    const source = r.cached
      ? '♻️ <b>CACHE</b>'
      : r.rescueUsed
        ? '🛟 <b>RESCUE OPENROUTER</b>'
        : r.callMode === 'RECHECK'
          ? '🔄 <b>RECHECK INTELIGENTE DE WAIT</b>'
          : r.callMode === 'SUPER_SCALP'
            ? '🚀 <b>NOVA ANÁLISE SUPER SCALP</b>'
            : r.callMode === 'SCALP_STRONG' ||
              r.callMode === 'PRIORITY'
              ? '⚡ <b>NOVA ANÁLISE SCALP FORTE</b>'
              : '🧠 <b>NOVA ANÁLISE NORMAL</b>';

    lines.push(
      `${aiDecisionIcon(r.decision)} <b>${r.symbol} ${r.side}</b> — ` +
      `${r.tier === 'PRE_CANDIDATE' ? 'PRÉ · ' : ''}` +
      `${r.decision} ${Math.round(r.confidence)}%\n` +
      `${source}\n` +
      `${r.reason}`
    );
  }

  return lines.join('\n');
}


function formatMillions(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return `$${(Number(value) / 1e6).toFixed(1)}M`;
}

function pendingAIText(pending = pendingAiCandidate) {
  if (!pending) {
    return '✅ Nenhum sinal técnico está aguardando validação da IA.';
  }

  const pseudoSignal = {
    symbol: pending.symbol,
    side: pending.side,
    score: pending.score,
    oiPct: pending.oiPct,
    candidateTier: 'STANDARD',
    t5: { volumeRatio: pending.volumeRatio },
    t15: { volumeRatio: pending.volumeRatio }
  };

  const wait = aiWaitInfo(pseudoSignal);

  const oi = Number.isFinite(pending.oiPct)
    ? `${pending.oiPct >= 0 ? '+' : ''}${pending.oiPct.toFixed(2)}%`
    : '—';

  const vol = Number.isFinite(pending.volumeRatio)
    ? `${pending.volumeRatio.toFixed(2)}x`
    : '—';

  const price = Number(pending.entry);
  const entryText = Number.isFinite(price)
    ? fmt(price)
    : '—';

  return (
    `🟠 <b>SINAL TÉCNICO APROVADO</b>\n` +
    `🤖 <b>AGUARDANDO VALIDAÇÃO DA IA</b>\n\n` +
    `${pending.side === 'LONG' ? '🟢' : '🔴'} ` +
    `<b>${pending.symbol} ${pending.side}</b>\n` +
    `⭐ Score: <b>${pending.score}/100</b>\n` +
    `📊 Volume relativo: ${vol}\n` +
    `📈 OI: ${oi}\n` +
    `💵 Volume 24h: ${formatMillions(pending.quoteVolume)}\n` +
    `💰 Entrada técnica: ${entryText}\n` +
    (pending.priorityEligible
      ? `⚡ <b>PRIORIDADE IA ADAPTATIVA</b> — score/volume/OI fortes\n`
      : '') +
    (pending.lastAttemptError
      ? `⚠️ Última tentativa: ${pending.lastAttemptError}\n`
      : '') +
    `⏳ ${wait.text}\n\n` +
    `<i>Não é entrada ainda. O sinal só será liberado se passar pela camada IA.</i>`
  );
}

function debugCandidateText(r) {
  if (!r) return 'Nenhum candidato disponível.';

  const score = Number.isFinite(r.score) ? `${r.score}/100` : '—';
  const vol = Number.isFinite(r.volumeRatio) ? `${r.volumeRatio.toFixed(2)}x` : '—';
  const oi = Number.isFinite(r.oiPct)
    ? `${r.oiPct >= 0 ? '+' : ''}${r.oiPct.toFixed(2)}%`
    : '—';

  const reasons = Array.isArray(r.reasons) && r.reasons.length
    ? r.reasons
    : [r.reason || 'não informado'];

  const badge = r.nearApproved
    ? `🟡 <b>QUASE APROVADO — apenas 1 filtro faltou</b>\n`
    : '';

  return (
    `${badge}` +
    `<b>${r.symbol} ${r.side || ''}</b>\n` +
    `⭐ Score: ${score}\n` +
    `📊 Volume relativo: ${vol}\n` +
    `📈 OI: ${oi}\n` +
    `💵 Volume 24h: ${formatMillions(r.quoteVolume)}\n` +
    `❌ Motivos:\n` +
    reasons.map(x => `• ${x}`).join('\n')
  );
}

function lastScanDebugText() {
  if (!lastScanReport) {
    return '🧪 Ainda não existe diagnóstico. Rode /scan primeiro.';
  }

  const m = lastScanReport.math;
  const a = lastScanReport.ai;
  const rejected = m?.rejected || [];
  const best = rejected[0] || null;

  const lines = [
    '🧪 <b>Diagnóstico do último scan</b>',
    '',
    `📊 Mercados selecionados: ${m?.selectedMarkets ?? 0}`,
    `🔬 Mercados analisados: ${m?.analyzedMarkets ?? 0}`,
    `✅ Passaram filtro técnico: ${m?.mathApproved ?? 0}`,
    `🕯 Indicadores: somente candles fechados`,
    `🟡 Quase aprovados: ${m?.nearApproved?.length ?? 0}`,
    `👀 Pré-candidatos ${m?.preCandidateMinScore ?? cfg.preCandidateMinScore}–${cfg.minScore - 1}: ${m?.preCandidates?.length ?? 0}`,
    `🤖 Candidatos selecionados para IA: ${a?.selected ?? 0}`,
    `📡 Requests novos à IA: ${a?.apiCalls ?? 0}`,
    `🛟 Requests de rescue: ${a?.rescueCalls ?? 0}`,
    `✅ Análises concluídas: ${a?.completed ?? 0}`,
    `⚠️ Falhas/timeout/parser: ${a?.errors ?? 0}`,
    `⚡ Candidatos prioritários chamados: ${a?.priorityCalls ?? 0}`,
    `🔄 Rechecks inteligentes de WAIT: ${a?.waitRecheckCalls ?? 0}`,
    `♻️ Respostas vindas do cache: ${a?.cacheHits ?? 0}`,
    `⏸ Sem vaga nova neste scan: ${a?.freshDeferred ?? 0}`,
    `🎯 Sinais liberados: ${lastScanReport.finalSignals ?? 0}`
  ];

  if (
    (a?.watch || 0) > 0 ||
    (a?.wait || 0) > 0 ||
    (a?.rejected || 0) > 0 ||
    (a?.lowConfidence || 0) > 0
  ) {
    lines.push(
      `🤖 IA — APPROVE: ${a?.approved ?? 0} | WATCH: ${a?.watch ?? 0} | ` +
      `WAIT: ${a?.wait ?? 0} | REJECT: ${a?.rejected ?? 0} | ` +
      `confiança baixa: ${a?.lowConfidence ?? 0}`
    );
  }

  if (a?.skipReason) {
    lines.push(`⏳ IA não chamada: ${a.skipReason}`);
  }

  if (lastScanReport?.pendingAI) {
    lines.push(
      '',
      '🟠 <b>Sinal técnico aprovado — pendente de IA</b>',
      pendingAIText(lastScanReport.pendingAI)
    );
  }

  const bestNear = m?.nearApproved?.[0] || null;
  const bestPre = m?.preCandidates?.[0] || null;

  if (bestNear) {
    lines.push(
      '',
      '🟡 <b>Mais perto de liberar sinal</b>',
      debugCandidateText(bestNear)
    );
  }

  if (bestPre) {
    lines.push(
      '',
      '👀 <b>Melhor pré-candidato para observação</b>',
      debugCandidateText(bestPre)
    );
  }

  if (best) {
    lines.push('', '🥈 <b>Melhor candidato rejeitado</b>', debugCandidateText(best));
  }

  if (rejected.length > 1) {
    lines.push('', '📋 <b>Outros rejeitados</b>');
    for (const r of rejected.slice(1, 4)) {
      const score = Number.isFinite(r.score) ? r.score : '—';
      lines.push(`• ${r.symbol} — score ${score} — ${r.reason}`);
    }
  }

  lines.push(
    '',
    `⏱ Duração: ${(lastScanReport.durationMs / 1000).toFixed(1)}s`,
    '<i>Use este diagnóstico para ajustar filtros sem adivinhar.</i>'
  );

  return lines.join('\n');
}

function scanNoSignalText(report) {
  const m = report.math;
  const a = report.ai;
  const best = (m?.rejected || [])[0];

  const lines = [
    '🔎 <b>Scan concluído</b>',
    '',
    `📊 ${m?.selectedMarkets ?? 0} mercados selecionados`,
    `✅ ${m?.mathApproved ?? 0} passaram pelo filtro técnico`,
    `🕯 Volume/indicadores: candles fechados`,
    `🟡 ${m?.nearApproved?.length ?? 0} quase aprovado(s)`,
    `👀 ${m?.preCandidates?.length ?? 0} pré-candidato(s) ${m?.preCandidateMinScore ?? cfg.preCandidateMinScore}–${cfg.minScore - 1}`,
    `📡 ${a?.apiCalls ?? 0} request(s) novo(s) à IA`,
    ...(a?.rescueCalls
      ? [`🛟 ${a.rescueCalls} request(s) de rescue`]
      : []),
    `✅ ${a?.completed ?? 0} análise(s) concluída(s)`,
    ...(a?.errors
      ? [`⚠️ ${a.errors} falha(s) de IA`]
      : []),
    ...(a?.priorityCalls
      ? [`⚡ ${a.priorityCalls} chamada(s) prioritária(s)`]
      : []),
    ...(a?.waitRecheckCalls
      ? [`🔄 ${a.waitRecheckCalls} recheck(s) inteligente(s) de WAIT`]
      : []),
    `🎯 0 sinais liberados`
  ];

  if ((a?.selected || 0) > 0) {
    if ((a?.watch || 0) > 0) lines.push(`👀 IA colocou ${a.watch} candidato(s) em WATCH`);
    if ((a?.wait || 0) > 0) lines.push(`⏳ IA marcou WAIT em ${a.wait}`);
    if ((a?.rejected || 0) > 0) lines.push(`🚫 IA rejeitou ${a.rejected}`);
    if ((a?.lowConfidence || 0) > 0) {
      lines.push(`📉 ${a.lowConfidence} APPROVE abaixo da confiança mínima`);
    }
    if (a?.skipReason) lines.push(`🆓 IA economizada: ${a.skipReason}`);
  }

  if (report.pendingAI) {
    lines.push(
      '',
      pendingAIText(report.pendingAI)
    );

    lines.push('', 'Use /ia para acompanhar o candidato pendente.');
    return lines.join('\n');
  }

  const bestNear = m?.nearApproved?.[0] || null;

  if (bestNear) {
    lines.push(
      '',
      '🟡 <b>Mais perto de liberar sinal</b>',
      debugCandidateText(bestNear)
    );
  } else if (best) {
    lines.push('', '🥈 <b>Melhor rejeitado no filtro técnico</b>', debugCandidateText(best));
  }

  lines.push('', 'Use /debug para ver os demais motivos.');
  return lines.join('\n');
}

function countAiDecision(meta, ai) {
  if (ai.decision === 'WATCH') {
    meta.watch += 1;
  } else if (ai.decision === 'WAIT') {
    meta.wait += 1;
  } else if (ai.decision === 'REJECT') {
    meta.rejected += 1;
  } else if (ai.decision === 'APPROVE') {
    if (ai.confidence >= cfg.aiMinConfidence) meta.approved += 1;
    else meta.lowConfidence += 1;
  }
}

async function validateSignalsWithAI(signals) {
  const meta = {
    input: signals.length,
    selected: 0,
    apiCalls: 0,
    rescueCalls: 0,
    priorityCalls: 0,
    waitRecheckCalls: 0,
    priorityEligible: 0,
    cacheHits: 0,
    freshDeferred: 0,
    skipped: 0,
    approved: 0,
    watch: 0,
    wait: 0,
    rejected: 0,
    lowConfidence: 0,
    errors: 0,
    completed: 0,
    skipReason: ''
  };

  if (!cfg.aiEnabled) {
    const approved = signals.map(s => ({
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

    meta.selected = signals.length;
    meta.approved = approved.length;

    return {
      approved,
      meta,
      pending: null
    };
  }

  if (!aiConfigured()) {
    if (cfg.aiFailOpen) {
      console.log('[ai] OPENROUTER_API_KEY ausente; fail-open ativo');

      const approved = signals.map(s => ({
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

      meta.selected = signals.length;
      meta.approved = approved.length;

      return {
        approved,
        meta,
        pending: null
      };
    }

    console.log('[ai] OPENROUTER_API_KEY ausente; sinais bloqueados');

    meta.selected = signals.length;
    meta.skipped = signals.length;
    meta.skipReason = 'OPENROUTER_API_KEY ausente';

    const pendingSignal = signals.find(
      s => s.candidateTier === 'STANDARD'
    ) || null;

    return {
      approved: [],
      meta,
      pending: pendingSignal
        ? {
            signal: pendingSignal,
            reason: meta.skipReason
          }
        : null
    };
  }

  // V1.3.8:
  // Analisa toda a fila para aproveitar TODOS os caches válidos.
  // Porém só permite UMA chamada nova por scan.
  meta.selected = signals.length;

  const approved = [];
  let freshCallsUsed = 0;
  let pending = null;

  for (const s of signals) {
    const cached = getCachedAI(s);

    if (cached) {
      if (
        pendingAiCandidate &&
        pendingAiCandidate.symbol === s.symbol &&
        pendingAiCandidate.side === s.side
      ) {
        clearPendingAI();
      }

      meta.cacheHits += 1;

      console.log(
        `[ai] cache ${s.symbol}: ${cached.decision} ` +
        `${Math.round(cached.confidence)}% · ` +
        `${cached.cacheAgeMin.toFixed(1)}/${cached.cacheTtlMin} min`
      );

      rememberAI(s, cached);
      countAiDecision(meta, cached);

      if (
        s.candidateTier !== 'PRE_CANDIDATE' &&
        cached.decision === 'APPROVE' &&
        cached.confidence >= cfg.aiMinConfidence
      ) {
        approved.push({ ...s, ai: cached });
      }

      // Cache não consome a vaga da chamada nova.
      continue;
    }

    if (isPriorityAICandidate(s)) {
      meta.priorityEligible += 1;
    }

    // Já usamos a única chamada nova permitida neste scan.
    // Continuamos o loop apenas para aproveitar caches posteriores.
    if (freshCallsUsed >= cfg.aiMaxCandidates) {
      meta.freshDeferred += 1;
      continue;
    }

    const permission = aiCallPermission(s);

    if (!permission.allowed) {
      meta.skipped += 1;

      if (!meta.skipReason) {
        meta.skipReason =
          permission.reason ||
          lastAiSkipReason;
      }

      // Guardamos o melhor STANDARD sem cache como pendente.
      if (
        !pending &&
        s.candidateTier === 'STANDARD'
      ) {
        pending = {
          signal: s,
          reason:
            permission.reason ||
            lastAiSkipReason ||
            'Aguardando janela da IA'
        };
      }

      lastAiEvent = {
        type: 'SKIP',
        at: Date.now(),
        message:
          `${s.symbol}: ` +
          `${permission.reason || lastAiSkipReason}`
      };

      console.log(
        `[ai] ${s.symbol}: chamada pulada — ` +
        `${permission.reason || lastAiSkipReason}`
      );

      // Se a janela global bloqueou este candidato, não gastamos a vaga.
      // Um candidato posterior prioritário ainda pode ser elegível,
      // então seguimos percorrendo a fila.
      continue;
    }

    try {
      console.log(
        `[ai] avaliando ${s.symbol} ${s.side} ` +
        `com ${aiModel()} [${permission.mode}]` +
        (permission.mode === 'RECHECK'
          ? ` · ${s._aiWaitRecheck?.reason || 'recheck WAIT'}`
          : '')
      );

      registerAICall(permission.mode);
      freshCallsUsed += 1;
      meta.apiCalls += 1;

      if (
        permission.mode === 'SCALP_STRONG' ||
        permission.mode === 'SUPER_SCALP' ||
        permission.mode === 'PRIORITY'
      ) {
        meta.priorityCalls += 1;
      }

      if (permission.mode === 'RECHECK') {
        meta.waitRecheckCalls += 1;
      }

      // O primeiro request já foi contabilizado por registerAICall().
      // Rescue só é permitido se ainda houver pelo menos 1 vaga na cota diária.
      const allowRescue = aiCallsToday < cfg.aiDailyLimit;

      const aiRaw = await analyzeSignalWithAI(s, {
        allowRescue
      });

      const extraRequests = Math.max(
        0,
        Number(aiRaw.apiRequestCount || 1) - 1
      );

      if (extraRequests > 0) {
        aiCallsToday += extraRequests;
        aiRescueCallsToday += extraRequests;
        meta.apiCalls += extraRequests;
        meta.rescueCalls += extraRequests;
      }

      const ai = {
        ...aiRaw,
        callMode: permission.mode
      };

      saveCachedAI(s, ai);
      rememberAI(s, ai);
      registerWaitDecision(s, ai);
      countAiDecision(meta, ai);
      aiCompletedToday += 1;
      meta.completed += 1;

      if (
        pendingAiCandidate &&
        pendingAiCandidate.symbol === s.symbol &&
        pendingAiCandidate.side === s.side
      ) {
        clearPendingAI();
      }

      console.log(
        `[ai] ${s.symbol}: ${ai.decision} ` +
        `${Math.round(ai.confidence)}% — ${ai.reason}`
      );

      if (
        s.candidateTier !== 'PRE_CANDIDATE' &&
        ai.decision === 'APPROVE' &&
        ai.confidence >= cfg.aiMinConfidence
      ) {
        approved.push({ ...s, ai });
      }
    } catch (error) {
      freshCallsUsed += 1;
      meta.errors += 1;
      aiFailedToday += 1;

      const extraRequests = Math.max(
        0,
        Number(error?.apiRequestCount || 1) - 1
      );

      if (extraRequests > 0) {
        aiCallsToday += extraRequests;
        aiRescueCallsToday += extraRequests;
        meta.apiCalls += extraRequests;
        meta.rescueCalls += extraRequests;
      }

      const errMsg = String(error?.message || error || 'erro desconhecido')
        .replace(/\s+/g, ' ')
        .slice(0, 180);

      lastAiEvent = {
        type: 'ERROR',
        at: Date.now(),
        message: `${s.symbol}: ${errMsg}`.slice(0, 260)
      };

      // V1.3.8.1: falha NÃO remove o candidato técnico.
      // Mantemos como pendente para tentar novamente na próxima janela.
      if (s.candidateTier === 'STANDARD') {
        if (
          !pendingAiCandidate ||
          pendingAiCandidate.symbol !== s.symbol ||
          pendingAiCandidate.side !== s.side
        ) {
          setPendingAI(s, 'Falha na última tentativa da IA');
        }

        if (pendingAiCandidate) {
          pendingAiCandidate.lastAttemptError = errMsg;
          pendingAiCandidate.lastAttemptAt = Date.now();
        }

        if (!pending) {
          pending = {
            signal: s,
            reason: `Falha na IA: ${errMsg}`
          };
        }
      }

      console.error(`[ai] ${s.symbol}: ${errMsg}`);

      if (cfg.aiFailOpen) {
        const ai = {
          decision: 'APPROVE',
          confidence: 0,
          risk: 'MEDIUM',
          style: 'NORMAL',
          reason:
            `IA falhou; liberado pelo filtro matemático: ` +
            `${error.message}`.slice(0, 220),
          model: 'ERROR'
        };

        approved.push({ ...s, ai });
        meta.approved += 1;
      }
    }
  }

  return {
    approved,
    meta,
    pending
  };
}

async function doScan({
  forceReply = false,
  marketBases = null,
  automatic = false
} = {}) {
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
  const startedAt = Date.now();

  try {
    const selectedBases =
      Array.isArray(marketBases) && marketBases.length
        ? marketBases
        : nextAutomaticScanBatch();

    console.log(
      `[scan] iniciando ${new Date().toISOString()} · ` +
      `${automatic ? 'AUTO' : 'MANUAL'} · lote: ${selectedBases.join(', ')} / USDT`
    );

    const {
      signals: mathSignals,
      preCandidates,
      snapshots,
      debug
    } = await scanMarket({
      topMarkets: cfg.topMarkets,
      marketBases: selectedBases,
      minQuoteVolume: cfg.minVolume,
      minScore: cfg.minScore,
      preCandidateMinScore: cfg.preCandidateMinScore,
      minVolumeRatio: cfg.minVolumeRatio,
      minOiPct: cfg.minOiPct,
      hardMinVolumeRatio: cfg.hardMinVolumeRatio,
      oiRejectPct: cfg.oiRejectPct,
      exceptionScore: cfg.exceptionScore,
      exceptionVolumeRatio: cfg.exceptionVolumeRatio
    });

    // Atualiza primeiro as posições paper usando somente candle fechado.
    const paperUpdate =
      updatePaperTrading(snapshots);

    for (const event of paperUpdate.events || []) {
      await notify(event);
    }

    await updateTrackedSignals(snapshots);
    reconcileWaitWatchlist(snapshots);

    console.log(
      `[scan] ${mathSignals.length} sinais matemáticos >= ${cfg.minScore}; ` +
      `${preCandidates.length} pré-candidato(s) >= ${cfg.preCandidateMinScore}`
    );

    // V1.3.7.1:
    // Como o plano grátis avalia apenas 1 candidato por janela,
    // primeiro colocamos qualquer setup PRIORITÁRIO no topo.
    // Só depois vêm os candidatos normais, ordenados por score/volume/OI.
    let aiInput;

    if (mathSignals.length) {
      const standardSignals = mathSignals.map(s => ({
        ...s,
        candidateTier: 'STANDARD'
      }));

      standardSignals.sort((a, b) => {
        const aPriority = aiPriorityRank(a);
        const bPriority = aiPriorityRank(b);

        if (aPriority !== bPriority) {
          return bPriority - aPriority;
        }

        if (b.score !== a.score) {
          return b.score - a.score;
        }

        const bVol = Number(b.t15?.volumeRatio || 0);
        const aVol = Number(a.t15?.volumeRatio || 0);

        if (bVol !== aVol) {
          return bVol - aVol;
        }

        return Number(b.oiPct || 0) - Number(a.oiPct || 0);
      });

      aiInput = standardSignals;
    } else {
      aiInput = preCandidates.slice(0, 1).map(s => ({
        ...s,
        candidateTier: 'PRE_CANDIDATE'
      }));
    }

    if (aiInput.length) {
      const first = aiInput[0];
      const priorityClass =
        aiPriorityClass(first);

      const priorityLabel =
        priorityClass === 'SUPER_SCALP'
          ? '🚀 SUPER_SCALP'
          : priorityClass === 'SCALP_STRONG'
            ? '⚡ SCALP_FORTE'
            : 'NORMAL';

      console.log(
        `[ai] candidato escolhido: ${first.symbol} ${first.side} · ` +
        `score ${first.score} · vol ${adaptiveVolumeRatio(first).toFixed(2)}x · ` +
        `OI ${Number(first.oiPct || 0).toFixed(2)}% · ` +
        priorityLabel
      );
    }

    const aiResult = await validateSignalsWithAI(aiInput);
    const signals = aiResult.approved;

    // V1.3.8:
    // Um cache aprovado pode liberar um sinal e, ao mesmo tempo,
    // outro candidato sem cache pode ficar pendente.
    if (aiResult.pending?.signal) {
      const samePending =
        pendingAiCandidate &&
        pendingAiCandidate.symbol === aiResult.pending.signal.symbol &&
        pendingAiCandidate.side === aiResult.pending.signal.side;

      if (!samePending) {
        setPendingAI(
          aiResult.pending.signal,
          aiResult.pending.reason
        );
      } else if (!pendingAiCandidate.reason) {
        pendingAiCandidate.reason = aiResult.pending.reason;
      }
    } else if (
      !signals.some(sig =>
        pendingAiCandidate &&
        pendingAiCandidate.symbol === sig.symbol &&
        pendingAiCandidate.side === sig.side
      )
    ) {
      clearPendingAI();
    }

    console.log(
      `[scan] ${signals.length} sinais liberados após camada IA`
    );

    // Paper trading automático é independente do Telegram.
    // O próprio módulo aplica score/confiança/cooldown/máx posições.
    for (const signal of signals) {
      const paperOpen =
        maybeOpenPaperPosition(signal);

      if (paperOpen.opened) {
        console.log(
          `[paper] aberto ${signal.symbol} ${signal.side} · ` +
          `IA ${Math.round(signal.ai?.confidence || 0)}% · score ${signal.score}`
        );

        await notify(
          paperOpen.message
        );
      } else {
        console.log(
          `[paper] ${signal.symbol}: ${paperOpen.reason}`
        );
      }
    }

    lastScanReport = {
      at: Date.now(),
      automatic,
      marketBases: selectedBases,
      quoteAsset: 'USDT',
      durationMs: Date.now() - startedAt,
      math: debug,
      ai: aiResult.meta,
      finalSignals: signals.length,
      pendingAI: pendingAiCandidate
        ? { ...pendingAiCandidate }
        : null
    };

    if (activeChatId) {
      const fresh = forceReply
        ? signals.slice(0, 5)
        : signals.filter(canAlert).slice(0, 5);

      if (forceReply && fresh.length === 0) {
        await sendMessage(
          cfg.token,
          activeChatId,
          scanNoSignalText(lastScanReport)
        );
      }

      for (const s of fresh) {
        await sendMessage(cfg.token, activeChatId, signalText(s));
        markAlert(s);
        await trackSignal(s);
        await maybeExecuteHyper(s);
      }
    }

    return signals;
  } catch (error) {
    console.error('[scan]', error.message);

    lastScanReport = {
      at: Date.now(),
      automatic,
      marketBases:
        Array.isArray(marketBases)
          ? marketBases
          : lastScanBatch,
      quoteAsset: 'USDT',
      durationMs: Date.now() - startedAt,
      math: {
        selectedMarkets: 0,
        analyzedMarkets: 0,
        mathApproved: 0,
        rejected: []
      },
      ai: {
        selected: 0,
        apiCalls: 0,
        cacheHits: 0,
        waitRecheckCalls: 0,
        approved: 0,
        watch: 0,
        wait: 0,
        rejected: 0,
        lowConfidence: 0,
        errors: 1,
        skipReason: ''
      },
      finalSignals: 0,
      pendingAI: pendingAiCandidate
        ? { ...pendingAiCandidate }
        : null,
      error: error.message
    };

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
      '🤖 <b>Crypto Futures Scanner V1.5.4 FREE</b>\n\n' +
      'Comandos:\n' +
      '/scan — varrer o próximo lote agora\n' +
      '/scheduler — ver rotação automática de 1 minuto\n' +
      '/status — ver configuração\n' +
      '/top — mostrar os melhores sinais atuais\n' +
      '/ativos — sinais em acompanhamento\n' +
      '/resultados — últimos resultados acompanhados\n' +
      '/ia — últimas decisões do Analista IA\n' +
      '/debug — diagnóstico do último scan\n' +
      '/hyper — testar Hyperliquid Testnet\n' +
      '/hagent — verificar Agent/API Wallet\n' +
      '/harm — armar ordens assinadas TESTNET\n' +
      '/hdisarm — desarmar ordens assinadas\n' +
      '/htest BTC LONG — enviar teste assinado TESTNET\n' +
      '/hexec — status do executor Hyperliquid\n' +
      '/hexecs — histórico Hyperliquid\n' +
      '/paper — dashboard paper trading\n' +
      '/paperpos — posições paper abertas\n' +
      '/papertrades — últimos trades paper\n' +
      '/paperpause — pausar novas entradas paper\n' +
      '/paperresume — reativar paper trading\n' +
      '/paperreset CONFIRM — zerar histórico/banca virtual\n' +
      '/kill — pausar e desarmar executor Hyperliquid\n' +
      '/resume — reativar executor Hyperliquid (continua desarmado)'
    );
  } else if (text.startsWith('/scheduler')) {
    await sendMessage(
      cfg.token,
      activeChatId,
      scanSchedulerText()
    );
  } else if (text.startsWith('/status')) {
    await sendMessage(
      cfg.token,
      activeChatId,
      `✅ Online — V1.5.4 FREE\n` +
      `⏱ Scan: ${cfg.intervalMin} min\n` +
      `⏱ Scan automático: a cada ${cfg.intervalMin} min\n` +
      `🪙 Lote automático: ${cfg.scanBatchSize} moedas · pares /USDT\n` +
      `🔁 Universo: BTC/ETH/SOL prioritários + 21 moedas em rotação\n` +
      `⚡ Modo: SCALP 5m · alvo de duração 15min–3h\n` +
      `⭐ Score mínimo para sinal: ${cfg.minScore}\n` +
      `👀 Pré-candidato IA: ${cfg.preCandidateMinScore}–${cfg.minScore - 1}\n` +
      `💵 Volume mínimo 24h: $${Math.round(cfg.minVolume / 1e6)}M\n` +
      `📊 Volume para confirmar: ${cfg.minVolumeRatio.toFixed(2)}x\n` +
      `🚫 Piso absoluto de volume: ${cfg.hardMinVolumeRatio.toFixed(2)}x\n` +
      `📈 OI para confirmar: +${cfg.minOiPct.toFixed(2)}%\n` +
      `🛡 Bloqueio OI: abaixo de ${cfg.oiRejectPct.toFixed(2)}%\n` +
      `⚡ Exceção: score ${cfg.exceptionScore}+ e volume ${cfg.exceptionVolumeRatio.toFixed(2)}x+\n` +
      `🧊 Cooldown: ${cfg.cooldownMin} min\n` +
      `📡 Dados: Coinalyze\n` +
      `🕯 Candles: SOMENTE FECHADOS\n` +
      `🤖 IA: ${aiEnabledNow() ? 'ATIVA' : 'INATIVA'}\n` +
      `🧠 Modelo: ${aiEnabledNow() ? aiModel() : '—'}\n` +
      `✅ Confiança mínima IA: ${cfg.aiMinConfidence}%\n` +
      `🆓 IA grátis: ${aiBudgetStats().used}/${aiBudgetStats().limit} requests hoje\n` +
      `✅ IA concluídas: ${aiBudgetStats().completed} · ⚠️ falhas: ${aiBudgetStats().failed}\n` +
      `🧠 Modelo principal: ${aiModel()}\n` +
      `🛟 Rescue IA: ${aiRescueEnabled() ? 'ATIVO' : 'INATIVO'} · requests extras ${aiBudgetStats().rescueCalls}\n` +
      `🛟 Modelo rescue: ${aiRescueEnabled() ? aiRescueModel() : '—'}\n` +
      `🧰 Tool calling principal: ${aiToolCallingEnabled() ? 'ATIVO (roteamento flexível)' : 'INATIVO'}\n` +
      `🧠 Reasoning explícito: ${aiReasoningMode()}\n` +
      `🧯 Rescue: JSON object sem tool calling\n` +
      `📏 Saída máxima: ${aiPrimaryMaxTokens()} tokens · rescue ${aiRescueMaxTokens()}\n` +
      `⚡ IA adaptativa: ${cfg.aiPriorityEnabled ? 'ATIVA' : 'INATIVA'}\n` +
      `🚀 SUPER SCALP: score ${cfg.aiSuperScalpScore}+ · vol ${cfg.aiSuperScalpVolumeRatio.toFixed(2)}x+ · OI +${cfg.aiSuperScalpOiPct.toFixed(2)}%+ · gap ${cfg.aiSuperScalpGapMin} min\n` +
      `⚡ SCALP FORTE: score ${cfg.aiPriorityScore}+ · vol ${cfg.aiPriorityVolumeRatio.toFixed(2)}x+ · OI +${cfg.aiPriorityOiPct.toFixed(2)}%+ · gap ${cfg.aiPriorityGapMin} min\n` +
      `⚡ Chamadas rápidas hoje: ${aiBudgetStats().priorityUsed}/${aiBudgetStats().priorityLimit}\n` +
      `⏳ IA normal: 1 chamada nova / mínimo ${cfg.aiMinGapMin} min\n` +
      `♻️ Cache: normal ${cfg.aiCacheMin}m · forte ${cfg.aiPriorityCacheMin}m · super ${cfg.aiSuperScalpCacheMin}m\n` +
      `🔄 Recheck WAIT: ${cfg.aiWaitRecheckEnabled ? 'ATIVO' : 'INATIVO'} · novo candle + melhora · gap ${cfg.aiWaitRecheckGapMin} min\n` +
      `🧷 WAIT padrão: ${cfg.aiWaitRecheckMinConfidence}%+\n` +
      `🧷 WAIT condicional: ${cfg.aiWaitConditionalMinConfidence}–${cfg.aiWaitRecheckMinConfidence - 1}% se score ${cfg.aiWaitConditionalScore}+ · vol ${cfg.aiWaitConditionalVolumeRatio.toFixed(2)}x+ · OI +${cfg.aiWaitConditionalOiPct.toFixed(2)}%+\n` +
      `👀 WATCH ativo: ${cfg.aiWatchRecheckMinConfidence}%+\n` +
      `🔄 Rechecks hoje: ${aiBudgetStats().waitRecheckUsed}/${aiBudgetStats().waitRecheckLimit} · máx ${cfg.aiWaitRecheckMaxAttempts} por setup\n` +
      `⏳ WAIT/WATCH em observação: ${aiWaitWatchlist.size}\n` +
      `🟠 Pendente de IA: ${pendingAiCandidate ? `${pendingAiCandidate.symbol} ${pendingAiCandidate.side}` : 'nenhum'}\n` +
      `🎯 Acompanhando: ${activeSignals.size} sinal(is)\n` +
      `📚 Resultados registrados: ${resultHistory.length}\n` +
      `🟣 Hyperliquid: ${hyperConfig().enabled ? 'ATIVO' : 'INATIVO'} · TESTNET\n` +
      `🧾 Signed testnet ENV: ${hyperConfig().signedTestnetEnabled ? 'HABILITADO' : 'DESABILITADO'}\n` +
      `🛡 Runtime arm: ${hyperSignedArmed ? 'ARMADO' : 'DESARMADO'}\n` +
      `🔒 Mainnet: NÃO IMPLEMENTADA\n` +
      `⏸ Executor pausado: ${hyperExecutionPaused ? 'SIM' : 'NÃO'}\n` +
      `🧪 Paper trading: ${paperConfig().enabled ? 'ATIVO' : 'INATIVO'} · banca ${paperStateInfo().equity.toFixed(2)} USDC\n` +
      `📌 Paper posições: ${paperStateInfo().openPositions} · fechados ${paperStateInfo().closedTrades}`
    );
  } else if (text.startsWith('/ativos')) {
    await sendMessage(cfg.token, activeChatId, activeSignalsText());
  } else if (text.startsWith('/resultados')) {
    await sendMessage(cfg.token, activeChatId, resultsText());
  } else if (text.startsWith('/ia')) {
    await sendMessage(cfg.token, activeChatId, aiHistoryText());
  } else if (text.startsWith('/debug')) {
    await sendMessage(cfg.token, activeChatId, lastScanDebugText());
  } else if (text.startsWith('/paperreset')) {
    const parts = text.trim().split(/\s+/);

    if (String(parts[1] || '').toUpperCase() !== 'CONFIRM') {
      await sendMessage(
        cfg.token,
        activeChatId,
        '⚠️ Para zerar banca virtual, posições e histórico use exatamente:\n/paperreset CONFIRM'
      );
    } else {
      paperReset();

      await sendMessage(
        cfg.token,
        activeChatId,
        `♻️ Paper trading resetado.\nBanca virtual: ${paperConfig().startingBalance.toFixed(2)} USDC`
      );
    }
  } else if (text.startsWith('/paperpause')) {
    paperPause();

    await sendMessage(
      cfg.token,
      activeChatId,
      '⏸ Paper trading pausado para NOVAS entradas. Posições já abertas continuam sendo gerenciadas até STOP/TP.'
    );
  } else if (text.startsWith('/paperresume')) {
    paperResume();

    await sendMessage(
      cfg.token,
      activeChatId,
      '▶️ Paper trading reativado.'
    );
  } else if (text.startsWith('/papertrades')) {
    await sendMessage(
      cfg.token,
      activeChatId,
      paperTradesText()
    );
  } else if (text.startsWith('/paperpos')) {
    await sendMessage(
      cfg.token,
      activeChatId,
      paperPositionsText()
    );
  } else if (text.startsWith('/paper')) {
    await sendMessage(
      cfg.token,
      activeChatId,
      paperStatusText()
    );
  } else if (text.startsWith('/hyper')) {
    await sendMessage(
      cfg.token,
      activeChatId,
      '🟣 Testando conexão com Hyperliquid Testnet...'
    );

    const pub =
      await testHyperliquidConnectivity();

    const account =
      await testHyperliquidAccount();

    const sample = pub.sample
      ? `BTC ${pub.sample.BTC ?? '—'} · ETH ${pub.sample.ETH ?? '—'} · SOL ${pub.sample.SOL ?? '—'}`
      : '—';

    const accountLine = account.skipped
      ? `👛 Conta: ${account.message}`
      : account.ok
        ? `👛 Conta: ✅ OK · valor ${account.accountValue ?? '—'} USDC · ` +
          `withdrawable ${account.withdrawable ?? '—'} · posições ${account.positions}`
        : `👛 Conta: ❌ ${account.message}`;

    await sendMessage(
      cfg.token,
      activeChatId,
      `🟣 <b>Hyperliquid Testnet</b>\n\n` +
      `${pub.ok ? '✅' : '❌'} API pública: ${pub.message}\n` +
      `HTTP: ${pub.status ?? '—'} · latência ${pub.latencyMs ?? '—'}ms\n` +
      `Mercados com mid: ${pub.midsCount ?? 0}\n` +
      `Amostra: ${sample}\n\n` +
      `${accountLine}\n\n` +
      `🧾 Signed testnet ENV: ${hyperConfig().signedTestnetEnabled ? 'HABILITADO' : 'DESABILITADO'}\n` +
      `🛡 Runtime: ${hyperSignedArmed ? 'ARMADO' : 'DESARMADO'}`
    );
  } else if (text.startsWith('/hagent')) {
    const agent =
      await getHyperAgentStatus();

    let expiry = '—';

    if (agent.validUntil) {
      try {
        expiry =
          new Date(agent.validUntil).toISOString();
      } catch {
        expiry = String(agent.validUntil);
      }
    }

    await sendMessage(
      cfg.token,
      activeChatId,
      `🔑 <b>Hyperliquid Agent/API Wallet</b>\n\n` +
      `Agent key: ${agent.configured ? '✅ configurada' : '❌ não configurada'}\n` +
      `Agent address: <code>${agent.address || '—'}</code>\n` +
      `Master pública: ${agent.masterConfigured ? '✅ configurada' : '❌ não configurada'}\n` +
      `Aprovação testnet: ${agent.approved ? '✅ ATIVA' : '❌ NÃO ATIVA'}\n` +
      `Nome: ${agent.name || '—'}\n` +
      `Validade: ${expiry}\n\n` +
      `${agent.message}\n\n` +
      `<i>Nunca envie a private key pelo Telegram ou chat.</i>`
    );
  } else if (text.startsWith('/hdisarm')) {
    hyperSignedArmed = false;

    await sendMessage(
      cfg.token,
      activeChatId,
      '🟢 Executor Hyperliquid DESARMADO. O scanner continua ativo e novas execuções ficam em DRY-RUN.'
    );
  } else if (text.startsWith('/harm')) {
    const cfgHyper =
      hyperConfig();

    if (!cfgHyper.signedTestnetEnabled) {
      hyperSignedArmed = false;

      await sendMessage(
        cfg.token,
        activeChatId,
        '🔒 Não foi possível armar. Configure HYPERLIQUID_TESTNET_SIGNED_ENABLED=true no Environment do Render.'
      );
    } else {
      const agent =
        await getHyperAgentStatus();

      const account =
        await testHyperliquidAccount();

      if (!agent.approved) {
        hyperSignedArmed = false;

        await sendMessage(
          cfg.token,
          activeChatId,
          `❌ Agent não aprovada/ativa.\n` +
          `Agent address: <code>${agent.address || '—'}</code>\n` +
          `${agent.message}`
        );
      } else if (!account.ok) {
        hyperSignedArmed = false;

        await sendMessage(
          cfg.token,
          activeChatId,
          `❌ Conta testnet não está pronta: ${account.message}`
        );
      } else if (Number(account.accountValue || 0) <= 0) {
        hyperSignedArmed = false;

        await sendMessage(
          cfg.token,
          activeChatId,
          '❌ Conta Hyperliquid Testnet está sem saldo/equity. Deposite/obtenha fundos testnet antes de armar.'
        );
      } else {
        hyperExecutionPaused = false;
        hyperSignedArmed = true;

        await sendMessage(
          cfg.token,
          activeChatId,
          `🔴 <b>HYPERLIQUID TESTNET ARMADO</b>\n\n` +
          `Agent: <code>${agent.address}</code>\n` +
          `Equity testnet: ${account.accountValue} USDC\n` +
          `Máx posições: ${cfgHyper.maxOpenPositions}\n` +
          `Notional alvo: ~${Math.max(cfgHyper.marginUsdc * cfgHyper.leverage, cfgHyper.minNotionalUsdc).toFixed(2)} USDC\n\n` +
          `<b>Somente TESTNET.</b> Mainnet não existe nesta versão.\n` +
          `Use /hdisarm ou /kill para bloquear novas ordens.`
        );
      }
    }
  } else if (text.startsWith('/htest')) {
    const parts =
      text.trim().split(/\s+/);

    const coin =
      String(parts[1] || 'BTC').toUpperCase();

    const side =
      String(parts[2] || 'LONG').toUpperCase();

    if (!['LONG', 'SHORT'].includes(side)) {
      await sendMessage(
        cfg.token,
        activeChatId,
        'Uso: /htest BTC LONG  ou  /htest ETH SHORT'
      );
    } else if (!hyperSignedArmed) {
      await sendMessage(
        cfg.token,
        activeChatId,
        '🛡 Executor está DESARMADO. Primeiro use /harm.'
      );
    } else {
      await sendMessage(
        cfg.token,
        activeChatId,
        `🧾 Enviando ordem TESTNET assinada para ${coin}-PERP ${side}...`
      );

      try {
        const result =
          await placeManualSignedTestnet({
            coin,
            side
          });

        hyperExecutionHistory.unshift({
          ...result,
          mode: 'SIGNED_TESTNET_MANUAL',
          aiConfidence: 0,
          score: 0
        });

        if (hyperExecutionHistory.length > 50) {
          hyperExecutionHistory.length = 50;
        }

        await sendMessage(
          cfg.token,
          activeChatId,
          `✅ <b>ORDEM TESTNET ENVIADA</b>\n` +
          `${result.side === 'LONG' ? '🟢' : '🔴'} ${result.coin}-PERP ${result.side}\n` +
          `📦 Notional: ${Number(result.notionalUsdc).toFixed(2)} USDC\n` +
          `⚙️ ${result.leverage}x\n` +
          `📐 Qty: ${result.quantity}\n` +
          `💰 IOC: ${result.entryLimit}\n` +
          `🛑 STOP: ${result.stop}\n` +
          `🎯 TP: ${result.tp}\n` +
          `${result.resultSummary?.oid ? `🆔 OID: ${result.resultSummary.oid}\n` : ''}` +
          `Resposta: ${result.resultSummary?.status || 'ok'}\n\n` +
          `<i>TESTNET — sem dinheiro real.</i>`
        );
      } catch (error) {
        await sendMessage(
          cfg.token,
          activeChatId,
          `❌ Falha na ordem TESTNET:\n${String(error.message || error).slice(0, 1200)}`
        );
      }
    }
  } else if (text.startsWith('/hexecs')) {
    await sendMessage(
      cfg.token,
      activeChatId,
      hyperExecutionHistoryText()
    );
  } else if (text.startsWith('/hexec')) {
    await sendMessage(
      cfg.token,
      activeChatId,
      hyperStatusText({
        paused: hyperExecutionPaused,
        signedArmed: hyperSignedArmed,
        totalExecutions:
          hyperExecutionHistory.length
      })
    );
  } else if (text.startsWith('/kill')) {
    hyperExecutionPaused = true;
    hyperSignedArmed = false;

    await sendMessage(
      cfg.token,
      activeChatId,
      '⛔ Executor Hyperliquid pausado e DESARMADO. Scanner e IA continuam funcionando.'
    );
  } else if (text.startsWith('/resume')) {
    hyperExecutionPaused = false;
    hyperSignedArmed = false;

    await sendMessage(
      cfg.token,
      activeChatId,
      '✅ Executor reativado, mas continua DESARMADO. Use /harm apenas quando quiser habilitar ordens TESTNET assinadas.'
    );
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

      // Em rolling deploy o processo antigo pode continuar fazendo getUpdates
      // por alguns segundos. HTTP 409 aqui normalmente é conflito temporário
      // entre as duas instâncias, então fazemos backoff maior.
      const waitMs =
        String(e.message || '').includes('409')
          ? 30000
          : 3000;

      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}

http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    service: 'crypto-futures-scanner',
    version: '1.5.4-free',
    scanning,
    activeSignals: activeSignals.size,
    results: resultHistory.length,
    aiEnabled: aiEnabledNow(),
    aiModel: aiEnabledNow() ? aiModel() : null,
    aiHistory: aiHistory.length,
    aiAttemptedToday: aiCallsToday,
    aiCompletedToday,
    aiFailedToday,
    aiRescueCallsToday,
    aiRescueEnabled: aiRescueEnabled(),
    aiToolCalling: aiToolCallingEnabled(),
    aiReasoningMode: aiReasoningMode(),
    aiPrimaryMaxTokens: aiPrimaryMaxTokens(),
    aiRescueMaxTokens: aiRescueMaxTokens(),
    aiWaitRecheckEnabled: cfg.aiWaitRecheckEnabled,
    aiWaitRecheckToday: aiWaitRecheckCallsToday,
    aiWaitWatching: aiWaitWatchlist.size,
    aiWaitStandardMinConfidence: cfg.aiWaitRecheckMinConfidence,
    aiWaitConditionalMinConfidence: cfg.aiWaitConditionalMinConfidence,
    aiWaitConditionalScore: cfg.aiWaitConditionalScore,
    aiWaitConditionalVolumeRatio: cfg.aiWaitConditionalVolumeRatio,
    aiWaitConditionalOiPct: cfg.aiWaitConditionalOiPct,
    aiWatchRecheckMinConfidence: cfg.aiWatchRecheckMinConfidence,
    hyperliquidEnabled: hyperConfig().enabled,
    hyperliquidMode: hyperConfig().mode,
    hyperliquidPaused: hyperExecutionPaused,
    hyperliquidSignedEnvEnabled: hyperConfig().signedTestnetEnabled,
    hyperliquidSignedArmed: hyperSignedArmed,
    hyperliquidExecutions: hyperExecutionHistory.length,
    hyperliquidMainnetUnlocked: false,
    paperTrading: paperStateInfo(),
    pendingAI: pendingAiCandidate
      ? `${pendingAiCandidate.symbol}:${pendingAiCandidate.side}`
      : null,
    lastScanAt: lastScanReport?.at ? new Date(lastScanReport.at).toISOString() : null,
    lastScanFinalSignals: lastScanReport?.finalSignals ?? null,
    time: new Date().toISOString()
  }));
}).listen(cfg.port, () => console.log(`HTTP :${cfg.port}`));

console.log('Crypto Futures Scanner V1.5.4 FREE pronto ✅');

// Em rolling deploy o processo antigo do Render pode permanecer vivo por
// alguns segundos. Um pequeno atraso evita duas instâncias consumindo a
// cota da Coinalyze ao mesmo tempo logo após o deploy.
const startupScanDelaySec = Math.max(
  5,
  Number(process.env.SCAN_START_DELAY_SECONDS || 30)
);

console.log(
  `[startup] primeiro scan automático em ${startupScanDelaySec}s`
);

setTimeout(
  () =>
    doScan({ automatic: true })
      .catch(console.error),
  startupScanDelaySec * 1000
);

setInterval(
  () =>
    doScan({ automatic: true })
      .catch(console.error),
  cfg.intervalMin * 60_000
);
pollingLoop();
