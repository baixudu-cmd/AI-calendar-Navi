// P5/P6 主动消息 CLI：默认 fake calendar + dry-run；显式开关后才只读真实主日历或发送微信。

import "dotenv/config";
import type { DeterministicCalendarAdapter } from "../calendar-api/index.js";
import { createLiveFeishuCalendarAdapter } from "../calendar/feishu/live-adapter.js";
import type { FeishuCalendarEvent } from "../calendar/feishu/types.js";
import { loadConfig } from "../config/index.js";
import {
  createFileProactiveMessageStore,
  createMemoryProactiveMessageStore,
  formatProactiveBriefingReport,
  runProactiveBriefing,
  type ProactiveMode,
} from "./proactive-briefing.js";
import { createFileSeedLiteStore } from "../seed-lite/index.js";
import {
  createDryRunProactiveDelivery,
  createOpenClawWeixinProactiveDelivery,
  type ProactiveDelivery,
} from "./proactive-delivery.js";
import { loadAppSettings } from "../settings/index.js";

const config = loadConfig();
const appSettings = loadAppSettings();
const mode = readMode(process.env.PROACTIVE_MODE);
const today = process.env.PROACTIVE_TODAY || todayInTimezone(config.timezone);
const now = process.env.PROACTIVE_NOW || new Date().toISOString();
const commit = process.env.PROACTIVE_COMMIT === "1";
const store = process.env.PROACTIVE_STATE_FILE
  ? createFileProactiveMessageStore(process.env.PROACTIVE_STATE_FILE)
  : createMemoryProactiveMessageStore();
const delivery = resolveDelivery();

if (!delivery.ok) {
  console.log(formatProactiveBriefingReport({ ok: false, mode, sent: false, message: delivery.message }));
  process.exitCode = 1;
  process.exit();
}

const calendar = await resolveCalendar();
const result = await runProactiveBriefing({
  mode,
  today,
  now,
  calendar,
  store,
  commit,
  delivery: delivery.data,
  seedStore: createFileSeedLiteStore(process.env.PROACTIVE_SEED_FILE || appSettings.stateFiles.seedLite),
  reminderLeadMinutes: readNumber(process.env.PROACTIVE_REMINDER_LEAD_MINUTES) || appSettings.reminders.proactiveLeadMinutes,
});

console.log(formatProactiveBriefingReport(result));
if (!result.ok) process.exitCode = 1;

async function resolveCalendar(): Promise<DeterministicCalendarAdapter> {
  if (process.env.LIVE_PROACTIVE_ENABLE_REAL_READ !== "1") return createFakeCalendar();
  if (!config.feishuMainCalendarId) return failedAdapter("缺少 FEISHU_MAIN_CALENDAR_ID，不能读取主日历。");

  const adapterResult = await createLiveFeishuCalendarAdapter({
    config: {
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      calendarId: config.feishuMainCalendarId,
      timezone: config.timezone,
      defaultAttendeeOpenId: config.feishuDefaultAttendeeOpenId,
    },
  });

  if (adapterResult.ok) return adapterResult.data;
  return failedAdapter(adapterResult.message);
}

function resolveDelivery(): { ok: true; data: ProactiveDelivery } | { ok: false; message: string } {
  if (process.env.PROACTIVE_DELIVERY_MODE !== "wechat") return { ok: true, data: createDryRunProactiveDelivery() };
  if (process.env.LIVE_PROACTIVE_ENABLE_WECHAT_SEND !== "1") {
    return { ok: false, message: "缺少 LIVE_PROACTIVE_ENABLE_WECHAT_SEND=1，不能真实发送微信。" };
  }
  if (!process.env.PROACTIVE_WECHAT_TARGET || !process.env.PROACTIVE_WECHAT_ACCOUNT_ID) {
    return { ok: false, message: "缺少 PROACTIVE_WECHAT_TARGET 或 PROACTIVE_WECHAT_ACCOUNT_ID，不能真实发送微信。" };
  }

  return {
    ok: true,
    data: createOpenClawWeixinProactiveDelivery({
      openclawPath: process.env.PROACTIVE_OPENCLAW_PATH,
      accountId: process.env.PROACTIVE_WECHAT_ACCOUNT_ID,
      target: process.env.PROACTIVE_WECHAT_TARGET,
    }),
  };
}

function createFakeCalendar(): DeterministicCalendarAdapter {
  const events: FeishuCalendarEvent[] = [
    { id: "proactive_evt_1", title: "投委会", start: `${today} 09:00` },
    { id: "proactive_evt_2", title: "客户电话", start: `${mode === "evening" ? addDays(today, 1) : today} 14:00` },
  ];

  return {
    async createEvent() {
      throw new Error("主动消息 CLI 默认不创建日程。");
    },
    async listEvents(input) {
      const date = input.date || input.range?.startDate;
      return { ok: true, data: events.filter((event) => !date || event.start.startsWith(date)) };
    },
    async updateEvent() {
      throw new Error("主动消息 CLI 默认不修改日程。");
    },
    async deleteEvent() {
      throw new Error("主动消息 CLI 默认不删除日程。");
    },
  };
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

function readMode(value: string | undefined): ProactiveMode {
  if (value === "evening" || value === "reminder") return value;
  return "morning";
}

function readNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

function addDays(dateText: string, days: number): string {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
