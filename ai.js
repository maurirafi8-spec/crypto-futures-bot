const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SIGNAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: {
      type: 'string',
      enum: ['APPROVE', 'WATCH', 'WAIT', 'REJECT']
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 100
    },
    risk: {
      type: 'string',
      enum: ['LOW', 'MEDIUM', 'HIGH']
    },
    style: {
      type: 'string',
      enum: ['SCALP', 'NORMAL']
    },
    reason: {
      type: 'string'
    },
    warnings: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string' }
    }
  },
  required: [
    'decision',
    'confidence',
    'risk',
    'style',
    'reason',
    'warnings'
  ]
};

const VALIDATION_TOOL = {
  type: 'function',
  function: {
    name: 'submit_signal_validation',
    description:
      'Retorna a decisão final da segunda camada de validação do sinal técnico.',
    parameters: SIGNAL_SCHEMA
  }
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function num(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function sideTrend(tf) {
  if (tf?.bullish) return 'BULLISH';
  if (tf?.bearish) return 'BEARISH';
  return 'MIXED';
}

function boolEnv(name, fallback = true) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return String(raw).toLowerCase() !== 'false';
}

function intEnv(name, fallback, min = 16, max = 32768) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function buildPayload(signal) {
  const risk = Math.abs(signal.entry - signal.stop);
  const stopPct = signal.entry > 0 ? (risk / signal.entry) * 100 : 0;

  return {
    candidate: {
      symbol: signal.symbol,
      exchange: signal.exchange,
      side: signal.side,
      score: signal.score,
      longScore: signal.longScore ?? null,
      shortScore: signal.shortScore ?? null,
      directionEdge: signal.directionEdge ?? null,
      oneHourConfirmed: Boolean(signal.oneHourConfirmed),
      btcScoreAdjustment: signal.btcScoreAdjustment ?? 0,
      tier: signal.candidateTier || 'STANDARD',
      confirmation: signal.confirmation?.label || '',
      price: num(signal.entry, 8),
      change24hPct: num(signal.change24h, 3),
      stopPct: num(stopPct, 3)
    },
    timeframe5m: {
      trend: sideTrend(signal.t5),
      rsi: num(signal.t5?.rsi, 2),
      macdHistogram: num(signal.t5?.macdHist, 8),
      volumeRatio: num(signal.t5?.volumeRatio, 3),
      priceVsEma20Pct:
        signal.t5?.ema20
          ? num(((signal.t5.price - signal.t5.ema20) / signal.t5.ema20) * 100, 3)
          : null,
      ema20VsEma50Pct:
        signal.t5?.ema50
          ? num(((signal.t5.ema20 - signal.t5.ema50) / signal.t5.ema50) * 100, 3)
          : null
    },
    timeframe15m: {
      trend: sideTrend(signal.t15),
      rsi: num(signal.t15?.rsi, 2),
      macdHistogram: num(signal.t15?.macdHist, 8),
      volumeRatio: num(signal.t15?.volumeRatio, 3),
      priceVsEma20Pct:
        signal.t15?.ema20
          ? num(((signal.t15.price - signal.t15.ema20) / signal.t15.ema20) * 100, 3)
          : null,
      ema20VsEma50Pct:
        signal.t15?.ema50
          ? num(((signal.t15.ema20 - signal.t15.ema50) / signal.t15.ema50) * 100, 3)
          : null
    },
    timeframe1h: {
      trend: sideTrend(signal.t1h),
      rsi: num(signal.t1h?.rsi, 2),
      macdHistogram: num(signal.t1h?.macdHist, 8),
      volumeRatio: num(signal.t1h?.volumeRatio, 3)
    },
    timeframe4h: {
      trend: sideTrend(signal.t4h),
      rsi: num(signal.t4h?.rsi, 2),
      macdHistogram: num(signal.t4h?.macdHist, 8),
      volumeRatio: num(signal.t4h?.volumeRatio, 3)
    },
    derivatives: {
      openInterestChangePct: num(signal.oiPct, 3),
      fundingRatePct:
        signal.fundingRate == null
          ? null
          : num(signal.fundingRate, 5)
    },
    btcContext: signal.btcContext || null,
    deterministicReasons: (signal.reasons || []).slice(0, 6),
    technicalGateFailures: (signal.rejectionReasons || []).slice(0, 6)
  };
}

function systemPrompt() {
  return [
    'Você é a segunda camada conservadora de validação de um scanner de futuros de criptomoedas.',
    'Use somente os dados enviados.',
    'Não invente notícias, preços ou indicadores.',
    'Este scanner está em modo SCALP: duração esperada de aproximadamente 15 minutos a 3 horas.',
    'Dê maior peso para 5m, 15m e 1h. Use 4h apenas como contexto e risco, sem exigir alinhamento perfeito.',
    'Trate LONG e SHORT de forma totalmente simétrica. Não favoreça LONG por padrão.',
    'O lado enviado já passou por um placar LONG x SHORT; confirme se 1h sustenta esse lado.',
    'Considere o contexto BTC: se 1H e 4H do BTC estiverem claramente contrários ao lado da altcoin, exija evidência excepcional.',
    'Não aprove entrada perseguindo candle já esticado; prefira pullback/reteste com momentum ainda válido.',
    'Para APPROVE, dê preferência a volume, OI e MACD confirmando juntos. Se momentum estiver incompleto, use WAIT/REJECT.',
    'Analise confluência multi-timeframe, volume relativo, Open Interest, RSI, MACD, stop e contexto do BTC. Funding pode estar ausente.',
    'STANDARD pode receber APPROVE, WATCH, WAIT ou REJECT.',
    'PRE_CANDIDATE nunca pode receber APPROVE.',
    'WATCH é somente observação, nunca entrada.',
    'APPROVE apenas quando o conjunto estiver coerente e sem contradição relevante.',
    'WAIT quando faltar confirmação, houver esticamento ou sinais mistos.',
    'REJECT quando houver contradição importante, risco ruim ou contexto contrário.',
    'Não mude o lado do candidato. Se preferir o lado oposto, use REJECT.'
  ].join(' ');
}

function jsonOnlyPrompt(payload) {
  return [
    systemPrompt(),
    'Retorne SOMENTE um objeto JSON válido, sem markdown e sem texto extra.',
    'Formato obrigatório:',
    '{"decision":"APPROVE|WATCH|WAIT|REJECT","confidence":0,"risk":"LOW|MEDIUM|HIGH","style":"SCALP|NORMAL","reason":"texto curto","warnings":[]}',
    'Dados:',
    JSON.stringify(payload)
  ].join('\n');
}

function parseJson(content) {
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    return normalizeParsed(content);
  }

  if (content == null || String(content).trim() === '') {
    throw new Error('Resposta vazia da IA');
  }

  let raw = String(content).trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return normalizeParsed(JSON.parse(raw));
  } catch {
    // tenta extrair o primeiro objeto aparente
  }

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');

  if (first !== -1 && last !== -1 && last > first) {
    return normalizeParsed(JSON.parse(raw.slice(first, last + 1)));
  }

  throw new Error('Resposta da IA sem objeto JSON válido');
}

