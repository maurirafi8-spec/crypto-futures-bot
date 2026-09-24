import { futureMarkets, exchanges, ohlcvHistory } from './binance.js';
import { ema, rsi, atr, macd, pctChange } from './indicators.js';
import { analyzeHoldPortfolioWithAI } from './ai.js';

const EXCHANGE_PRIORITY = ['BINANCE', 'BYBIT', 'OKX', 'BITGET'];
const DEFAULT_HOLD_BASES = ['BTC', 'ETH', 'SOL', 'LINK', 'AVAX'];
const H4_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const cache = new Map();

function envNum(name, fallback, min, max) {
  const n = Number(process.env[name] || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function holdConfig() {
  return {
    maxAssets: Math.trunc(envNum('HOLD_MAX_ASSETS', 8, 1, 8)),
    cacheMin: envNum('HOLD_CACHE_MINUTES', 20, 1, 240),
    dailyLookbackDays: Math.trunc(envNum('HOLD_DAILY_LOOKBACK_DAYS', 500, 240, 1200)),
    fourHourLookbackDays: Math.trunc(envNum('HOLD_4H_LOOKBACK_DAYS', 180, 45, 300))
  };
}

export function defaultHoldBases() { return [...DEFAULT_HOLD_BASES]; }

export function parseHoldBases(rawText = '') {
  const cfg = holdConfig();
  const cleaned = String(rawText || '').replace(/^\/?hold(?:@\w+)?\b/i, '').trim();
  if (!cleaned) return defaultHoldBases();

  const out = [];
  const seen = new Set();
  for (const token of cleaned.split(/[\s,;|/]+/)) {
    const base = String(token || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/USDT$/, '');
    if (!base || base === 'USDT' || seen.has(base)) continue;
    seen.add(base);
    out.push(base);
    if (out.length >= cfg.maxAssets) break;
  }
  return out.length ? out : defaultHoldBases();
}

function last(arr) { return arr[arr.length - 1]; }
function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function mapHistory(history) {
  return (history || [])
    .map(k => ({
      openTime: Number(k.t) * 1000,
      open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c),
      volume: Number(k.v || 0), quoteVolume: Number(k.v || 0) * Number(k.c)
    }))
    .filter(c => Number.isFinite(c.openTime) && Number.isFinite(c.close) && c.close > 0)
    .sort((a, b) => a.openTime - b.openTime);
}

function onlyClosed(candles, intervalMs, nowMs = Date.now()) {
  return (candles || []).filter(c => c.openTime + intervalMs <= nowMs - 5000);
}

function weekBucket(openTime) {
  return Math.floor((openTime + 3 * DAY_MS) / WEEK_MS) * WEEK_MS - 3 * DAY_MS;
}

function resampleWeekly(daily) {
  const groups = new Map();
  for (const c of daily || []) {
    const bucket = weekBucket(c.openTime);
    if (!groups.has(bucket)) groups.set(bucket, { ...c, openTime: bucket });
    else {
      const g = groups.get(bucket);
      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.close = c.close;
      g.volume += c.volume;
      g.quoteVolume += c.quoteVolume;
    }
  }
  return [...groups.values()].sort((a, b) => a.openTime - b.openTime);
}

function snapshot(candles, weekly = false) {
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.quoteVolume);
  const e8 = ema(closes, 8), e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
  const rs = rsi(closes, 14), at = atr(candles, 14), mc = macd(closes);
  const c = last(candles);
  const prevVol = volumes.slice(-21, -1);
  const avgVol = prevVol.reduce((a, b) => a + b, 0) / Math.max(1, prevVol.length);

  const out = {
    openTime: c.openTime, price: c.close, high: c.high, low: c.low,
    ema8: finite(last(e8)), ema20: finite(last(e20)), ema50: finite(last(e50)), ema200: finite(last(e200)),
    rsi: finite(last(rs), 50), atr: finite(last(at), 0), macdHist: finite(last(mc.histogram), 0),
    volumeRatio: avgVol > 0 ? c.quoteVolume / avgVol : 1
  };

  if (weekly) {
    out.trend = out.ema8 && out.ema20 && out.price > out.ema8 && out.ema8 > out.ema20
      ? 'BULLISH'
      : out.ema8 && out.ema20 && out.price < out.ema8 && out.ema8 < out.ema20 ? 'BEARISH' : 'MIXED';
  } else {
    out.trend = out.ema20 && out.ema50 && out.price > out.ema20 && out.ema20 > out.ema50
      ? 'BULLISH'
      : out.ema20 && out.ema50 && out.price < out.ema20 && out.ema20 < out.ema50 ? 'BEARISH' : 'MIXED';
  }
  return out;
}

