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
      'Envia a decisão final da segunda camada de validação do sinal técnico.',
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
      tier: signal.candidateTier || 'STANDARD',
      confirmation: signal.confirmation?.label || '',
      price: num(signal.entry, 8),
      change24hPct: num(signal.change24h, 3),
      stopPct: num(stopPct, 3)
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
      fundingRatePct: num(signal.fundingRate, 5)
    },
    btcContext: signal.btcContext || null,
    deterministicReasons: (signal.reasons || []).slice(0, 6),
    technicalGateFailures: (signal.rejectionReasons || []).slice(0, 6)
  };
}

function systemPrompt() {
  return [
    'Você é a segunda camada conservadora de validação de um scanner de futuros de criptomoedas.',
    'Use SOMENTE os dados enviados.',
    'Não invente notícias, preço, indicadores ou contexto ausente.',
    'Analise confluência multi-timeframe, volume relativo, Open Interest, funding, RSI, MACD, stop e contexto do BTC.',
    'STANDARD já passou pelo filtro técnico e pode receber APPROVE, WATCH, WAIT ou REJECT.',
    'PRE_CANDIDATE tem score abaixo do mínimo e NUNCA pode receber APPROVE.',
    'WATCH é apenas observação, nunca entrada.',
    'APPROVE somente quando o conjunto estiver coerente e sem contradição relevante.',
    'WAIT quando faltar confirmação ou o movimento parecer esticado.',
    'REJECT quando houver contradição importante, assimetria ruim ou contexto contrário.',
    'Não mude o lado do candidato. Se preferir o lado oposto, use REJECT.',
    'Finalize obrigatoriamente chamando a ferramenta submit_signal_validation.'
  ].join(' ');
}

function parseJson(content) {
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    return normalizeParsed(content);
  }

  if (content == null || String(content).trim() === '') {
    throw new Error('Resposta vazia da IA');
  }

  let raw = String(content).trim();

  raw = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return normalizeParsed(JSON.parse(raw));
  } catch {
    // fallback abaixo
  }

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');

  if (first !== -1 && last !== -1 && last > first) {
    return normalizeParsed(JSON.parse(raw.slice(first, last + 1)));
  }

  throw new Error('Resposta da IA sem objeto JSON válido');
}

