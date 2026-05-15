import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("live env doctor CLI", () => {
  it("prints redacted status and does not leak secrets", () => {
    const result = spawnSync("npm", ["run", "live:env-doctor"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        MODEL_PROVIDER: "openai-compatible",
        MODEL_BASE_URL: "https://example.test/v1",
        MODEL_API_KEY: "secret-model-key",
        MODEL_NAME: "fake-model",
        FEISHU_APP_ID: "fake-app-id",
        FEISHU_APP_SECRET: "secret-feishu-key",
        FEISHU_CALENDAR_ID: "test-calendar-id",
        FEISHU_TEST_CALENDAR_ID: "test-calendar-id",
        OPENCLAW_WORKSPACE: "/home/example/.openclaw",
        WECHAT_ENTRY_SECRET: "secret-wechat-key",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Live env doctor: passed");
    expect(result.stdout).toContain("测试日历门禁通过。");
    expect(result.stdout).toContain("MODEL_API_KEY=[set]");
    expect(result.stdout).not.toContain("secret-model-key");
    expect(result.stdout).not.toContain("secret-feishu-key");
    expect(result.stdout).not.toContain("secret-wechat-key");
  });
});
