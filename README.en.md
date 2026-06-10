# Navi Calendar

English | [简体中文](README.md)

[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](#testing)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Runtime](https://img.shields.io/badge/runtime-Node.js%2020%2B-339933)](https://nodejs.org/)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-supported-111827)](docs/openclaw/install-and-debug.md)

Navi Calendar is a self-hosted AI calendar assistant. It accepts natural-language requests for calendar creation, search, updates, deletion, reminders, and schedule proposals, then executes them through controlled tools.

The project keeps a simple boundary: the model understands the request, while deterministic tools perform calendar writes, state changes, reminders, and confirmations.

## Features

- Create single, batch, daily recurring, or weekly recurring calendar events from natural language.
- Search, update, and delete calendar events with confirmation gates.
- Capture unscheduled items in a lightweight todo inbox.
- Generate schedule proposals from calendar availability.
- Provide daily briefings, status overview, and settings summary.
- Support default reminders and explicit at-time reminders.
- Route OCR text from images or screenshots through the same calendar flow.
- Consolidate local assistant-owned memory for future schedule recommendations.

See [docs/product-manual.md](docs/product-manual.md) for the full product guide.

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

Live commands fail closed until model, calendar, and messaging credentials are configured. Start with local tests before connecting real services.

## OpenClaw Setup

Navi can use OpenClaw as a lightweight message transport:

```text
WeChat / OpenClaw
  -> Navi shadow route
  -> model-first decision
  -> tool contract
  -> calendar / inbox / scheduler / reminder
```

Minimal smoke flow:

```bash
npm run agent:shadow-server

OPENCLAW_SHADOW_URL=http://127.0.0.1:37891/calendar-agent/shadow \
OPENCLAW_SHADOW_SECRET=<same-as-WECHAT_ENTRY_SECRET> \
OPENCLAW_SHADOW_TEXT="Plan a trip tomorrow at 3pm" \
npm run openclaw:shadow-caller-smoke
```

Full setup guide: [docs/openclaw/install-and-debug.md](docs/openclaw/install-and-debug.md).

## Configuration

Navi uses two configuration layers:

- `.env`: secrets, external service IDs, and live-write switches.
- `config/settings.local.json`: non-secret product defaults such as reminder lead time, state file paths, briefing toggles, and schedule option count.

Local configuration files are ignored by Git. Public examples:

- `.env.example`
- `config/settings.example.json`

## Architecture

```text
message input
  -> entry guards
  -> model decision
  -> tool-contract validation
  -> agent-api orchestration
  -> calendar-api / seed-lite / scheduler / reminder / memory
  -> short reply
```

Core rules:

- User intent is interpreted once by the model.
- Every model-selected tool is validated before execution.
- Calendar writes are confirmed by the calendar API result.
- Deletion, conflict handling, and schedule proposals use confirmation gates.
- Local memory can influence proposals but never writes the calendar by itself.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/api/capability-apis.md](docs/api/capability-apis.md).

## Testing

```bash
npm test
npm run typecheck
```

Before publishing:

```bash
npm run public:export
npm run public:audit
```

The clean public tree is generated at:

```text
dist/public/navi-calendar
```

## Publishing

Use a new empty GitHub repository and publish the clean export:

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

Do not publish the live development repository history directly. See [PUBLICATION.md](PUBLICATION.md).

## Public Boundary

Safe to publish:

- `src/`
- `tests/`
- README / ARCHITECTURE / PUBLICATION
- `.env.example`
- `config/settings.example.json`
- placeholder examples under `ops/launchagents/`
- `scripts/run-memory-dream-launchagent.sh`
- `scripts/run-proactive-launchagent.sh`
- public docs and GitHub issue templates

Keep private:

- `.env`
- `config/settings.local.json`
- local state, logs, runtime folders, account IDs, contact IDs, tokens, and message logs
- private deployment notes and machine paths
