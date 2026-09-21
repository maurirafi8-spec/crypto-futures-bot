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

function stripZeros(value) {
  const s = String(value);
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function fmtNumber(value, digits = 8) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ''));
}

function isPrivateKey(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || ''));
}

export function hyperConfig() {
  return {
    enabled:
      String(process.env.HYPERLIQUID_EXECUTION_ENABLED || 'true')
        .toLowerCase() !== 'false',

    mode: 'TESTNET',

    apiUrl:
      process.env.HYPERLIQUID_TESTNET_API || TESTNET_API,

    // Ordens assinadas só são possíveis quando esta flag está explicitamente true.
    signedTestnetEnabled:
      boolEnv('HYPERLIQUID_TESTNET_SIGNED_ENABLED', false),

    // Mesmo com a flag acima, o processo inicia DESARMADO.
    // O usuário precisa usar /harm após cada deploy/restart.
    requireRuntimeArm: true,

    walletAddress:
      String(process.env.HYPERLIQUID_WALLET_ADDRESS || '').trim(),

    agentPrivateKey:
      String(process.env.HYPERLIQUID_AGENT_PRIVATE_KEY || '').trim(),

    marginUsdc:
      numEnv('HYPERLIQUID_MARGIN_USDC', 6, 1, 100000),

    leverage: Math.trunc(
      numEnv('HYPERLIQUID_LEVERAGE', 2, 1, 50)
    ),

    minAiConfidence:
      numEnv('HYPERLIQUID_AUTO_MIN_AI_CONFIDENCE', 70, 0, 100),

    minScore:
      numEnv('HYPERLIQUID_AUTO_MIN_SCORE', 75, 0, 100),

    maxOpenPositions: Math.trunc(
      numEnv('HYPERLIQUID_MAX_OPEN_POSITIONS', 1, 1, 10)
    ),

    slippageBps:
      numEnv('HYPERLIQUID_SLIPPAGE_BPS', 50, 5, 300),

    // Evita ficar exatamente na borda de mínimo de notional.
    minNotionalUsdc:
      numEnv('HYPERLIQUID_MIN_NOTIONAL_USDC', 12, 10, 1000),

    timeoutMs:
      Math.trunc(
        numEnv('HYPERLIQUID_TIMEOUT_MS', 15000, 3000, 60000)
      )
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
    reason: 'aprovado para execução Hyperliquid Testnet'
  };
}

async function postInfo(body, timeoutMs) {
  const cfg = hyperConfig();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs || cfg.timeoutMs
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

  if (!isAddress(cfg.walletAddress)) {
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

  const positions = Array.isArray(state.data?.assetPositions)
    ? state.data.assetPositions.filter(p => {
        const szi = Number(
          p?.position?.szi ??
          p?.position?.positionValue ??
          0
        );
        return Number.isFinite(szi) && Math.abs(szi) > 0;
      })
    : [];

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
    positions: positions.length,
    rawPositions: positions,
    message:
      'Conta Hyperliquid Testnet consultada com sucesso'
  };
}

async function loadSigningSdk() {
  const cfg = hyperConfig();

  if (!cfg.agentPrivateKey) {
    throw new Error(
      'HYPERLIQUID_AGENT_PRIVATE_KEY não configurada'
    );
  }

  if (!isPrivateKey(cfg.agentPrivateKey)) {
    throw new Error(
      'HYPERLIQUID_AGENT_PRIVATE_KEY inválida; esperado 0x + 64 hex'
    );
  }

  const [
    hyper,
    viemAccounts
  ] = await Promise.all([
    import('@nktkas/hyperliquid'),
    import('viem/accounts')
  ]);

  const wallet =
    viemAccounts.privateKeyToAccount(
      cfg.agentPrivateKey
    );

  const transport =
    new hyper.HttpTransport({
      isTestnet: true,
      timeout: cfg.timeoutMs
    });

  const info =
    new hyper.InfoClient({
      transport
    });

  const exchange =
    new hyper.ExchangeClient({
      transport,
      wallet,
      defaultExpiresAfter:
        () => Date.now() + 30000
    });

  return {
    ...hyper,
    wallet,
    transport,
    info,
    exchange
  };
}

