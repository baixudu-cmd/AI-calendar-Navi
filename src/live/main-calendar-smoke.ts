// 主日历 smoke：创建一个可观察验证事件，并通过查询确认。

import type { DeterministicCalendarAdapter } from "../calendar-api/index.js";
import type { AppConfig, EnvSource } from "../config/index.js";
import { formatCalendarEventDetail } from "../reply/event-format.js";
import { evaluateMainCalendarGate } from "./main-calendar-gate.js";

export type MainCalendarSmokeInput = {
  config: AppConfig;
  env?: EnvSource;
  calendar: DeterministicCalendarAdapter;
  now?: string;
};

export type MainCalendarSmokeResult = {
  ok: boolean;
  message: string;
  createdEventId?: string;
};

// 在主日历创建一个带 Navi 标识的验证事件；默认不删除，方便用户观察。
export async function runMainCalendarSmoke(input: MainCalendarSmokeInput): Promise<MainCalendarSmokeResult> {
  const gate = evaluateMainCalendarGate(input.config, input.env);
  if (!gate.ok) return { ok: false, message: gate.failures.join("；") };

  const base = input.now ? new Date(input.now) : new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: input.config.timezone }).format(base);
  const title = `Navi 主日历写入验证 ${date}`;

  const created = await input.calendar.createEvent({
    title,
    date,
    startTime: "09:00",
    endTime: "09:15",
    notes: "这是 Navi Calendar 的主日历写入验证事件。",
  });
  if (!created.ok) return { ok: false, message: created.message };

  const listed = await input.calendar.listEvents({ date });
  if (!listed.ok) return { ok: false, message: listed.message, createdEventId: created.data.id };

  const found = listed.data.some((event) => event.id === created.data.id);
  if (!found) {
    return {
      ok: false,
      message: "主日历已创建，但查询确认没有找到该事件。",
      createdEventId: created.data.id,
    };
  }

  return {
    ok: true,
    message: `主日历写入验证通过：\n${formatCalendarEventDetail(created.data)}`,
    createdEventId: created.data.id,
  };
}
