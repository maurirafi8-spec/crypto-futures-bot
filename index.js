import http from 'node:http';
import { scanMarket, signalText } from './scanner.js';
import { sendMessage, getUpdates } from './telegram.js';

const cfg = {
  token: process.env.BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID || '',
  port: Number(process.env.PORT || 3000),
  intervalMin: Number(process.env.SCAN_INTERVAL_MINUTES || 5),
  topMarkets: Number(process.env.TOP_MARKETS || 15),
  minScore: Number(process.env.MIN_SCORE || 70),
  minVolume: Number(process.env.MIN_QUOTE_VOLUME_USDT || 50_000_000),
  cooldownMin: Number(process.env.COOLDOWN_MINUTES || 90)
};

if (!cfg.token) throw new Error('BOT_TOKEN não configurado');
let activeChatId = cfg.chatId;
let updateOffset = 0;
let scanning = false;
const cooldown = new Map();

function key(s) { return `${s.symbol}:${s.side}`; }
function canAlert(s) {
  const prev = cooldown.get(key(s)) || 0;
  return Date.now() - prev >= cfg.cooldownMin * 60_000;
}
function markAlert(s) { cooldown.set(key(s), Date.now()); }

async function doScan({ forceReply = false } = {}) {
  if (scanning) return [];
  scanning = true;
  try {
    console.log(`[scan] iniciando ${new Date().toISOString()}`);
    const signals = await scanMarket({ topMarkets: cfg.topMarkets, minQuoteVolume: cfg.minVolume, minScore: cfg.minScore });
    console.log(`[scan] ${signals.length} sinais >= ${cfg.minScore}`);
    if (activeChatId) {
      const fresh = forceReply ? signals.slice(0, 5) : signals.filter(canAlert).slice(0, 5);
      if (forceReply && fresh.length === 0) await sendMessage(cfg.token, activeChatId, '🔎 Nenhum sinal atingiu o score mínimo agora.');
      for (const s of fresh) {
        await sendMessage(cfg.token, activeChatId, signalText(s));
        markAlert(s);
      }
    }
    return signals;
  } finally { scanning = false; }
}

async function handleMessage(msg) {
  const text = (msg.text || '').trim();
  if (!text.startsWith('/')) return;
  activeChatId = String(msg.chat.id);
  if (text.startsWith('/start')) {
    await sendMessage(cfg.token, activeChatId,
      '🤖 <b>Crypto Futures Scanner V1</b>\n\nComandos:\n/scan — varrer o mercado agora\n/status — ver configuração\n/top — mostrar os melhores sinais atuais');
  } else if (text.startsWith('/status')) {
    await sendMessage(cfg.token, activeChatId,
      `✅ Online\n⏱ Scan: ${cfg.intervalMin} min\n🪙 Top mercados: ${cfg.topMarkets}\n⭐ Score mínimo: ${cfg.minScore}\n💵 Volume mínimo 24h: $${Math.round(cfg.minVolume/1e6)}M\n🧊 Cooldown: ${cfg.cooldownMin} min`);
  } else if (text.startsWith('/scan') || text.startsWith('/top')) {
    await sendMessage(cfg.token, activeChatId, '🔎 Analisando Binance Futures...');
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
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'crypto-futures-scanner', scanning, time: new Date().toISOString() }));
}).listen(cfg.port, () => console.log(`HTTP :${cfg.port}`));

console.log('Crypto Futures Scanner V1 pronto ✅');
setTimeout(() => doScan().catch(console.error), 5000);
setInterval(() => doScan().catch(console.error), cfg.intervalMin * 60_000);
pollingLoop();
