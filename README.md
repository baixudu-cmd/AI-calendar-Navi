# Navi Calendar

简体中文 | [English](README.en.md)

[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](#测试)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Runtime](https://img.shields.io/badge/runtime-Node.js%2020%2B-339933)](https://nodejs.org/)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-supported-111827)](docs/openclaw/install-and-debug.md)

Navi Calendar 是一个可自托管的 AI 日程助手。它可以通过自然语言接收日程创建、查询、修改、删除、提醒和排程请求，并通过受控工具执行到日历系统。

项目目标很明确：让日程处理更顺畅，同时把所有副作用放在可验证的工具边界里。模型负责理解，工具负责执行；确认前不写入日历。

## 功能

- 自然语言创建单个或多个日程。
- 查询、修改和删除日程，删除前需要确认。
- 把未确定时间的事项放入待推进收件箱。
- 基于日历空档生成排程候选，支持多个推荐位。
- 支持早报、晚报、状态总览和设置总结。
- 支持默认提醒和指定时间提醒。
- 支持图片或截图 OCR 文本进入同一套日程理解流程。
- 支持本地记忆整理，用于改进后续排程推荐。

完整产品说明见 [docs/product-manual.md](docs/product-manual.md)。

## Quick Start

```bash
git clone https://github.com/baixudu-cmd/AI-calendar-Navi.git
cd AI-calendar-Navi
npm ci
cp .env.example .env
cp config/settings.example.json config/settings.local.json
npm run health
npm test
```

没有配置模型、日历和消息入口时，live 命令会安全失败。这是预期行为。先跑通本地测试，再接入真实服务。

## OpenClaw Setup

Navi 可以把 OpenClaw 作为消息转发层：

```text
WeChat / OpenClaw
  -> Navi shadow route
  -> model-first decision
  -> tool contract
  -> calendar / inbox / scheduler / reminder
```

本地 smoke：

```bash
npm run agent:shadow-server

OPENCLAW_SHADOW_URL=http://127.0.0.1:37891/calendar-agent/shadow \
OPENCLAW_SHADOW_SECRET=<same-as-WECHAT_ENTRY_SECRET> \
OPENCLAW_SHADOW_TEXT="明天下午三点讨论旅行计划" \
npm run openclaw:shadow-caller-smoke
```

完整接入说明见 [docs/openclaw/install-and-debug.md](docs/openclaw/install-and-debug.md)。

## 配置

Navi 使用两层配置：

- `.env`：密钥、外部服务 ID、上线写入开关。
- `config/settings.local.json`：非密钥产品设置，例如默认提醒时间、状态文件路径、早晚报开关和排程候选数量。

本地配置文件不会进入 Git。公开仓库只提供：

- `.env.example`
- `config/settings.example.json`

## 架构

```text
message input
  -> entry guards
  -> model decision
  -> tool-contract validation
  -> agent-api orchestration
  -> calendar-api / seed-lite / scheduler / reminder / memory
  -> short reply
```

核心原则：

- 语义判断只走一次模型决策。
- 工具合同校验通过后才允许执行。
- 创建、修改、删除是否成功，以日历 API 结果为准。
- 删除、冲突处理和排程推荐都有确认边界。
- 本地记忆只作为推荐参考，不自动写日历。

更多结构说明见 [ARCHITECTURE.md](ARCHITECTURE.md) 和 [docs/api/capability-apis.md](docs/api/capability-apis.md)。

## 测试

```bash
npm test
npm run typecheck
```

公开发布前运行：

```bash
npm run public:export
npm run public:audit
```

公开导出目录：

```text
dist/public/navi-calendar
```

## 发布到 GitHub

建议使用一个新的空仓库，只发布干净导出目录：

```bash
npm run public:export
npm run public:audit
cd dist/public/navi-calendar
git init
git add .
git commit -m "Initial public release"
git branch -M main
git remote add origin git@github.com:<your-account>/<repo>.git
git push -u origin main
```

不要直接公开 live 开发仓库和完整历史。公开边界见 [PUBLICATION.md](PUBLICATION.md)。

## Public Boundary

可以公开：

- `src/`
- `tests/`
- README / ARCHITECTURE / PUBLICATION
- `.env.example`
- `config/settings.example.json`
- 公开文档和 GitHub Issue 模板

不要公开：

- `.env`
- `config/settings.local.json`
- 本地状态、日志、运行目录、账号 ID、联系人 ID、token、消息记录
- 私有部署记录和机器路径
