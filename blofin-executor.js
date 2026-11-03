// ==============================================================
// BLOFIN EXECUTOR V1.1 — CRYPTO & TOKENIZED STOCKS (EQUITIES)
// Suporte nativo a Modo Demo (Sandbox) e Conta Real na BloFin
// Suporta: Criptomoedas (BTC, ETH, SOL, SUI, etc.) e Ações (TSLA, NVDA, AAPL, etc.)
// ==============================================================

import crypto from 'node:crypto';

const LIVE_API_URL = 'https://openapi.blofin.com';
const DEMO_API_URL = 'https://demo-trading-openapi.blofin.com';

export const POPULAR_EQUITY_BASES = [
  'TSLA',
  'NVDA',
  'AAPL',
  'MSFT',
  'AMZN',
  'META',
  'COIN',
  'AMD',
  'MSTR'
];

const EQUITY_SET = new Set(POPULAR_EQUITY_BASES);

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

export function isEquitySymbol(symbol = '') {
  const base = String(symbol || '')
    .toUpperCase()
    .replace(/[-_/]/g, '')
    .replace(/USDT.*$/, '')
    .replace(/PERP.*$/, '')
    .trim();
  return EQUITY_SET.has(base);
}

export function formatBlofinInstId(symbol = '') {
  const s = String(symbol || '').toUpperCase().trim();
  if (s.includes('-USDT')) return s;
  const base = s
    .replace(/[-_/]/g, '')
    .replace(/USDT.*$/, '')
    .replace(/PERP.*$/, '')
    .trim();
  return `${base}-USDT`;
}

export function blofinConfig() {
  const isDemo = boolEnv('BLOFIN_DEMO', true);
  // Limpa aspas e espaços acidentais ao copiar/colar no Render
  const clean = v => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
  const apiKey = clean(process.env.BLOFIN_API_KEY);
  const secretKey = clean(process.env.BLOFIN_SECRET_KEY);
  const passphrase = clean(process.env.BLOFIN_PASSPHRASE);

  const hasCredentials = Boolean(apiKey && secretKey && passphrase);

  return {
    enabled: boolEnv('BLOFIN_EXECUTION_ENABLED', true),
    isDemo,
    mode: isDemo ? 'DEMO' : 'LIVE',
    apiUrl: isDemo ? DEMO_API_URL : LIVE_API_URL,
    apiKey,
    secretKey,
    passphrase,
    hasCredentials,
    leverage: Math.trunc(numEnv('BLOFIN_LEVERAGE', 5, 1, 50)),
    marginUsdt: numEnv('BLOFIN_MARGIN_USDT', 12, 1, 10000),
    marginMode: String(process.env.BLOFIN_MARGIN_MODE || 'cross').toLowerCase(),
    maxOpenPositions: Math.trunc(numEnv('BLOFIN_MAX_OPEN_POSITIONS', 4, 1, 20)),
    stocksEnabled: boolEnv('BLOFIN_STOCKS_ENABLED', true),
    minAiConfidence: numEnv('BLOFIN_MIN_AI_CONFIDENCE', 75, 0, 100),
    minScore: numEnv('BLOFIN_MIN_SCORE', 80, 0, 100),
    timeoutMs: Math.trunc(numEnv('BLOFIN_TIMEOUT_MS', 15000, 3000, 60000))
  };
}

/**
 * Assina uma requisição HTTP para a API Blofin usando HMAC-SHA256 Base64 Canônico
 * Formato canônico BloFin: requestPath + method.toUpperCase() + timestamp + nonce + body
 * Assinatura: HMAC-SHA256 binário codificado diretamente em Base64 (44 caracteres)
 */
export function getBlofinHeaders(method, requestPath, bodyObj, apiKey, secretKey, passphrase) {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomUUID();

  let bodyString = '';
  if (bodyObj && (method === 'POST' || method === 'PUT')) {
    bodyString = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  }

  const prehash = `${requestPath}${method.toUpperCase()}${timestamp}${nonce}${bodyString}`;

  // HMAC-SHA256 binário codificado direto em base64 (especificação oficial BloFin / CCXT)
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(prehash)
    .digest('base64');

  return {
    'ACCESS-KEY': apiKey,
    'ACCESS-SIGN': signature,
    'ACCESS-TIMESTAMP': timestamp,
    'ACCESS-NONCE': nonce,
    'ACCESS-PASSPHRASE': passphrase,
    'Content-Type': 'application/json'
  };
}

/**
 * Faz requisição HTTP à API Blofin com timeout e parsing seguro
 */