function minLow(candles, count) {
  const s = candles.slice(-count);
  return s.length ? Math.min(...s.map(c => c.low)) : null;
}
function maxHigh(candles, count) {
  const s = candles.slice(-count);
  return s.length ? Math.max(...s.map(c => c.high)) : null;
}

function uniqueSupports(values, price, atrValue) {
  const minDistance = Math.max(price * 0.012, atrValue * 0.45);
  const sorted = values.map(Number)
    .filter(v => Number.isFinite(v) && v > 0 && v <= price * 1.005)
    .sort((a, b) => b - a);
  const out = [];
  for (const value of sorted) {
    if (out.every(x => Math.abs(x - value) >= minDistance)) out.push(value);
    if (out.length >= 3) break;
  }
  return out;
}

function buildBuyZones({ price, daily, h4, dailyCandles }) {
  const atrValue = Math.max(daily.atr || 0, price * 0.015);
  let supports = uniqueSupports([
    h4.ema20, h4.ema50, daily.ema20, daily.ema50, daily.ema200,
    minLow(dailyCandles, 20), minLow(dailyCandles, 60), minLow(dailyCandles, 180)
  ], price, atrValue);

  const atrPct = atrValue / price * 100;
  const fallbackPullbacks = [
    clamp(Math.max(4, atrPct * 1.3), 4, 10),
    clamp(Math.max(9, atrPct * 2.5), 8, 18),
    clamp(Math.max(16, atrPct * 4), 14, 30)
  ];

  for (const pct of fallbackPullbacks) {
    if (supports.length >= 3) break;
    const candidate = price * (1 - pct / 100);
    if (supports.every(x => Math.abs(x - candidate) > atrValue * 0.4)) supports.push(candidate);
  }

  supports = supports.sort((a, b) => b - a).slice(0, 3);
  const half = Math.max(atrValue * 0.28, price * 0.008);
  return supports.map((center, index) => {
    const low = Math.max(0.00000001, center - half);
    const high = Math.min(price, center + half * 0.65);
    return { number: index + 1, center, low: Math.min(low, high), high: Math.max(low, high), distancePct: (price - center) / price * 100 };
  });
}

function scoreHold({ daily, weekly, zones, price }) {
  let score = 40;
  const reasons = [];
  if (weekly.trend === 'BULLISH') { score += 20; reasons.push('1W em alta'); }
  else if (weekly.trend === 'BEARISH') { score -= 18; reasons.push('1W em baixa'); }
  else score += 4;

  if (daily.trend === 'BULLISH') { score += 18; reasons.push('1D em alta'); }
  else if (daily.trend === 'BEARISH') { score -= 15; reasons.push('1D em baixa'); }
  else score += 4;

  if (daily.ema200) score += price > daily.ema200 ? 8 : -7;
  if (daily.rsi >= 40 && daily.rsi <= 58) { score += 12; reasons.push('RSI diário saudável'); }
  else if (daily.rsi > 72) { score -= 14; reasons.push('RSI diário esticado'); }
  else if (daily.rsi < 32) { score += 5; reasons.push('RSI diário sobrevendido'); }

  score += daily.macdHist > 0 ? 7 : -4;
  score += weekly.macdHist > 0 ? 7 : -4;

  const zoneDistance = zones?.[0] ? Math.abs((price - zones[0].center) / price * 100) : 99;
  if (zoneDistance <= 3) { score += 8; reasons.push('próximo da zona 1'); }
  const stretchPct = daily.ema20 ? (price - daily.ema20) / daily.ema20 * 100 : 0;
  if (stretchPct > 10) { score -= 12; reasons.push('muito acima da EMA20 diária'); }
  else if (stretchPct > 6) score -= 6;

  return { score: Math.round(clamp(score, 0, 100)), reasons, stretchPct, zoneDistance };
}

