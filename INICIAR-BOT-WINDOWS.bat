@echo off
title Crypto Futures Bot V2.6 - Rodando no PC
echo ========================================================
echo   INICIANDO CRYPTO FUTURES SCANNER V2.6 NO SEU PC
echo ========================================================
if not exist node_modules (
  echo Instalando dependencias pela primeira vez...
  call npm install --omit=dev
)
echo Iniciando o Bot (Mantenha esta janela aberta)...
node --env-file=.env index.js
pause
