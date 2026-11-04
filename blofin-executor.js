// ==============================================================
// BLOFIN EXECUTOR V1.3 — DUAL-SIGNATURE & AUTO-ENVIRONMENT DETECT
// Suporte nativo a Modo Demo (Sandbox) e Conta Real na BloFin
// Suporta: Criptomoedas (BTC, ETH, SOL, SUI, etc.) e Ações (TSLA, NVDA, AAPL, etc.)
// ==============================================================

import crypto from 'node:crypto';

export const BLOFIN_EXECUTOR_VERSION = 'V1.3 Dual-Engine';

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
  let s = String(symbol || '').toUpperCase().trim();
  s = s.replace(/-SWAP$/i, '')
       .replace(/-PERP$/i, '')
       .replace(/:.*$/, '')
       .trim();

  if (s.endsWith('-USDT')) return s;

  const base = s
    .replace(/[-_/]/g, '')
    .replace(/USDT.*$/, '')
    .trim();

  return `${base}-USDT`;
}

export function blofinConfig() {
  const isDemo = boolEnv('BLOFIN_DEMO', true);
  // Limpa aspas ou espaços acidentais colados no Render
  const clean = v => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
  const apiKey = clean(process.env.BLOFIN_API_KEY);
  const secretKey = clean(process.env.BLOFIN_SECRET_KEY);
  const passphrase = clean(process.env.BLOFIN_PASSPHRASE);

  const hasCredentials = Boolean(apiKey && secretKey && passphrase);

  return {
    version: BLOFIN_EXECUTOR_VERSION,
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
 * Assina requisição HTTP para a API BloFin.
 * Suporta o modo oficial da documentação (Hex 64 chars -> Base64 88 chars)
 * e o modo direto (HMAC 32 bytes -> Base64 44 chars).
 */
export function getBlofinHeaders(method, requestPath, bodyObj, apiKey, secretKey, passphrase, useDirectBinary = false) {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomUUID();

  let bodyString = '';
  if (bodyObj && (method === 'POST' || method === 'PUT')) {
    bodyString = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  }

  const prehash = `${requestPath}${method.toUpperCase()}${timestamp}${nonce}${bodyString}`;

  let signature = '';
  if (useDirectBinary) {
    // Formato Direto (HMAC-SHA256 32 bytes em Base64 = 44 caracteres)
    signature = crypto
      .createHmac('sha256', secretKey)
      .update(prehash)
      .digest('base64');
  } else {
    // Formato Oficial BloFin Doc (HMAC-SHA256 64 hex chars em Base64 = 88 caracteres)
    const hexDigest = crypto
      .createHmac('sha256', secretKey)
      .update(prehash)
      .digest('hex');
    signature = Buffer.from(hexDigest, 'utf8').toString('base64');
  }

  return {
    'ACCESS-KEY': apiKey,
    'ACCESS-SIGN': signature,
    'ACCESS-TIMESTAMP': timestamp,
    'ACCESS-NONCE': nonce,
    'ACCESS-PASSPHRASE': passphrase,
    'Content-Type': 'application/json'
  };
}

async function executeSingleRequest(method, pathWithQuery, body, cfg, useDirectBinary) {
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
      cfg.passphrase,
      useDirectBinary
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

    const firstItem = Array.isArray(json?.data) ? json.data[0] : json?.data;
    const subCode = firstItem?.sCode != null ? String(firstItem.sCode) : null;
    const subMsg = firstItem?.sMsg || firstItem?.msg || '';

    // No BloFin, a operação é sucesso se o código geral for 0 E o sub-código do item for 0 ou ausente
    const isSuccess = res.ok && json && (json.code === '0' || json.code === 0) && (!subCode || subCode === '0' || subCode === '00000');

    // Mensagem descritiva: se subMsg detalhar o erro, expõe para o usuário
    let effectiveMsg = json?.msg || '';
    if (subMsg && subMsg !== json?.msg) {
      effectiveMsg = json?.msg && json.msg !== 'All operations failed'
        ? `${json.msg}: ${subMsg}`
        : subMsg;
    }

    return {
      ok: isSuccess,
      status: res.status,
      code: subCode || json?.code || null,
      topCode: json?.code || null,
      subCode,
      msg: effectiveMsg || text,
      data: json?.data ?? null,
      raw: text,
      latencyMs: Date.now() - startedAt,
      signMode: useDirectBinary ? 'DIRECT_44' : 'HEX_BASE64_88'
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      code: 'NETWORK_ERROR',
      msg: error?.name === 'AbortError' ? 'timeout excedido' : error.message,
      data: null,
      raw: '',
      latencyMs: Date.now() - startedAt,
      signMode: useDirectBinary ? 'DIRECT_44' : 'HEX_BASE64_88'
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Faz requisição HTTP à BloFin com DUAL-SIGNATURE ENGINE:
 * Tenta o formato oficial (Hex 88 chars). Se falhar com erro de assinatura, retenta com o formato direto (44 chars).
 */
export async function blofinRequest(method, pathWithQuery, body = null, customConfig = null) {
  const cfg = customConfig || blofinConfig();

  // Tentativa 1: Oficial da documentação
  let res = await executeSingleRequest(method, pathWithQuery, body, cfg, false);

  // Tentativa 2: Fallback automático se a assinatura falhar
  if (!res.ok && (res.code === '50111' || String(res.msg || '').toLowerCase().includes('signature'))) {
    const res2 = await executeSingleRequest(method, pathWithQuery, body, cfg, true);
    if (res2.ok) return res2;
    return res2;
  }

  return res;
}

export function extractBlofinError(res) {
  if (!res) return 'Sem resposta da API BloFin';
  const first = Array.isArray(res.data) ? res.data[0] : (res.data || {});
  const subMsg = first?.sMsg || first?.msg;
  const subCode = first?.sCode || first?.code;

  if (subMsg && subMsg !== res.msg) {
    return `${subMsg}${subCode && subCode !== '0' ? ` (código: ${subCode})` : ''}`;
  }
  if (res.msg && res.msg !== 'All operations failed') {
    return `${res.msg}${res.code ? ` (código: ${res.code})` : ''}`;
  }
  if (subMsg) {
    return `${subMsg}${subCode && subCode !== '0' ? ` (código: ${subCode})` : ''}`;
  }
  return res.msg || res.raw || `HTTP ${res.status || 'erro'}`;
}

let cachedPositionMode = null;
let lastPositionModeFetch = 0;

export async function getBlofinPositionMode() {
  const now = Date.now();
  if (cachedPositionMode && now - lastPositionModeFetch < 5 * 60 * 1000) {
    return cachedPositionMode;
  }
  const cfg = blofinConfig();
  if (!cfg.hasCredentials) return 'long_short_mode';
  try {
    const res = await blofinRequest('GET', '/api/v1/account/position-mode');
    if (res.ok && res.data?.positionMode) {
      cachedPositionMode = res.data.positionMode;
      lastPositionModeFetch = now;
      console.log(`[blofin] Modo de Posição detectado da conta: ${cachedPositionMode}`);
      return cachedPositionMode;
    }
  } catch (e) {
    console.warn('[blofin] Aviso ao consultar position-mode:', e?.message || e);
  }
  return cachedPositionMode || 'long_short_mode';
}

const instrumentsCache = new Map();
let lastInstrumentsRefresh = 0;

export async function refreshBlofinInstruments() {
  const now = Date.now();
  if (instrumentsCache.size > 0 && now - lastInstrumentsRefresh < 60 * 60 * 1000) {
    return instrumentsCache;
  }

  try {
    const cfg = blofinConfig();
    const endpoint = `${cfg.apiUrl.replace(/\/$/, '')}/api/v1/market/instruments?instType=SWAP`;
    const res = await fetch(endpoint);
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
  } catch {}

  return instrumentsCache;
}

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
 * Consulta saldo autenticado com auto-detecção de ambiente (DEMO vs LIVE)
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

  // 1. Tenta no ambiente configurado (Demo ou Live)
  let res = await blofinRequest('GET', '/api/v1/asset/balances?accountType=futures', null, cfg);
  if (!res.ok) {
    res = await blofinRequest('GET', '/api/v1/account/balance', null, cfg);
  }
  if (!res.ok) {
    res = await blofinRequest('GET', '/api/v1/asset/balances', null, cfg);
  }

  // 2. Se falhou e estava configurado como DEMO, testa se a chave é da conta REAL (Live)
  if (!res.ok && cfg.isDemo) {
    const liveCfg = { ...cfg, isDemo: false, mode: 'LIVE', apiUrl: LIVE_API_URL };
    let liveRes = await blofinRequest('GET', '/api/v1/asset/balances?accountType=futures', null, liveCfg);
    if (!liveRes.ok) liveRes = await blofinRequest('GET', '/api/v1/account/balance', null, liveCfg);
    if (liveRes.ok) {
      return {
        ok: false,
        configured: true,
        mode: cfg.mode,
        message: '⚡ DETECTADO: Sua chave API foi criada na conta REAL (Live), não na Sandbox Demo! Mude no Render: BLOFIN_DEMO=false'
      };
    }
  }

  // 3. Se falhou e estava configurado como LIVE, testa se a chave é da Sandbox DEMO
  if (!res.ok && !cfg.isDemo) {
    const demoCfg = { ...cfg, isDemo: true, mode: 'DEMO', apiUrl: DEMO_API_URL };
    let demoRes = await blofinRequest('GET', '/api/v1/asset/balances?accountType=futures', null, demoCfg);
    if (!demoRes.ok) demoRes = await blofinRequest('GET', '/api/v1/account/balance', null, demoCfg);
    if (demoRes.ok) {
      return {
        ok: false,
        configured: true,
        mode: cfg.mode,
        message: '⚡ DETECTADO: Sua chave API é da Sandbox DEMO! Mude no Render: BLOFIN_DEMO=true'
      };
    }
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
        avgPrice: Number(p.averagePrice || p.avgPrice || p.openAvgPrice || 0),
        markPrice: Number(p.markPrice || 0),
        unrealizedPnl: Number(p.unrealizedPnl || p.upl || 0),
        leverage: Number(p.leverage || cfg.leverage),
        marginMode: p.marginMode || 'cross'
      };
    });
}

export const blofinExecutionHistory = [];

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

  const currentPositions = await getBlofinPositions();
  if (currentPositions.length >= cfg.maxOpenPositions) {
    return {
      ok: false,
      reason: `limite máximo de posições (${currentPositions.length}/${cfg.maxOpenPositions}) atingido na BloFin`
    };
  }

  await refreshBlofinInstruments();
  if (instrumentsCache.size > 0 && !instrumentsCache.has(instId)) {
    const reason = cfg.isDemo
      ? `Par ${instId} não está disponível na Sandbox DEMO da BloFin (Demo possui 87 pares; ativo na conta REAL)`
      : `Par ${instId} não encontrado nos instrumentos perpétuos da BloFin`;
    return {
      ok: false,
      instId,
      mode: cfg.mode,
      error: reason,
      reason
    };
  }

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
  const stopLoss = Number(signal?.quickScalpStopReference || signal?.stop || 0);
  const takeProfit = Number(signal?.quickScalpTargetReference || signal?.tp1 || signal?.tp2 || 0);

  if (entryPrice <= 0) {
    return { ok: false, reason: 'preço de entrada inválido' };
  }

  const appliedLeverage = Math.min(cfg.leverage, inst.maxLeverage);
  const notional = cfg.marginUsdt * appliedLeverage;
  const contractVal = inst.contractValue > 0 ? inst.contractValue : 1;
  const rawContracts = notional / (entryPrice * contractVal);

  const lotSize = inst.lotSize > 0 ? inst.lotSize : 1;
  const minSize = inst.minSize > 0 ? inst.minSize : 1;
  const contracts = Math.max(minSize, Math.round(rawContracts / lotSize) * lotSize);

  const decimals = (lotSize.toString().split('.')[1] || '').length;
  const formattedSize = decimals > 0 ? contracts.toFixed(decimals) : String(Math.round(contracts));

  try {
    await blofinRequest('POST', '/api/v1/account/set-leverage', {
      instId,
      leverage: String(appliedLeverage),
      marginMode: cfg.marginMode,
      positionSide: isLong ? 'long' : 'short'
    });
  } catch {}

  const posMode = await getBlofinPositionMode();
  const isNetMode = posMode === 'net_mode';
  const detectedPosSide = isNetMode ? 'net' : (isLong ? 'long' : 'short');
  const alternatePosSide = isNetMode ? (isLong ? 'long' : 'short') : 'net';

  const attempts = [
    // 1. Modo detectado (com TP/SL embutido)
    { posSide: detectedPosSide, includeTpSl: true, label: `Modo detectado (${detectedPosSide}) com TP/SL` },
    // 2. Modo detectado puro a mercado (sem TP/SL embutido para evitar rejeição por preço de gatilho)
    { posSide: detectedPosSide, includeTpSl: false, label: `Modo detectado (${detectedPosSide}) a mercado direto` },
    // 3. Modo alternativo (net vs long/short)
    { posSide: alternatePosSide, includeTpSl: false, label: `Modo alternativo (${alternatePosSide}) a mercado` },
    // 4. Modo alternativo com TP/SL
    { posSide: alternatePosSide, includeTpSl: true, label: `Modo alternativo (${alternatePosSide}) com TP/SL` },
    // 5. Sem positionSide (One-way puro)
    { posSide: null, includeTpSl: false, label: 'Ordem a mercado sem positionSide' }
  ];

  let res = null;
  let finalPosSide = detectedPosSide;
  let placedWithTpSl = false;

  for (const att of attempts) {
    const payload = {
      instId,
      marginMode: cfg.marginMode,
      side: orderSide,
      orderType: 'market',
      size: formattedSize
    };

    if (att.posSide) {
      payload.positionSide = att.posSide;
    }

    if (att.includeTpSl) {
      if (takeProfit > 0) {
        payload.tpTriggerPrice = String(takeProfit);
        payload.tpOrderPrice = '-1';
      }
      if (stopLoss > 0) {
        payload.slTriggerPrice = String(stopLoss);
        payload.slOrderPrice = '-1';
      }
    }

    res = await blofinRequest('POST', '/api/v1/trade/order', payload);
    const first = Array.isArray(res.data) ? res.data[0] : res.data;
    const subCode = first?.sCode != null ? String(first.sCode) : null;
    const isOrderAccepted = res.ok && (!subCode || subCode === '0' || subCode === '00000');

    if (isOrderAccepted) {
      res.ok = true;
      finalPosSide = att.posSide || 'net';
      placedWithTpSl = att.includeTpSl;
      console.log(`[blofin] Ordem aceita com sucesso usando estratégia: ${att.label}`);
      break;
    }
  }

  // Se a ordem a mercado abriu mas sem TP/SL embutido, anexa TP/SL via endpoint dedicado /api/v1/trade/order-tpsl
  if (res.ok && !placedWithTpSl && (takeProfit > 0 || stopLoss > 0)) {
    try {
      const tpslPayload = {
        instId,
        marginMode: cfg.marginMode,
        side: isLong ? 'sell' : 'buy', // Lado de encerramento da posição
        size: '-1' // Protege a posição inteira
      };
      if (finalPosSide) {
        tpslPayload.positionSide = finalPosSide;
      }
      if (takeProfit > 0) {
        tpslPayload.tpTriggerPrice = String(takeProfit);
        tpslPayload.tpOrderPrice = '-1';
      }
      if (stopLoss > 0) {
        tpslPayload.slTriggerPrice = String(stopLoss);
        tpslPayload.slOrderPrice = '-1';
      }
      const tpslRes = await blofinRequest('POST', '/api/v1/trade/order-tpsl', tpslPayload);
      if (tpslRes.ok) {
        console.log(`[blofin] TP/SL anexado com sucesso via order-tpsl para ${instId} (TP: ${takeProfit}, SL: ${stopLoss})`);
      } else {
        console.warn('[blofin] order-tpsl aviso:', extractBlofinError(tpslRes));
      }
    } catch (e) {
      console.warn('[blofin] Falha ao enviar TP/SL pós-ordem:', e?.message || e);
    }
  }

  const detailedError = res.ok ? null : extractBlofinError(res);

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
    error: detailedError
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
    error: detailedError,
    reason: detailedError
  };
}