function deterministicAction({ score, daily, weekly, stretchPct, zoneDistance }) {
  if (daily.trend === 'BEARISH' && weekly.trend === 'BEARISH') return 'AVOID';
  if (daily.rsi > 72 || stretchPct > 10) return 'WAIT_CORRECTION';
  if (score >= 75 && zoneDistance <= 4) return 'BUY_NOW';
  if (score >= 65) return 'ACCUMULATE';
  return 'WAIT_CORRECTION';
}

function technicalRisk({ daily, weekly, price }) {
  const atrPct = price > 0 ? (daily.atr || 0) / price * 100 : 0;
  if (atrPct >= 8 || (daily.trend === 'BEARISH' && weekly.trend === 'BEARISH')) return 'HIGH';
  if (atrPct >= 4 || daily.trend === 'MIXED' || weekly.trend === 'MIXED') return 'MEDIUM';
  return 'LOW';
}

function bestMarketForBase(markets, exchangeNames, base) {
  const available = markets.filter(m =>
    String(m.base_asset).toUpperCase() === base && String(m.quote_asset).toUpperCase() === 'USDT' &&
    m.is_perpetual === true && m.has_ohlcv_data === true
  );
  if (!available.length) return null;
  available.sort((a, b) => {
    const an = String(exchangeNames.get(String(a.exchange)) || a.exchange).toUpperCase();
    const bn = String(exchangeNames.get(String(b.exchange)) || b.exchange).toUpperCase();
    const ai = EXCHANGE_PRIORITY.indexOf(an), bi = EXCHANGE_PRIORITY.indexOf(bn);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  const picked = available[0];
  return { ...picked, exchangeName: exchangeNames.get(String(picked.exchange)) || picked.exchange };
}

function mergeAi(asset, aiItem) {
  const action = ['BUY_NOW','ACCUMULATE','WAIT_CORRECTION','AVOID'].includes(String(aiItem?.action || '').toUpperCase())
    ? String(aiItem.action).toUpperCase() : asset.technicalAction;
  const confidence = clamp(finite(aiItem?.confidence, asset.holdScore), 0, 100);
  const risk = ['LOW','MEDIUM','HIGH'].includes(String(aiItem?.risk || '').toUpperCase())
    ? String(aiItem.risk).toUpperCase() : asset.technicalRisk;
  return {
    ...asset, action, confidence, risk,
    aiReason: String(aiItem?.reason || asset.scoreReasons.slice(0,2).join('; ') || 'Sem observação adicional.')
      .replace(/\s+/g,' ').trim().slice(0,240)
  };
}

function allocationMap(assets) {
  const eligible = assets.filter(a => a.action !== 'AVOID');
  const out = new Map(assets.map(a => [a.base, 0]));
  if (!eligible.length) return out;
  const raw = eligible.map(a => {
    const af = ({BUY_NOW:1.10,ACCUMULATE:1,WAIT_CORRECTION:0.78})[a.action] || 0.75;
    const rf = ({LOW:1.10,MEDIUM:1,HIGH:0.72})[a.risk] || 1;
    const cf = 0.70 + a.confidence / 100 * 0.30;
    return { base:a.base, value:Math.max(1,a.holdScore)*af*rf*cf };
  });
  const total = raw.reduce((s,x)=>s+x.value,0);
  const parts = raw.map(x => { const exact=x.value/total*100; return {...x,pct:Math.floor(exact),frac:exact-Math.floor(exact)}; });
  let remainder = 100 - parts.reduce((s,x)=>s+x.pct,0);
  parts.sort((a,b)=>b.frac-a.frac);
  for (let i=0;i<parts.length && remainder>0;i+=1,remainder-=1) parts[i].pct += 1;
  for (const x of parts) out.set(x.base,x.pct);
  return out;
}

export async function analyzeHoldPortfolio(requestedBases = defaultHoldBases()) {
  const cfg = holdConfig();
  const bases = [];
  for (const raw of requestedBases || []) {
    const base = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/USDT$/,'');
    if (base && base !== 'USDT' && !bases.includes(base)) bases.push(base);
    if (bases.length >= cfg.maxAssets) break;
  }
  if (!bases.length) bases.push(...defaultHoldBases());

  const cacheKey = bases.join(',');
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < cfg.cacheMin*60000) {
    return { ...cached.result, cacheHit:true, cacheAgeMin:(Date.now()-cached.at)/60000 };
  }

  const [marketList, exchangeList] = await Promise.all([futureMarkets(), exchanges()]);
  const exchangeNames = new Map(exchangeList.map(e => [String(e.code),e.name]));
  const markets = [], missing = [];
  for (const base of bases) {
    const market = bestMarketForBase(marketList,exchangeNames,base);
    if (market) markets.push(market); else missing.push(base);
  }
  if (!markets.length) throw new Error('Nenhuma moeda informada possui histórico disponível no provedor.');

  const symbols = markets.map(m=>m.symbol);
  const now = Math.floor(Date.now()/1000);
  const [h4Raw,dailyRaw] = await Promise.all([
    ohlcvHistory(symbols,'4hour',now-cfg.fourHourLookbackDays*86400,now),
    ohlcvHistory(symbols,'daily',now-cfg.dailyLookbackDays*86400,now)
  ]);
  const h4Map = new Map(h4Raw.map(x=>[x.symbol,x.history||[]]));
  const dailyMap = new Map(dailyRaw.map(x=>[x.symbol,x.history||[]]));
  const assets = [], dataErrors = [];

  for (const market of markets) {
    const h4Candles = onlyClosed(mapHistory(h4Map.get(market.symbol)),H4_MS);
    const dailyCandles = onlyClosed(mapHistory(dailyMap.get(market.symbol)),DAY_MS);
    const weeklyCandles = onlyClosed(resampleWeekly(dailyCandles),WEEK_MS);
    if (h4Candles.length<60 || dailyCandles.length<220 || weeklyCandles.length<35) {
      dataErrors.push(`${market.base_asset}: histórico insuficiente`); continue;
    }
    const h4=snapshot(h4Candles), daily=snapshot(dailyCandles), weekly=snapshot(weeklyCandles,true), price=daily.price;
    const zones=buildBuyZones({price,daily,h4,dailyCandles});
    const scoring=scoreHold({daily,weekly,zones,price});
    const action=deterministicAction({score:scoring.score,daily,weekly,stretchPct:scoring.stretchPct,zoneDistance:scoring.zoneDistance});
    const risk=technicalRisk({daily,weekly,price});
    const high20=maxHigh(dailyCandles,20);
    const chaseCeiling=Math.min(high20&&high20>price?high20:price*1.08,price+Math.max(daily.atr*1.15,price*0.055));
    assets.push({
      base:String(market.base_asset).toUpperCase(), symbol:market.symbol_on_exchange||`${market.base_asset}USDT`, exchange:market.exchangeName,
      price, change30dPct:dailyCandles.length>=31?pctChange(dailyCandles[dailyCandles.length-31].close,price):null,
      h4,daily,weekly,zones,avoidAbove:Math.max(price,chaseCeiling),holdScore:scoring.score,scoreReasons:scoring.reasons,
      technicalAction:action,technicalRisk:risk
    });
  }
  if (!assets.length) throw new Error(`Não foi possível montar HOLD. ${dataErrors.join(' | ')}`);

  let ai=null, aiError='';
  try {
    ai=await analyzeHoldPortfolioWithAI(assets.map(a=>({
      symbol:a.base,price:a.price,holdScore:a.holdScore,technicalAction:a.technicalAction,technicalRisk:a.technicalRisk,change30dPct:a.change30dPct,
      timeframe4h:{trend:a.h4.trend,rsi:a.h4.rsi,macdHistogram:a.h4.macdHist},
      timeframe1d:{trend:a.daily.trend,rsi:a.daily.rsi,macdHistogram:a.daily.macdHist,atrPct:a.price>0?a.daily.atr/a.price*100:null,
        priceVsEma20Pct:a.daily.ema20?(a.price-a.daily.ema20)/a.daily.ema20*100:null,
        priceVsEma50Pct:a.daily.ema50?(a.price-a.daily.ema50)/a.daily.ema50*100:null,
        priceVsEma200Pct:a.daily.ema200?(a.price-a.daily.ema200)/a.daily.ema200*100:null},
      timeframe1w:{trend:a.weekly.trend,rsi:a.weekly.rsi,macdHistogram:a.weekly.macdHist},
      buyZones:a.zones.map(z=>({low:z.low,high:z.high,distancePct:z.distancePct}))
    })));
  } catch(error) {
    aiError=String(error?.message||error).replace(/\s+/g,' ').slice(0,260);
    console.error('[hold-ai]',aiError);
  }

  const aiBySymbol=new Map((ai?.assets||[]).map(x=>[String(x.symbol||'').toUpperCase(),x]));
  const merged=assets.map(a=>mergeAi(a,aiBySymbol.get(a.base)));
  const allocations=allocationMap(merged);
  const finalAssets=merged.map(a=>({...a,allocationPct:allocations.get(a.base)||0}));
  const result={at:Date.now(),bases,assets:finalAssets,missing,dataErrors,aiSource:ai?.source||'TECH_ONLY',aiModel:ai?.model||null,aiSummary:ai?.summary||'',aiError,cacheHit:false,cacheAgeMin:0};
  cache.set(cacheKey,{at:Date.now(),result});
  return result;
}

