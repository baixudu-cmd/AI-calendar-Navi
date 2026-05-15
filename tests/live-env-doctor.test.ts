import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/index.js";
import { runLiveEnvDoctor } from "../src/live/index.js";

const safeEnv = {
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
};

describe("runLiveEnvDoctor", () => {
  it("fails closed and redacts secrets when config is missing", () => {
    const result = runLiveEnvDoctor(loadConfig({ MODEL_API_KEY: "secret-model-key" }));

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("Live env doctor: failed");
    expect(result.details.some((line) => line.includes("缺少 MODEL_PROVIDER"))).toBe(true);
    expect(result.redactedConfig.every((line) => /^[A-Z_]+=/u.test(line.slice(2)))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-model-key");
  });

  it("rejects primary calendar", () => {
    const result = runLiveEnvDoctor(loadConfig({ ...safeEnv, FEISHU_CALENDAR_ID: "primary" }));

    expect(result.ok).toBe(false);
    expect(result.details).toContain("live bring-up 不能使用 primary 日历，请配置专用测试日历 ID。");
  });

  it("rejects mismatched test calendar", () => {
    const result = runLiveEnvDoctor(
      loadConfig({
        ...safeEnv,
        FEISHU_CALENDAR_ID: "real-calendar-id",
        FEISHU_TEST_CALENDAR_ID: "test-calendar-id",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.details).toContain("live bring-up 只能使用 FEISHU_TEST_CALENDAR_ID 指定的专用测试日历。");
  });

  it("passes with complete safe test calendar config", () => {
    const result = runLiveEnvDoctor(loadConfig(safeEnv));

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("Live env doctor: passed");
    expect(result.details).toContain("测试日历门禁通过。");
    expect(JSON.stringify(result)).not.toContain("secret-model-key");
    expect(JSON.stringify(result)).not.toContain("secret-feishu-key");
    expect(JSON.stringify(result)).not.toContain("secret-wechat-key");
  });
});