function normalizeParsed(obj) {
  const decision = String(obj?.decision || '').toUpperCase();

  if (!['APPROVE', 'WATCH', 'WAIT', 'REJECT'].includes(decision)) {
    throw new Error(`Decisão inválida da IA: ${decision || 'vazia'}`);
  }

  const risk = String(obj?.risk || 'MEDIUM').toUpperCase();
  const style = String(obj?.style || 'NORMAL').toUpperCase();

  return {
    decision,
    confidence: clamp(Number(obj?.confidence) || 0, 0, 100),
    risk: ['LOW', 'MEDIUM', 'HIGH'].includes(risk) ? risk : 'MEDIUM',
    style: ['SCALP', 'NORMAL'].includes(style) ? style : 'NORMAL',
    reason: String(obj?.reason || 'Sem justificativa').slice(0, 240),
    warnings: Array.isArray(obj?.warnings)
      ? obj.warnings.map(x => String(x).slice(0, 120)).slice(0, 4)
      : []
  };
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

function extractToolArguments(data) {
  const message = data?.choices?.[0]?.message || {};

  for (const tool of message?.tool_calls || []) {
    if (
      tool?.function?.name === 'submit_signal_validation' &&
      tool?.function?.arguments
    ) {
      return {
        value: tool.function.arguments,
        extractedFrom: 'tool_calls.submit_signal_validation'
      };
    }
  }

  if (
    message?.function_call?.name === 'submit_signal_validation' &&
    message?.function_call?.arguments
  ) {
    return {
      value: message.function_call.arguments,
      extractedFrom: 'function_call.submit_signal_validation'
    };
  }

  return null;
}

function extractResponseCandidates(data) {
  const out = [];
  const tool = extractToolArguments(data);

  if (tool) out.push(tool);

  const choice = data?.choices?.[0];
  const message = choice?.message || {};

  const push = (label, value) => {
    if (value == null) return;

    if (typeof value === 'object' && !Array.isArray(value)) {
      out.push({ label, value });
      return;
    }

    const text = String(value).trim();
    if (text) out.push({ label, value: text });
  };

  // Fallbacks caso algum provider ignore tool_choice.
  push('message.content', contentPartsToText(message.content));
  push('choice.text', choice?.text);
  push('data.output_text', data?.output_text);

  const seen = new Set();

  return out.filter(item => {
    const key =
      typeof item.value === 'string'
        ? item.value
        : JSON.stringify(item.value);

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseResponseData(data) {
  const candidates = extractResponseCandidates(data);

  if (!candidates.length) {
    throw new Error('Resposta vazia da IA');
  }

  const errors = [];

  for (const candidate of candidates) {
    try {
      return {
        parsed: parseJson(candidate.value),
        extractedFrom: candidate.extractedFrom || candidate.label
      };
    } catch (error) {
      errors.push(
        `${candidate.extractedFrom || candidate.label}: ${error.message}`
      );
    }
  }

  throw new Error(
    `Resposta sem decisão válida (${errors.slice(0, 3).join(' | ')})`
  );
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

  if (status != null) {
    error.status = status;
  }

  return error;
}

function reasoningEffort() {
  return String(process.env.AI_REASONING_EFFORT || 'low').toLowerCase();
}

function maxCompletionTokens(rescue = false) {
  return intEnv(
    rescue
      ? 'AI_RESCUE_MAX_COMPLETION_TOKENS'
      : 'AI_MAX_COMPLETION_TOKENS',
    rescue ? 1200 : 1500,
    128,
    8192
  );
}

async function requestOnce({
  apiKey,
  model,
  payload,
  timeoutMs,
  rescue = false
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = {
      model,
      temperature: 0,
      max_completion_tokens: maxCompletionTokens(rescue),
      reasoning: {
        effort: reasoningEffort()
      },
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
          content: systemPrompt()
        },
        {
          role: 'user',
          content:
            (rescue
              ? 'RESCUE: conclua agora a validação e chame a ferramenta obrigatória. Dados:\n'
              : 'Valide o candidato e chame a ferramenta obrigatória. Dados:\n') +
            JSON.stringify(payload)
        }
      ],
      provider: {
        allow_fallbacks: true
      }
    };

    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer':
          process.env.OPENROUTER_SITE_URL ||
          'https://crypto-futures-bot.onrender.com',
        'X-Title': 'Crypto Futures Scanner V1.3.8.3 Free'
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

    const summary = safeResponseSummary(data, rawBody);

    try {
      const extracted = parseResponseData(data);

      return {
        ...extracted,
        data,
        summary
      };
    } catch (error) {
      throw makeAiError(error.message, {
        status: res.status,
        diagnostic: summary
      });
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw makeAiError(
        `IA excedeu ${Math.round(timeoutMs / 1000)}s`,
        {
          diagnostic: rescue ? 'fase=rescue' : 'fase=primary'
        }
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function aiConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function aiModel() {
  return (
    process.env.AI_MODEL ||
    process.env.OPENROUTER_MODEL ||
    'inclusionai/ling-3.0-flash-fin:free'
  );
}

export function aiRescueModel() {
  return (
    process.env.AI_RESCUE_MODEL ||
    'nvidia/nemotron-3-ultra-550b-a55b-20260604:free'
  );
}

export function aiRescueEnabled() {
  return boolEnv('AI_RESCUE_ENABLED', true);
}

export function aiStructuredOutputEnabled() {
  // Mantido por compatibilidade com index.js antigo.
  // Nesta versão a saída estruturada é feita via tool/function calling.
  return false;
}

export function aiToolCallingEnabled() {
  return true;
}

export function aiReasoningEffort() {
  return reasoningEffort();
}

export function aiMaxCompletionTokens() {
  return maxCompletionTokens(false);
}

export function aiRescueMaxCompletionTokens() {
  return maxCompletionTokens(true);
}

export async function analyzeSignalWithAI(signal, {
  apiKey = process.env.OPENROUTER_API_KEY,
  model = aiModel(),
  timeoutMs = Number(process.env.AI_TIMEOUT_MS || 35000),
  allowRescue = true
} = {}) {
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY não configurada');
  }

  const payload = buildPayload(signal);
  let apiRequestCount = 0;
  let primaryError = null;

  try {
    apiRequestCount += 1;

    const primary = await requestOnce({
      apiKey,
      model,
      payload,
      timeoutMs,
      rescue: false
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
      responseMode: 'TOOL_CALL',
      extractedFrom: primary.extractedFrom,
      diagnosticSummary: primary.summary
    };
  } catch (error) {
    primaryError = error;

    const status = Number(error?.status || 0);
    const nonRetryable =
      status === 400 ||
      status === 401 ||
      status === 402 ||
      status === 403 ||
      status === 429;

    const rescueAllowed =
      allowRescue &&
      aiRescueEnabled() &&
      !nonRetryable;

    if (!rescueAllowed) {
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

    const rescued = await requestOnce({
      apiKey,
      model: rescueModel,
      payload,
      timeoutMs,
      rescue: true
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
      responseMode: 'TOOL_CALL_RESCUE',
      extractedFrom: rescued.extractedFrom,
      diagnosticSummary: rescued.summary,
      primaryFailure:
        String(primaryError?.message || 'falha primária')
          .replace(/\s+/g, ' ')
          .slice(0, 180)
    };
  } catch (rescueError) {
    const diagnostic = [
      `primary=${String(primaryError?.message || 'erro').replace(/\s+/g, ' ').slice(0, 180)}`,
      `rescue=${String(rescueError?.message || 'erro').replace(/\s+/g, ' ').slice(0, 180)}`
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