function priceText(value) {
  const n=Number(value); if(!Number.isFinite(n)) return '—';
  if(n>=10000) return n.toLocaleString('en-US',{maximumFractionDigits:0});
  if(n>=1000) return n.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});
  if(n>=100) return n.toFixed(2); if(n>=1) return n.toFixed(3); if(n>=0.01) return n.toFixed(5); return n.toFixed(8);
}
function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function trendLabel(t){return t==='BULLISH'?'🟢 ALTA':t==='BEARISH'?'🔴 BAIXA':'🟡 MISTA';}
function riskLabel(r){return r==='LOW'?'BAIXO':r==='HIGH'?'ALTO':'MÉDIO';}
function actionLabel(a){return ({BUY_NOW:'🟢 COMPRAR AGORA / ZONA ATUAL',ACCUMULATE:'🔵 ACUMULAR AOS POUCOS',WAIT_CORRECTION:'🟡 ESPERAR CORREÇÃO',AVOID:'🔴 EVITAR POR ENQUANTO'})[a]||'🟡 ESPERAR CORREÇÃO';}

export function holdHelpText(){return '🧠 <b>HOLD AI</b>\n\nAnalisa carteira para médio/longo prazo sem abrir ordens.\n\n<b>Comandos:</b>\n/hold — BTC ETH SOL LINK AVAX\n/hold BTC ETH SOL — carteira personalizada\n/hold BTC,ADA,XRP,NEAR — aceita vírgulas\n\nMáximo: '+holdConfig().maxAssets+' moedas.\n\n4H = timing · 1D = tendência principal · 1W = contexto.\nMostra 3 zonas de compra, decisão da IA, risco e divisão indicativa da carteira.\n\nℹ️ HOLD é só análise: não abre PAPER, futuros ou compra automática.';}

