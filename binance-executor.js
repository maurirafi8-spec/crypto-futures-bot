import crypto from 'node:crypto';

const DEFAULT_BASE_URL = 'https://fapi.binance.com';

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
}

function numEnv(name, fallback, min = -Infinity, max = Infinity) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function executionConfig() {
  const mode = String(
    process.env.BINANCE_EXECUTION_MODE || 'DRY_RUN'
  ).toUpperCase();

  return {
    enabled: boolEnv('BINANCE_EXECUTION_ENABLED', true),
    mode,
    baseUrl:
      process.env.BINANCE_FUTURES_BASE_URL || DEFAULT_BASE_URL,

    // Margem usada POR OPERAÇÃO. Ex.: 5 USDT com 2x = notional ~10 USDT.
    marginUsdt: numEnv('BINANCE_MARGIN_USDT', 5, 1, 100000),
    leverage: Math.trunc(
      numEnv('BINANCE_LEVERAGE', 2, 1, 125)
    ),

    // Trava adicional para execução automática.
    minAiConfidence: numEnv(
      'BINANCE_AUTO_MIN_AI_CONFIDENCE',
      70,
      0,
      100
    ),
    minScore: numEnv(
      'BINANCE_AUTO_MIN_SCORE',
      75,
      0,
      100
    ),

    maxOpenPositions: Math.trunc(
      numEnv('BINANCE_MAX_OPEN_POSITIONS', 1, 1, 10)
    ),

    apiKey: process.env.BINANCE_API_KEY || '',
    apiSecret: process.env.BINANCE_API_SECRET || ''
  };
}

export function executionMode() {
  return executionConfig().mode;
}

export function isDryRun() {
  return executionConfig().mode === 'DRY_RUN';
}

export function liveTradingUnlocked() {
  // V1.4.0 propositalmente NÃO envia ordens reais.
  // Mesmo se alguém definir LIVE por engano, esta versão bloqueia.
  return false;
}

function fmt(n, digits = 8) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Number(x.toFixed(digits));
}

function qtyDigits(price) {
  if (price >= 10000) return 5;
  if (price >= 1000) return 4;
  if (price >= 10) return 3;
  if (price >= 1) return 2;
  return 1;
}

export function buildExecutionPlan(signal) {
  const cfg = executionConfig();
  const entry = Number(signal.entry);
  const notionalUsdt = cfg.marginUsdt * cfg.leverage;
  const rawQty = notionalUsdt / entry;
  const quantity = Number(rawQty.toFixed(qtyDigits(entry)));

  return {
    id:
      `dry_${Date.now()}_${String(signal.symbol).replace(/[^A-Z0-9]/gi, '')}`,
    mode: cfg.mode,
    symbol: signal.symbol,
    side: signal.side,
    orderSide: signal.side === 'LONG' ? 'BUY' : 'SELL',
    quantity,
    entry: fmt(signal.entry),
    stop: fmt(signal.stop),
    tp1: fmt(signal.tp1),
    tp2: fmt(signal.tp2),
    tp3: fmt(signal.tp3),
    marginUsdt: cfg.marginUsdt,
    leverage: cfg.leverage,
    notionalUsdt: fmt(notionalUsdt, 2),
    aiDecision: signal.ai?.decision || null,
    aiConfidence: Number(signal.ai?.confidence || 0),
    score: Number(signal.score || 0),
    createdAt: Date.now()
  };
}

export function executionEligibility(signal) {
  const cfg = executionConfig();

  if (!cfg.enabled) {
    return { ok: false, reason: 'executor Binance desativado' };
  }

  if (cfg.mode !== 'DRY_RUN') {
    return {
      ok: false,
      reason:
        `modo ${cfg.mode} bloqueado nesta versão; somente DRY_RUN é permitido`
    };
  }

  if (signal?.ai?.decision !== 'APPROVE') {
    return {
      ok: false,
      reason: `IA ${signal?.ai?.decision || 'sem decisão'}`
    };
  }

  if (
    Number(signal?.ai?.confidence || 0) <
    cfg.minAiConfidence
  ) {
    return {
      ok: false,
      reason:
        `confiança IA ${Math.round(signal?.ai?.confidence || 0)}% < ` +
        `${cfg.minAiConfidence}%`
    };
  }

  if (Number(signal?.score || 0) < cfg.minScore) {
    return {
      ok: false,
      reason:
        `score ${Number(signal?.score || 0)} < ${cfg.minScore}`
    };
  }

  return { ok: true, reason: 'aprovado para DRY_RUN' };
}