export async function getHyperAgentStatus() {
  const cfg = hyperConfig();

  if (!cfg.agentPrivateKey) {
    return {
      configured: false,
      approved: false,
      address: null,
      masterConfigured: Boolean(cfg.walletAddress),
      message:
        'HYPERLIQUID_AGENT_PRIVATE_KEY ainda não configurada'
    };
  }

  let sdk;

  try {
    sdk = await loadSigningSdk();
  } catch (error) {
    return {
      configured: true,
      approved: false,
      address: null,
      masterConfigured: Boolean(cfg.walletAddress),
      message: error.message
    };
  }

  const address =
    sdk.wallet.address.toLowerCase();

  if (!cfg.walletAddress) {
    return {
      configured: true,
      approved: false,
      address,
      masterConfigured: false,
      message:
        'Agent key válida; falta HYPERLIQUID_WALLET_ADDRESS'
    };
  }

  if (!isAddress(cfg.walletAddress)) {
    return {
      configured: true,
      approved: false,
      address,
      masterConfigured: true,
      message:
        'HYPERLIQUID_WALLET_ADDRESS inválido'
    };
  }

  try {
    const agents =
      await sdk.info.extraAgents({
        user: cfg.walletAddress
      });

    const match =
      Array.isArray(agents)
        ? agents.find(
            a =>
              String(a?.address || '').toLowerCase() ===
              address
          )
        : null;

    const validUntil =
      match?.validUntil == null
        ? null
        : Number(match.validUntil);

    const approved =
      Boolean(match) &&
      (
        validUntil == null ||
        !Number.isFinite(validUntil) ||
        validUntil > Date.now()
      );

    return {
      configured: true,
      approved,
      address,
      masterConfigured: true,
      name: match?.name || null,
      validUntil,
      message: approved
        ? 'Agent/API Wallet aprovada no Hyperliquid Testnet'
        : 'Agent key existe, mas este endereço não está aprovado/ativo para a conta master'
    };
  } catch (error) {
    return {
      configured: true,
      approved: false,
      address,
      masterConfigured: true,
      message:
        `Falha ao consultar agents: ${error.message}`
    };
  }
}

function formatSize(value, szDecimals) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `Tamanho inválido: ${value}`
    );
  }

  const factor = 10 ** szDecimals;

  // Arredonda para baixo para não exceder o notional pretendido.
  const floored =
    Math.floor(n * factor) / factor;

  if (floored <= 0) {
    throw new Error(
      `Quantidade ficou zero com szDecimals=${szDecimals}`
    );
  }

  return stripZeros(
    floored.toFixed(szDecimals)
  );
}

function formatPrice(value, szDecimals) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `Preço inválido: ${value}`
    );
  }

  const maxDecimals =
    Math.max(0, 6 - Number(szDecimals || 0));

  // Hyperliquid: até 5 algarismos significativos
  // e no máximo 6 - szDecimals casas para perps.
  const sig =
    Number(n.toPrecision(5));

  return stripZeros(
    sig.toFixed(maxDecimals)
  );
}

async function resolveAsset(info, coin) {
  const meta =
    await info.meta();

  const index =
    meta.universe.findIndex(
      u => u.name === coin
    );

  if (index < 0) {
    throw new Error(
      `Ativo ${coin} não encontrado no Hyperliquid Testnet`
    );
  }

  return {
    assetIndex: index,
    szDecimals:
      Number(meta.universe[index].szDecimals),
    maxLeverage:
      Number(meta.universe[index].maxLeverage || 1),
    onlyIsolated:
      Boolean(meta.universe[index].onlyIsolated)
  };
}

async function getMid(info, coin) {
  const mids =
    await info.allMids();

  const mid =
    Number(mids?.[coin]);

  if (!Number.isFinite(mid) || mid <= 0) {
    throw new Error(
      `Mid inválido para ${coin}`
    );
  }

  return mid;
}

function relativeRiskFromSignal(signal) {
  const entry =
    Number(signal?.entry);

  let stopPct = 0.01;
  let tpPct = 0.015;

  if (
    Number.isFinite(entry) &&
    entry > 0
  ) {
    const stop =
      Number(signal?.stop);

    const tp =
      Number(
        signal?.tp1 ??
        signal?.tp2 ??
        signal?.tp3
      );

    if (
      Number.isFinite(stop) &&
      stop > 0
    ) {
      stopPct =
        Math.abs(entry - stop) / entry;
    }

    if (
      Number.isFinite(tp) &&
      tp > 0
    ) {
      tpPct =
        Math.abs(tp - entry) / entry;
    }
  }

  // Proteções para evitar bracket absurdo caso algum campo venha quebrado.
  stopPct =
    Math.max(0.003, Math.min(0.05, stopPct));

  tpPct =
    Math.max(0.004, Math.min(0.10, tpPct));

  return {
    stopPct,
    tpPct
  };
}

