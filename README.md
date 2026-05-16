# Navi Calendar

[English](README.en.md) | 简体中文

[![Tests](https://img.shields.io/badge/tests-572%20passing-brightgreen)](#测试方法)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Runtime](https://img.shields.io/badge/runtime-Node.js%2020%2B-339933)](https://nodejs.org/)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-shadow%20route-111827)](docs/openclaw/install-and-debug.md)

Navi Calendar 是一个自用优先的微信 AI 日程助手。你可以在微信里用自然语言、语音转写文本或图片内容告诉它要安排什么、查询什么、修改什么；Navi 负责理解意图，并通过受控工具把可靠结果写入飞书日历。

当前重点不是做一个全能助手，而是把个人日程、待推进事项、排程推荐、早晚报、提醒和记忆整理这些高频链路做稳。

## Why Navi

- 微信就是入口：适合语音、文字、截图和聊天记录转日程。
- 模型只做理解：真正创建、修改、删除都由确定性 API 执行。
- 确认前不写日历：排程推荐、删除和冲突创建都有明确门禁。
- 可以自托管：配置放在 `.env` 和 `config/settings.local.json`，真实密钥不进 Git。
- OpenClaw 友好：提供 shadow route 和 caller smoke，方便把 OpenClaw 当微信转发层。

## 当前能力

- 微信入口：通过 OpenClaw / WeChat 路由接收普通文本、语音转写文本和图片 OCR 文本。
- 日程创建：支持单个日程、多个明确日程，以及“聊天记录 + 明确时间”自动总结标题后创建。
- 冲突处理：如果一批日程里有一部分撞时间，回复会列出冲突和本次尚未写入的其他事项。
- 日程查询：支持今天、明天、某天、某个时间段的日程查询。
- 日程修改：支持围绕刚创建、刚查询、早晚报或工作台里的日程继续改，也支持按“周六下午的健身”这类结构化线索查找唯一日程后修改。
- 删除确认：删除前先锁定目标并等待确认；如果“健身”这类模糊线索匹配多个日程，会先列候选让你选第几个。
- 今日工作台：把当日安排和待推进事项放在同一个可继续处理的上下文里。
- 早晚报：会展示日程、待推进事项和待处理上下文，主动消息里也能拉回待确认推荐。
- 状态总览：可直接问“你现在记着我什么”，查看待补时间、待确认推荐、待确认删除和待推进事项。
- 放弃上下文：可直接说“算了，先不管了”，清空当前待补时间、推荐、删除或冲突确认，不影响已创建日程和待推进收件箱。
- 待推进收件箱：没有明确时间的事项先记住，后续可查看、完成、取消、设置提醒或安排时间。
- 排程推荐：支持给待推进事项推荐时间，支持多个候选、选第几个、换下午、换明天、晚一点等后续调整；确认前不会写入日历。
- 微信提醒：默认提前 40 分钟提醒；如果用户明确说“某天某时提醒我”，会登记到点微信提醒。
- 设置总结：可直接问“提醒时间在哪里改”“模型 API 设置怎么看”，Navi 会返回关键配置、低摩擦规则和修改入口，密钥只显示是否已设置。
- 图片录入：图片 OCR 后交给模型理解，信息完整时转成日程草稿或直接创建。
- 记忆整理：每日整理日程助手自身交互、执行结果、Seed Lite 和明确用户交互记录，不做后台读屏、截图或桌面采集。

完整产品说明见 [docs/product-manual.md](docs/product-manual.md)。

## Quick Start

```bash
git clone https://github.com/baixudu-cmd/navi-calendar.git
cd navi-calendar
npm ci
cp .env.example .env
cp config/settings.example.json config/settings.local.json
npm run health
npm test
```

没有真实模型、飞书和微信配置时，live 命令会失败关闭，这是预期行为。先用本地测试确认代码可运行，再按 [OpenClaw 安装和调试指南](docs/openclaw/install-and-debug.md) 接入微信入口。

## OpenClaw Setup

Navi 推荐把 OpenClaw 当成轻量微信转发层：

```text
WeChat / OpenClaw
  -> OpenClaw shadow caller
  -> Navi shadow route
  -> model-first decision
  -> Feishu Calendar / local assistant state
```

最小调试顺序：

```bash
npm run agent:shadow-server

OPENCLAW_SHADOW_URL=http://127.0.0.1:37891/calendar-agent/shadow \
OPENCLAW_SHADOW_SECRET=<same-as-WECHAT_ENTRY_SECRET> \
OPENCLAW_SHADOW_TEXT="明天下午三点和小李讨论旅行计划" \
npm run openclaw:shadow-caller-smoke
```

完整安装、OpenClaw 动作配置、失败排查和真实发送边界见 [docs/openclaw/install-and-debug.md](docs/openclaw/install-and-debug.md)。

## 使用示例

```text
明天下午三点和小李讨论旅行计划
```

信息完整时，Navi 会直接创建日程。只有真实飞书 API 成功后，才会回复已创建。

```text
今天 10 点提醒我看这段聊天记录
```

如果原文里有明确时间，Navi 会自己总结标题，不再追问“是什么类型”。

```text
明天上午 8 点提醒我取体检报告
```

这类明确到点提醒会创建对应时间的日程，并在到点时登记微信提醒。

```text
把第一个提醒转成日程，到时候提醒我
```

如果待推进收件箱里的事项已经有提醒时间，Navi 会用这条结构化时间创建日程和到点提醒；创建成功后，该事项会从收件箱移除。

```text
帮我安排一下整理旅行清单
```

没有明确时间时，Navi 会先放进待推进收件箱，或根据当前上下文给出可确认的排程推荐。

```text
换到下午，给我三个候选
```

Navi 会基于当前推荐继续调整，确认前不会写日历。

```text
你现在记着我什么？
```

Navi 会只读展示待补时间、待确认推荐、待确认删除、冲突确认和待推进事项。

```text
算了，先不管了
```

Navi 会清空当前挂起的短期上下文，不会删除日历，也不会清掉待推进事项。

## 核心原则

- 模型只做一次语义判断，本地代码不靠正则或关键词路由抢语义。
- 本地只负责工具合同、状态门禁、执行护栏和失败关闭。
- 工具执行结果才是事实；飞书 API 成功前不说“已创建”或“已修改”。
- 旧系统只作为私有只读参考，不随公开发行仓库发布，也不复制旧业务代码、旧 prompt、旧状态恢复函数或旧测试框架。
- 真实密钥不进入 Git；真实写入、真实微信发送和远端同步都保留显式 gate。

## 技术架构

主链路：

```text
WeChat / OpenClaw
  -> message normalization
  -> model-first tool decision
  -> tool-contract validation
  -> calendar-api / seed-lite / scheduler / reminder / memory
  -> Feishu Calendar or local assistant state
  -> short reply
```

主要模块：

- `src/entry`：空输入、长度、重复消息等非语义保护。
- `src/decision`：模型决策接口和真实模型客户端。
- `src/tool-contract`：工具 Schema、参数校验和合同门禁。
- `src/calendar-api`：确定性日历能力，封装创建、查询、修改、删除等操作。
- `src/agent-api`：微信 / OpenClaw 未来调用的受控助手入口。
- `src/seed-lite`：待推进收件箱。
- `src/scheduler`：排程候选生成。
- `src/briefing`：早报、晚报和今日工作台。
- `src/wechat`：微信消息归一和提醒分发。
- `src/memory-dream`：每日记忆整理。
- `src/settings`：读取 GitHub 可发布的非密钥 JSON 设置。
- `src/settings-summary`：只读整理提醒、模型、日历、记忆和运行入口等关键设置。
- `src/status-overview`：只读整理当前挂起的待处理上下文。

更完整的模块职责见 [ARCHITECTURE.md](ARCHITECTURE.md)，能力 API 说明见 [docs/api/capability-apis.md](docs/api/capability-apis.md)。

## 本地运行

安装依赖：

```bash
npm install
```

运行健康检查：

```bash
npm run health
```

运行本地测试：

```bash
npm test
```

运行类型检查：

```bash
npm run typecheck
```

本地 shadow server：

```bash
npm run agent:shadow-server
```

默认只监听 `127.0.0.1:37891`。没有真实环境变量时，大多数 live 命令会失败关闭，这是预期行为。

## 配置方式

Navi 把配置分成两层，方便发布到 GitHub 后别人照着配置：

- `.env`：只放密钥、外部接入和真实写入 gate，例如模型 API Key、飞书 App Secret、真实日历 ID、微信入口 Secret。
- `config/settings.local.json`：只放非密钥产品默认值，例如默认提醒提前量、本地状态文件路径、早晚报开关、排程候选数量。

首次配置可以这样做：

```bash
cp .env.example .env
cp config/settings.example.json config/settings.local.json
```

`config/settings.local.json` 已被 Git 忽略，真实密钥也不要写进 JSON。运行时可用 `NAVI_SETTINGS_FILE` 指定其他设置文件。

## 部署

公开仓库只保留通用部署路径：

1. 在目标机器 clone 仓库并运行 `npm ci`。
2. 复制 `.env.example` 和 `config/settings.example.json`。
3. 在 `.env` 填写模型、飞书、微信入口密钥。
4. 运行 `npm run live:env-doctor` 检查配置。
5. 运行 `npm run agent:shadow-server` 启动本机 shadow route。
6. 用 OpenClaw 调用 `openclaw:shadow-caller-smoke` 做端到端 smoke。

个人机器、Tailscale 地址、用户名、真实运行目录和密钥都不应写入公开仓库。公开边界见 [PUBLICATION.md](PUBLICATION.md)。

## 公开发布

不要直接公开 live 开发仓库和完整 Git 历史。发布到 GitHub 前先生成干净发行目录：

```bash
npm run public:export
npm run public:audit
```

然后把 `dist/public/navi-calendar` 推到单独的公开仓库。这个目录只包含源码、测试、公开说明、配置样例和 GitHub 模板，不包含本机上下文、阶段计划、运行端交接、私有路径或历史排障记录。

完整公开策略见 [docs/public-release.md](docs/public-release.md)。

## 测试方法

常用本机验证：

```bash
npm test
npm run typecheck
git diff --check
```

合并前门禁：

```bash
npm run merge:gate
npm run public:audit
```

真实环境检查：

```bash
npm run live:config
npm run live:env-doctor
npm run live:model-smoke
npm run live:advanced-regression
```

当前本机验证口径：

- 85 个测试文件通过。
- 559 个测试通过。
- 失败 0。
- `npm run typecheck` 通过。
- `git diff --check` 通过。

真实模型验证口径：

- 进阶题库和换题版用于真实运行前回归。
- 公开仓库不记录个人机器地址、远端用户名或本机密码变量。

## GitHub 发布资料

- 公开发布清单：[PUBLICATION.md](PUBLICATION.md)
- OpenClaw 安装和调试：[docs/openclaw/install-and-debug.md](docs/openclaw/install-and-debug.md)
- 中文仓库简介：[docs/github/repository-summary.zh-CN.md](docs/github/repository-summary.zh-CN.md)
- English repository summary：[docs/github/repository-summary.en.md](docs/github/repository-summary.en.md)
- 中文 PR 正文：[docs/github/pull-request.zh-CN.md](docs/github/pull-request.zh-CN.md)
- English PR body：[docs/github/pull-request.en.md](docs/github/pull-request.en.md)

当前机器没有 `gh` CLI。创建 PR 时可使用 GitHub 网页入口，或在配置 `gh` / token 后再走 CLI。

## 搜索记录

- 2026-05-08：已确认本项目是自用 Mac mini 日程助手重构线，不是从旧 Navi 直接续写。
- 2026-05-14：已参考 Toki、TickTick、Todoist 的公开产品能力，结论是优先补齐“先接住、分清楚、可回看、可修改、确认后再行动”的私人助手闭环，不引入番茄钟、后台读屏、截图采集或多用户后台。
- 2026-05-14：已新增 GitHub PR 模板、中文 / 英文 PR 正文和中文 / 英文仓库简介。
- 2026-05-15：已把 GitHub 首页 README 从阶段日志整理成正式项目首页；历史阶段细节保留在 `CONTEXT.md`、`.planning/` 和 `docs/reviews/`。
- 2026-05-15：新增 `config/settings.example.json` 和 `src/settings`，把非密钥产品默认值从 `.env` 中分离出来。
- 2026-05-15：已补 `ARCHITECTURE.md` 当前架构总览，便于新会话和新贡献者先看主链路，再看历史阶段。
- 2026-05-15：新增公开发布清单、OpenClaw 安装调试页和 GitHub Issue 模板，并把 README 的私有运行信息改成公开占位说明。

## 已完成功能

- 隔离旧 Navi，建立新版 model-first 单决策链路。
- 接入飞书日历 fake / live adapter，并保留真实写入 gate。
- 接入微信 / OpenClaw shadow route 和受控 Calendar Agent API。
- 支持创建、查询、修改、删除确认、早晚报和今日工作台。
- 支持 Seed Lite 待推进收件箱。
- 支持排程推荐、多个候选、推荐后调整和批量待推进编号。
- 支持微信 40 分钟提醒策略。
- 支持关键设置总结入口。
- 支持当前状态总览入口。
- 支持 `.env` + `config/settings.local.json` 的双层配置方式。
- 支持图片 OCR 到日程理解链路。
- 支持 memory dream 本地归纳整理。
- 建立能力 API 文档，方便后续 AI 调阅。
- 建立 100 条 TTT 题库和换题验证机制。

## 待办事项

- 把当前 GitHub 首页整理分支合并到默认分支后，GitHub 首页才会直接显示新版 README。
- 外部使用者接入真实环境前，应先按 OpenClaw 安装调试指南跑通本地 smoke。
- 后续体验优化继续按 P32 真实使用闭环推进，每次只做一个清晰小切片。

## 相关文档

- 当前上下文：[CONTEXT.md](CONTEXT.md)
- 架构说明：[ARCHITECTURE.md](ARCHITECTURE.md)
- 产品手册：[docs/product-manual.md](docs/product-manual.md)
- 能力 API：[docs/api/capability-apis.md](docs/api/capability-apis.md)
- OpenClaw 安装和调试：[docs/openclaw/install-and-debug.md](docs/openclaw/install-and-debug.md)
- 公开发布清单：[PUBLICATION.md](PUBLICATION.md)
- 历史复盘：[docs/reviews/](docs/reviews/)
- 阶段计划：[.planning/projects/live-bringup/phases/](.planning/projects/live-bringup/phases/)
