// P5 主动早晚报和提醒测试：只读日历事实，不触碰旧 private-toki 推送链路。

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DeterministicCalendarAdapter } from "../src/calendar-api/index.js";
import {
  createMemoryProactiveMessageStore,
  formatProactiveBriefingReport,
  runProactiveBriefing,
} from "../src/live/proactive-briefing.js";
import { createMemorySeedLiteStore } from "../src/seed-lite/index.js";

describe("proactive briefing and reminder", () => {
  it("builds a proactive morning briefing from calendar facts", async () => {
    const store = createMemoryProactiveMessageStore();
    const result = await runProactiveBriefing({
      mode: "morning",
      today: "2026-05-14",
      now: "2026-05-14T08:30:00+08:00",
      calendar: createCalendar([
        { id: "evt_1", title: "投委会", start: "2026-05-14 09:00" },
        { id: "evt_2", title: "客户电话", start: "2026-05-14 14:00" },
      ]),
      store,
      commit: true,
    });

    expect(result).toEqual({
      ok: true,
      mode: "morning",
      sent: true,
      key: "briefing:morning:2026-05-14",
      message: "早报｜2026年5月14日 星期四\n1. 2026年5月14日 星期四 09:00 投委会\n2. 2026年5月14日 星期四 14:00 客户电话",
    });
    await expect(store.hasSent("briefing:morning:2026-05-14")).resolves.toBe(true);
  });

  it("sorts proactive morning events by start time", async () => {
    const result = await runProactiveBriefing({
      mode: "morning",
      today: "2026-05-14",
      now: "2026-05-14T08:30:00+08:00",
      calendar: createCalendar([
        { id: "evt_2", title: "客户电话", start: "2026-05-14 14:00" },
        { id: "evt_1", title: "投委会", start: "2026-05-14 09:00" },
      ]),
      store: createMemoryProactiveMessageStore(),
    });

    if (!result.sent) throw new Error("expected morning briefing to be sent");
    expect(result.message).toBe("早报｜2026年5月14日 星期四\n1. 2026年5月14日 星期四 09:00 投委会\n2. 2026年5月14日 星期四 14:00 客户电话");
  });

  it("uses tomorrow for proactive evening briefing", async () => {
    const result = await runProactiveBriefing({
      mode: "evening",
      today: "2026-05-14",
      now: "2026-05-14T20:30:00+08:00",
      calendar: createCalendar([{ id: "evt_3", title: "晨会", start: "2026-05-15 09:30" }]),
      store: createMemoryProactiveMessageStore(),
    });

    if (!result.sent) throw new Error("expected evening briefing to be sent");
    expect(result.key).toBe("briefing:evening:2026-05-15");
    expect(result.message).toBe("晚报｜2026年5月15日 星期五\n1. 2026年5月15日 星期五 09:30 晨会");
  });

  it("adds Seed Lite items to proactive daily briefings", async () => {
    const result = await runProactiveBriefing({
      mode: "morning",
      today: "2026-05-14",
      now: "2026-05-14T08:30:00+08:00",
      calendar: createCalendar([{ id: "evt_1", title: "投委会", start: "2026-05-14 09:00" }]),
      store: createMemoryProactiveMessageStore(),
      seedStore: createMemorySeedLiteStore([{ seedId: "seed_1", title: "整理路演材料" }]),
    });

    if (!result.sent) throw new Error("expected briefing to be sent");
    expect(result.message).toBe(
      "早报｜2026年5月14日 星期四\n1. 2026年5月14日 星期四 09:00 投委会\n待推进收件箱：\n1. 整理路演材料",
    );
  });

  it("sends proactive daily briefings when only Seed Lite items exist", async () => {
    const result = await runProactiveBriefing({
      mode: "evening",
      today: "2026-05-14",
      now: "2026-05-14T21:30:00+08:00",
      calendar: createCalendar([]),
      store: createMemoryProactiveMessageStore(),
      seedStore: createMemorySeedLiteStore([{ seedId: "seed_1", title: "整理路演材料" }]),
    });

    expect(result).toEqual({
      ok: true,
      mode: "evening",
      sent: true,
      key: "briefing:evening:2026-05-15",
      deliveryMode: undefined,
      message: "晚报｜2026年5月15日 星期五\n待推进收件箱：\n1. 整理路演材料",
    });
  });

  it("adds pending schedule context to proactive daily briefings", async () => {
    const result = await runProactiveBriefing({
      mode: "morning",
      today: "2026-05-14",
      now: "2026-05-14T08:30:00+08:00",
      calendar: createCalendar([]),
      store: createMemoryProactiveMessageStore(),
      pendingState: {
        pending_schedule: {
          date: "2026-05-14",
          options: [
            {
              optionNumber: 1,
              items: [
                {
                  itemNumber: 1,
                  title: "拿币",
                  date: "2026-05-14",
                  startTime: "15:00",
                  durationMinutes: 30,
                },
              ],
            },
          ],
        },
      },
    });

    expect(result).toEqual({
      ok: true,
      mode: "morning",
      sent: true,
      key: "briefing:morning:2026-05-14",
      deliveryMode: undefined,
      message: "早报｜2026年5月14日 星期四\n待处理上下文：\n- 待确认推荐：拿币（2026-05-14 15:00）",
    });
  });

  it("keeps empty proactive briefings silent", async () => {
    const result = await runProactiveBriefing({
      mode: "morning",
      today: "2026-05-14",
      now: "2026-05-14T08:30:00+08:00",
      calendar: createCalendar([]),
      store: createMemoryProactiveMessageStore(),
      commit: true,
    });

    expect(result).toEqual({
      ok: true,
      mode: "morning",
      sent: false,
      skippedReason: "no_events",
      message: "没有需要主动发送的日程。",
    });
  });

  it("sends an evening briefing when tomorrow has no schedule", async () => {
    const store = createMemoryProactiveMessageStore();
    const result = await runProactiveBriefing({
      mode: "evening",
      today: "2026-05-14",
      now: "2026-05-14T21:30:00+08:00",
      calendar: createCalendar([]),
      store,
      commit: true,
    });

    expect(result).toEqual({
      ok: true,
      mode: "evening",
      sent: true,
      key: "briefing:evening:2026-05-15",
      message: "晚报｜2026年5月15日 星期五\n明天没有安排日程。",
    });
    await expect(store.hasSent("briefing:evening:2026-05-15")).resolves.toBe(true);
  });

  it("does not send the same proactive briefing twice", async () => {
    const store = createMemoryProactiveMessageStore(["briefing:morning:2026-05-14"]);
    const result = await runProactiveBriefing({
      mode: "morning",
      today: "2026-05-14",
      now: "2026-05-14T08:30:00+08:00",
      calendar: createCalendar([{ id: "evt_1", title: "投委会", start: "2026-05-14 09:00" }]),
      store,
      commit: true,
    });

    expect(result).toEqual({
      ok: true,
      mode: "morning",
      sent: false,
      skippedReason: "duplicate",
      key: "briefing:morning:2026-05-14",
      message: "这条主动消息已经发送过。",
    });
  });

  it("builds reminders only for unsent events inside the 40-minute lead window by default", async () => {
    const store = createMemoryProactiveMessageStore(["reminder:2026-05-14:evt_sent:2026-05-14 08:50"]);
    const result = await runProactiveBriefing({
      mode: "reminder",
      today: "2026-05-14",
      now: "2026-05-14T08:20:00+08:00",
      calendar: createCalendar([
        { id: "evt_sent", title: "已提醒会议", start: "2026-05-14 08:50" },
        { id: "evt_due", title: "投委会", start: "2026-05-14 09:00" },
        { id: "evt_late", title: "客户电话", start: "2026-05-14 10:30" },
      ]),
      store,
      commit: true,
    });

    expect(result.ok).toBe(true);
    expect(result.sent).toBe(true);
    expect(result.message).toBe("日程提醒｜2026年5月14日 星期四\n40 分钟内：2026年5月14日 星期四 09:00 投委会");
    await expect(store.hasSent("reminder:2026-05-14:evt_due:2026-05-14 09:00")).resolves.toBe(true);
  });

  it("prints a concise report", async () => {
    const report = formatProactiveBriefingReport({
      ok: true,
      mode: "morning",
      sent: true,
      key: "briefing:morning:2026-05-14",
      message: "早报｜2026年5月14日 星期四\n1. 2026年5月14日 星期四 09:00 投委会",
    });

    expect(report).toContain("Proactive briefing: passed");
    expect(report).toContain("Sent: yes");
    expect(report).toContain("Mode: morning");
    expect(report).not.toContain("FEISHU_APP_SECRET");
  });

  it("is exposed through package script", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

    expect(pkg.scripts["live:proactive-briefing"]).toBe("tsx src/live/proactive-briefing-cli.ts");
  });

  it("runs from the CLI without real Feishu or WeChat by default", () => {
    const result = spawnSync("npm", ["run", "live:proactive-briefing"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PROACTIVE_MODE: "morning",
        PROACTIVE_TODAY: "2026-05-14",
        PROACTIVE_NOW: "2026-05-14T08:30:00+08:00",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Proactive briefing: passed");
    expect(result.stdout).toContain("Sent: yes");
    expect(result.stdout + result.stderr).not.toContain("FEISHU_APP_SECRET");
    expect(result.stdout + result.stderr).not.toContain(`${"tracklog"}-${"agent"}/scripts/push-weixin-calendar.mjs`);
  });
});

function createCalendar(events: Array<{ id: string; title: string; start: string }>): DeterministicCalendarAdapter {
  return {
    async createEvent() {
      throw new Error("P5 proactive runner must not create events");
    },
    async listEvents(input) {
      const date = input.date || input.range?.startDate;
      return { ok: true, data: events.filter((event) => !date || event.start.startsWith(date)) };
    },
    async updateEvent() {
      throw new Error("P5 proactive runner must not update events");
    },
    async deleteEvent() {
      throw new Error("P5 proactive runner must not delete events");
    },
  };
}