function resultSummary(result) {
  const statuses =
    result?.response?.data?.statuses;

  if (!Array.isArray(statuses)) {
    return {
      status: result?.status || 'unknown',
      filled: false,
      oid: null,
      avgPx: null,
      rawStatuses: statuses || null
    };
  }

  const first =
    statuses[0] || {};

  return {
    status: result?.status || 'unknown',
    filled: Boolean(first?.filled),
    oid:
      first?.filled?.oid ??
      first?.resting?.oid ??
      null,
    avgPx:
      first?.filled?.avgPx ??
      null,
    rawStatuses: statuses
  };
}

export async function placeSignedTestnetBracket({
  coin,
  side,
  notionalUsdc,
  stopPct = 0.01,
  tpPct = 0.015
}) {
  const cfg = hyperConfig();

  if (!cfg.signedTestnetEnabled) {
    throw new Error(
      'HYPERLIQUID_TESTNET_SIGNED_ENABLED não está true'
    );
  }

  const agent =
    await getHyperAgentStatus();

  if (!agent.approved) {
    throw new Error(
      `Agent não aprovada: ${agent.message}` +
      (agent.address
        ? ` · address=${agent.address}`
        : '')
    );
  }

  const account =
    await testHyperliquidAccount();

  if (!account.ok) {
    throw new Error(
      `Conta testnet indisponível: ${account.message}`
    );
  }

  if (
    account.positions >=
    cfg.maxOpenPositions
  ) {
    throw new Error(
      `Limite de posições atingido ` +
      `(${account.positions}/${cfg.maxOpenPositions})`
    );
  }

  const sdk =
    await loadSigningSdk();

  const asset =
    await resolveAsset(
      sdk.info,
      coin
    );

  const mid =
    await getMid(
      sdk.info,
      coin
    );

  const leverage =
    Math.max(
      1,
      Math.min(
        cfg.leverage,
        asset.maxLeverage
      )
    );

  const finalNotional =
    Math.max(
      Number(notionalUsdc || 0),
      cfg.minNotionalUsdc
    );

  const qty =
    finalNotional / mid;

  const sizeStr =
    formatSize(
      qty,
      asset.szDecimals
    );

  const isBuy =
    String(side).toUpperCase() === 'LONG';

  const slip =
    cfg.slippageBps / 10000;

  const entryLimit =
    mid *
    (isBuy
      ? (1 + slip)
      : (1 - slip));

  const tpPrice =
    mid *
    (isBuy
      ? (1 + tpPct)
      : (1 - tpPct));

  const slPrice =
    mid *
    (isBuy
      ? (1 - stopPct)
      : (1 + stopPct));

  const entryPx =
    formatPrice(
      entryLimit,
      asset.szDecimals
    );

  const tpPx =
    formatPrice(
      tpPrice,
      asset.szDecimals
    );

  const slPx =
    formatPrice(
      slPrice,
      asset.szDecimals
    );

  await sdk.exchange.updateLeverage({
    asset: asset.assetIndex,
    isCross: !asset.onlyIsolated,
    leverage
  });

  const closeIsBuy = !isBuy;

  const result =
    await sdk.exchange.order({
      orders: [
        {
          a: asset.assetIndex,
          b: isBuy,
          p: entryPx,
          s: sizeStr,
          r: false,
          t: {
            limit: {
              tif: 'Ioc'
            }
          }
        },
        {
          a: asset.assetIndex,
          b: closeIsBuy,
          p: tpPx,
          s: sizeStr,
          r: true,
          t: {
            trigger: {
              isMarket: true,
              triggerPx: tpPx,
              tpsl: 'tp'
            }
          }
        },
        {
          a: asset.assetIndex,
          b: closeIsBuy,
          p: slPx,
          s: sizeStr,
          r: true,
          t: {
            trigger: {
              isMarket: true,
              triggerPx: slPx,
              tpsl: 'sl'
            }
          }
        }
      ],
      grouping: 'normalTpsl'
    });

  return {
    venue: 'Hyperliquid Testnet',
    signed: true,
    coin,
    side: isBuy ? 'LONG' : 'SHORT',
    assetIndex: asset.assetIndex,
    szDecimals: asset.szDecimals,
    leverage,
    isCross: !asset.onlyIsolated,
    mid: fmtNumber(mid),
    notionalUsdc:
      fmtNumber(finalNotional, 2),
    quantity: sizeStr,
    entryLimit: entryPx,
    tp: tpPx,
    stop: slPx,
    stopPct:
      fmtNumber(stopPct * 100, 3),
    tpPct:
      fmtNumber(tpPct * 100, 3),
    agentAddress: agent.address,
    result,
    resultSummary:
      resultSummary(result),
    createdAt: Date.now()
  };
}