export async function blofinRequest(method, pathWithQuery, body = null, customConfig = null) {
  const cfg = customConfig || blofinConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  const startedAt = Date.now();

  try {
    const headers = getBlofinHeaders(
      method,
      pathWithQuery,
      body,
      cfg.apiKey,
      cfg.secretKey,
      cfg.passphrase
    );

    const fullUrl = `${cfg.apiUrl.replace(/\/$/, '')}${pathWithQuery}`;

    const res = await fetch(fullUrl, {
      method: method.toUpperCase(),
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    const isSuccess = res.ok && json && (json.code === '0' || json.code === 0);

    return {
      ok: isSuccess,
      status: res.status,
      code: json?.code ?? null,
      msg: json?.msg || '',
      data: json?.data ?? null,
      raw: text,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      code: 'NETWORK_ERROR',
      msg: error?.name === 'AbortError' ? 'timeout excedido' : error.message,
      data: null,
      raw: '',
      latencyMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timer);
  }
}

// Cache local de instrumentos Blofin (tickSize, lotSize, contractValue)
const instrumentsCache = new Map();
let lastInstrumentsRefresh = 0;

export async function refreshBlofinInstruments() {
  const now = Date.now();
  if (instrumentsCache.size > 0 && now - lastInstrumentsRefresh < 60 * 60 * 1000) {
    return instrumentsCache;
  }

  try {
    const res = await fetch('https://openapi.blofin.com/api/v1/market/instruments?instType=SWAP');
    const json = await res.json();
    if (json?.code === '0' && Array.isArray(json?.data)) {
      instrumentsCache.clear();
      for (const inst of json.data) {
        if (inst?.instId) {
          instrumentsCache.set(inst.instId, {
            instId: inst.instId,
            baseCurrency: inst.baseCurrency,
            quoteCurrency: inst.quoteCurrency,
            contractValue: Number(inst.contractValue || 1),
            maxLeverage: Number(inst.maxLeverage || 20),
            assetClass: inst.assetClass || 'Crypto',
            minSize: Number(inst.minSize || 1),
            lotSize: Number(inst.lotSize || 1),
            tickSize: Number(inst.tickSize || 0.01)
          });
        }
      }
      lastInstrumentsRefresh = now;
    }
  } catch {
    // Mantém o cache anterior se falhar
  }

  return instrumentsCache;
}

/**
 * Testa conectividade pública com a Blofin
 */
export async function testBlofinConnectivity() {
  const cfg = blofinConfig();
  const startedAt = Date.now();

  try {
    const res = await fetch('https://openapi.blofin.com/api/v1/market/tickers');
    const json = await res.json();
    const latencyMs = Date.now() - startedAt;

    if (json?.code === '0' && Array.isArray(json?.data)) {
      const cryptos = json.data.filter(x => !isEquitySymbol(x.instId)).length;
      const stocks = json.data.filter(x => isEquitySymbol(x.instId)).length;

      return {
        ok: true,
        mode: cfg.mode,
        latencyMs,
        totalTickers: json.data.length,
        cryptosAvailable: cryptos,
        stocksAvailable: stocks,
        message: `Conectividade pública BloFin OK (${latencyMs}ms) · ${cryptos} criptos · ${stocks} ações tokenizadas`
      };
    }

    return {
      ok: false,
      mode: cfg.mode,
      latencyMs,
      message: `BloFin respondeu com código: ${json?.code || 'sem código'}`
    };
  } catch (err) {
    return {
      ok: false,
      mode: cfg.mode,
      latencyMs: Date.now() - startedAt,
      message: `Falha na conexão: ${err.message}`
    };
  }
}

/**
 * Consulta a conta autenticada do usuário na Blofin (Demo ou Real)
 * Tenta tanto /api/v1/account/balance quanto /api/v1/asset/balances
 */
export async function testBlofinAccount() {
  const cfg = blofinConfig();

  if (!cfg.hasCredentials) {
    return {
      ok: false,
      configured: false,
      mode: cfg.mode,
      message: 'Chaves BLOFIN_API_KEY, BLOFIN_SECRET_KEY e BLOFIN_PASSPHRASE ainda não configuradas no Render.'
    };
  }

  // Tentativa 1: /api/v1/account/balance (conta de futuros/derivativos)
  let res = await blofinRequest('GET', '/api/v1/account/balance');

  // Fallback 1: /api/v1/asset/balances?accountType=futures
  if (!res.ok) {
    res = await blofinRequest('GET', '/api/v1/asset/balances?accountType=futures');
  }

  // Fallback 2: /api/v1/asset/balances
  if (!res.ok) {
    res = await blofinRequest('GET', '/api/v1/asset/balances');
  }

  if (!res.ok) {
    return {
      ok: false,
      configured: true,
      mode: cfg.mode,
      status: res.status,
      code: res.code,
      message: `Falha de autenticação Blofin (${cfg.mode}): ${res.msg || res.raw || 'erro desconhecido'}`
    };
  }

  // Parsing do saldo retornado pela BloFin
  let balanceUsdt = 0;
  let availableUsdt = 0;
  let frozenUsdt = 0;

  if (Array.isArray(res.data) && res.data.length > 0) {
    const first = res.data[0];
    if (first?.details && Array.isArray(first.details)) {
      const usdt = first.details.find(d => String(d?.currency || '').toUpperCase() === 'USDT');
      if (usdt) {
        balanceUsdt = Number(usdt.equity || usdt.balance || 0);
        availableUsdt = Number(usdt.available || usdt.availBal || usdt.equity || 0);
        frozenUsdt = Number(usdt.frozen || usdt.frozenBal || 0);
      } else {
        balanceUsdt = Number(first.totalEquity || 0);
        availableUsdt = Number(first.availableBalance || first.totalEquity || 0);
      }
    } else {
      const usdt = res.data.find(b => String(b?.currency || '').toUpperCase() === 'USDT');
      if (usdt) {
        balanceUsdt = Number(usdt.balance || usdt.equity || 0);
        availableUsdt = Number(usdt.available || usdt.availBal || 0);
        frozenUsdt = Number(usdt.frozen || 0);
      }
    }
  } else if (res.data && typeof res.data === 'object') {
    balanceUsdt = Number(res.data.totalEquity || res.data.balance || 0);
    availableUsdt = Number(res.data.availableBalance || res.data.available || res.data.totalEquity || 0);
  }

  return {
    ok: true,
    configured: true,
    mode: cfg.mode,
    balanceUsdt,
    availableUsdt,
    frozenUsdt,
    latencyMs: res.latencyMs,
    message: `Conta BloFin ${cfg.mode} Autenticada com Sucesso! Saldo: ${availableUsdt.toFixed(2)} USDT`
  };
}

/**
 * Consulta posições abertas na Blofin
 */
export async function getBlofinPositions(instId = null) {
  const cfg = blofinConfig();
  if (!cfg.hasCredentials) return [];

  const path = instId
    ? `/api/v1/account/positions?instId=${encodeURIComponent(instId)}`
    : '/api/v1/account/positions';

  const res = await blofinRequest('GET', path);
  if (!res.ok || !Array.isArray(res.data)) return [];

  return res.data
    .filter(p => Number(p?.positions || p?.contracts || 0) !== 0)
    .map(p => {
      const qty = Number(p.positions || p.contracts || 0);
      return {
        instId: p.instId,
        positionSide: p.positionSide || 'net',
        side: qty > 0 ? 'LONG' : 'SHORT',
        contracts: Math.abs(qty),
        avgPrice: Number(p.avgPrice || p.openAvgPrice || 0),
        markPrice: Number(p.markPrice || 0),
        unrealizedPnl: Number(p.unrealizedPnl || p.upl || 0),
        leverage: Number(p.leverage || cfg.leverage),
        marginMode: p.marginMode || 'cross'
      };
    });
}

// Histórico de execuções em memória para Telegram e interface
export const blofinExecutionHistory = [];

/**
 * Executa ordem de trading na Blofin (com TP1 e Stop Loss anexados)
 */
export async function executeBlofinOrder(signal, options = {}) {
  const cfg = blofinConfig();

  if (!cfg.enabled) {
    return { ok: false, reason: 'executor BloFin desabilitado no .env' };
  }

  if (!cfg.hasCredentials) {
    return { ok: false, reason: 'chaves BLOFIN_API_KEY não configuradas' };
  }

  const rawSymbol = String(signal?.symbol || signal?.dataSymbol || '').toUpperCase();
  const instId = formatBlofinInstId(rawSymbol);
  const isStock = isEquitySymbol(rawSymbol);

  if (isStock && !cfg.stocksEnabled) {
    return { ok: false, reason: 'negociação de ações tokenizadas desativada em BLOFIN_STOCKS_ENABLED' };
  }

  // Verifica limite de posições abertas
  const currentPositions = await getBlofinPositions();
  if (currentPositions.length >= cfg.maxOpenPositions) {
    return {
      ok: false,
      reason: `limite máximo de posições (${currentPositions.length}/${cfg.maxOpenPositions}) atingido na BloFin`
    };
  }

  // Garante cache de instrumentos carregado
  await refreshBlofinInstruments();
  const inst = instrumentsCache.get(instId) || {
    contractValue: isStock ? 0.01 : (instId.startsWith('BTC') ? 0.001 : 1),
    lotSize: 1,
    minSize: 1,
    maxLeverage: isStock ? 20 : 50
  };

  const side = String(signal?.side || '').toUpperCase();
  const isLong = side === 'LONG';
  const orderSide = isLong ? 'buy' : 'sell';

  const entryPrice = Number(signal?.entry || signal?.t5?.price || 0);
  const stopLoss = Number(signal?.stop || 0);
  const takeProfit = Number(signal?.tp1 || signal?.tp2 || 0);

  if (entryPrice <= 0) {
    return { ok: false, reason: 'preço de entrada inválido' };
  }

  // Cálculo da quantidade em número de contratos
  const appliedLeverage = Math.min(cfg.leverage, inst.maxLeverage);
  const notional = cfg.marginUsdt * appliedLeverage;
  const contractVal = inst.contractValue > 0 ? inst.contractValue : 1;
  const rawContracts = notional / (entryPrice * contractVal);

  const lotSize = inst.lotSize > 0 ? inst.lotSize : 1;
  const minSize = inst.minSize > 0 ? inst.minSize : 1;
  const contracts = Math.max(minSize, Math.round(rawContracts / lotSize) * lotSize);

  // Configura a alavancagem do par antes da ordem
  try {
    await blofinRequest('POST', '/api/v1/account/set-leverage', {
      instId,
      leverage: String(appliedLeverage),
      marginMode: cfg.marginMode
    });
  } catch {
    // Ignora se já estiver com alavancagem ajustada
  }

  // Payload da ordem com Stop Loss e Take Profit automáticos
  const orderPayload = {
    instId,
    marginMode: cfg.marginMode,
    side: orderSide,
    orderType: 'market',
    size: String(contracts)
  };

  if (takeProfit > 0) {
    orderPayload.tpTriggerPrice = String(takeProfit);
    orderPayload.tpOrderPrice = '-1';
  }

  if (stopLoss > 0) {
    orderPayload.slTriggerPrice = String(stopLoss);
    orderPayload.slOrderPrice = '-1';
  }

  const res = await blofinRequest('POST', '/api/v1/trade/order', orderPayload);

  const executionRecord = {
    id: res.data?.[0]?.orderId || `BLF_${Date.now()}`,
    timestamp: Date.now(),
    instId,
    assetClass: isStock ? 'Stock' : 'Crypto',
    side,
    entryPrice,
    stopLoss,
    takeProfit,
    contracts,
    notionalUsdt: Number((contracts * contractVal * entryPrice).toFixed(2)),
    marginUsdt: cfg.marginUsdt,
    leverage: appliedLeverage,
    mode: cfg.mode,
    score: Number(signal?.score || 0),
    aiConfidence: Number(signal?.ai?.confidence || 0),
    success: res.ok,
    error: res.ok ? null : (res.msg || res.raw)
  };

  blofinExecutionHistory.unshift(executionRecord);
  if (blofinExecutionHistory.length > 50) blofinExecutionHistory.pop();

  return {
    ok: res.ok,
    instId,
    mode: cfg.mode,
    isStock,
    contracts,
    notional: executionRecord.notionalUsdt,
    entryPrice,
    stopLoss,
    takeProfit,
    response: res.data,
    error: res.ok ? null : (res.msg || res.raw)
  };
}

/**
 * Fecha uma posição a mercado na BloFin
 */
export async function closeBlofinPosition(instId) {
  const positions = await getBlofinPositions(instId);
  const pos = positions.find(p => p.instId === instId);

  if (!pos || pos.contracts <= 0) {
    return { ok: false, reason: `nenhuma posição aberta para ${instId}` };
  }

  const closeSide = pos.side === 'LONG' ? 'sell' : 'buy';

  const res = await blofinRequest('POST', '/api/v1/trade/order', {
    instId,
    marginMode: pos.marginMode,
    side: closeSide,
    orderType: 'market',
    size: String(pos.contracts),
    reduceOnly: true
  });

  return {
    ok: res.ok,
    instId,
    closedSide: pos.side,
    contracts: pos.contracts,
    response: res.data,
    error: res.ok ? null : (res.msg || res.raw)
  };
}
