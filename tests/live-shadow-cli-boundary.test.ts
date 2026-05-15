import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("live shadow message CLI boundary", () => {
  it("does not import real OpenClaw, WeChat, Feishu, or calendar modules by default", () => {
    const content = readFileSync(join(process.cwd(), "src/live/shadow-cli.ts"), "utf8");

    expect(content).not.toContain("openclaw");
    expect(content).not.toContain("calendar-api");
    expect(content).not.toContain("calendar/feishu");
    expect(content).not.toContain("createFeishuCalendarClient");
    expect(content).not.toContain("./index.js");
  });

  it("prints observable ids with complete fake live config", () => {
    const result = spawnSync("npm", ["run", "live:shadow-message"], {
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
        WECHAT_ENTRY_SECRET: "shadow-secret",
        LIVE_SHADOW_SECRET: "shadow-secret",
        LIVE_SHADOW_REQUEST_ID: "req_cli",
        LIVE_SHADOW_MESSAGE_ID: "msg_cli",
        LIVE_SHADOW_TEXT: "看看明天日程",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Live shadow message: handled");
    expect(result.stdout).toContain("requestId=req_cli");
    expect(result.stdout).toContain("messageId=msg_cli");
    expect(result.stdout).toContain("shadow reply");
    expect(result.stdout).not.toContain("fake-model-key");
    expect(result.stdout).not.toContain("fake-feishu-secret");
  });
});
