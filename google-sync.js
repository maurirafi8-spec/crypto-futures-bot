const BOT_VERSION = '1.10.1-google-sync-verified';

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
}

function intEnv(name, fallback, min, max) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function cleanUrl(value) {
  const s = String(value || '').trim();
  return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(s)
    ? s
    : '';
}

export function googleSyncConfig() {
  const webhookUrl = cleanUrl(process.env.GOOGLE_SYNC_WEBHOOK_URL);
  const token = String(process.env.GOOGLE_SYNC_TOKEN || '').trim();

  return {
    enabled: boolEnv('GOOGLE_SYNC_ENABLED', true),
    webhookUrl,
    token,
    configured: Boolean(webhookUrl && token),
    timeoutMs: intEnv('GOOGLE_SYNC_TIMEOUT_MS', 8000, 1000, 30000),
    botVersion: BOT_VERSION
  };
}

const stats = {
  queued: 0,
  sent: 0,
  ok: 0,
  failed: 0,
  skipped: 0,
  lastEvent: null,
  lastOkAt: 0,
  lastError: ''
};

let queue = Promise.resolve();

async function sendEvent(event, payload = {}) {
  const cfg = googleSyncConfig();
  stats.lastEvent = String(event || 'UNKNOWN');

  if (!cfg.enabled) {
    stats.skipped += 1;
    return { ok: false, skipped: true, reason: 'GOOGLE_SYNC_ENABLED=false' };
  }

  if (!cfg.configured) {
    stats.skipped += 1;
    return {
      ok: false,
      skipped: true,
      reason: 'GOOGLE_SYNC_WEBHOOK_URL/GOOGLE_SYNC_TOKEN não configurados'
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    stats.sent += 1;

    const response = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: cfg.token,
        source: 'crypto-futures-bot',
        version: cfg.botVersion,
        event: String(event || 'UNKNOWN'),
        eventAt: Date.now(),
        payload
      }),
      signal: controller.signal
    });

    const raw = await response.text();
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw: raw.slice(0, 500) };
    }

    if (
      !response.ok ||
      parsed?.ok === false ||
      parsed?.written !== true
    ) {
      throw new Error(
        `HTTP ${response.status}: ${String(
          parsed?.error ||
          parsed?.message ||
          (!parsed?.written
            ? 'webhook respondeu OK mas NÃO confirmou gravação (written=true ausente)'
            : raw)
        ).slice(0, 400)}`
      );
    }

    stats.ok += 1;
    stats.lastOkAt = Date.now();
    stats.lastError = '';

    return { ok: true, status: response.status, response: parsed };
  } catch (error) {
    stats.failed += 1;
    stats.lastError = String(error?.message || error).slice(0, 500);
    console.error('[google-sync]', stats.lastError);
    return { ok: false, error: stats.lastError };
  } finally {
    clearTimeout(timeout);
  }
}

export function googleSyncEvent(event, payload = {}) {
  stats.queued += 1;

  const task = queue.then(() => sendEvent(event, payload));

  queue = task
    .catch(() => null)
    .then(() => {
      stats.queued = Math.max(0, stats.queued - 1);
    });

  return task;
}

export function googleSyncStats() {
  return {
    ...stats,
    config: {
      ...googleSyncConfig(),
      token: googleSyncConfig().token ? 'CONFIGURADO' : ''
    }
  };
}

function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toISOString().replace('T', ' ').replace('Z', ' UTC');
}

export function googleSyncStatusText() {
  const cfg = googleSyncConfig();

  return [
    '☁️ <b>GOOGLE SYNC — V1.10.1</b>',
    '',
    `Status: ${!cfg.enabled ? '⛔ DESATIVADO' : cfg.configured ? '✅ CONFIGURADO' : '🟡 AGUARDANDO CONFIGURAÇÃO'}`,
    `📊 Sheets + Drive: ${cfg.configured ? 'PRONTO' : 'webhook/token pendentes'}`,
    `📤 Enviados: ${stats.sent} · ✅ ${stats.ok} · ❌ ${stats.failed} · ⏭ ${stats.skipped}`,
    `🧺 Fila: ${stats.queued}`,
    `🕐 Último OK: ${fmtTime(stats.lastOkAt)}`,
    `⚠️ Último erro: ${stats.lastError || '—'}`,
    '',
    '<i>Falha no Google não bloqueia scanner nem PAPER.</i>'
  ].join('\n');
}
