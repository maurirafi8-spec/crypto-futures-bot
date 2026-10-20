# Crypto Futures Trading Bot — V2.0 Otimizado (100% Compatível)

Bot de trading de futuros cripto com motor de alta assertividade e correção de todos os bugs de referência.

## Correções Inclusas:
1. scanner.js: Mantém 100% da assinatura original ({ signals, preCandidates, snapshots, debug }) + corrige c15All.length + integra Bandas de Bollinger, ADX e Hard BTC Gate.
2. index.js: Corrige ReferenceError: lastScanBatch is not defined (linha 4433) e adiciona fallback seguro na desestruturação do scanMarket.
3. confirmed-entry.js: Preserva 100% dos métodos originais (statsSnapshot, statusText, oiClassForSide) + entrada otimizada no reteste.
4. quick-scalp.js & paper-trader.js: Payoff 1.47:1 (Alvo 1.10% líquido / Stop 0.75% líquido, break-even 40.5%).
5. indicators.js: EMA, RSI, ATR, MACD + Bandas de Bollinger (%B e Bandwidth), ADX/DMI e VWAP Diária.