function normalizeParsed(obj) {
  const rawDecision =
    String(obj?.decision || '').toUpperCase();

  if (!['APPROVE', 'WATCH', 'WAIT', 'REJECT'].includes(rawDecision)) {
    throw new Error(
      `Decisão inválida da IA: ${rawDecision || 'vazia'}`
    );
  }

  const risk =
    String(obj?.risk || 'MEDIUM').toUpperCase();

  const style =
    String(obj?.style || 'NORMAL').toUpperCase();

  const rawConfidence =
    obj?.confidence;

  const confidenceNumber =
    Number(rawConfidence);

  const confidencePresent =
    rawConfidence !== null &&
    rawConfidence !== undefined &&
    String(rawConfidence).trim() !== '';

  const confidenceValid =
    confidencePresent &&
    Number.isFinite(confidenceNumber) &&
    confidenceNumber >= 0 &&
    confidenceNumber <= 100;

  let decision =
    rawDecision;

  let confidence =
    confidenceValid
      ? clamp(confidenceNumber, 0, 100)
      : null;

  let reason =
    String(
      obj?.reason ||
      'Sem justificativa'
    ).slice(0, 240);

  const warnings =
    Array.isArray(obj?.warnings)
      ? obj.warnings
          .map(x => String(x).slice(0, 120))
          .slice(0, 4)
      : [];

  let confidenceGuarded = false;

  // V1.5.9 CONFIDENCE GUARD:
  // APPROVE sem confidence válida (ou contraditório APPROVE 0%)
  // nunca é aceito como aprovação.
  if (
    decision === 'APPROVE' &&
    (
      !confidenceValid ||
      confidence <= 0
    )
  ) {
    decision = 'WAIT';
    confidence = null;
    confidenceGuarded = true;

    reason = (
      'APPROVE bloqueado: confidence ausente/inválida. ' +
      reason
    ).slice(0, 240);

    if (
      !warnings.some(
        x =>
          String(x)
            .toLowerCase()
            .includes('confidence')
      )
    ) {
      warnings.unshift(
        'confidence ausente/inválida; entrada bloqueada'
      );
    }
  }

  return {
    decision,
    confidence,
    confidenceValid:
      confidenceValid &&
      !confidenceGuarded,
    confidenceGuarded,
    originalDecision:
      confidenceGuarded
        ? rawDecision
        : null,
    risk:
      ['LOW', 'MEDIUM', 'HIGH'].includes(risk)
        ? risk
        : 'MEDIUM',
    style:
      ['SCALP', 'NORMAL'].includes(style)
        ? style
        : 'NORMAL',
    reason,
    warnings:
      warnings.slice(0, 4)
  };
}

// Exportado para smoke test e diagnóstico.
// A lógica usada aqui é exatamente a mesma usada nas respostas da IA.
export function normalizeAIResponse(obj) {
  return normalizeParsed(obj);
}

