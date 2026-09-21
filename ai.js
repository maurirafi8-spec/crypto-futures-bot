const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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
    'Você é a segunda camada de validação de um scanner de futuros de criptomoedas.',
    'Sua função é FILTRAR sinais e watchlists; não invente dados ausentes e não tente maximizar quantidade de operações.',
    'Avalie confluência multi-timeframe, volume, Open Interest, funding, RSI, MACD, distância do stop e contexto do BTC.',
    'Existem dois tiers: STANDARD e PRE_CANDIDATE.',
    'STANDARD já passou pelo filtro técnico e pode receber APPROVE, WATCH, WAIT ou REJECT.',
    'PRE_CANDIDATE tem score abaixo do mínimo de entrada e NUNCA pode receber APPROVE.',
    'Para PRE_CANDIDATE use WATCH se vale acompanhar porque está perto de confirmar; WAIT se ainda falta confirmação clara; REJECT se está fraco ou contraditório.',
    'WATCH significa apenas observação, nunca entrada.',
    'APPROVE somente quando um STANDARD estiver coerente com o conjunto dos dados.',
    'WAIT quando a ideia for plausível, mas faltarem confirmação/participação ou houver sinais mistos.',
    'REJECT quando houver contradição relevante, risco assimétrico ruim ou contexto oposto.',
    'Não altere o lado candidato. Se você preferir a direção oposta, use REJECT.',
    'Retorne SOMENTE JSON válido, sem markdown.',
    'Formato obrigatório:',
    '{"decision":"APPROVE|WATCH|WAIT|REJECT","confidence":0-100,"risk":"LOW|MEDIUM|HIGH","style":"SCALP|NORMAL","reason":"frase curta em português","warnings":["item curto"]}'
  ].join(' ');
}

function parseJson(content) {
  if (!content) throw new Error('Resposta vazia da IA');

  let raw = String(content).trim();

  raw = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');

  if (first !== -1 && last !== -1 && last > first) {
    raw = raw.slice(first, last + 1);
  }

  const obj = JSON.parse(raw);

  const decision = String(obj.decision || '').toUpperCase();
  if (!['APPROVE', 'WATCH', 'WAIT', 'REJECT'].includes(decision)) {
    throw new Error(`Decisão inválida da IA: ${decision || 'vazia'}`);
  }

  const risk = String(obj.risk || 'MEDIUM').toUpperCase();
  const style = String(obj.style || 'NORMAL').toUpperCase();

  return {
    decision,
    confidence: clamp(Number(obj.confidence) || 0, 0, 100),
    risk: ['LOW', 'MEDIUM', 'HIGH'].includes(risk) ? risk : 'MEDIUM',
    style: ['SCALP', 'NORMAL'].includes(style) ? style : 'NORMAL',
    reason: String(obj.reason || 'Sem justificativa').slice(0, 240),
    warnings: Array.isArray(obj.warnings)
      ? obj.warnings.map(x => String(x).slice(0, 120)).slice(0, 4)
      : []
  };
}

export function aiConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function aiModel() {
  return process.env.AI_MODEL || process.env.OPENROUTER_MODEL || 'openrouter/free';
}

export async function analyzeSignalWithAI(signal, {
  apiKey = process.env.OPENROUTER_API_KEY,
  model = aiModel(),
  timeoutMs = Number(process.env.AI_TIMEOUT_MS || 25000)
} = {}) {
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY não configurada');
  }

  const payload = buildPayload(signal);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://crypto-futures-bot.onrender.com',
        'X-Title': 'Crypto Futures Scanner V1.3.8.1 Free'
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 350,
        messages: [
          {
            role: 'system',
            content: systemPrompt()
          },
          {
            role: 'user',
            content:
              'Valide este candidato. Seja conservador e use apenas os dados fornecidos:\n' +
              JSON.stringify(payload)
          }
        ]
      }),
      signal: controller.signal
    });

    const body = await res.text();

    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = JSON.parse(body);
    const content = data?.choices?.[0]?.message?.content;
    let parsed = parseJson(content);

    // Segurança: pré-candidato nunca vira entrada, mesmo se o modelo
    // devolver APPROVE contrariando o prompt.
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
      model,
      checkedAt: Date.now()
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`IA excedeu ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
