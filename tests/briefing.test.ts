// 日报模块测试：验证早晚日报日期、状态写入和日报序号解析。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executeDailyBriefing, resolveBriefingItemUpdate } from "../src/briefing/index.js";
import type { CalendarAdapter } from "../src/calendar/action-executor.js";
import { createMemorySeedLiteStore } from "../src/seed-lite/index.js";
import { createShortTermStateStore } from "../src/state/index.js";

function createCalendar(eventsByDate: Record<string, Array<{ id: string; title: string; start: string }>>): CalendarAdapter {
  return {
    async createEvent(event) {
      return { ok: true, data: { id: "created", title: event.title, start: `${event.date} ${event.startTime}` } };
    },
    async listEvents(input) {
      return { ok: true, data: eventsByDate[input.date || ""] || [] };
    },
    async updateEvent(input) {
      return { ok: true, data: { id: input.eventId, title: input.patch.title || "改后", start: "" } };
    },
    async deleteEvent(input) {
      return { ok: true, data: { eventId: input.eventId } };
    },
  };
}

describe("briefing", () => {
  it("builds morning briefing for today and stores numbered items", async () => {
    const state = createShortTermStateStore();
    const result = await executeDailyBriefing({
      briefingType: "morning",
      today: "2026-05-09",
      state,
      calendar: createCalendar({ "2026-05-09": [{ id: "evt_1", title: "见张总", start: "15:00" }] }),
    });

    expect(result).toEqual({ ok: true, reply: "早报｜2026年5月9日 星期六\n今日日程：\n1. 2026年5月9日 星期六 15:00 见张总" });
    expect(state.snapshot().briefing_items).toEqual([
      { itemNumber: 1, eventId: "evt_1", title: "见张总", date: "2026-05-09", startTime: "15:00" },
    ]);
  });

  it("orders same-day briefing items from morning to evening", async () => {
    const state = createShortTermStateStore();
    const result = await executeDailyBriefing({
      briefingType: "morning",
      today: "2026-05-13",
      state,
      calendar: createCalendar({
        "2026-05-13": [
          { id: "evt_1", title: "阅盟材料", start: "18:00" },
          { id: "evt_2", title: "DCF", start: "10:00" },
        ],
      }),
    });

    expect(result).toEqual({
      ok: true,
      reply: "早报｜2026年5月13日 星期三\n今日日程：\n1. 2026年5月13日 星期三 10:00 DCF\n2. 2026年5月13日 星期三 18:00 阅盟材料",
    });
    expect(state.snapshot().briefing_items).toEqual([
      { itemNumber: 1, eventId: "evt_2", title: "DCF", date: "2026-05-13", startTime: "10:00" },
      { itemNumber: 2, eventId: "evt_1", title: "阅盟材料", date: "2026-05-13", startTime: "18:00" },
    ]);
  });

  it("builds evening briefing for tomorrow", async () => {
    const result = await executeDailyBriefing({
      briefingType: "evening",
      today: "2026-05-09",
      state: createShortTermStateStore(),
      calendar: createCalendar({ "2026-05-10": [{ id: "evt_2", title: "电话会", start: "09:00" }] }),
    });

    expect(result).toEqual({ ok: true, reply: "晚报｜2026年5月10日 星期日\n明日日程：\n1. 2026年5月10日 星期日 09:00 电话会" });
  });

  it("uses an explicit target date for briefing requests like tomorrow schedule", async () => {
    const state = createShortTermStateStore();
    const result = await executeDailyBriefing({
      briefingType: "morning",
      date: "2026-06-11",
      today: "2026-06-10",
      state,
      calendar: createCalendar({
        "2026-06-10": [{ id: "evt_today", title: "今天的会", start: "14:00" }],
        "2026-06-11": [{ id: "evt_tomorrow", title: "明天的会", start: "14:00" }],
      }),
    });

    expect(result).toEqual({ ok: true, reply: "早报｜2026年6月11日 星期四\n日程：\n1. 2026年6月11日 星期四 14:00 明天的会" });
    expect(state.snapshot().briefing_items).toEqual([
      { itemNumber: 1, eventId: "evt_tomorrow", title: "明天的会", date: "2026-06-11", startTime: "14:00" },
    ]);
  });

  it("includes numbered pending todos in daily briefing when a seed store is provided", async () => {
    const result = await executeDailyBriefing({
      briefingType: "morning",
      today: "2026-05-09",
      state: createShortTermStateStore(),
      calendar: createCalendar({ "2026-05-09": [{ id: "evt_1", title: "电话会", start: "10:00" }] }),
      seedStore: createMemorySeedLiteStore([
        { seedId: "seed_1", title: "拿币" },
        { seedId: "seed_2", title: "整理材料", targetDate: "2026-05-12" },
      ]),
    });

    expect(result.ok).toBe(true);
    expect(result.reply).toContain("早报｜2026年5月9日 星期六");
    expect(result.reply).toContain("今日日程：");
    expect(result.reply).toContain("1. 2026年5月9日 星期六 10:00 电话会");
    expect(result.reply).toContain("待处理工作台：");
    expect(result.reply).toContain("我现在帮你盯着 2 件事");
    expect(result.reply).toContain("待安排：");
    expect(result.reply).toContain("整理材料（2026-05-12）");
    expect(result.reply).toContain("待推进：");
    expect(result.reply).toContain("拿币");
    expect(result.reply).toContain("第几个今天下午");
    expect(result.reply).toContain("第几个完成了");
  });

  it("syncs grouped Watchlist state after daily briefing", async () => {
    const state = createShortTermStateStore();
    const result = await executeDailyBriefing({
      briefingType: "morning",
      today: "2026-05-09",
      state,
      calendar: createCalendar({}),
      seedStore: createMemorySeedLiteStore([
        { seedId: "seed_1", title: "订票", reminderAt: "2026-05-10 09:00" },
        { seedId: "seed_2", title: "整理材料", targetDate: "2026-05-11" },
        { seedId: "seed_3", title: "拿币" },
        { seedId: "seed_4", title: "旧事项", status: "shelved" },
      ]),
    });

    expect(result.ok).toBe(true);
    expect(state.snapshot()).toMatchObject({
      seed_items: [
        { seedId: "seed_1", title: "订票" },
        { seedId: "seed_2", title: "整理材料" },
        { seedId: "seed_3", title: "拿币" },
      ],
      pending_reminder_seed_items: [{ seedId: "seed_1", title: "订票" }],
      pending_schedule_seed_items: [{ seedId: "seed_2", title: "整理材料" }],
      pending_todo_seed_items: [{ seedId: "seed_3", title: "拿币" }],
      shelved_seed_items: [{ seedId: "seed_4", title: "旧事项" }],
    });
  });

  it("gently pulls back overdue watchlist items in daily briefing", async () => {
    const result = await executeDailyBriefing({
      briefingType: "morning",
      today: "2026-05-14",
      state: createShortTermStateStore(),
      calendar: createCalendar({}),
      seedStore: createMemorySeedLiteStore([
        { seedId: "seed_1", title: "整理材料", targetDate: "2026-05-13" },
        { seedId: "seed_2", title: "订 1011 的 PS", reminderAt: "2026-05-13 08:00" },
      ]),
    });

    expect(result.ok).toBe(true);
    expect(result.reply).toContain("温和拉回：整理材料、订 1011 的 PS 已过原定时间");
    expect(result.reply).toContain("可以在对应分组里说“待安排里的第几个今天下午”或“待提醒里的第几个提前 2 小时”");
    expect(result.reply).not.toContain("可以回“今天下午处理”“先不管”或“完成了”");
  });

  it("records gentle pullback progress once per day", async () => {
    const seedStore = createMemorySeedLiteStore([{ seedId: "seed_1", title: "整理材料", targetDate: "2026-05-13" }]);

    await executeDailyBriefing({
      briefingType: "morning",
      today: "2026-05-14",
      state: createShortTermStateStore(),
      calendar: createCalendar({}),
      seedStore,
    });
    await executeDailyBriefing({
      briefingType: "evening",
      today: "2026-05-14",
      state: createShortTermStateStore(),
      calendar: createCalendar({}),
      seedStore,
    });

    await expect(seedStore.list()).resolves.toMatchObject([
      { seedId: "seed_1", title: "整理材料", pullbackCount: 1, lastPullbackAt: "2026-05-14" },
    ]);
  });

  it("shelves overdue watchlist items after two prior pullbacks", async () => {
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "整理材料", targetDate: "2026-05-13", pullbackCount: 2, lastPullbackAt: "2026-05-15" },
    ]);

    const result = await executeDailyBriefing({
      briefingType: "morning",
      today: "2026-05-16",
      state: createShortTermStateStore(),
      calendar: createCalendar({}),
      seedStore,
    });

    expect(result.ok).toBe(true);
    expect(result.reply).not.toContain("温和拉回：整理材料");
    expect(result.reply).toContain("搁置区还有 1 件");
    await expect(seedStore.list()).resolves.toMatchObject([
      { seedId: "seed_1", title: "整理材料", status: "shelved", pullbackCount: 2, lastPullbackAt: "2026-05-15" },
    ]);
  });

  it("surfaces unresolved schedule context in daily briefing", async () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-09",
        options: [
          {
            optionNumber: 1,
            items: [{ itemNumber: 1, title: "整理 DCF", date: "2026-05-09", startTime: "15:00", durationMinutes: 60 }],
          },
        ],
      },
    });

    const result = await executeDailyBriefing({
      briefingType: "morning",
      today: "2026-05-09",
      state,
      calendar: createCalendar({ "2026-05-09": [{ id: "evt_1", title: "电话会", start: "10:00" }] }),
    });

    expect(result.ok).toBe(true);
    expect(result.reply).toContain("待处理工作台：");
    expect(result.reply).toContain("我现在帮你盯着 1 件事");
    expect(result.reply).toContain("待确认：");
    expect(result.reply).toContain("排程推荐：整理 DCF（2026-05-09 15:00）");
    expect(result.reply).toContain("待确认里的排程推荐可以说“确认第 1 个推荐位”");
  });

  it("uses tomorrow wording when evening briefing has no events", async () => {
    const result = await executeDailyBriefing({
      briefingType: "evening",
      today: "2026-05-09",
      state: createShortTermStateStore(),
      calendar: createCalendar({}),
    });

    expect(result).toEqual({ ok: true, reply: "晚报｜2026年5月10日 星期日\n这一天没有日程。" });
  });

  it("keeps daily briefing on the calendar-api list wrapper", () => {
    const source = readFileSync(new URL("../src/briefing/index.ts", import.meta.url), "utf8");

    expect(source).toContain("from \"../calendar-api/index.js\"");
    expect(source).toContain("listEvents(input.calendar");
    expect(source).not.toContain("input.calendar.listEvents");
  });

  it("resolves briefing item update into last_event update", () => {
    const state = createShortTermStateStore({ briefing_items: [{ itemNumber: 2, eventId: "evt_2", title: "电话会" }] });

    expect(
      resolveBriefingItemUpdate(
        { type: "update_event", target: { kind: "briefing_item", itemNumber: 2 }, patch: { title: "改电话会" } },
        state,
      ),
    ).toEqual({
      ok: true,
      action: { type: "update_event", target: { kind: "last_event", eventId: "evt_2" }, patch: { title: "改电话会" } },
    });
  });

  it("fills item date for briefing item time-only updates", () => {
    const state = createShortTermStateStore({
      briefing_items: [{ itemNumber: 1, eventId: "evt_1", title: "董事会", date: "2026-05-09", startTime: "10:00" }],
    });

    expect(
      resolveBriefingItemUpdate(
        { type: "update_event", target: { kind: "briefing_item", itemNumber: 1 }, patch: { startTime: "16:00" } },
        state,
      ),
    ).toEqual({
      ok: true,
      action: {
        type: "update_event",
        target: { kind: "last_event", eventId: "evt_1" },
        patch: { date: "2026-05-09", startTime: "16:00" },
      },
    });
  });

  it("returns failure when briefing item is missing", () => {
    const state = createShortTermStateStore();

    expect(
      resolveBriefingItemUpdate(
        { type: "update_event", target: { kind: "briefing_item", itemNumber: 3 }, patch: { title: "改" } },
        state,
      ),
    ).toEqual({
      ok: false,
      message: "没有找到日报里的第 3 条。",
    });
  });
});
