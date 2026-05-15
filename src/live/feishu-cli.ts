// live 飞书 smoke CLI；默认失败关闭，只有显式开关才接入真实飞书测试日历。

import "dotenv/config";
import type { DeterministicCalendarAdapter } from "../calendar-api/index.js";
import { createLiveFeishuCalendarAdapter } from "../calendar/feishu/live-adapter.js";
import { loadConfig } from "../config/index.js";
import { runCalendarApiDryRunSmoke } from "./calendar-smoke.js";

const config = loadConfig();

const disabledAdapter: DeterministicCalendarAdapter = {
  async createEvent() {
    return { ok: false, code: "missing_config", message: "真实飞书 adapter 尚未启用；设置 LIVE_FEISHU_ENABLE_REAL_TRANSPORT=1 后才会写测试日历。" };
  },
  async listEvents() {
    return { ok: false, code: "missing_config", message: "真实飞书 adapter 尚未启用；设置 LIVE_FEISHU_ENABLE_REAL_TRANSPORT=1 后才会写测试日历。" };
  },
  async updateEvent() {
    return { ok: false, code: "missing_config", message: "真实飞书 adapter 尚未启用；设置 LIVE_FEISHU_ENABLE_REAL_TRANSPORT=1 后才会写测试日历。" };
  },
  async deleteEvent() {
    return { ok: false, code: "missing_config", message: "真实飞书 adapter 尚未启用；设置 LIVE_FEISHU_ENABLE_REAL_TRANSPORT=1 后才会写测试日历。" };
  },
};

const adapter = await resolveAdapter();
const result = await runCalendarApiDryRunSmoke({
  adapter,
  config,
  date: process.env.LIVE_FEISHU_SMOKE_DATE || "2026-05-09",
  startTime: process.env.LIVE_FEISHU_SMOKE_START_TIME || "09:00",
});

console.log(`Live Feishu smoke: ${result.ok ? "passed" : "failed"}`);
for (const step of result.steps) {
  console.log(`${step.name}: ${step.ok ? "ok" : "failed"} - ${step.message}`);
}

if (!result.ok) {
  process.exitCode = 1;
}

// 根据显式开关决定是否创建真实 adapter。
async function resolveAdapter(): Promise<DeterministicCalendarAdapter> {
  if (process.env.LIVE_FEISHU_ENABLE_REAL_TRANSPORT !== "1") return disabledAdapter;

  const adapterResult = await createLiveFeishuCalendarAdapter({
    config: {
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      calendarId: config.feishuCalendarId,
      timezone: config.timezone,
    },
  });

  if (adapterResult.ok) return adapterResult.data;

  return {
    async createEvent() {
      return adapterResult;
    },
    async listEvents() {
      return adapterResult;
    },
    async updateEvent() {
      return adapterResult;
    },
    async deleteEvent() {
      return adapterResult;
    },
  };
}
