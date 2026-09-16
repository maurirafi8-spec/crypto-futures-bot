# Crypto Futures Scanner V1

Scanner experimental de contratos perpétuos USDT da Binance Futures com alertas no Telegram.

## O que analisa
- Tendência em 15m, 1h e 4h com EMA 20/50/200
- RSI 14
- MACD
- ATR para stop e alvos
- Volume relativo
- Open Interest
- Funding rate
- Score LONG/SHORT de 0 a 100

## Rodar localmente (Node 20+)
1. Copie `.env.example` para `.env`
2. Preencha `BOT_TOKEN`
3. Rode:
   `node --env-file=.env src/index.js`

## Render
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Variáveis: BOT_TOKEN, TELEGRAM_CHAT_ID (opcional), SCAN_INTERVAL_MINUTES, TOP_MARKETS, MIN_SCORE, MIN_QUOTE_VOLUME_USDT, COOLDOWN_MINUTES

Depois abra o bot no Telegram e mande `/start`.

## Observação
V1 apenas envia sinais. Não envia ordens para a corretora. Isso é intencional para validar a estratégia antes de qualquer automação de execução.
