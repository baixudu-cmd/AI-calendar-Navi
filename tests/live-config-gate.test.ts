import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/index.js";
import { evaluateLiveConfigGate, formatLiveConfigGateReport } from "../src/live/index.js";

describe("live config gate", () => {
  it("fails closed when required live config is missing and redacts secrets", () => {
    const report = evaluateLiveConfigGate(
      loadConfig({
        MODEL_API_KEY: "secret-model-key",
        FEISHU_APP_SECRET: "secret-feishu-key",
        WECHAT_ENTRY_SECRET: "secret-wechat-key",
      }),
    );

    expect(report.ok).toBe(false);
    expect(report.failures).toContain("缺少 MODEL_PROVIDER");
    expect(report.failures).toContain("缺少 MODEL_NAME");
    expect(JSON.stringify(report)).not.toContain("secret-model-key");
    expect(JSON.stringify(report)).not.toContain("secret-feishu-key");
    expect(JSON.stringify(report)).not.toContain("secret-wechat-key");
  });

  it("rejects primary calendar for live bring-up", () => {
    const report = evaluateLiveConfigGate(
      loadConfig({
        MODEL_PROVIDER: "openai-compatible",
        MODEL_BASE_URL: "https://example.test/v1",
        MODEL_API_KEY: "secret-model-key",
        MODEL_NAME: "gpt-test",
        FEISHU_APP_ID: "app-id",
        FEISHU_APP_SECRET: "secret-feishu-key",
        FEISHU_CALENDAR_ID: "primary",
        FEISHU_TEST_CALENDAR_ID: "test-calendar-id",
        OPENCLAW_WORKSPACE: "/home/example/.openclaw",
        WECHAT_ENTRY_SECRET: "secret-wechat-key",
      }),
    );

    expect(report.ok).toBe(false);
    expect(report.failures).toContain("live bring-up 不能使用 primary 日历，请配置专用测试日历 ID。");
  });

  it("passes with a dedicated Feishu test calendar id", () => {
    const report = evaluateLiveConfigGate(
      loadConfig({
        MODEL_PROVIDER: "openai-compatible",
        MODEL_BASE_URL: "https://example.test/v1",
        MODEL_API_KEY: "secret-model-key",
        MODEL_NAME: "gpt-test",
        FEISHU_APP_ID: "app-id",
        FEISHU_APP_SECRET: "secret-feishu-key",
        FEISHU_CALENDAR_ID: "test-calendar-id",
        FEISHU_TEST_CALENDAR_ID: "test-calendar-id",
        OPENCLAW_WORKSPACE: "/home/example/.openclaw",
        WECHAT_ENTRY_SECRET: "secret-wechat-key",
      }),
    );

    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it("rejects live calendar id that does not match the dedicated test calendar id", () => {
    const report = evaluateLiveConfigGate(
      loadConfig({
        MODEL_PROVIDER: "openai-compatible",
        MODEL_BASE_URL: "https://example.test/v1",
        MODEL_API_KEY: "secret-model-key",
        MODEL_NAME: "gpt-test",
        FEISHU_APP_ID: "app-id",
        FEISHU_APP_SECRET: "secret-feishu-key",
        FEISHU_CALENDAR_ID: "real-non-primary-calendar-id",
        FEISHU_TEST_CALENDAR_ID: "test-calendar-id",
        OPENCLAW_WORKSPACE: "/home/example/.openclaw",
        WECHAT_ENTRY_SECRET: "secret-wechat-key",
      }),
    );

    expect(report.ok).toBe(false);
    expect(report.failures).toContain("live bring-up 只能使用 FEISHU_TEST_CALENDAR_ID 指定的专用测试日历。");
  });

  it("formats a short report for CLI use", () => {
    const text = formatLiveConfigGateReport({
      ok: false,
      failures: ["缺少 MODEL_PROVIDER"],
      diagnostics: { missing: ["MODEL_PROVIDER"], values: { MODEL_API_KEY: "[set]" } },
    });

    expect(text).toContain("Live config gate: failed");
    expect(text).toContain("缺少 MODEL_PROVIDER");
    expect(text).toContain("MODEL_API_KEY=[set]");
  });
});