function contentPartsToText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  return content
    .map(part => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      if (typeof part.value === 'string') return part.value;
      if (typeof part?.text?.value === 'string') return part.text.value;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractPrimary(data) {
  const choice = data?.choices?.[0];
  const message = choice?.message || {};

  for (const tool of message?.tool_calls || []) {
    if (
      tool?.function?.name === 'submit_signal_validation' &&
      tool?.function?.arguments
    ) {
      return {
        parsed: parseJson(tool.function.arguments),
        extractedFrom: 'tool_calls.submit_signal_validation'
      };
    }
  }

  if (
    message?.function_call?.name === 'submit_signal_validation' &&
    message?.function_call?.arguments
  ) {
    return {
      parsed: parseJson(message.function_call.arguments),
      extractedFrom: 'function_call.submit_signal_validation'
    };
  }

  // Fallback defensivo se o provider ignorar tool_choice e responder texto.
  const text = contentPartsToText(message.content);

  if (text) {
    return {
      parsed: parseJson(text),
      extractedFrom: 'message.content'
    };
  }

  throw new Error('Resposta vazia da IA');
}

function extractRescue(data) {
  const choice = data?.choices?.[0];
  const message = choice?.message || {};
  const text = contentPartsToText(message.content);

  if (!text) {
    throw new Error('Resposta vazia da IA rescue');
  }

  return {
    parsed: parseJson(text),
    extractedFrom: 'message.content.json'
  };
}

function safeResponseSummary(data, bodyText = '') {
  const choice = data?.choices?.[0];
  const message = choice?.message || {};
  const content = message?.content;

  let contentKind = typeof content;
  let contentSize = 0;

  if (typeof content === 'string') {
    contentKind = 'string';
    contentSize = content.length;
  } else if (Array.isArray(content)) {
    contentKind = 'array';
    contentSize = content.length;
  } else if (content == null) {
    contentKind = 'null';
  }

  const reasoningCount = Array.isArray(message?.reasoning_details)
    ? message.reasoning_details.length
    : message?.reasoning
      ? 1
      : 0;

  const toolCount = Array.isArray(message?.tool_calls)
    ? message.tool_calls.length
    : 0;

  const usage = data?.usage || {};

  return [
    `model=${String(data?.model || '—').slice(0, 90)}`,
    `provider=${String(data?.provider || '—').slice(0, 60)}`,
    `finish=${String(choice?.finish_reason || '—').slice(0, 40)}`,
    `choices=${Array.isArray(data?.choices) ? data.choices.length : 0}`,
    `content=${contentKind}:${contentSize}`,
    `tools=${toolCount}`,
    `reasoning=${reasoningCount}`,
    `completion_tokens=${Number(usage?.completion_tokens || 0)}`,
    `body=${bodyText ? bodyText.length : 0} chars`
  ].join(', ');
}

function makeAiError(message, {
  apiRequestCount = 1,
  rescueUsed = false,
  diagnostic = '',
  status = null
} = {}) {
  const full = diagnostic
    ? `${message} [${diagnostic}]`
    : message;

  const error = new Error(full);
  error.apiRequestCount = apiRequestCount;
  error.rescueUsed = rescueUsed;
  error.diagnostic = diagnostic;

  if (status != null) error.status = status;

  return error;
}

function primaryMaxTokens() {
  // Novo nome para não herdar configuração antiga por engano.
  return intEnv('AI_PRIMARY_OUTPUT_TOKENS', 2048, 256, 8192);
}

function rescueMaxTokens() {
  return intEnv('AI_JSON_RESCUE_OUTPUT_TOKENS', 1024, 128, 4096);
}

function fastMaxTokens() {
  return intEnv('AI_FAST_OUTPUT_TOKENS', 768, 128, 4096);
}

async function fetchOpenRouter({ apiKey, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer':
          process.env.OPENROUTER_SITE_URL ||
          'https://crypto-futures-bot.onrender.com',
        'X-Title': 'Crypto Futures Scanner V1.7.1 Free'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const rawBody = await res.text();

    let data = null;

    try {
      data = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      throw makeAiError(
        `OpenRouter retornou corpo não-JSON (HTTP ${res.status})`,
        {
          status: res.status,
          diagnostic: `body=${rawBody.length} chars`
        }
      );
    }

    if (!res.ok) {
      const msg =
        data?.error?.message ||
        data?.message ||
        rawBody.slice(0, 220) ||
        'erro sem mensagem';

      throw makeAiError(
        `OpenRouter ${res.status}: ${String(msg).slice(0, 220)}`,
        {
          status: res.status,
          diagnostic: safeResponseSummary(data, rawBody)
        }
      );
    }

    return { data, rawBody };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw makeAiError(
        `IA excedeu ${Math.round(timeoutMs / 1000)}s`
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestPrimary({
  apiKey,
  model,
  payload,
  timeoutMs
}) {
  // IMPORTANTE: não enviamos reasoning.
  // A tarefa é classificação estruturada curta; queremos chegar ao tool call
  // sem gastar o orçamento da conclusão em raciocínio oculto.
  const body = {
    model,
    temperature: 0,
    max_completion_tokens: primaryMaxTokens(),
    tools: [VALIDATION_TOOL],
    tool_choice: {
      type: 'function',
      function: {
        name: 'submit_signal_validation'
      }
    },
    messages: [
      {
        role: 'system',
        content:
          systemPrompt() +
          ' Prefira chamar submit_signal_validation. Se o provedor não conseguir tool calling, responda SOMENTE com um JSON válido no mesmo formato da ferramenta, sem markdown.'
      },
      {
        role: 'user',
        content:
          'Valide este candidato. Chame a ferramenta; se tool calling não estiver disponível, devolva somente JSON puro:\n' +
          JSON.stringify(payload)
      }
    ],
    provider: {
      allow_fallbacks: true
    }
  };

  const { data, rawBody } = await fetchOpenRouter({
    apiKey,
    body,
    timeoutMs
  });

  const summary = safeResponseSummary(data, rawBody);
  const finish = String(data?.choices?.[0]?.finish_reason || '');

  if (
    finish === 'length' &&
    !(data?.choices?.[0]?.message?.tool_calls || []).length
  ) {
    throw makeAiError(
      'Modelo atingiu o limite antes de entregar o tool call',
      {
        status: 200,
        diagnostic: summary
      }
    );
  }

  try {
    const extracted = extractPrimary(data);
    return {
      ...extracted,
      data,
      summary
    };
  } catch (error) {
    throw makeAiError(error.message, {
      status: 200,
      diagnostic: summary
    });
  }
}

async function requestRescue({
  apiKey,
  model,
  fallbackModels = [],
  payload,
  timeoutMs,
  maxTokens = rescueMaxTokens(),
  disableReasoning = false,
  label = 'rescue'
}) {
  // Caminho JSON sem tool calling.
  // Gemma aceita structured JSON e thinking configurável.
  // Para o router openrouter/free não forçamos reasoning=none,
  // porque o router pode escolher um modelo cujo reasoning seja obrigatório.
  const modelChain = [
    model,
    ...fallbackModels
  ].filter(Boolean);

  const body = {
    temperature: 0,
    max_tokens: maxTokens,
    response_format: {
      type: 'json_object'
    },
    messages: [
      {
        role: 'system',
        content:
          systemPrompt() +
          ` Esta é uma tentativa ${label}. ` +
          'Responda somente JSON válido e seja extremamente conciso.'
      },
      {
        role: 'user',
        content: jsonOnlyPrompt(payload)
      }
    ],
    provider: {
      allow_fallbacks: true
    }
  };

  if (modelChain.length > 1) {
    body.models = modelChain;
  } else {
    body.model = model;
  }

  if (disableReasoning) {
    body.reasoning = {
      effort: 'none'
    };
  }

  const { data, rawBody } = await fetchOpenRouter({
    apiKey,
    body,
    timeoutMs
  });

  const summary = safeResponseSummary(data, rawBody);
  const finish = String(data?.choices?.[0]?.finish_reason || '');

  if (finish === 'length') {
    throw makeAiError(
      `${label} atingiu o limite de saída`,
      {
        status: 200,
        diagnostic: summary
      }
    );
  }

  try {
    const extracted = extractRescue(data);
    return {
      ...extracted,
      data,
      summary
    };
  } catch (error) {
    throw makeAiError(error.message, {
      status: 200,
      diagnostic: summary
    });
  }
}

export function aiConfigured() {
  return Boolean(
    process.env.OPENROUTER_API_KEY ||
    process.env.GEMINI_API_KEY
  );
}

export function aiModel() {
  return (
    process.env.AI_MODEL ||
    process.env.OPENROUTER_MODEL ||
    'inclusionai/ling-3.0-flash-fin:free'
  );
}

export function aiFastModel() {
  // Modelo rápido para SCALP_FORTE / SUPER_SCALP.
  // Usa JSON estruturado em vez de tool call.
  return (
    process.env.AI_FAST_MODEL ||
    'google/gemma-4-31b-it:free'
  );
}

export function aiRescueModel() {
  return (
    process.env.AI_JSON_RESCUE_MODEL ||
    'google/gemma-4-31b-it:free'
  );
}

export function aiFreeFallbackModel() {
  return (
    process.env.AI_FREE_FALLBACK_MODEL ||
    'openrouter/free'
  );
}

export function geminiFallbackConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function geminiFallbackModel() {
  return (
    process.env.GEMINI_FALLBACK_MODEL ||
    'gemini-3.5-flash-lite'
  );
}

function geminiFallbackMaxTokens() {
  return intEnv(
    'GEMINI_FALLBACK_MAX_TOKENS',
    768,
    128,
    4096
  );
}

// Circuit breaker em memória para não continuar desperdiçando
// chamadas OpenRouter depois de "free-models-per-day".
let openRouterBlockedUntil = 0;
let openRouterBlockReason = '';

function openRouterCircuitInfo() {
  const remainingMs =
    Math.max(
      0,
      openRouterBlockedUntil - Date.now()
    );

  return {
    blocked: remainingMs > 0,
    remainingMin:
      Math.ceil(remainingMs / 60_000),
    reason:
      remainingMs > 0
        ? openRouterBlockReason
        : ''
  };
}

export function openRouterCircuitStatus() {
  return openRouterCircuitInfo();
}

function armOpenRouterCircuit(error) {
  const status =
    Number(error?.status || 0);

  const message =
    [
      error?.message,
      error?.diagnostic
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

  if (status !== 429) {
    return;
  }

  const dailyQuota =
    message.includes('free-models-per-day') ||
    message.includes('per day') ||
    message.includes('daily');

  const cooldownMin =
    dailyQuota
      ? intEnv(
          'OPENROUTER_DAILY_429_COOLDOWN_MINUTES',
          720,
          30,
          1440
        )
      : intEnv(
          'OPENROUTER_429_COOLDOWN_MINUTES',
          10,
          1,
          120
        );

  openRouterBlockedUntil =
    Date.now() +
    cooldownMin * 60_000;

  openRouterBlockReason =
    dailyQuota
      ? 'cota diária gratuita OpenRouter atingida'
      : 'OpenRouter 429 temporário';
}

export function aiRescueEnabled() {
  return boolEnv('AI_RESCUE_ENABLED', true);
}

export function aiToolCallingEnabled() {
  return true;
}

export function aiReasoningMode() {
  return 'DESATIVADO';
}

export function aiPrimaryMaxTokens() {
  return primaryMaxTokens();
}

export function aiRescueMaxTokens() {
  return rescueMaxTokens();
}

export function aiFastMaxTokens() {
  return fastMaxTokens();
}

function geminiErrorMessage(data, rawBody, status) {
  const apiMessage =
    data?.error?.message ||
    data?.message ||
    '';

  const text =
    String(
      apiMessage ||
      rawBody ||
      `HTTP ${status}`
    )
      .replace(/\s+/g, ' ')
      .trim();

  return text.slice(0, 700);
}

async function fetchGemini({
  apiKey,
  model,
  payload,
  timeoutMs
}) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              jsonOnlyPrompt(payload) +
              '\nDecida apenas com os dados enviados. ' +
              'Não invente preços, indicadores ou contexto ausente.'
          }
        ]
      }
    ],
    generationConfig: {
      maxOutputTokens:
        geminiFallbackMaxTokens(),
      responseMimeType:
        'application/json'
    }
  };

  try {
    const response =
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
          'x-goog-api-key':
            apiKey
        },
        body:
          JSON.stringify(body),
        signal:
          controller.signal
      });

    const rawBody =
      await response.text();

    let data = null;

    try {
      data =
        rawBody
          ? JSON.parse(rawBody)
          : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw makeAiError(
        `Gemini HTTP ${response.status}: ` +
        geminiErrorMessage(
          data,
          rawBody,
          response.status
        ),
        {
          status:
            response.status,
          diagnostic:
            geminiErrorMessage(
              data,
              rawBody,
              response.status
            )
        }
      );
    }

    const candidate =
      data?.candidates?.[0];

    const text =
      (candidate?.content?.parts || [])
        .map(part => part?.text || '')
        .join('')
        .trim();

    if (!text) {
      throw makeAiError(
        'Gemini retornou resposta vazia',
        {
          status: 200,
          diagnostic:
            `finish=${candidate?.finishReason || '—'}`
        }
      );
    }

    const parsed =
      parseJson(text);

    return {
      parsed,
      data,
      rawText: text,
      finishReason:
        candidate?.finishReason || null
    };
  } catch (error) {
    if (
      error?.name === 'AbortError'
    ) {
      throw makeAiError(
        'Gemini timeout',
        {
          status: 408,
          diagnostic:
            `timeout=${timeoutMs}ms`
        }
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function analyzeSignalWithGemini(
  signal,
  {
    timeoutMs =
      Number(
        process.env.GEMINI_TIMEOUT_MS ||
        process.env.AI_TIMEOUT_MS ||
        35000
      ),
    callMode = 'NORMAL',
    previousError = null,
    previousRequestCount = 0
  } = {}
) {
  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw makeAiError(
      'GEMINI_API_KEY não configurada',
      {
        apiRequestCount:
          previousRequestCount
      }
    );
  }

  const payload =
    buildPayload(signal);

  const model =
    geminiFallbackModel();

  try {
    const result =
      await fetchGemini({
        apiKey,
        model,
        payload,
        timeoutMs
      });

    let parsed =
      result.parsed;

    if (
      signal.candidateTier ===
        'PRE_CANDIDATE' &&
      parsed.decision ===
        'APPROVE'
    ) {
      parsed = {
        ...parsed,
        decision: 'WATCH',
        reason:
          `Pré-candidato: ${parsed.reason}`
            .slice(0, 240)
      };
    }

    return {
      ...parsed,
      model,
      provider:
        'google-gemini',
      checkedAt:
        Date.now(),
      apiRequestCount:
        previousRequestCount + 1,
      rescueUsed:
        Boolean(previousError),
      geminiFallbackUsed:
        true,
      responseMode:
        `${callMode}_GEMINI_FALLBACK`,
      extractedFrom:
        'gemini-json',
      diagnosticSummary:
        `Gemini ${model} · finish=` +
        `${result.finishReason || '—'}`,
      primaryFailure:
        previousError
          ? String(
              previousError?.message ||
              'falha OpenRouter'
            )
              .replace(/\s+/g, ' ')
              .slice(0, 190)
          : undefined
    };
  } catch (error) {
    const previous =
      previousError
        ? String(
            previousError?.message ||
            previousError
          )
            .replace(/\s+/g, ' ')
            .slice(0, 220)
        : '';

    const gemini =
      String(
        error?.message ||
        error
      )
        .replace(/\s+/g, ' ')
        .slice(0, 220);

    throw makeAiError(
      previousError
        ? 'OpenRouter e Gemini falharam'
        : 'Gemini fallback falhou',
      {
        apiRequestCount:
          previousRequestCount + 1,
        rescueUsed:
          Boolean(previousError),
        diagnostic:
          [
            previous
              ? `openrouter=${previous}`
              : '',
            `gemini=${gemini}`
          ]
            .filter(Boolean)
            .join(' | '),
        status:
          error?.status
      }
    );
  }
}

function shouldUseGeminiAfter(error) {
  if (!geminiFallbackConfigured()) {
    return false;
  }

  const status =
    Number(error?.status || 0);

  const text =
    [
      error?.message,
      error?.diagnostic
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

  if (
    status === 401 ||
    status === 402 ||
    status === 403
  ) {
    return false;
  }

  const providerOrTransportFailure =
    status === 429 ||
    status === 408 ||
    status >= 500 ||
    status === 0 ||
    text.includes('rate limit') ||
    text.includes('free-models-per-day') ||
    text.includes('timeout') ||
    text.includes('fetch failed');

  const unusableModelResponse =
    text.includes('finish=length') ||
    text.includes('finish = length') ||
    text.includes('atingiu o limite') ||
    text.includes('limite antes de entregar') ||
    text.includes('tool call') ||
    text.includes('tools=0') ||
    text.includes('resposta vazia') ||
    text.includes('conteúdo vazio') ||
    text.includes('content=null') ||
    text.includes('parser') ||
    text.includes('parse') ||
    text.includes('json inválido') ||
    text.includes('json invalido') ||
    text.includes('decisão inválida') ||
    text.includes('decisao invalida') ||
    text.includes('invalid decision') ||
    text.includes('choices=0');

  return (
    providerOrTransportFailure ||
    unusableModelResponse
  );
}

async function analyzeSignalWithOpenRouter(signal, {
  apiKey = process.env.OPENROUTER_API_KEY,
  model = aiModel(),
  timeoutMs = Number(process.env.AI_TIMEOUT_MS || 35000),
  allowRescue = true,
  callMode = 'NORMAL'
} = {}) {
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY não configurada');
  }

  const payload = buildPayload(signal);
  let apiRequestCount = 0;
  let primaryError = null;

  const fastMode =
    callMode === 'SUPER_SCALP' ||
    callMode === 'SCALP_STRONG';

  // V1.5.5:
  // Setups rápidos não passam pelo tool call do Ling como primeira opção.
  // Eles usam Gemma em JSON direto, com reasoning desligado, para reduzir
  // o risco de consumir todo o orçamento antes de devolver a decisão.
  if (fastMode) {
    try {
      apiRequestCount += 1;

      const fastModel =
        aiFastModel();

      const fast = await requestRescue({
        apiKey,
        model: fastModel,
        fallbackModels: [
          aiFreeFallbackModel()
        ],
        payload,
        timeoutMs,
        maxTokens: fastMaxTokens(),
        disableReasoning: true,
        label: callMode
      });

      let parsed = fast.parsed;

      if (
        signal.candidateTier === 'PRE_CANDIDATE' &&
        parsed.decision === 'APPROVE'
      ) {
        parsed = {
          ...parsed,
          decision: 'WATCH',
          reason: `Pré-candidato: ${parsed.reason}`.slice(0, 240)
        };
      }

      return {
        ...parsed,
        model: fast.data?.model || fastModel,
        provider: fast.data?.provider || null,
        checkedAt: Date.now(),
        apiRequestCount,
        rescueUsed: false,
        responseMode: `${callMode}_FAST_JSON`,
        extractedFrom: fast.extractedFrom,
        diagnosticSummary: fast.summary
      };
    } catch (error) {
      primaryError = error;

      const status =
        Number(error?.status || 0);

      const nonRetryable =
        status === 401 ||
        status === 402 ||
        status === 403;

      if (
        !allowRescue ||
        !aiRescueEnabled() ||
        nonRetryable
      ) {
        throw makeAiError(
          error?.message || 'Falha na IA rápida',
          {
            apiRequestCount,
            rescueUsed: false,
            diagnostic: error?.diagnostic || '',
            status: error?.status
          }
        );
      }

      try {
        apiRequestCount += 1;

        const fallbackModel =
          aiFreeFallbackModel();

        const fallback =
          await requestRescue({
            apiKey,
            model: fallbackModel,
            payload,
            timeoutMs,
            maxTokens: rescueMaxTokens(),
            disableReasoning: false,
            label: `${callMode} backup fallback`
          });

        let parsed =
          fallback.parsed;

        if (
          signal.candidateTier === 'PRE_CANDIDATE' &&
          parsed.decision === 'APPROVE'
        ) {
          parsed = {
            ...parsed,
            decision: 'WATCH',
            reason: `Pré-candidato: ${parsed.reason}`.slice(0, 240)
          };
        }

        return {
          ...parsed,
          model:
            fallback.data?.model ||
            fallbackModel,
          provider:
            fallback.data?.provider || null,
          checkedAt: Date.now(),
          apiRequestCount,
          rescueUsed: true,
          responseMode:
            `${callMode}_FREE_ROUTER_FALLBACK`,
          extractedFrom:
            fallback.extractedFrom,
          diagnosticSummary:
            fallback.summary,
          primaryFailure:
            String(
              primaryError?.message ||
              'falha rápida primária'
            )
              .replace(/\s+/g, ' ')
              .slice(0, 190)
        };
      } catch (fallbackError) {
        const diagnostic = [
          `fast=${String(primaryError?.message || 'erro').replace(/\s+/g, ' ').slice(0, 190)}`,
          `fallback=${String(fallbackError?.message || 'erro').replace(/\s+/g, ' ').slice(0, 190)}`
        ].join(' | ');

        throw makeAiError(
          'IA rápida falhou na tentativa principal e no fallback',
          {
            apiRequestCount,
            rescueUsed: true,
            diagnostic,
            status: fallbackError?.status
          }
        );
      }
    }
  }

  try {
    apiRequestCount += 1;

    const primary = await requestPrimary({
      apiKey,
      model,
      payload,
      timeoutMs
    });

    let parsed = primary.parsed;

    if (
      signal.candidateTier === 'PRE_CANDIDATE' &&
      parsed.decision === 'APPROVE'
    ) {
      parsed = {
        ...parsed,
        decision: 'WATCH',
        reason: `Pré-candidato: ${parsed.reason}`.slice(0, 240)
      };
    }

    return {
      ...parsed,
      model: primary.data?.model || model,
      provider: primary.data?.provider || null,
      checkedAt: Date.now(),
      apiRequestCount,
      rescueUsed: false,
      responseMode: 'TOOL_CALL_NO_REASONING',
      extractedFrom: primary.extractedFrom,
      diagnosticSummary: primary.summary
    };
  } catch (error) {
    primaryError = error;

    const status = Number(error?.status || 0);

    // HTTP 200 com resposta vazia/length É retryable.
    const nonRetryable =
      status === 400 ||
      status === 401 ||
      status === 402 ||
      status === 403 ||
      status === 429;

    // 404 "No endpoints found..." pode ser específico do conjunto
    // modelo/parâmetros/provedor. Nessa situação o rescue usa outro
    // modelo e outro formato, então vale tentar.


    if (
      !allowRescue ||
      !aiRescueEnabled() ||
      nonRetryable
    ) {
      throw makeAiError(
        error?.message || 'Falha na IA',
        {
          apiRequestCount,
          rescueUsed: false,
          diagnostic: error?.diagnostic || '',
          status: error?.status
        }
      );
    }
  }

  try {
    apiRequestCount += 1;

    const rescueModel = aiRescueModel();

    const rescued = await requestRescue({
      apiKey,
      model: rescueModel,
      fallbackModels: [
        aiFreeFallbackModel()
      ],
      payload,
      timeoutMs,
      maxTokens: rescueMaxTokens(),
      disableReasoning: true,
      label: 'rescue normal'
    });

    let parsed = rescued.parsed;

    if (
      signal.candidateTier === 'PRE_CANDIDATE' &&
      parsed.decision === 'APPROVE'
    ) {
      parsed = {
        ...parsed,
        decision: 'WATCH',
        reason: `Pré-candidato: ${parsed.reason}`.slice(0, 240)
      };
    }

    return {
      ...parsed,
      model: rescued.data?.model || rescueModel,
      provider: rescued.data?.provider || null,
      checkedAt: Date.now(),
      apiRequestCount,
      rescueUsed: true,
      responseMode: 'JSON_OBJECT_RESCUE',
      extractedFrom: rescued.extractedFrom,
      diagnosticSummary: rescued.summary,
      primaryFailure:
        String(primaryError?.message || 'falha primária')
          .replace(/\s+/g, ' ')
          .slice(0, 190)
    };
  } catch (rescueError) {
    const diagnostic = [
      `primary=${String(primaryError?.message || 'erro').replace(/\s+/g, ' ').slice(0, 190)}`,
      `rescue=${String(rescueError?.message || 'erro').replace(/\s+/g, ' ').slice(0, 190)}`
    ].join(' | ');

    throw makeAiError(
      'IA falhou na tentativa principal e no rescue',
      {
        apiRequestCount,
        rescueUsed: true,
        diagnostic,
        status: rescueError?.status
      }
    );
  }
}


export async function analyzeSignalWithAI(
  signal,
  options = {}
) {
  const openRouterKey =
    options.apiKey !== undefined
      ? options.apiKey
      : process.env.OPENROUTER_API_KEY;

  const callMode =
    options.callMode ||
    'NORMAL';

  const timeoutMs =
    Number(
      options.timeoutMs ||
      process.env.AI_TIMEOUT_MS ||
      35000
    );

  const circuit =
    openRouterCircuitInfo();

  // Se a cota diária do OpenRouter já estourou neste processo,
  // vai direto ao Gemini em vez de perder tempo em novos 429.
  if (
    circuit.blocked &&
    geminiFallbackConfigured()
  ) {
    return analyzeSignalWithGemini(
      signal,
      {
        timeoutMs,
        callMode,
        previousError:
          makeAiError(
            circuit.reason,
            {
              status: 429,
              diagnostic:
                `circuit-breaker ${circuit.remainingMin}min`
            }
          ),
        previousRequestCount: 0
      }
    );
  }

  if (!openRouterKey) {
    if (geminiFallbackConfigured()) {
      return analyzeSignalWithGemini(
        signal,
        {
          timeoutMs,
          callMode,
          previousRequestCount: 0
        }
      );
    }

    throw new Error(
      'OPENROUTER_API_KEY e GEMINI_API_KEY não configuradas'
    );
  }

  try {
    return await analyzeSignalWithOpenRouter(
      signal,
      {
        ...options,
        apiKey:
          openRouterKey,
        timeoutMs,
        callMode
      }
    );
  } catch (error) {
    armOpenRouterCircuit(
      error
    );

    if (
      !shouldUseGeminiAfter(error)
    ) {
      throw error;
    }

    console.log(
      `[ai] fallback Gemini acionado após OpenRouter: ` +
      `${String(error?.message || 'falha desconhecida').replace(/\s+/g, ' ').slice(0, 220)}`
    );

    return analyzeSignalWithGemini(
      signal,
      {
        timeoutMs,
        callMode,
        previousError:
          error,
        previousRequestCount:
          Number(
            error?.apiRequestCount ||
            1
          )
      }
    );
  }
}

// ============================================================
// V1.6.8 HOLD AI
// ============================================================
function parseLooseJson(content) {
  if (content && typeof content === 'object' && !Array.isArray(content)) return content;
  if (content == null || String(content).trim() === '') throw new Error('Resposta HOLD vazia');
  const raw = String(content).trim().replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/i,'').trim();
  try { return JSON.parse(raw); } catch {}
  const first=raw.indexOf('{'), lastIndex=raw.lastIndexOf('}');
  if(first!==-1 && lastIndex>first) return JSON.parse(raw.slice(first,lastIndex+1));
  throw new Error('Resposta HOLD sem JSON válido');
}

function normalizeHoldAiResponse(obj, requestedAssets) {
  const actions=new Set(['BUY_NOW','ACCUMULATE','WAIT_CORRECTION','AVOID']);
  const risks=new Set(['LOW','MEDIUM','HIGH']);
  const wanted=new Set(requestedAssets.map(x=>String(x.symbol).toUpperCase()));
  const assets=[];
  for(const item of Array.isArray(obj?.assets)?obj.assets:[]) {
    const symbol=String(item?.symbol||'').toUpperCase();
    if(!wanted.has(symbol)) continue;
    const action=String(item?.action||'').toUpperCase();
    const risk=String(item?.risk||'').toUpperCase();
    const c=Number(item?.confidence);
    assets.push({
      symbol,
      action:actions.has(action)?action:'WAIT_CORRECTION',
      confidence:Number.isFinite(c)?clamp(c,0,100):null,
      risk:risks.has(risk)?risk:'MEDIUM',
      reason:String(item?.reason||'').replace(/\s+/g,' ').trim().slice(0,240)
    });
  }
  if(!assets.length) throw new Error('IA HOLD não retornou nenhum ativo válido');
  return {summary:String(obj?.summary||'').replace(/\s+/g,' ').trim().slice(0,320),assets};
}

function holdSystemPrompt(){return [
  'Você analisa uma carteira de criptomoedas para HOLD de médio/longo prazo.',
  'Não é futures: não use alavancagem, SHORT ou stop curto de scalp.',
  'Use SOMENTE os dados técnicos enviados. Não invente notícias, fundamentos, preços ou indicadores.',
  '4H serve para timing; 1D é tendência principal; 1W é contexto estrutural.',
  'As zonas já foram calculadas deterministicamente: não altere números nem invente novas zonas.',
  'Escolha uma ação por ativo: BUY_NOW, ACCUMULATE, WAIT_CORRECTION ou AVOID.',
  'BUY_NOW = estrutura boa e timing adequado para iniciar uma parcela.',
  'ACCUMULATE = estrutura aceitável para compras parceladas nas zonas.',
  'WAIT_CORRECTION = interessante, porém esticado/misto ou com timing ruim.',
  'AVOID = estrutura 1D/1W fraca ou risco técnico alto.',
  'Confiança entre 0 e 100. Risco LOW, MEDIUM ou HIGH.',
  'Em incerteza, prefira ACCUMULATE ou WAIT_CORRECTION a BUY_NOW.'
].join(' ');}

function holdPrompt(assets){return holdSystemPrompt()+'\nRetorne SOMENTE JSON puro no formato:\n{"summary":"texto curto","assets":[{"symbol":"BTC","action":"BUY_NOW|ACCUMULATE|WAIT_CORRECTION|AVOID","confidence":0,"risk":"LOW|MEDIUM|HIGH","reason":"texto curto"}]}\nRetorne um item para cada símbolo enviado.\nDados:\n'+JSON.stringify({horizon:'medium_long_term_hold',assets});}

async function requestHoldGemini(assets,options={}){
  const apiKey=process.env.GEMINI_API_KEY;if(!apiKey)throw new Error('GEMINI_API_KEY não configurada');
  const model=process.env.HOLD_GEMINI_MODEL||geminiFallbackModel();
  const timeoutMs=Number(options.timeoutMs||process.env.HOLD_AI_TIMEOUT_MS||45000);
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:JSON.stringify({contents:[{role:'user',parts:[{text:holdPrompt(assets)}]}],generationConfig:{temperature:0,maxOutputTokens:intEnv('HOLD_GEMINI_MAX_TOKENS',2048,512,4096),responseMimeType:'application/json'}}),signal:controller.signal});
    const rawBody=await response.text();let data=null;try{data=rawBody?JSON.parse(rawBody):null;}catch{}
    if(!response.ok)throw new Error(`Gemini HOLD HTTP ${response.status}: `+String(data?.error?.message||rawBody||'erro').replace(/\s+/g,' ').slice(0,300));
    const candidate=data?.candidates?.[0];const text=(candidate?.content?.parts||[]).map(p=>p?.text||'').join('').trim();
    return {...normalizeHoldAiResponse(parseLooseJson(text),assets),source:'GEMINI',model};
  }catch(error){if(error?.name==='AbortError')throw new Error('Gemini HOLD timeout');throw error;}finally{clearTimeout(timer);}
}