export async function closeBlofinPosition(instId) {
  const positions = await getBlofinPositions(instId);
  const pos = positions.find(p => p.instId === instId);

  if (!pos || pos.contracts <= 0) {
    return { ok: false, reason: `nenhuma posição aberta para ${instId}` };
  }

  const closeSide = pos.side === 'LONG' ? 'sell' : 'buy';
  const posSide = pos.positionSide || (pos.side === 'LONG' ? 'long' : 'short');

  const closePayload = {
    instId,
    marginMode: pos.marginMode || 'cross',
    positionSide: posSide,
    side: closeSide,
    orderType: 'market',
    size: String(pos.contracts)
  };

  let res = await blofinRequest('POST', '/api/v1/trade/order', closePayload);

  if (!res.ok) {
    closePayload.positionSide = closePayload.positionSide === 'net' ? (pos.side === 'LONG' ? 'long' : 'short') : 'net';
    res = await blofinRequest('POST', '/api/v1/trade/order', closePayload);
  }

  const detailedError = res.ok ? null : extractBlofinError(res);

  return {
    ok: res.ok,
    instId,
    contracts: pos.contracts,
    side: closeSide,
    response: res.data,
    error: detailedError,
    reason: detailedError
  };
}

export async function updateBlofinTpSl(instId, { takeProfit = 0, stopLoss = 0, side = 'LONG' } = {}) {
  const cfg = blofinConfig();
  if (!cfg.enabled || !cfg.hasCredentials) {
    return { ok: false, reason: 'executor BloFin desabilitado ou sem credenciais' };
  }

  const isLong = String(side || '').toUpperCase() === 'LONG';
  const closeSide = isLong ? 'sell' : 'buy';
  const posMode = await getBlofinPositionMode();
  const isNetMode = posMode === 'net_mode';
  const positionSide = isNetMode ? 'net' : (isLong ? 'long' : 'short');

  const payload = {
    instId,
    marginMode: cfg.marginMode,
    side: closeSide,
    positionSide,
    size: '-1' // Protege a posição inteira
  };

  if (takeProfit > 0) {
    payload.tpTriggerPrice = String(takeProfit);
    payload.tpOrderPrice = '-1';
  }
  if (stopLoss > 0) {
    payload.slTriggerPrice = String(stopLoss);
    payload.slOrderPrice = '-1';
  }

  let res = await blofinRequest('POST', '/api/v1/trade/order-tpsl', payload);
  if (!res.ok) {
    payload.positionSide = positionSide === 'net' ? (isLong ? 'long' : 'short') : 'net';
    res = await blofinRequest('POST', '/api/v1/trade/order-tpsl', payload);
  }

  const detailedError = res.ok ? null : extractBlofinError(res);
  return {
    ok: res.ok,
    instId,
    stopLoss,
    takeProfit,
    error: detailedError,
    reason: detailedError
  };
}

