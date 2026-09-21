const TESTNET_API = 'https://api.hyperliquid-testnet.xyz';

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

export function hyperConfig() {
  return {
    enabled: boolEnv('HYPERLIQUID_EXECUTION_ENABLED', true),
    mode: 'TESTNET_DRY_RUN',
    apiUrl:
      process.env.HYPERLIQUID_TESTNET_API || TESTNET_API,

    marginUsdc: numEnv(
      'HYPERLIQUID_MARGIN_USDC',
      5,
      1,
      100000
    ),
    leverage: Math.trunc(
      numEnv('HYPERLIQUID_LEVERAGE', 2, 1, 50)
    ),
    minAiConfidence: numEnv(
      'HYPERLIQUID_AUTO_MIN_AI_CONFIDENCE',
      70,
      0,
      100
    ),
    minScore: numEnv(
      'HYPERLIQUID_AUTO_MIN_SCORE',
      75,
      0,
      100
    ),
    maxOpenPositions: Math.trunc(
      numEnv('HYPERLIQUID_MAX_OPEN_POSITIONS', 1, 1, 10)
    ),

    // Endereço público da conta principal Hyperliquid.
    // Não é a chave privada.
    walletAddress:
      process.env.HYPERLIQUID_WALLET_ADDRESS || ''
  };
}

export function hyperExecutionEligibility(signal) {
  const cfg = hyperConfig();

  if (!cfg.enabled) {
    return {
      ok: false,
      reason: 'executor Hyperliquid desativado'
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

  return {
    ok: true,
    reason: 'aprovado para TESTNET_DRY_RUN'
  };
}

function digitsForQty(price) {
  if (price >= 50000) return 5;
  if (price >= 10000) return 4;
  if (price >= 1000) return 4;
  if (price >= 100) return 3;
  if (price >= 1) return 2;
  return 1;
}

function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function buildHyperPlan(signal) {
  const cfg = hyperConfig();
  const entry = finite(signal.entry, 0);
  const notional = cfg.marginUsdc * cfg.leverage;
  const rawQty = entry > 0 ? notional / entry : 0;
  const qty = Number(
    rawQty.toFixed(digitsForQty(entry))
  );

  return {
    id:
      `hyper_dry_${Date.now()}_${String(signal.symbol)
        .replace(/USDT$/i, '')
        .replace(/[^A-Z0-9]/gi, '')}`,
    mode: 'TESTNET_DRY_RUN',
    venue: 'Hyperliquid Testnet',
    coin: String(signal.symbol).replace(/USDT$/i, ''),
    symbol: signal.symbol,
    side: signal.side,
    quantity: qty,
    entry: finite(signal.entry),
    stop: finite(signal.stop),
    tp1: finite(signal.tp1),
    tp2: finite(signal.tp2),
    tp3: finite(signal.tp3),
    marginUsdc: cfg.marginUsdc,
    leverage: cfg.leverage,
    notionalUsdc: Number(notional.toFixed(2)),
    aiConfidence: Number(signal.ai?.confidence || 0),
    score: Number(signal.score || 0),
    createdAt: Date.now()
  };
}

async function postInfo(body, timeoutMs = 10000) {
  const cfg = hyperConfig();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  const started = Date.now();

  try {
    const res = await fetch(
      `${cfg.apiUrl.replace(/\/$/, '')}/info`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
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
      data,
      raw: text
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      data: null,
      raw: '',
      error:
        error?.name === 'AbortError'
          ? 'timeout'
          : error.message
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function testHyperliquidConnectivity() {
  const mids = await postInfo({
    type: 'allMids'
  });

  if (!mids.ok) {
    return {
      ok: false,
      status: mids.status,
      latencyMs: mids.latencyMs,
      message:
        mids.error === 'timeout'
          ? 'Timeout ao conectar no Hyperliquid Testnet'
          : `Hyperliquid Testnet respondeu ` +
            `${mids.status ?? 'sem HTTP'}: ` +
            `${String(mids.raw || mids.error || '').slice(0, 220)}`,
      midsCount: 0,
      sample: null
    };
  }

  const keys =
    mids.data && typeof mids.data === 'object'
      ? Object.keys(mids.data)
      : [];

  return {
    ok: true,
    status: mids.status,
    latencyMs: mids.latencyMs,
    message: 'Conexão pública Hyperliquid Testnet OK',
    midsCount: keys.length,
    sample: {
      BTC: mids.data?.BTC ?? null,
      ETH: mids.data?.ETH ?? null,
      SOL: mids.data?.SOL ?? null
    }
  };
}

export async function testHyperliquidAccount() {
  const cfg = hyperConfig();

  if (!cfg.walletAddress) {
    return {
      ok: false,
      skipped: true,
      message:
        'HYPERLIQUID_WALLET_ADDRESS ainda não configurado'
    };
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(cfg.walletAddress)) {
    return {
      ok: false,
      skipped: false,
      message:
        'HYPERLIQUID_WALLET_ADDRESS inválido'
    };
  }

  const state = await postInfo({
    type: 'clearinghouseState',
    user: cfg.walletAddress
  });

  if (!state.ok) {
    return {
      ok: false,
      skipped: false,
      status: state.status,
      message:
        `Falha ao consultar conta: ` +
        `${String(state.raw || state.error || '').slice(0, 220)}`
    };
  }

  const marginSummary =
    state.data?.marginSummary || {};

  return {
    ok: true,
    skipped: false,
    status: state.status,
    accountValue:
      marginSummary.accountValue ?? null,
    totalMarginUsed:
      marginSummary.totalMarginUsed ?? null,
    withdrawable:
      state.data?.withdrawable ?? null,
    positions:
      Array.isArray(state.data?.assetPositions)
        ? state.data.assetPositions.length
        : 0,
    message:
      'Conta Hyperliquid Testnet consultada com sucesso'
  };
}

export function hyperStatusText({
  paused = false,
  openDryRuns = 0,
  totalDryRuns = 0
} = {}) {
  const cfg = hyperConfig();

  return [
    '🟣 <b>Hyperliquid Testnet Executor</b>',
    '',
    `Modo: <b>${cfg.mode}</b>`,
    `Executor: ${cfg.enabled ? '✅ ATIVO' : '⛔ DESATIVADO'}`,
    `Pausa manual: ${paused ? '⛔ SIM' : '✅ NÃO'}`,
    `Ordens reais: 🔒 BLOQUEADAS nesta versão`,
    `Ordens testnet assinadas: 🔒 ainda não enviadas nesta versão`,
    '',
    `💵 Margem simulada: ${cfg.marginUsdc.toFixed(2)} USDC`,
    `⚙️ Alavancagem simulada: ${cfg.leverage}x`,
    `📦 Notional aproximado: ${(cfg.marginUsdc * cfg.leverage).toFixed(2)} USDC`,
    `🤖 Confiança IA mínima: ${cfg.minAiConfidence}%`,
    `⭐ Score mínimo: ${cfg.minScore}`,
    `📌 Máx. posições simuladas: ${cfg.maxOpenPositions}`,
    '',
    `🧪 DRY-RUNs ativos: ${openDryRuns}`,
    `📚 DRY-RUNs registrados: ${totalDryRuns}`,
    '',
    `👛 Wallet pública: ${cfg.walletAddress ? 'configurada' : 'não configurada'}`
  ].join('\n');
}
