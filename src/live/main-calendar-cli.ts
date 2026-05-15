// 主日历 smoke CLI：必须显式设置 LIVE_MAIN_CALENDAR_ENABLE_REAL_WRITE 和确认文本。

import "dotenv/config";
import type { DeterministicCalendarAdapter } from "../calendar-api/index.js";
import { createLiveFeishuCalendarAdapter } from "../calendar/feishu/live-adapter.js";
import { loadConfig } from "../config/index.js";
import { runMainCalendarSmoke } from "./main-calendar-smoke.js";

const config = loadConfig();
const disabledAdapter: DeterministicCalendarAdapter = failedAdapter(
  "真实主日历 adapter 尚未启用；需要 LIVE_MAIN_CALENDAR_ENABLE_REAL_WRITE=1 和 LIVE_MAIN_CALENDAR_CONFIRM_TEXT=NAVI_WRITE_MAIN_CALENDAR。",
);

const adapter = await resolveAdapter();
const result = await runMainCalendarSmoke({ config, env: process.env, calendar: adapter });

if (!result.ok) {
  console.error(`Main calendar smoke: failed - ${result.message}`);
  process.exitCode = 1;
} else {
  console.log(result.message);
  console.log(`createdEventId=${result.createdEventId}`);
}

// 根据显式 gate 结果决定是否创建真实主日历 adapter。
async function resolveAdapter(): Promise<DeterministicCalendarAdapter> {
  if (
    process.env.LIVE_MAIN_CALENDAR_ENABLE_REAL_WRITE !== "1" ||
    process.env.LIVE_MAIN_CALENDAR_CONFIRM_TEXT !== "NAVI_WRITE_MAIN_CALENDAR" ||
    !config.feishuMainCalendarId
  ) {
    return disabledAdapter;
  }

  const adapterResult = await createLiveFeishuCalendarAdapter({
    config: {
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      calendarId: config.feishuMainCalendarId,
      timezone: config.timezone,
    },
  });

  if (adapterResult.ok) return adapterResult.data;
  return failedAdapter(adapterResult.message);
}

function failedAdapter(message: string): DeterministicCalendarAdapter {
  return {
    async createEvent() {
      return { ok: false, code: "missing_config", message };
    },
    async listEvents() {
      return { ok: false, code: "missing_config", message };
    },
    async updateEvent() {
      return { ok: false, code: "missing_config", message };
    },
    async deleteEvent() {
      return { ok: false, code: "missing_config", message };
    },
  };
}
