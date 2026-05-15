import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/index.js";
import { evaluateMainCalendarGate } from "../src/live/main-calendar-gate.js";

const baseEnv = {
  MODEL_PROVIDER: "openai-compatible",
  MODEL_BASE_URL: "https://model.example/v1",
  MODEL_API_KEY: "model-key",
  MODEL_NAME: "model",
  FEISHU_APP_ID: "app",
  FEISHU_APP_SECRET: "secret",
  FEISHU_CALENDAR_ID: "test-calendar-id",
  FEISHU_TEST_CALENDAR_ID: "test-calendar-id",
  FEISHU_MAIN_CALENDAR_ID: "main-calendar-id",
  OPENCLAW_WORKSPACE: "/tmp/openclaw",
  WECHAT_ENTRY_SECRET: "entry-secret",
};

describe("main calendar gate", () => {
  it("fails closed without the explicit enable flag", () => {
    const report = evaluateMainCalendarGate(loadConfig(baseEnv), {});

    expect(report.ok).toBe(false);
    expect(report.failures).toContain("缺少 LIVE_MAIN_CALENDAR_ENABLE_REAL_WRITE=1。");
  });

  it("fails closed without the confirmation text", () => {
    const report = evaluateMainCalendarGate(loadConfig(baseEnv), {
      LIVE_MAIN_CALENDAR_ENABLE_REAL_WRITE: "1",
    });

    expect(report.ok).toBe(false);
    expect(report.failures).toContain("缺少 LIVE_MAIN_CALENDAR_CONFIRM_TEXT=NAVI_WRITE_MAIN_CALENDAR。");
  });

  it("fails closed when main calendar equals the test calendar", () => {
    const report = evaluateMainCalendarGate(
      loadConfig({
        ...baseEnv,
        FEISHU_MAIN_CALENDAR_ID: "test-calendar-id",
      }),
      {
        LIVE_MAIN_CALENDAR_ENABLE_REAL_WRITE: "1",
        LIVE_MAIN_CALENDAR_CONFIRM_TEXT: "NAVI_WRITE_MAIN_CALENDAR",
      },
    );

    expect(report.ok).toBe(false);
    expect(report.failures).toContain("FEISHU_MAIN_CALENDAR_ID 不能等于 FEISHU_TEST_CALENDAR_ID。");
  });

  it("passes only with main calendar id and both explicit gates", () => {
    const report = evaluateMainCalendarGate(loadConfig(baseEnv), {
      LIVE_MAIN_CALENDAR_ENABLE_REAL_WRITE: "1",
      LIVE_MAIN_CALENDAR_CONFIRM_TEXT: "NAVI_WRITE_MAIN_CALENDAR",
    });

    expect(report).toMatchObject({ ok: true, targetCalendarId: "main-calendar-id" });
  });
});