export function formatHoldMessages(result){
  const source=result.aiSource==='GEMINI'?`🟦 Gemini (${esc(result.aiModel||'API')})`:result.aiSource==='OPENROUTER'?`🟪 OpenRouter (${esc(result.aiModel||'API')})`:'🧮 Técnico — IA indisponível';
  const allocation=result.assets.filter(a=>a.allocationPct>0).map(a=>`${a.base} ${a.allocationPct}%`).join(' · ');
  let header='🧠 <b>HOLD AI — CARTEIRA</b>\n\n'+`🤖 Motor: ${source}\n`+'⏳ Horizonte: médio/longo prazo\n📊 Timeframes: 4H + 1D + 1W\n'+`🪙 Ativos: ${result.assets.map(a=>a.base).join(' · ')}\n`;
  if(result.cacheHit) header+=`♻️ Cache: ${result.cacheAgeMin.toFixed(1)} min\n`;
  if(allocation) header+=`\n📦 <b>Distribuição técnica indicativa</b>\n${allocation}\n`;
  if(result.aiSummary) header+=`\n🧠 ${esc(result.aiSummary)}\n`;
  if(result.missing.length) header+=`\n⚠️ Sem dados: ${result.missing.join(', ')}\n`;
  if(result.aiError) header+='\n⚠️ IA falhou nesta consulta; mantida análise técnica.\n';
  header+='\nℹ️ As zonas são referências técnicas; HOLD não executa compras.';
  const messages=[header];
  for(const a of result.assets){
    const dca=a.action==='BUY_NOW'?'30% / 30% / 40%':a.action==='ACCUMULATE'?'25% / 35% / 40%':a.action==='WAIT_CORRECTION'?'15% / 35% / 50%':'—';
    const zoneLines=a.zones.map((z,i)=>`${i===2?'🔥':'🟢'} Zona ${i+1}: $${priceText(z.low)} – $${priceText(z.high)} (${z.distancePct.toFixed(1)}% abaixo)`).join('\n');
    messages.push(`🪙 <b>${a.base} — HOLD</b>\n\n💵 Referência: <b>$${priceText(a.price)}</b>\n⭐ Hold score: <b>${a.holdScore}/100</b>\n📈 4H: ${trendLabel(a.h4.trend)} · RSI ${a.h4.rsi.toFixed(1)}\n📅 1D: ${trendLabel(a.daily.trend)} · RSI ${a.daily.rsi.toFixed(1)}\n🗓 1W: ${trendLabel(a.weekly.trend)} · RSI ${a.weekly.rsi.toFixed(1)}\n\n🧠 IA: <b>${actionLabel(a.action)}</b>\n🎯 Confiança: ${a.confidence.toFixed(0)}% · Risco: ${riskLabel(a.risk)}\n💬 ${esc(a.aiReason)}\n\n${zoneLines}\n🚫 Evitar perseguir acima de: $${priceText(a.avoidAbove)}\n💰 DCA nas zonas: ${dca}\n📦 Peso indicativo: <b>${a.allocationPct}%</b>`);
  }
  return messages;
}

export function holdTechnicalFromCandles({h4Candles,dailyCandles}){
  const h4=snapshot(h4Candles),daily=snapshot(dailyCandles),weekly=snapshot(resampleWeekly(dailyCandles),true);
  const zones=buildBuyZones({price:daily.price,daily,h4,dailyCandles});
  const scoring=scoreHold({daily,weekly,zones,price:daily.price});
  return {h4,daily,weekly,zones,score:scoring.score,action:deterministicAction({score:scoring.score,daily,weekly,stretchPct:scoring.stretchPct,zoneDistance:scoring.zoneDistance}),risk:technicalRisk({daily,weekly,price:daily.price})};
}
