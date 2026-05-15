import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("live Feishu smoke CLI boundary", () => {
  it("keeps real Feishu transport behind an explicit switch", () => {
    const content = readFileSync(join(process.cwd(), "src/live/feishu-cli.ts"), "utf8");

    expect(content).not.toContain("axios");
    expect(content).not.toContain("tenant_access_token/internal");
    expect(content).not.toContain("createFeishuCalendarClient");
    expect(content).not.toContain("calendar/feishu/client");
    expect(content).not.toContain("./index.js");
    expect(content).toContain("LIVE_FEISHU_ENABLE_REAL_TRANSPORT");
  });

  it("fails from disabled adapter with complete fake live config", () => {
    const result = spawnSync("npm", ["run", "live:feishu-smoke"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        MODEL_PROVIDER: "openai-compatible",
        MODEL_BASE_URL: "https://example.test/v1",
        MODEL_API_KEY: "fake-model-key",
        MODEL_NAME: "fake-model",
        FEISHU_APP_ID: "fake-app-id",
        FEISHU_APP_SECRET: "fake-feishu-secret",
        FEISHU_CALENDAR_ID: "test-calendar-id",
        FEISHU_TEST_CALENDAR_ID: "test-calendar-id",
        OPENCLAW_WORKSPACE: "/home/example/.openclaw",
        WECHAT_ENTRY_SECRET: "fake-wechat-secret",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Live Feishu smoke: failed");
    expect(result.stdout).toContain("真实飞书 adapter 尚未启用");
    expect(result.stdout).not.toContain("fake-model-key");
    expect(result.stdout).not.toContain("fake-feishu-secret");
    expect(result.stdout).not.toContain("fake-wechat-secret");
  });
});
