# Crypto & Tokenized Stocks Bot — V2.7 (BloFin Demo/Real + Ações Tokenizadas)

Bot de trading algorítmico com inteligência artificial para futuros perpétuos de Criptomoedas e Ações Tokenizadas na BloFin.

## Principais Atualizações desta Versão:
1. **Executor Oficial BloFin (Modo Demo Sandbox & Real):**
   - Suporte completo a Demo (`https://demo-trading-openapi.blofin.com`) e Conta Real.
   - Autenticação canônica HMAC-SHA256 Base64 com suporte a trailing spaces/quotes no Render.
   - Comandos Telegram: `/blofin` (saldo/status), `/bpos` (posições), `/bexecs` (histórico), `/btest TSLA LONG` (teste imediato), `/bclose <PAR>` (fechar a mercado).
2. **Ações Tokenizadas Perpétuas USDT (Equities):**
   - Opere TSLA, NVDA, AAPL, MSFT, AMZN, META, COIN, AMD, MSTR 24/7 com alavancagem configurável e Stop Loss automático.
3. **Confirmed Entry V2.7 & Fast Entry 1-Candle:**
   - Reteste na EMA20 ou máxima rompida com proteção de falsos rompimentos.
4. **Hard Circuit Breaker do Bitcoin:**
   - Se o BTC estiver em BEARISH no 15m/1h, todos os LONGs em altcoins são sumariamente bloqueados.

## Como Subir no Render ou Servidor VPS:
1. Copie estes arquivos para o seu repositório Git.
2. Copie as variáveis do arquivo `.env.example` e cole na aba Environment do Render.
   - Preencha: `BLOFIN_API_KEY`, `BLOFIN_SECRET_KEY`, `BLOFIN_PASSPHRASE`.
   - Para modo simulado (dinheiro virtual), mantenha: `BLOFIN_DEMO=true`.
3. Execute `npm install` e `npm start`.
4. No Telegram, envie `/blofin` para verificar a conexão e saldo.
