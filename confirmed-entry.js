/**
 * CONFIRMED ENTRY OTIMIZADO (V2 - Retest Limit Fill)
 * Não compra mais a mercado no fechamento da vela de confirmação.
 */

export function calculateOptimizedEntryOrder({
  side,
  triggerHigh,
  triggerLow,
  triggerClose,
  triggerEma20,
  atr
}) {
  const isLong = side === 'LONG';
  const atrBuffer = atr * 0.15;

  // Em vez de comprar o preço que fechou lá em cima,
  // entramos na faixa de reteste do topo anterior ou na média móvel rápida:
  const limitPrice = isLong
    ? Math.max(triggerHigh, triggerEma20 + atrBuffer)
    : Math.min(triggerLow, triggerEma20 - atrBuffer);

  // Stop posicionado abaixo do suporte estrutural da vela gatilho + buffer de ATR
  const structuralStop = isLong
    ? triggerLow - (atr * 0.35)
    : triggerHigh + (atr * 0.35);

  return {
    orderType: 'LIMIT',
    limitPrice,
    structuralStop,
    maxWaitCandles: 2, // Se não pegar o reteste em 2 candles (10 min), cancela
    retestDiscountPct: Math.abs((triggerClose - limitPrice) / triggerClose) * 100
  };
}