export async function testBinancePublicConnectivity({
  timeoutMs = 10000
} = {}) {
  const cfg = executionConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const started = Date.now();

  try {
    const res = await fetch(
      `${cfg.baseUrl.replace(/\/$/, '')}/fapi/v1/time`,
      {
        method: 'GET',
        signal: controller.signal
      }
    );

    const text = await res.text();

    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    return {
      ok: res.ok,
      status: res.status,
      latencyMs: Date.now() - started,
      serverTime: data?.serverTime || null,
      message: res.ok
        ? 'Conexão pública Binance Futures OK'
        : `Binance respondeu HTTP ${res.status}: ${text.slice(0, 180)}`
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      serverTime: null,
      message:
        error?.name === 'AbortError'
          ? 'Timeout ao conectar na Binance Futures'
          : `Falha de conexão: ${error.message}`
    };
  } finally {
    clearTimeout(timer);
  }
}

function signQuery(params, secret) {
  const qs = new URLSearchParams(params).toString();
  const signature = crypto
    .createHmac('sha256', secret)
    .update(qs)
    .digest('hex');

  return `${qs}&signature=${signature}`;
}

export async function testBinanceAuth({
  timeoutMs = 10000
} = {}) {
  const cfg = executionConfig();

  if (!cfg.apiKey || !cfg.apiSecret) {
    return {
      ok: false,
      skipped: true,
      status: null,
      message:
        'BINANCE_API_KEY/BINANCE_API_SECRET ainda não configuradas'
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const query = signQuery(
      {
        timestamp: Date.now(),
        recvWindow: 5000
      },
      cfg.apiSecret
    );

    const res = await fetch(
      `${cfg.baseUrl.replace(/\/$/, '')}/fapi/v3/account?${query}`,
      {
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': cfg.apiKey
        },
        signal: controller.signal
      }
    );

    const text = await res.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    const usdt = Array.isArray(data?.assets)
      ? data.assets.find(a => a.asset === 'USDT')
      : null;

    return {
      ok: res.ok,
      skipped: false,
      status: res.status,
      latencyMs: Date.now() - started,
      canTrade: Boolean(data?.canTrade),
      availableBalance:
        usdt?.availableBalance ?? data?.availableBalance ?? null,
      message: res.ok
        ? 'Autenticação Binance Futures OK'
        : `Binance auth HTTP ${res.status}: ${text.slice(0, 180)}`
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      status: null,
      latencyMs: Date.now() - started,
      message:
        error?.name === 'AbortError'
          ? 'Timeout na autenticação Binance Futures'
          : `Falha de autenticação: ${error.message}`
    };
  } finally {
    clearTimeout(timer);
  }
}

export function executionStatusText({
  paused = false,
  openDryRuns = 0,
  totalDryRuns = 0
} = {}) {
  const cfg = executionConfig();

  return [
    '🏦 <b>Binance Futures Executor</b>',
    '',
    `Modo: <b>${cfg.mode}</b>`,
    `Executor: ${cfg.enabled ? '✅ ATIVO' : '⛔ DESATIVADO'}`,
    `Pausa manual: ${paused ? '⛔ SIM' : '✅ NÃO'}`,
    `Ordens reais: 🔒 BLOQUEADAS na V1.4.0`,
    '',
    `💵 Margem por operação: ${cfg.marginUsdt.toFixed(2)} USDT`,
    `⚙️ Alavancagem simulada: ${cfg.leverage}x`,
    `📦 Notional aproximado: ${(cfg.marginUsdt * cfg.leverage).toFixed(2)} USDT`,
    `🤖 Confiança IA mínima para executar: ${cfg.minAiConfidence}%`,
    `⭐ Score mínimo para executar: ${cfg.minScore}`,
    `📌 Máx. posições configurado: ${cfg.maxOpenPositions}`,
    '',
    `🧪 DRY-RUNs ativos: ${openDryRuns}`,
    `📚 DRY-RUNs registrados: ${totalDryRuns}`,
    '',
    `🔑 API key: ${cfg.apiKey ? 'configurada' : 'não configurada'}`,
    `🔐 API secret: ${cfg.apiSecret ? 'configurado' : 'não configurado'}`
  ].join('\n');
}
