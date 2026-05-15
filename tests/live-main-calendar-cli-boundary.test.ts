import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("main calendar cli boundary", () => {
  it("keeps explicit gate wording visible and does not use old runtime", () => {
    const content = readFileSync(join(process.cwd(), "src/live/main-calendar-cli.ts"), "utf8");

    expect(content).toContain("LIVE_MAIN_CALENDAR_ENABLE_REAL_WRITE");
    expect(content).toContain("NAVI_WRITE_MAIN_CALENDAR");
    expect(content).not.toContain(`${"tracklog"}-${"agent"}`);
    expect(content).not.toContain("action:");
  });

  it("fails closed without explicit main calendar gates", () => {
    const emptyEnvPath = join(mkdtempSync(join(tmpdir(), "navi-empty-env-")), ".env");
    writeFileSync(emptyEnvPath, "", "utf8");
    const result = spawnSync("npm", ["run", "live:main-calendar-smoke"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DOTENV_CONFIG_PATH: emptyEnvPath,
        MODEL_PROVIDER: "openai-compatible",
        MODEL_BASE_URL: "https://example.test/v1",
        MODEL_API_KEY: "fake-model-key",
        MODEL_NAME: "fake-model",
        FEISHU_APP_ID: "fake-app-id",
        FEISHU_APP_SECRET: "fake-feishu-secret",
        FEISHU_CALENDAR_ID: "test-calendar-id",
        FEISHU_TEST_CALENDAR_ID: "test-calendar-id",
        FEISHU_MAIN_CALENDAR_ID: "main-calendar-id",
        OPENCLAW_WORKSPACE: "/home/example/.openclaw",
        WECHAT_ENTRY_SECRET: "fake-wechat-secret",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toContain("LIVE_MAIN_CALENDAR_ENABLE_REAL_WRITE");
    expect(result.stderr + result.stdout).not.toContain("fake-model-key");
    expect(result.stderr + result.stdout).not.toContain("fake-feishu-secret");
    expect(result.stderr + result.stdout).not.toContain("fake-wechat-secret");
  });
});
