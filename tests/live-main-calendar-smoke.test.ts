import { describe, expect, it } from "vitest";
import type { DeterministicCalendarAdapter } from "../src/calendar-api/index.js";
import { loadConfig } from "../src/config/index.js";
import { runMainCalendarSmoke } from "../src/live/main-calendar-smoke.js";

const config = loadConfig({
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
});

function createMainCalendarAdapter(): DeterministicCalendarAdapter & { createdTitles: string[] } {
  const createdTitles: string[] = [];
  return {
    createdTitles,
    async createEvent(input) {
      createdTitles.push(input.title);
      return { ok: true, data: { id: "evt_main_1", title: input.title, start: `${input.date} ${input.startTime}` } };
    },
    async listEvents() {
      return { ok: true, data: [{ id: "evt_main_1", title: createdTitles[0], start: "2026-05-11 09:00" }] };
    },
    async updateEvent() {
      throw new Error("main smoke should not update");
    },
    async deleteEvent() {
      throw new Error("main smoke should not delete by default");
    },
  };
}

describe("main calendar smoke", () => {
  it("creates one observable Navi event on the gated main calendar", async () => {
    const calendar = createMainCalendarAdapter();
    const result = await runMainCalendarSmoke({
      config,
      env: {
        LIVE_MAIN_CALENDAR_ENABLE_REAL_WRITE: "1",
        LIVE_MAIN_CALENDAR_CONFIRM_TEXT: "NAVI_WRITE_MAIN_CALENDAR",
      },
      calendar,
      now: "2026-05-11T10:00:00+08:00",
    });

    expect(result.ok).toBe(true);
    expect(result.createdEventId).toBe("evt_main_1");
    expect(result.message).toBe("主日历写入验证通过：\n2026年5月11日 星期一 09:00 Navi 主日历写入验证 2026-05-11");
    expect(calendar.createdTitles[0]).toContain("Navi 主日历写入验证");
  });

  it("stops before calendar writes when the gate fails", async () => {
    const calendar = createMainCalendarAdapter();
    const result = await runMainCalendarSmoke({
      config,
      env: {},
      calendar,
      now: "2026-05-11T10:00:00+08:00",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("LIVE_MAIN_CALENDAR_ENABLE_REAL_WRITE");
    expect(calendar.createdTitles).toEqual([]);
  });
});
