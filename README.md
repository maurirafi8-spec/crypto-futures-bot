# Crypto Futures Trading Bot — V2.0 Otimizado

Bot de trading de futuros cripto com motor de alta assertividade.

## Principais Melhorias:
1. Payoff Positivo (> 1.47:1) com alvos fora do ruído de 5m (1.10% target / 0.75% stop).
2. Confirmed Entry com Reteste Limite (elimina compras a mercado no topo de vela esticada).
3. Novos Indicadores: Bandas de Bollinger (%B e Bandwidth), ADX/DMI e VWAP Diária.
4. Hard BTC Gate: Bloqueio imediato de compras se o Bitcoin estiver BEARISH no 15m ou 1h.
5. Resample seguro de velas (3x 5m para 15m; 4x 1h para 4h).

## Como Instalar no Render / VPS:
1. Descompacte os arquivos na pasta do seu projeto.
2. Execute npm install
3. Configure o .env
4. Execute npm start
5. No Telegram envie: /paperreset CONFIRM
