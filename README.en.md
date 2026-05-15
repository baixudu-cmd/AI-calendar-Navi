# Navi Calendar

English | [简体中文](README.md)

[![Tests](https://img.shields.io/badge/tests-573%20passing-brightgreen)](#testing)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Runtime](https://img.shields.io/badge/runtime-Node.js%2020%2B-339933)](https://nodejs.org/)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-shadow%20route-111827)](docs/openclaw/install-and-debug.md)

Navi Calendar is a self-hosted WeChat AI calendar assistant. It accepts natural language, voice transcription text, screenshots, and chat snippets, then turns them into reliable calendar actions through controlled tools.

The project is intentionally narrow: it focuses on personal scheduling, todo inbox capture, schedule proposals, daily briefings, reminders, and local memory consolidation.

## Why Navi

- WeChat-first input: text, voice transcription, screenshots, and chat records can all become scheduling context.
- Model for understanding only: calendar writes, state changes, reminders, and deletes are executed by deterministic APIs.
- No calendar write before confirmation: schedule proposals, delete actions, and conflict resolution have explicit gates.
- Self-hostable: secrets live in `.env`; non-secret product defaults live in `config/settings.local.json`.
- OpenClaw-friendly: the repo includes a shadow route and caller smoke command for a lightweight WeChat transport layer.

## Features

- WeChat / OpenClaw entry for text, voice transcription text, and OCR text.
- Single and batch calendar creation.
- Automatic title summarization for chat records with explicit time.
- Calendar query, update, and delete confirmation.
- Conflict-safe creation with clear reporting of unwritten items.
- Daily workbench and morning/evening briefings.
- Todo inbox for unscheduled items.
- Schedule proposals with multiple options and follow-up refinements.
- At-time WeChat reminders and default reminder lead time.
- Read-only settings summary and pending-state overview.
- Context dismissal for short-term pending states.
- Image-to-calendar understanding through OCR plus model interpretation.
- Local memory consolidation for assistant-owned interaction records.

See [docs/product-manual.md](docs/product-manual.md) for the full product guide.

## Quick Start

```bash
git clone https://github.com/<your-account>/navi-calendar.git
cd navi-calendar
npm ci
cp .env.example .env
cp config/settings.example.json config/settings.local.json
npm run health
npm test
```

Live commands fail closed when model, Feishu, or WeChat credentials are missing. Start with local tests, then connect OpenClaw using [docs/openclaw/install-and-debug.md](docs/openclaw/install-and-debug.md).

## OpenClaw Setup

Navi treats OpenClaw as a lightweight WeChat transport:

```text
WeChat / OpenClaw
  -> OpenClaw shadow caller
  -> Navi shadow route
  -> model-first decision
  -> Feishu Calendar / local assistant state
```

Minimal smoke flow:

```bash
npm run agent:shadow-server

OPENCLAW_SHADOW_URL=http://127.0.0.1:37891/calendar-agent/shadow \
OPENCLAW_SHADOW_SECRET=<same-as-WECHAT_ENTRY_SECRET> \
OPENCLAW_SHADOW_TEXT="Schedule a BP discussion tomorrow at 3pm" \
npm run openclaw:shadow-caller-smoke
```

## Configuration

Navi uses two configuration layers:

- `.env`: secrets, external service IDs, and live-write gates.
- `config/settings.local.json`: non-secret product defaults such as reminder lead time, state file paths, briefing toggles, and schedule option count.

Create local config files:

```bash
cp .env.example .env
cp config/settings.example.json config/settings.local.json
```

Do not commit `.env` or `config/settings.local.json`.

## Architecture

```text
WeChat / OpenClaw
  -> message normalization
  -> model-first tool decision
  -> tool-contract validation
  -> calendar-api / seed-lite / scheduler / reminder / memory
  -> Feishu Calendar or local assistant state
  -> short reply
```

Main modules:

- `src/entry`: non-semantic request guards.
- `src/decision`: model decision interface and model client.
- `src/tool-contract`: tool schemas and validation.
- `src/calendar-api`: deterministic calendar operations.
- `src/agent-api`: controlled assistant API for WeChat / OpenClaw.
- `src/seed-lite`: todo inbox.
- `src/scheduler`: schedule candidate generation.
- `src/briefing`: daily briefings and workbench summaries.
- `src/wechat`: message normalization and reminder delivery.
- `src/settings`: public-safe non-secret settings loader.
- `src/status-overview`: read-only pending-state overview.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/api/capability-apis.md](docs/api/capability-apis.md).

## Testing

```bash
npm test
npm run typecheck
```

Before publishing a public repository:

```bash
npm run public:export
npm run public:audit
```

The clean public tree is generated at `dist/public/navi-calendar`.

## Publishing

Do not make the live development repository public with its full history. Generate a clean public tree first:

```bash
npm run public:export
npm run public:audit
cd dist/public/navi-calendar
git init
git add .
git commit -m "Initial public release"
git branch -M main
git remote add origin git@github.com:<your-account>/navi-calendar.git
git push -u origin main
```

Use a new empty GitHub repository for this export. The public tree excludes private context, planning records, machine runbooks, local paths, secrets, and runtime state.

## Public Boundary

Safe to publish:

- `src/`
- `tests/`
- README files
- `ARCHITECTURE.md`
- `PUBLICATION.md`
- `.env.example`
- `config/settings.example.json`
- public docs and GitHub issue templates

Keep private:

- `.env`
- `config/settings.local.json`
- `CONTEXT.md`
- `.planning/`
- private runbooks
- state, logs, local machine paths, tokens, account IDs, and message logs

See [PUBLICATION.md](PUBLICATION.md).
