#!/bin/zsh
# P6.5 主动消息定时任务 runner：只设置运行门禁，然后调用新版 proactive briefing CLI。

set -euo pipefail

PROJECT_ROOT="${PROACTIVE_PROJECT_ROOT:-$HOME/projects/codex-workspaces/minical-agent-main}"
MODE="${1:-morning}"

# 读取 Mac mini 本地配置；该文件不提交，用来放微信 target/account 等本机值。
if [ -f "$PROJECT_ROOT/.env.proactive" ]; then
  set -a
  source "$PROJECT_ROOT/.env.proactive"
  set +a
fi

# 校验模式，避免 LaunchAgent 配错后跑到未知分支。
case "$MODE" in
  morning|evening|reminder)
    ;;
  *)
    echo "未知主动消息模式：$MODE"
    exit 1
    ;;
esac

mkdir -p "$PROJECT_ROOT/state" "$PROJECT_ROOT/logs"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PROACTIVE_MODE="$MODE"
export LIVE_PROACTIVE_ENABLE_REAL_READ=1
export PROACTIVE_DELIVERY_MODE=wechat
export LIVE_PROACTIVE_ENABLE_WECHAT_SEND=1
export PROACTIVE_COMMIT=1
export PROACTIVE_STATE_FILE="${PROACTIVE_STATE_FILE:-$PROJECT_ROOT/state/proactive-sent.json}"
export PROACTIVE_SEED_FILE="${PROACTIVE_SEED_FILE:-$PROJECT_ROOT/state/seed-lite.json}"
export WECHAT_REMINDER_STATE_FILE="${WECHAT_REMINDER_STATE_FILE:-$PROJECT_ROOT/state/wechat-reminders.json}"
export PROACTIVE_OPENCLAW_PATH="${PROACTIVE_OPENCLAW_PATH:-$HOME/.openclaw/bin/openclaw}"

if [ "$MODE" = "reminder" ]; then
  export PROACTIVE_REMINDER_LEAD_MINUTES="${PROACTIVE_REMINDER_LEAD_MINUTES:-40}"
fi

if [ -z "${PROACTIVE_WECHAT_TARGET:-}" ] || [ -z "${PROACTIVE_WECHAT_ACCOUNT_ID:-}" ]; then
  echo "缺少 PROACTIVE_WECHAT_TARGET 或 PROACTIVE_WECHAT_ACCOUNT_ID，不能真实发送微信。"
  exit 1
fi

cd "$PROJECT_ROOT"
if [ "${PROACTIVE_RUNTIME_SKIP_DOCTOR:-0}" != "1" ]; then
  PROACTIVE_RUNTIME_ENABLE_LIVE=1 npm --silent run live:proactive-runtime-doctor
fi

if [ "$MODE" = "reminder" ]; then
  npm --silent run live:wechat-reminder-dispatcher
else
  npm --silent run live:proactive-briefing
fi
