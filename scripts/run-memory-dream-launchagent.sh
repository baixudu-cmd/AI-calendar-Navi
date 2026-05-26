#!/bin/zsh
# P19 每日记忆整理定时任务 runner：只运行本地记忆归纳，不发微信、不写日历。

set -euo pipefail

PROJECT_ROOT="${MEMORY_DREAM_PROJECT_ROOT:-$HOME/projects/codex-workspaces/minical-agent-main}"

if [ -f "$PROJECT_ROOT/.env.proactive" ]; then
  set -a
  source "$PROJECT_ROOT/.env.proactive"
  set +a
fi

mkdir -p "$PROJECT_ROOT/state" "$PROJECT_ROOT/logs"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export MEMORY_DREAM_STATE_FILE="${MEMORY_DREAM_STATE_FILE:-$PROJECT_ROOT/state/memory-dream.json}"
export MEMORY_DREAM_SEED_FILE="${MEMORY_DREAM_SEED_FILE:-$PROJECT_ROOT/state/seed-lite.json}"

cd "$PROJECT_ROOT"
npm --silent run live:memory-dream
