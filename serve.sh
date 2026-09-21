#!/bin/zsh
cd "$(dirname "$0")"
PORT="${1:-8765}"
exec python3 ./serve.py "$PORT"
