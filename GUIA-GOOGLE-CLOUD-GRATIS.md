# Como Rodar o Bot no Google Cloud (100% Grátis / Sem Expirar como o Render)

Você tem **2 formas excelentes** de rodar este bot no Google Cloud:

---

## OPÇÃO 1 (MAIS RECOMENDADA — 100% GRÁTIS PARA SEMPRE): Google Compute Engine `e2-micro` (Always Free)
O Google Cloud dá **1 Máquina Virtual `e2-micro` Grátis Para Sempre** (mesmo após acabar os $300 de teste) nas regiões **`us-central1` (Iowa)**, **`us-east1` (Carolina do Sul)** ou **`us-west1` (Oregon)** com **30 GB de disco Standard Persistent Disk**.
Como nosso bot usa a API da **Coinalyze** + **Google Sheets Sync**, ele roda perfeitamente nos EUA 24h por dia sem hibernar e sem perder o `paper-state.json`!

### Passo a Passo (leva 4 minutos):
1. Acesse [console.cloud.google.com](https://console.cloud.google.com/) -> menu **Compute Engine** -> **Instâncias de VM** -> **Criar Instância**.
2. Configure exatamente assim para entrar no **Free Tier Permanente**:
   - **Região**: `us-east1` (Carolina do Sul) ou `us-central1` (Iowa)
   - **Série / Tipo de máquina**: `E2` -> **`e2-micro`** (2 vCPUs compartilhadas, 1 GB de memória)
   - **Disco de inicialização (Boot Disk)**: Clique em **Alterar**:
     - Sistema Operacional: **Ubuntu 22.04 LTS** (ou Debian 12)
     - Tipo de disco: **Disco permanente padrão (Standard persistent disk)** *(Importante: mude de Balanced para Standard para ser 100% grátis!)*
     - Tamanho: **20 GB** (o limite grátis é até 30 GB)
3. Clique em **Criar** e depois clique no botão **SSH** ao lado da sua VM para abrir o terminal no navegador.
4. Na janela SSH do navegador, clique no ícone de **Engrenagem (canto superior direito)** -> **Fazer upload de arquivo (Upload file)** e envie o arquivo `crypto-bot-v2-otimizado.zip`.
5. No terminal SSH, rode este único comando para descompactar, configurar suas chaves do Render no `.env` e ligar o bot 24/7 com PM2:
```bash
sudo apt-get update && sudo apt-get install -y unzip nano
mkdir -p ~/bot && unzip -o ~/crypto-bot-v2-otimizado.zip -d ~/bot && cd ~/bot
nano .env
# (Cole o seu TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, COINALYZE_API_KEY, GEMINI_API_KEY / OPENROUTER_API_KEY, salve com Ctrl+O, Enter e saia com Ctrl+X)
bash setup-gcp-vm.sh
```
Pronto! O script `setup-gcp-vm.sh` já cria 2 GB de memória Swap, instala o Node 20 + PM2 e deixa o bot rodando 24/7 com reinício automático!
Para ver os logs ao vivo a qualquer momento:
```bash
pm2 logs crypto-scanner
```

---

## OPÇÃO 2 (SEM SERVIDOR / IGUAL AO RENDER): Google Cloud Run
O pacote já inclui o `Dockerfile` configurado e o endpoint `/cron-scan` integrado no `index.js`!

1. Abra o **Google Cloud Shell** (ícone `>_` no topo do painel do Google Cloud).
2. Faça upload do `crypto-bot-v2-otimizado.zip` no Cloud Shell e rode:
```bash
mkdir -p ~/bot && unzip -o crypto-bot-v2-otimizado.zip -d ~/bot && cd ~/bot
nano .env
# (Preencha suas variáveis no .env ou passe via painel do Cloud Run)
bash deploy-cloud-run.sh
```
- **Dica Cloud Run 100% Free Tier**: Se quiser gastar **zero** após acabar os $300 de crédito inicial, mude `--min-instances=0` no Cloud Run e crie um job gratuito no **Google Cloud Scheduler** (ou no site gratuito **cron-job.org**) chamando a URL `https://SUA-URL-CLOUD-RUN.run.app/cron-scan` a cada **1 minuto**. O `index.js` V2.6 já aguarda o scan terminar na rota `/cron-scan` antes de responder!
