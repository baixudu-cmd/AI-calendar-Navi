# Publication Checklist

This project is intended to be useful as a public self-hosted calendar assistant repo, while keeping private runtime details out of Git.

## Public by default

These are safe to keep on GitHub:

- Source code under `src/`.
- Tests under `tests/`.
- Example configuration files such as `.env.example` and `config/settings.example.json`.
- Public product docs: `README.md`, `docs/product-manual.md`, `docs/api/capability-apis.md`.
- OpenClaw integration docs and smoke commands.
- Placeholder LaunchAgent examples and public runner scripts under `scripts/`.
- GitHub issue templates and PR templates.

## Keep private

Do not commit:

- `.env`, `.env.*`, local secrets, model keys, Feishu secrets, WeChat secrets.
- Private network addresses, personal usernames, personal machine paths, SSH passwords.
- Real OpenClaw contact IDs, group IDs, account IDs or message logs.
- Local `state/`, `logs/`, `node_modules/`, `.venv/`, `.worktrees/`.
- Private calendar IDs unless they are fake examples.

## Public configuration pattern

Use two layers:

```text
.env
  secrets, external service IDs, runtime gates

config/settings.local.json
  non-secret product defaults
```

Both local files are ignored by Git. Public examples live in:

- `.env.example`
- `config/settings.example.json`

## OpenClaw publishing boundary

OpenClaw can be documented publicly as a transport layer:

```text
OpenClaw receives WeChat message
  -> calls Navi shadow route
  -> sends Navi reply back to WeChat
```

Keep private:

- OpenClaw account IDs.
- Real contact names or group names.
- Machine-specific OpenClaw workspace paths.
- Runtime logs containing user messages.

## Before making a release

Run:

```bash
npm test
npm run typecheck
git diff --check
npm run public:audit
```

Then check:

- `README.md` has no personal IP or machine path.
- `docs/openclaw/install-and-debug.md` uses placeholders for secrets.
- `.env.example` contains only blank placeholders.
- GitHub templates ask users to redact secrets.
- Any new runbook separates public steps from private machine details.

## Historical docs

Some older planning and runbook files may mention local machine paths from private bring-up work. Treat these as internal history. For a fully public release, either move them out of the public branch or rewrite them with placeholders before tagging a release.

## Recommended public workflow

Do not make the live development repository public with its full history. Generate a clean export instead:

```bash
npm run public:export
npm run public:audit
```

Publish only `dist/public/navi-calendar` to the public GitHub repository. This keeps the real runtime, local planning history and private machine notes out of the public project while preserving a complete installable source tree.
