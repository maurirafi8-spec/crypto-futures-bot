/**
 * CORREÇÕES DE OURO NO SCANNER:
 * 1. Hard BTC Trend Gate
 * 2. Validação estrita de Resample de Candles
 * 3. Filtro de Ruído de OI
 */

// 1. HARD BTC CIRCUIT BREAKER
export function isBtcMarketHostile(side, btcContext) {
  if (!btcContext) return false;
  
  const btc15m = String(btcContext.trend15m || 'MIXED').toUpperCase();
  const btc1h = String(btcContext.trend1h || 'MIXED').toUpperCase();
  
  // Se você quer abrir LONG, mas o BTC está BEARISH no 15m e 1h: BLOQUEIO TOTAL
  if (side === 'LONG' && (btc15m === 'BEARISH' || btc1h === 'BEARISH')) {
    return {
      blocked: true,
      reason: 'BTC em tendência de baixa (15m/1h). Queda de altcoins é inevitável.'
    };
  }

  // Se você quer abrir SHORT, mas o BTC está em rali forte BULLISH: BLOQUEIO TOTAL
  if (side === 'SHORT' && (btc15m === 'BULLISH' || btc1h === 'BULLISH')) {
    return {
      blocked: true,
      reason: 'BTC em tendência de alta (15m/1h). Shorts em altcoins sofrem squeeze.'
    };
  }

  return { blocked: false };
}

// 2. RESAMPLE COM VALIDAÇÃO DE CONTAGEM MÍNIMA
export function safeResample15m(candles5m) {
  const groups = new Map();
  for (const c of candles5m) {
    const bucket = Math.floor(c.openTime / (15 * 60 * 1000)) * (15 * 60 * 1000);
    if (!groups.has(bucket)) {
      groups.set(bucket, { count: 1, openTime: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, quoteVolume: c.quoteVolume });
    } else {
      const g = groups.get(bucket);
      g.count += 1;
      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.close = c.close;
      g.volume += c.volume;
      g.quoteVolume += c.quoteVolume;
    }
  }
  
  // FILTRO ESSENCIAL: Só aceita velas de 15m que tenham pelo menos 3 candles de 5m agregados!
  return [...groups.values()]
    .filter(g => g.count >= 3)
    .sort((a, b) => a.openTime - b.openTime);
}
