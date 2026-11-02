#!/usr/bin/env bash
set -e
echo "=== Configurando Bot Crypto Futures V2.6 na VM Google Cloud (e2-micro) ==="
# 1. Cria Swap de 2GB (essencial para e2-micro de 1GB RAM nunca travar)
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  echo "Swap de 2GB criado com sucesso!"
fi

# 2. Instala Node.js 20 LTS e PM2
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs unzip
fi
sudo npm install -g pm2

# 3. Instala dependencias do bot, carrega .env e inicia em background 24/7
npm install --omit=dev
set -a
[ -f .env ] && . ./.env
set +a
pm2 delete crypto-scanner 2>/dev/null || true
pm2 start index.js --name crypto-scanner --node-args="--env-file=.env" --update-env --time
pm2 save
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp $HOME || true
echo "✅ Bot rodando 24/7! Use: pm2 logs crypto-scanner"
