# OpenClaw 安装和调试指南

这份文档面向想把 Navi 接到 OpenClaw / 微信入口的使用者。OpenClaw 只负责收微信消息和转发最小 payload；Navi 负责模型理解、工具合同、日历执行、状态和回复。

## 1. 准备环境

需要准备：

- Node.js 20 或更新版本。
- 一个 OpenAI-compatible 模型接口。
- 飞书应用和一个专用测试日历。
- OpenClaw 微信入口，能把文本消息转成命令或 HTTP 调用。

安装项目：

```bash
git clone https://github.com/baixudu-cmd/AI-calendar-Navi.git
cd AI-calendar-Navi
npm ci
cp .env.example .env
cp config/settings.example.json config/settings.local.json
```

先跑本地检查：

```bash
npm run health
npm test
npm run typecheck
```

## 2. 配置 `.env`

`.env` 只放密钥和外部接入：

```bash
MODEL_PROVIDER=openai-compatible
MODEL_BASE_URL=https://your-model-endpoint.example/v1
MODEL_API_KEY=<redacted>
MODEL_NAME=<your-model-name>

FEISHU_APP_ID=<redacted>
FEISHU_APP_SECRET=<redacted>
FEISHU_CALENDAR_ID=<test-calendar-id>
FEISHU_TEST_CALENDAR_ID=<test-calendar-id>
FEISHU_MAIN_CALENDAR_ID=<main-calendar-id-optional>

WECHAT_ENTRY_SECRET=<local-shadow-secret>
```

`config/settings.local.json` 只放非密钥设置，例如提醒提前量、状态文件路径和排程默认候选数量。

检查配置：

```bash
npm run live:env-doctor
npm run live:model-smoke
npm run live:feishu-smoke
```

## 3. 启动 Navi shadow route

```bash
npm run agent:shadow-server
```

默认监听：

```text
http://127.0.0.1:37891/calendar-agent/shadow
```

这个入口只建议本机调用，不建议直接暴露公网。OpenClaw 应该在同一台机器或同一内网里调用它。

## 4. 用 OpenClaw caller 做 smoke

在另一个终端运行：

```bash
OPENCLAW_SHADOW_URL=http://127.0.0.1:37891/calendar-agent/shadow \
OPENCLAW_SHADOW_SECRET=<same-as-WECHAT_ENTRY_SECRET> \
OPENCLAW_SHADOW_TEXT="明天下午三点和小李讨论旅行计划" \
npm run openclaw:shadow-caller-smoke
```

如果只想拿到可以直接发回微信的回复：

```bash
OPENCLAW_SHADOW_REPLY_ONLY=1 \
OPENCLAW_SHADOW_URL=http://127.0.0.1:37891/calendar-agent/shadow \
OPENCLAW_SHADOW_SECRET=<same-as-WECHAT_ENTRY_SECRET> \
OPENCLAW_SHADOW_TEXT="$OPENCLAW_MESSAGE_TEXT" \
npm run --silent openclaw:shadow-caller-smoke
```

OpenClaw 动作里只需要把微信文本填到 `OPENCLAW_SHADOW_TEXT`，把输出作为微信回复。不要在 OpenClaw 侧拼飞书参数、模型参数或日历状态。

## 5. 图片或文件消息

OpenClaw 如果拿到本地媒体路径，可以传媒体字段：

```bash
OPENCLAW_SHADOW_URL=http://127.0.0.1:37891/calendar-agent/shadow \
OPENCLAW_SHADOW_SECRET=<same-as-WECHAT_ENTRY_SECRET> \
OPENCLAW_SHADOW_MEDIA_PATH=/tmp/openclaw-weixin/inbound/appointment.png \
OPENCLAW_SHADOW_MEDIA_TYPE=image/png \
npm run openclaw:shadow-caller-smoke
```

Navi 只接收用户主动发来的媒体路径和 MIME type，不后台读屏、不后台截图。

## 6. 调试顺序

按这个顺序排查：

```bash
npm run live:env-doctor
npm run agent:model-smoke
npm run live:feishu-smoke
npm run agent:shadow-smoke
npm run openclaw:shadow-caller-smoke
```

常见问题：

| 现象 | 处理 |
| --- | --- |
| `missing required env` | 补齐 `OPENCLAW_SHADOW_URL`、`OPENCLAW_SHADOW_SECRET`，并传文本或媒体 |
| `wrong secret` | 确认 caller 的 secret 和 Navi `.env` 里的 `WECHAT_ENTRY_SECRET` 一致 |
| 模型 smoke 失败 | 先检查 `MODEL_BASE_URL`、模型名和 API key |
| 飞书 smoke 失败 | 先用专用测试日历，不要直接写主日历 |
| OpenClaw 没回复 | 用 `OPENCLAW_SHADOW_REPLY_ONLY=1` 单独确认命令输出 |

## 7. 安全边界

- 不提交 `.env`、真实 token、私有网络地址、个人机器路径或微信联系人标识。
- OpenClaw caller 只传 `text`、`messageId`、`requestId`、`secret` 和可选媒体信息。
- 日历创建、修改、删除都以 Navi 的工具执行结果为准。
- 推荐排程确认前不写日历。
- 主日历写入必须使用显式 gate，先用测试日历跑通。

更多底层设计见项目根目录的 `ARCHITECTURE.md`。
