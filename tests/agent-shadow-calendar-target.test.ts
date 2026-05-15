// Shadow 日历目标测试：真实微信入口必须写主日历，不能继续写测试日历。

import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/index.js";
import { resolveShadowCalendarTarget } from "../src/agent-api/shadow-calendar-target.js";

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

describe("shadow calendar target", () => {
  it("uses the main calendar id for the real WeChat shadow server", () => {
    const target = resolveShadowCalendarTarget(loadConfig(baseEnv), {
      LIVE_MAIN_CALENDAR_ENABLE_REAL_WRITE: "1",
      LIVE_MAIN_CALENDAR_CONFIRM_TEXT: "NAVI_WRITE_MAIN_CALENDAR",
    });

    expect(target).toEqual({ ok: true, calendarId: "main-calendar-id" });
  });

  it("fails closed when main calendar gate is not explicitly enabled", () => {
    const target = resolveShadowCalendarTarget(loadConfig(baseEnv), {});

    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.message).toContain("缺少 LIVE_MAIN_CALENDAR_ENABLE_REAL_WRITE=1。");
    }
  });
});
