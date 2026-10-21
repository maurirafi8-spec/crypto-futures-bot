# Crypto Futures Bot — V2.0 Otimizado

Bot de trading para futuros perpétuos de criptomoedas com alta assertividade e payoff positivo.

## Principais Atualizações desta Versão:
1. **Payoff Positivo (> 1.47:1) & Alvos Fora do Ruído:**
   - Alvo Quick Scalp: +1.10% líquido do notional (+2.20 USDC em $200 notional)
   - Stop Quick Scalp: -0.75% líquido do notional (-1.50 USDC em $200 notional)
   - Break-even win rate reduzido de 63.6% para apenas 40.5% (facilmente superável).
2. **Entrada no Reteste (Confirmed Entry):**
   - Elimina a compra a mercado no topo de velas esticadas.
   - Posiciona a ordem limite no micro-reteste da máxima rompida ou da EMA20.
3. **Novos Indicadores Técnicos:**
   - Bandas de Bollinger (%B e Bandwidth): Bloqueia operações durante compressão (Squeeze) e exige expansão de bandas.
   - ADX / DMI: Filtra mercados sem tendência (CHOP). Exige ADX >= 20.
   - Daily Anchored VWAP: Suporte e resistência institucional diário ancorado em 00:00 UTC.
4. **Hard Circuit Breaker do Bitcoin:**
   - Se o BTC estiver em tendência de baixa (BEARISH) no 15m ou 1h, todos os LONGs em altcoins são sumariamente bloqueados.
5. **Resample Seguro de Velas:**
   - Garante que velas de 15m tenham pelo menos 3 candles de 5m agregados, eliminando distorções de volume e EMAs.

## Como Subir no Render ou Servidor VPS:
1. Copie estes arquivos para o seu repositório Git.
2. Copie as variáveis do arquivo `.env.example` e cole na aba Environment do Render (ou no seu `.env` local).
3. Execute `npm install` e `npm start`.
4. No Telegram, envie `/paperreset CONFIRM` para iniciar a simulação com a nova calibração de alta assertividade.