export async function placeSignalSignedTestnet(signal) {
  const cfg = hyperConfig();
  const coin =
    String(signal.symbol)
      .replace(/USDT$/i, '');

  const risk =
    relativeRiskFromSignal(signal);

  return placeSignedTestnetBracket({
    coin,
    side: signal.side,
    notionalUsdc:
      Math.max(
        cfg.marginUsdc * cfg.leverage,
        cfg.minNotionalUsdc
      ),
    stopPct:
      risk.stopPct,
    tpPct:
      risk.tpPct
  });
}

export async function placeManualSignedTestnet({
  coin,
  side
}) {
  const cfg = hyperConfig();

  return placeSignedTestnetBracket({
    coin:
      String(coin || 'BTC').toUpperCase(),
    side:
      String(side || 'LONG').toUpperCase(),
    notionalUsdc:
      Math.max(
        cfg.marginUsdc * cfg.leverage,
        cfg.minNotionalUsdc
      ),
    stopPct: 0.01,
    tpPct: 0.015
  });
}

export function buildHyperDryRunPlan(signal) {
  const cfg = hyperConfig();

  const entry =
    Number(signal.entry || 0);

  const notional =
    Math.max(
      cfg.marginUsdc * cfg.leverage,
      cfg.minNotionalUsdc
    );

  return {
    id:
      `hyper_dry_${Date.now()}_` +
      String(signal.symbol)
        .replace(/USDT$/i, '')
        .replace(/[^A-Z0-9]/gi, ''),
    mode: 'TESTNET_DRY_RUN',
    venue: 'Hyperliquid Testnet',
    coin:
      String(signal.symbol).replace(/USDT$/i, ''),
    symbol: signal.symbol,
    side: signal.side,
    estimatedQuantity:
      entry > 0
        ? fmtNumber(notional / entry, 8)
        : null,
    entry:
      fmtNumber(signal.entry),
    stop:
      fmtNumber(signal.stop),
    tp1:
      fmtNumber(signal.tp1),
    tp2:
      fmtNumber(signal.tp2),
    tp3:
      fmtNumber(signal.tp3),
    marginUsdc: cfg.marginUsdc,
    leverage: cfg.leverage,
    notionalUsdc:
      fmtNumber(notional, 2),
    aiConfidence:
      Number(signal.ai?.confidence || 0),
    score:
      Number(signal.score || 0),
    createdAt: Date.now()
  };
}

export function hyperStatusText({
  paused = false,
  signedArmed = false,
  totalExecutions = 0
} = {}) {
  const cfg = hyperConfig();

  return [
    '🟣 <b>Hyperliquid Testnet Executor V1.4.2</b>',
    '',
    `Executor: ${cfg.enabled ? '✅ ATIVO' : '⛔ DESATIVADO'}`,
    `API: TESTNET`,
    `Signed testnet: ${cfg.signedTestnetEnabled ? '✅ HABILITADO NO ENV' : '🔒 DESABILITADO NO ENV'}`,
    `Runtime arm: ${signedArmed ? '🔴 ARMADO' : '🟢 DESARMADO'}`,
    `Pausa manual: ${paused ? '⛔ SIM' : '✅ NÃO'}`,
    `Mainnet: 🔒 NÃO IMPLEMENTADA`,
    '',
    `💵 Margem alvo: ${cfg.marginUsdc.toFixed(2)} USDC`,
    `⚙️ Alavancagem: ${cfg.leverage}x`,
    `📦 Notional mínimo: ${cfg.minNotionalUsdc.toFixed(2)} USDC`,
    `📉 Slippage IOC: ${(cfg.slippageBps / 100).toFixed(2)}%`,
    `🤖 Confiança IA mínima: ${cfg.minAiConfidence}%`,
    `⭐ Score mínimo: ${cfg.minScore}`,
    `📌 Máx. posições simultâneas: ${cfg.maxOpenPositions}`,
    '',
    `👛 Master pública: ${cfg.walletAddress ? 'configurada' : 'não configurada'}`,
    `🔑 Agent private key: ${cfg.agentPrivateKey ? 'configurada' : 'não configurada'}`,
    `📚 Execuções registradas: ${totalExecutions}`,
    '',
    `🛡 Depois de cada deploy o executor volta DESARMADO.`
  ].join('\n');
}