async function requestHoldOpenRouter(assets,options={}){
  const apiKey=process.env.OPENROUTER_API_KEY;if(!apiKey)throw new Error('OPENROUTER_API_KEY não configurada');
  const circuit=openRouterCircuitInfo();if(circuit.blocked)throw new Error(`OpenRouter pausado pelo circuit breaker (${circuit.remainingMin}m)`);
  const model=process.env.HOLD_OPENROUTER_MODEL||aiRescueModel();const timeoutMs=Number(options.timeoutMs||process.env.HOLD_AI_TIMEOUT_MS||45000);
  const body={model,temperature:0,max_tokens:intEnv('HOLD_OPENROUTER_MAX_TOKENS',2048,512,4096),response_format:{type:'json_object'},messages:[{role:'system',content:holdSystemPrompt()},{role:'user',content:holdPrompt(assets)}],provider:{allow_fallbacks:true}};
  try{const {data}=await fetchOpenRouter({apiKey,body,timeoutMs});const text=contentPartsToText(data?.choices?.[0]?.message?.content);return {...normalizeHoldAiResponse(parseLooseJson(text),assets),source:'OPENROUTER',model:data?.model||model};}
  catch(error){armOpenRouterCircuit(error);throw error;}
}

export async function analyzeHoldPortfolioWithAI(assets,options={}){
  if(!Array.isArray(assets)||!assets.length)throw new Error('Carteira HOLD vazia');
  if(geminiFallbackConfigured()){
    try{return await requestHoldGemini(assets,options);}catch(geminiError){
      if(!process.env.OPENROUTER_API_KEY)throw geminiError;
      console.log(`[hold-ai] Gemini falhou; tentando OpenRouter: ${String(geminiError?.message||geminiError).replace(/\s+/g,' ').slice(0,220)}`);
      return requestHoldOpenRouter(assets,options);
    }
  }
  if(process.env.OPENROUTER_API_KEY)return requestHoldOpenRouter(assets,options);
  throw new Error('Nenhuma IA configurada para HOLD');
}
