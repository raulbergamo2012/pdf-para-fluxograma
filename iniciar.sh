#!/bin/bash
# Linux: ./iniciar.sh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js não encontrado. Abrindo página de download..."
  xdg-open "https://nodejs.org/pt"
  read -p "Pressione Enter para sair"
  exit 1
fi
node server.js
