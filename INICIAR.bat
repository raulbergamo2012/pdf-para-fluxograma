@echo off
chcp 65001 >nul
title Fluxograma IA
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js nao foi encontrado neste computador.
  echo  Vou abrir a pagina de download. Instale a versao LTS e depois
  echo  clique de novo em INICIAR.bat
  start https://nodejs.org/pt
  pause
  exit /b
)
node server.js
pause
