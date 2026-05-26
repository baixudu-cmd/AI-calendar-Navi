import { describe, expect, it } from "vitest";
import { handleCalendarAgentRequest } from "../src/agent-api/index.js";
import type { CalendarAdapter } from "../src/calendar/action-executor.js";
import type { DecisionClient } from "../src/decision/index.js";
import { createMemoryMemoryDreamStore } from "../src/memory-dream/index.js";
import { createMemorySeedLiteStore } from "../src/seed-lite/index.js";
import { createShortTermStateStore } from "../src/state/index.js";
import { DEFAULT_WECHAT_REMINDER_LEAD_MINUTES, buildWechatReminderJobs, createMemoryWechatReminderStore } from "../src/wechat-reminder/index.js";

function createFakeCalendar(): CalendarAdapter {
  const events: Array<{ id: string; title: string; start: string; end?: string }> = [];
  return {
    async createEvent(event) {
      const created = {
        id: `evt_${events.length + 1}`,
        title: event.title,
        start: `${event.date} ${event.startTime}`,
        ...(event.endTime ? { end: `${event.date} ${event.endTime}` } : {}),
      };
      events.push(created);
      return { ok: true, data: created };
    },
    async listEvents() {
      return { ok: true, data: events };
    },
    async updateEvent(input) {
      const event = events.find((candidate) => candidate.id === input.eventId);
      if (!event) return { ok: false, code: "not_found", message: "没有找到日程。" };
      if (input.patch.title) event.title = input.patch.title;
      if (input.patch.date && input.patch.startTime) event.start = `${input.patch.date} ${input.patch.startTime}`;
      return { ok: true, data: event };
    },
    async deleteEvent(input) {
      return { ok: true, data: { eventId: input.eventId } };
    },
  };
}

function decisionClient(decision: unknown): DecisionClient {
  return { decide: async () => decision };
}

describe("handleCalendarAgentRequest", () => {
  it("summarizes unfinished assistant context without touching calendar", async () => {
    let listCalls = 0;
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "整理路演材料", reminderAt: "2026-05-16 14:00" },
      { seedId: "seed_2", title: "订 1011 的 PS", targetDate: "2026-05-17" },
      { seedId: "seed_3", title: "拿币" },
    ]);
    const state = createShortTermStateStore({
      pending_clarification: {
        question: "这个日程几点开始？",
        missing: ["startTime"],
        createDraft: { title: "和张总聊 BP", date: "2026-05-16" },
      },
      pending_schedule: {
        date: "2026-05-16",
        options: [
          {
            optionNumber: 1,
            items: [{ itemNumber: 1, title: "看 DCF", date: "2026-05-16", startTime: "15:00", durationMinutes: 60 }],
          },
        ],
      },
      pending_delete: { eventId: "evt_delete", title: "旧电话会", source: "last_event", date: "2026-05-16", startTime: "10:00" },
    });

    const calendar: CalendarAdapter = {
      ...createFakeCalendar(),
      async listEvents() {
        listCalls += 1;
        return { ok: true, data: [] };
      },
    };

    const result = await handleCalendarAgentRequest({
      text: "你现在记着我什么？",
      requestId: "req_status_overview",
      state,
      decisionClient: decisionClient({ type: "status_overview" }),
      calendar,
      seedStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "status_overview", requestId: "req_status_overview" });
    expect(result.reply).toContain("我现在帮你盯着 6 件事");
    expect(result.reply).toContain("待补信息 1 件");
    expect(result.reply).toContain("待确认 2 件");
    expect(result.reply).toContain("待安排 1 件");
    expect(result.reply).toContain("待提醒 1 件");
    expect(result.reply).toContain("待推进 1 件");
    expect(result.reply).toContain("待补信息：和张总聊 BP");
    expect(result.reply).toContain("待确认：");
    expect(result.reply).toContain("排程推荐：");
    expect(result.reply).toContain("看 DCF");
    expect(result.reply).toContain("删除确认：旧电话会");
    expect(result.reply).toContain("待提醒：");
    expect(result.reply).toContain("整理路演材料（2026-05-16 14:00）");
    expect(result.reply).toContain("待安排：");
    expect(result.reply).toContain("订 1011 的 PS（2026-05-17）");
    expect(result.reply).toContain("待推进：");
    expect(result.reply).toContain("拿币");
    expect(result.reply).toContain("待确认里的排程推荐可以说“确认第 1 个推荐位”");
    expect(result.reply).toContain("待确认里的删除确认可以说“确认删除”或“取消删除”");
    expect(result.reply).toContain("待推进里的第几个完成了");
    expect(result.reply).toContain("待安排里的第几个今天下午");
    expect(result.reply).toContain("待提醒里的第几个不用提醒");
    expect(result.reply).toContain("待提醒里的第几个提前 2 小时");
    expect(result.reply).toContain("待推进里的第几个先不管");
    expect(result.reply).not.toContain("排程推荐可以回“选 1”确认");
    expect(result.reply).not.toContain("或“提醒提前 2 小时”");
    expect(result.reply).not.toContain("或“第二个先不管”");
    expect(state.snapshot().seed_items).toHaveLength(3);
    expect(listCalls).toBe(0);
  });

  it("dismisses current pending context without touching calendar or persistent inbox", async () => {
    let calendarCalls = 0;
    const state = createShortTermStateStore({
      last_event: { eventId: "evt_last", title: "已创建日程", date: "2026-05-16", startTime: "09:00" },
      pending_clarification: {
        question: "这个日程几点开始？",
        missing: ["startTime"],
        createDraft: { title: "和张总聊 BP", date: "2026-05-16" },
      },
      pending_schedule: {
        date: "2026-05-16",
        options: [
          {
            optionNumber: 1,
            items: [{ itemNumber: 1, title: "看 DCF", date: "2026-05-16", startTime: "15:00", durationMinutes: 60 }],
          },
        ],
      },
      pending_delete: { eventId: "evt_delete", title: "旧电话会", source: "last_event", date: "2026-05-16", startTime: "10:00" },
      pending_conflict: {
        action: { type: "create_event", event: { title: "冲突会", date: "2026-05-16", startTime: "10:00" } },
        conflicts: [{ existingEventId: "evt_delete", title: "旧电话会", start: "2026-05-16 10:00" }],
      },
      pending_image_draft: { title: "图片日程", date: "2026-05-16", startTime: "11:00" },
      seed_items: [{ seedId: "seed_1", title: "整理路演材料", createdAt: "2026-05-15T09:00:00.000Z" }],
    });
    const calendar: CalendarAdapter = {
      async createEvent() {
        calendarCalls += 1;
        return { ok: false, code: "api_error", message: "不应该创建日历。" };
      },
      async listEvents() {
        calendarCalls += 1;
        return { ok: true, data: [] };
      },
      async updateEvent() {
        calendarCalls += 1;
        return { ok: false, code: "api_error", message: "不应该修改日历。" };
      },
      async deleteEvent() {
        calendarCalls += 1;
        return { ok: false, code: "api_error", message: "不应该删除日历。" };
      },
    };

    const result = await handleCalendarAgentRequest({
      text: "算了，先不管了",
      requestId: "req_dismiss_context",
      state,
      decisionClient: decisionClient({ type: "dismiss_context" }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "dismiss_context", requestId: "req_dismiss_context" });
    expect(result.reply).toContain("已清空当前待处理上下文");
    expect(calendarCalls).toBe(0);
    expect(state.snapshot()).toEqual({
      last_event: { eventId: "evt_last", title: "已创建日程", date: "2026-05-16", startTime: "09:00" },
      seed_items: [{ seedId: "seed_1", title: "整理路演材料", createdAt: "2026-05-15T09:00:00.000Z" }],
    });
  });

  it("returns a redacted settings summary without touching calendar", async () => {
    let createCalls = 0;
    let listCalls = 0;
    const calendar: CalendarAdapter = {
      async createEvent(event) {
        createCalls += 1;
        return { ok: true, data: { id: "evt_settings", title: event.title, start: `${event.date} ${event.startTime}` } };
      },
      async listEvents() {
        listCalls += 1;
        return { ok: true, data: [] };
      },
      async updateEvent() {
        return { ok: false, code: "api_error", message: "不应该修改日历。" };
      },
      async deleteEvent() {
        return { ok: false, code: "api_error", message: "不应该删除日历。" };
      },
    };

    const result = await handleCalendarAgentRequest({
      text: "提醒时间和模型设置在哪里改？",
      requestId: "req_settings_summary",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({ type: "settings_summary", topic: "all" }),
      calendar,
      defaultWechatReminderLeadMinutes: [40],
      settingsEnv: {
        MODEL_PROVIDER: "openai-compatible",
        MODEL_BASE_URL: "https://model.example/v1",
        MODEL_API_KEY: "secret-model-key",
        MODEL_NAME: "mimo-v2.5-pro",
        FEISHU_MAIN_CALENDAR_ID: "main-calendar-id",
        FEISHU_TEST_CALENDAR_ID: "test-calendar-id",
        FEISHU_CALENDAR_ID: "sandbox-calendar-id",
        TIMEZONE: "Asia/Shanghai",
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "settings_summary", requestId: "req_settings_summary" });
    expect(result.reply).toContain("默认微信提醒：提前 40 分钟");
    expect(result.reply).toContain("WECHAT_REMINDER_LEAD_MINUTES");
    expect(result.reply).toContain("PROACTIVE_REMINDER_LEAD_MINUTES");
    expect(result.reply).toContain("MODEL_PROVIDER：openai-compatible");
    expect(result.reply).toContain("MODEL_API_KEY：[set]");
    expect(result.reply).not.toContain("secret-model-key");
    expect(result.reply).toContain("FEISHU_MAIN_CALENDAR_ID：main-calendar-id");
    expect(result.reply).not.toContain("第一个改到 11 点");
    expect(result.reply).toContain("Mac mini 运行目录的 .env");
    expect(createCalls).toBe(0);
    expect(listCalls).toBe(0);
  });

  it("loads Seed Lite inbox items into decision state before model routing", async () => {
    const capturedStates: unknown[] = [];
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "拿币" },
      { seedId: "seed_2", title: "整理 DCF" },
    ]);

    const result = await handleCalendarAgentRequest({
      text: "第二个先别提醒了",
      requestId: "req_seed_state_before_decision",
      state: createShortTermStateStore(),
      decisionClient: {
        decide: async (request) => {
          capturedStates.push(request.state);
          return { type: "manage_todos", operation: "delete", target: { itemNumber: 2 } };
        },
      },
      calendar: createFakeCalendar(),
      seedStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "manage_todos" });
    expect(capturedStates[0]).toMatchObject({
      seed_items: [
        { seedId: "seed_1", title: "拿币" },
        { seedId: "seed_2", title: "整理 DCF" },
      ],
    });
  });

  it("keeps shelved todos separate from active decision state before model routing", async () => {
    const capturedStates: unknown[] = [];
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "整理材料", targetDate: "2026-05-13", status: "shelved" },
      { seedId: "seed_2", title: "拿币" },
    ]);

    const result = await handleCalendarAgentRequest({
      text: "第一个完成了",
      requestId: "req_seed_state_shelved_split",
      state: createShortTermStateStore(),
      decisionClient: {
        decide: async (request) => {
          capturedStates.push(request.state);
          return { type: "manage_todos", operation: "complete", target: { itemNumber: 1 } };
        },
      },
      calendar: createFakeCalendar(),
      seedStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "manage_todos" });
    expect(result.reply).toContain("已完成待推进：拿币");
    expect(capturedStates[0]).toMatchObject({
      seed_items: [{ seedId: "seed_2", title: "拿币" }],
      shelved_seed_items: [{ seedId: "seed_1", title: "整理材料", status: "shelved" }],
    });
  });

  it("loads grouped watchlist items into decision state before model routing", async () => {
    const capturedStates: unknown[] = [];
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "订票", reminderAt: "2026-05-18 09:00" },
      { seedId: "seed_2", title: "体检", targetDate: "2026-05-19" },
      { seedId: "seed_3", title: "整理清单" },
      { seedId: "seed_4", title: "旧事项", status: "shelved" },
    ]);

    const result = await handleCalendarAgentRequest({
      text: "待提醒里的第一个不用提醒",
      requestId: "req_grouped_watchlist_state_before_decision",
      state: createShortTermStateStore(),
      decisionClient: {
        decide: async (request) => {
          capturedStates.push(request.state);
          return { type: "manage_todos", operation: "update", target: { group: "pending_reminder", itemNumber: 1 }, patch: { clearReminder: true } };
        },
      },
      calendar: createFakeCalendar(),
      seedStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "manage_todos" });
    expect(capturedStates[0]).toMatchObject({
      pending_reminder_seed_items: [{ seedId: "seed_1", title: "订票", reminderAt: "2026-05-18 09:00" }],
      pending_schedule_seed_items: [{ seedId: "seed_2", title: "体检", targetDate: "2026-05-19" }],
      pending_todo_seed_items: [{ seedId: "seed_3", title: "整理清单" }],
      shelved_seed_items: [{ seedId: "seed_4", title: "旧事项", status: "shelved" }],
    });
  });

  it("clears a todo reminder while keeping the inbox item", async () => {
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "拿币" },
      { seedId: "seed_2", title: "整理 DCF", reminderAt: "2026-05-18 14:00" },
    ]);

    const result = await handleCalendarAgentRequest({
      text: "第二个先别提醒了",
      requestId: "req_todo_clear_reminder",
      state: createShortTermStateStore(),
      seedStore,
      decisionClient: decisionClient({
        type: "manage_todos",
        operation: "update",
        target: { itemNumber: 2 },
        patch: { clearReminder: true },
      }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "manage_todos", requestId: "req_todo_clear_reminder" });
    expect(result.reply).toContain("已关闭提醒：整理 DCF");
    await expect(seedStore.list()).resolves.toEqual([
      { seedId: "seed_1", title: "拿币" },
      { seedId: "seed_2", title: "整理 DCF" },
    ]);
  });

  it("targets one item inside the pending reminder group without clearing the whole group", async () => {
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "订票", reminderAt: "2026-05-18 09:00" },
      { seedId: "seed_2", title: "体检", reminderAt: "2026-05-19 08:00" },
      { seedId: "seed_3", title: "整理清单" },
    ]);

    const result = await handleCalendarAgentRequest({
      text: "待提醒里的第二个不用提醒",
      requestId: "req_todo_clear_one_pending_reminder_group_item",
      state: createShortTermStateStore(),
      seedStore,
      decisionClient: decisionClient({
        type: "manage_todos",
        operation: "update",
        target: { group: "pending_reminder", itemNumber: 2 },
        patch: { clearReminder: true },
      }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "manage_todos", requestId: "req_todo_clear_one_pending_reminder_group_item" });
    expect(result.reply).toContain("已关闭提醒：体检");
    expect(result.reply).toContain("事项还在待推进，可以说“看看待推进收件箱”继续处理。");
    await expect(seedStore.list()).resolves.toEqual([
      { seedId: "seed_1", title: "订票", reminderAt: "2026-05-18 09:00" },
      { seedId: "seed_2", title: "体检" },
      { seedId: "seed_3", title: "整理清单" },
    ]);
  });

  it("shelves a pulled-back todo without deleting it", async () => {
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "整理材料", targetDate: "2026-05-13" },
      { seedId: "seed_2", title: "拿币" },
    ]);

    const result = await handleCalendarAgentRequest({
      text: "第一个先不管",
      requestId: "req_todo_shelve",
      state: createShortTermStateStore(),
      seedStore,
      decisionClient: decisionClient({
        type: "manage_todos",
        operation: "shelve",
        target: { itemNumber: 1 },
      }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "manage_todos", requestId: "req_todo_shelve" });
    expect(result.reply).toContain("已搁置待推进：整理材料");
    expect(result.reply).toContain("之后可以说“看看搁置区”或“搁置区第几个恢复”。");
    await expect(seedStore.list()).resolves.toEqual([
      { seedId: "seed_1", title: "整理材料", targetDate: "2026-05-13", status: "shelved" },
      { seedId: "seed_2", title: "拿币" },
    ]);
  });

  it("keeps shelved todos out of the active watchlist", async () => {
    const result = await handleCalendarAgentRequest({
      text: "看看现在盯着什么",
      requestId: "req_todo_shelved_overview",
      state: createShortTermStateStore(),
      seedStore: createMemorySeedLiteStore([
        { seedId: "seed_1", title: "整理材料", targetDate: "2026-05-13", status: "shelved" },
        { seedId: "seed_2", title: "拿币" },
      ]),
      decisionClient: decisionClient({ type: "status_overview" }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "status_overview", requestId: "req_todo_shelved_overview" });
    expect(result.reply).toContain("待推进 1 件");
    expect(result.reply).toContain("拿币");
    expect(result.reply).not.toContain("整理材料（2026-05-13）");
    expect(result.reply).toContain("搁置区还有 1 件，可以说“看看搁置区”或“搁置区第几个恢复”。");
    expect(result.reply).not.toContain("搁置区还有 1 件，可以说“看看搁置区”。");
  });

  it("lists shelved todos separately from the active inbox", async () => {
    const result = await handleCalendarAgentRequest({
      text: "我搁置了什么？",
      requestId: "req_todo_shelved_list",
      state: createShortTermStateStore(),
      seedStore: createMemorySeedLiteStore([
        { seedId: "seed_1", title: "整理材料", targetDate: "2026-05-13", status: "shelved" },
        { seedId: "seed_2", title: "拿币" },
      ]),
      decisionClient: decisionClient({ type: "manage_todos", operation: "list_shelved" }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "manage_todos", requestId: "req_todo_shelved_list" });
    expect(result.reply).toContain("搁置区：");
    expect(result.reply).toContain("整理材料（2026-05-13）");
    expect(result.reply).toContain("搁置区第几个恢复");
    expect(result.reply).not.toContain("可以直接说“第几个恢复”");
    expect(result.reply).not.toContain("拿币");
  });

  it("keeps a shelved inbox entry visible when the active inbox is empty", async () => {
    const result = await handleCalendarAgentRequest({
      text: "看看待推进收件箱",
      requestId: "req_todo_active_empty_shelved_hint",
      state: createShortTermStateStore(),
      seedStore: createMemorySeedLiteStore([{ seedId: "seed_1", title: "整理材料", targetDate: "2026-05-13", status: "shelved" }]),
      decisionClient: decisionClient({ type: "manage_todos", operation: "list" }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "manage_todos", requestId: "req_todo_active_empty_shelved_hint" });
    expect(result.reply).toContain("现在没有待推进。");
    expect(result.reply).toContain("搁置区还有 1 件，可以说“看看搁置区”或“搁置区第几个恢复”。");
  });

  it("keeps the active inbox visible when the shelved inbox is empty", async () => {
    const result = await handleCalendarAgentRequest({
      text: "看看搁置区",
      requestId: "req_todo_shelved_empty_active_hint",
      state: createShortTermStateStore(),
      seedStore: createMemorySeedLiteStore([{ seedId: "seed_1", title: "整理材料", targetDate: "2026-05-13" }]),
      decisionClient: decisionClient({ type: "manage_todos", operation: "list_shelved" }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "manage_todos", requestId: "req_todo_shelved_empty_active_hint" });
    expect(result.reply).toContain("搁置区现在没有事项。");
    expect(result.reply).toContain("还有 1 件待推进，可以说“看看待推进收件箱”继续处理。");
  });

  it("restores a shelved todo without creating a calendar event", async () => {
    let calendarCalls = 0;
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "整理材料", targetDate: "2026-05-13", status: "shelved" },
      { seedId: "seed_2", title: "拿币" },
    ]);
    const calendar: CalendarAdapter = {
      async createEvent() {
        calendarCalls += 1;
        return { ok: false, code: "api_error", message: "不应该创建日历。" };
      },
      async listEvents() {
        calendarCalls += 1;
        return { ok: true, data: [] };
      },
      async updateEvent() {
        calendarCalls += 1;
        return { ok: false, code: "api_error", message: "不应该修改日历。" };
      },
      async deleteEvent() {
        calendarCalls += 1;
        return { ok: false, code: "api_error", message: "不应该删除日历。" };
      },
    };

    const result = await handleCalendarAgentRequest({
      text: "把第一个恢复",
      requestId: "req_todo_restore_shelved",
      state: createShortTermStateStore(),
      seedStore,
      decisionClient: decisionClient({ type: "manage_todos", operation: "restore", target: { itemNumber: 1 } }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "manage_todos", requestId: "req_todo_restore_shelved" });
    expect(result.reply).toContain("已恢复待推进：整理材料");
    expect(result.reply).toContain("之后可以说“看看待推进收件箱”继续处理。");
    expect(calendarCalls).toBe(0);
    await expect(seedStore.list()).resolves.toEqual([
      { seedId: "seed_1", title: "整理材料", targetDate: "2026-05-13" },
      { seedId: "seed_2", title: "拿币" },
    ]);
  });

  it("keeps restore failures scoped to the shelved inbox", async () => {
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "整理材料", targetDate: "2026-05-13", status: "shelved" },
      { seedId: "seed_2", title: "拿币" },
    ]);

    const result = await handleCalendarAgentRequest({
      text: "搁置区第三个恢复",
      requestId: "req_todo_restore_missing_shelved",
      state: createShortTermStateStore(),
      seedStore,
      decisionClient: decisionClient({ type: "manage_todos", operation: "restore", target: { itemNumber: 3 } }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: false, actionType: "manage_todos", requestId: "req_todo_restore_missing_shelved" });
    expect(result.reply).toContain("没有找到第 3 个搁置项");
    expect(result.reply).toContain("当前搁置区：");
    expect(result.reply).toContain("1. 整理材料（2026-05-13）");
    expect(result.reply).toContain("搁置区第几个恢复");
    expect(result.reply).not.toContain("当前待推进收件箱");
    expect(result.reply).not.toContain("待安排里的第几个安排一下");
    await expect(seedStore.list()).resolves.toEqual([
      { seedId: "seed_1", title: "整理材料", targetDate: "2026-05-13", status: "shelved" },
      { seedId: "seed_2", title: "拿币" },
    ]);
  });

  it("does not treat a far future todo reminder as a disabled reminder", async () => {
    const seedStore = createMemorySeedLiteStore([{ seedId: "seed_1", title: "整理 DCF", reminderAt: "2026-05-18 14:00" }]);

    const result = await handleCalendarAgentRequest({
      text: "第二个先别提醒了",
      requestId: "req_todo_far_future_reminder",
      state: createShortTermStateStore(),
      seedStore,
      decisionClient: decisionClient({
        type: "manage_todos",
        operation: "update",
        target: { itemNumber: 1 },
        patch: { reminderAt: "2026-12-31 23:59" },
      }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "manage_todos", requestId: "req_todo_far_future_reminder" });
    expect(result.reply).toContain("提醒：2026-12-31 23:59");
    expect(result.reply).toContain("之后可以说“待提醒里的第几个不用提醒”或“待提醒里的第几个提前 2 小时”。");
    await expect(seedStore.list()).resolves.toEqual([{ seedId: "seed_1", title: "整理 DCF", reminderAt: "2026-12-31 23:59" }]);
  });

  it("offers scheduling follow up after setting a todo target date", async () => {
    const seedStore = createMemorySeedLiteStore([{ seedId: "seed_1", title: "整理材料" }]);

    const result = await handleCalendarAgentRequest({
      text: "第一个下周处理",
      requestId: "req_todo_set_target_date_follow_up",
      state: createShortTermStateStore(),
      seedStore,
      decisionClient: decisionClient({
        type: "manage_todos",
        operation: "update",
        target: { itemNumber: 1 },
        patch: { targetDate: "2026-05-25" },
      }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "manage_todos", requestId: "req_todo_set_target_date_follow_up" });
    expect(result.reply).toContain("已更新待推进：整理材料（2026-05-25）");
    expect(result.reply).toContain("之后可以说“待安排里的第几个安排一下”或“待安排的都给我推荐一下”。");
    await expect(seedStore.list()).resolves.toEqual([{ seedId: "seed_1", title: "整理材料", targetDate: "2026-05-25" }]);
  });

  it("schedules a visible inbox item by todo target and completes only that item", async () => {
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "拿币" },
      { seedId: "seed_2", title: "整理 DCF" },
    ]);

    const result = await handleCalendarAgentRequest({
      text: "把第一个安排一下",
      requestId: "req_schedule_todo_target",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        type: "propose_schedule",
        date: "2026-05-14",
        autoCreate: true,
        items: [{ target: { itemNumber: 1 }, durationMinutes: 45 }],
      }),
      calendar: createFakeCalendar(),
      seedStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event" });
    expect(result.reply).toContain("拿币");
    await expect(seedStore.list()).resolves.toEqual([{ seedId: "seed_2", title: "整理 DCF" }]);
  });

  it("schedules multiple visible inbox items from one todo target", async () => {
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "拿币" },
      { seedId: "seed_2", title: "整理 DCF" },
      { seedId: "seed_3", title: "写邮件" },
    ]);
    const calendar = createFakeCalendar();

    const result = await handleCalendarAgentRequest({
      text: "把前两个安排一下",
      requestId: "req_schedule_batch_todo_targets",
      now: "2026-05-14T08:00:00+08:00",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        type: "propose_schedule",
        date: "2026-05-14",
        autoCreate: true,
        items: [{ target: { itemNumbers: [1, 2] }, durationMinutes: 45 }],
      }),
      calendar,
      seedStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_events" });
    expect(result.reply).toContain("拿币");
    expect(result.reply).toContain("整理 DCF");
    await expect(seedStore.list()).resolves.toEqual([{ seedId: "seed_3", title: "写邮件" }]);
    await expect(calendar.listEvents({ date: "2026-05-14" })).resolves.toMatchObject({
      ok: true,
      data: [
        { title: "拿币", start: "2026-05-14 09:00", end: "2026-05-14 09:45" },
        { title: "整理 DCF", start: "2026-05-14 10:00", end: "2026-05-14 10:45" },
      ],
    });
  });

  it("shows the current inbox when a schedule todo target is missing", async () => {
    const seedStore = createMemorySeedLiteStore([{ seedId: "seed_1", title: "拿币" }]);

    const result = await handleCalendarAgentRequest({
      text: "把第三个安排一下",
      requestId: "req_schedule_missing_todo_target",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        type: "propose_schedule",
        date: "2026-05-14",
        items: [{ target: { itemNumber: 3 } }],
      }),
      calendar: createFakeCalendar(),
      seedStore,
    });

    expect(result).toMatchObject({ ok: false, actionType: "propose_schedule" });
    expect(result.reply).toContain("没有找到第 3 个待推进");
    expect(result.reply).toContain("当前待推进收件箱");
    expect(result.reply).toContain("1. 拿币");
    expect(result.reply).toContain("待推进里的第几个完成了");
  });

  it("uses the todo target date when scheduling an inbox item without an explicit date", async () => {
    const seedStore = createMemorySeedLiteStore([{ seedId: "seed_1", title: "整理材料", targetDate: "2026-05-15" }]);

    const result = await handleCalendarAgentRequest({
      text: "把第一个安排一下",
      requestId: "req_schedule_todo_target_date",
      now: "2026-05-14T10:00:00+08:00",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        type: "propose_schedule",
        autoCreate: true,
        items: [{ target: { itemNumber: 1 } }],
      }),
      calendar: createFakeCalendar(),
      seedStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event" });
    expect(result.reply).toContain("2026年5月15日");
    expect(result.reply).toContain("整理材料");
  });

  it("uses the todo reminder time as the default schedule date and preferred start time", async () => {
    const seedStore = createMemorySeedLiteStore([{ seedId: "seed_1", title: "整理材料", reminderAt: "2026-05-15 14:00" }]);

    const result = await handleCalendarAgentRequest({
      text: "把第一个安排一下",
      requestId: "req_schedule_todo_reminder_at",
      now: "2026-05-14T10:00:00+08:00",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        type: "propose_schedule",
        autoCreate: true,
        items: [{ target: { itemNumber: 1 } }],
      }),
      calendar: createFakeCalendar(),
      seedStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event" });
    expect(result.reply).toContain("2026年5月15日");
    expect(result.reply).toContain("14:00");
    expect(result.reply).toContain("整理材料");
  });

  it("creates an event through the existing calendar action executor", async () => {
    const result = await handleCalendarAgentRequest({
      text: "明天下午三点见张总",
      requestId: "req_create",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        action: "create_event",
        event: { title: "见张总", date: "2026-05-09", startTime: "15:00" },
      }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_create" });
    expect(result.reply).toContain("已新增日程");
  });

  it("records a memory dream observation after handling a request", async () => {
    const memoryDreamStore = createMemoryMemoryDreamStore();

    const result = await handleCalendarAgentRequest({
      text: "明天下午三点见张总",
      requestId: "req_memory_dream",
      messageId: "msg_memory_dream",
      now: "2026-05-13T01:00:00.000Z",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        action: "create_event",
        event: { title: "见张总", date: "2026-05-14", startTime: "15:00" },
      }),
      calendar: createFakeCalendar(),
      memoryDreamStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event" });
    await expect(memoryDreamStore.load()).resolves.toMatchObject({
      observations: [
        {
          observedAt: "2026-05-13T01:00:00.000Z",
          requestId: "req_memory_dream",
          messageId: "msg_memory_dream",
          sourceText: "明天下午三点见张总",
          actionType: "create_event",
          ok: true,
          createdEvents: [{ title: "见张总", date: "2026-05-14", startTime: "15:00" }],
        },
      ],
    });
  });

  it("records created events from calendar execution results instead of draft text", async () => {
    const memoryDreamStore = createMemoryMemoryDreamStore();
    const calendar: CalendarAdapter = {
      ...createFakeCalendar(),
      async createEvent() {
        return {
          ok: true,
          data: {
            id: "evt_adjusted",
            title: "日历返回标题",
            start: "2026-05-14 16:30",
            end: "2026-05-14 17:30",
          },
        };
      },
    };

    await handleCalendarAgentRequest({
      text: "明天下午三点见张总",
      requestId: "req_memory_dream_execution_result",
      now: "2026-05-13T01:00:00.000Z",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        action: "create_event",
        event: { title: "模型草稿标题", date: "2026-05-14", startTime: "15:00" },
      }),
      calendar,
      memoryDreamStore,
    });

    await expect(memoryDreamStore.load()).resolves.toMatchObject({
      observations: [
        expect.objectContaining({
          requestId: "req_memory_dream_execution_result",
          createdEvents: [{ title: "日历返回标题", date: "2026-05-14", startTime: "16:30" }],
        }),
      ],
    });
  });

  it("expires stale pending delete state when a media request starts a new interaction", async () => {
    const state = createShortTermStateStore({
      pending_delete: { eventId: "evt_old", title: "旧删除", source: "last_event" },
    });

    const result = await handleCalendarAgentRequest({
      text: "",
      media: { path: "/tmp/openclaw-weixin/inbound/meeting.png", type: "image/png" },
      requestId: "req_media_expires_pending_delete",
      state,
      decisionClient: decisionClient({
        action: "list_events",
        date: "2026-05-14",
      }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "image_capture_dry_run" });
    expect(state.snapshot().pending_delete).toBeUndefined();
  });

  it("registers default WeChat reminder jobs after creating an event", async () => {
    const reminderStore = createMemoryWechatReminderStore();

    const result = await handleCalendarAgentRequest({
      text: "明天下午三点见张总",
      requestId: "req_create_wechat_reminder",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        action: "create_event",
        event: { title: "见张总", date: "2026-05-09", startTime: "15:00" },
      }),
      calendar: createFakeCalendar(),
      wechatReminderStore: reminderStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_create_wechat_reminder" });
    await expect(reminderStore.list()).resolves.toEqual([
      {
        jobId: "wechat-reminder:evt_1:2026-05-09 15:00:40",
        eventId: "evt_1",
        title: "见张总",
        start: "2026-05-09 15:00",
        leadMinutes: 40,
        dueAt: "2026-05-09T06:20:00.000Z",
        status: "pending",
      },
    ]);
  });

  it("respects explicit WeChat reminder lead values from a created event", async () => {
    const reminderStore = createMemoryWechatReminderStore();

    await handleCalendarAgentRequest({
      text: "明天下午三点见张总，提前两小时提醒我",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        action: "create_event",
        event: { title: "见张总", date: "2026-05-09", startTime: "15:00", reminderMinutes: 120 },
      }),
      calendar: createFakeCalendar(),
      wechatReminderStore: reminderStore,
      defaultWechatReminderLeadMinutes: [30, 10],
    });

    await expect(reminderStore.list()).resolves.toMatchObject([
      { eventId: "evt_1", leadMinutes: 120 },
    ]);
  });

  it("registers multiple explicit WeChat reminders for an important created event", async () => {
    const reminderStore = createMemoryWechatReminderStore();

    await handleCalendarAgentRequest({
      text: "明天下午三点见张总，这个比较重要，再提前提醒一次",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        action: "create_event",
        event: { title: "见张总", date: "2026-05-09", startTime: "15:00", reminderMinutes: [120, 40] },
      }),
      calendar: createFakeCalendar(),
      wechatReminderStore: reminderStore,
    });

    await expect(reminderStore.list()).resolves.toMatchObject([
      { eventId: "evt_1", leadMinutes: 120 },
      { eventId: "evt_1", leadMinutes: 40 },
    ]);
  });

  it("refreshes pending WeChat reminders to multiple explicit leads", async () => {
    const state = createShortTermStateStore({
      last_event: { eventId: "evt_1", title: "见张总", date: "2026-05-09", startTime: "15:00" },
    });
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "见张总", date: "2026-05-09", startTime: "15:00" });
    const reminderStore = createMemoryWechatReminderStore(
      buildWechatReminderJobs({ id: "evt_1", title: "见张总", start: "2026-05-09 15:00" }, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES),
    );

    const result = await handleCalendarAgentRequest({
      text: "刚才那个比较重要，再提前提醒一次",
      state,
      decisionClient: decisionClient({
        action: "update_event",
        target: { kind: "last_event", eventId: "ignored_by_state" },
        patch: { reminderMinutes: [120, 40] },
      }),
      calendar,
      wechatReminderStore: reminderStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "update_event" });
    await expect(reminderStore.list()).resolves.toMatchObject([
      { eventId: "evt_1", leadMinutes: 120, status: "pending" },
      { eventId: "evt_1", leadMinutes: 40, status: "pending" },
    ]);
  });

  it("refreshes pending WeChat reminders when updating an event reminder lead", async () => {
    const state = createShortTermStateStore({
      last_event: { eventId: "evt_1", title: "见张总", date: "2026-05-09", startTime: "15:00" },
    });
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "见张总", date: "2026-05-09", startTime: "15:00" });
    const reminderStore = createMemoryWechatReminderStore(
      buildWechatReminderJobs({ id: "evt_1", title: "见张总", start: "2026-05-09 15:00" }, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES),
    );

    const result = await handleCalendarAgentRequest({
      text: "刚才那个提前两小时提醒我",
      state,
      decisionClient: decisionClient({
        action: "update_event",
        target: { kind: "last_event", eventId: "ignored_by_state" },
        patch: { reminderMinutes: 120 },
      }),
      calendar,
      wechatReminderStore: reminderStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "update_event" });
    await expect(reminderStore.list()).resolves.toMatchObject([
      { eventId: "evt_1", leadMinutes: 120, status: "pending" },
    ]);
  });

  it("moves existing WeChat reminders when updating an event time", async () => {
    const state = createShortTermStateStore({
      last_event: { eventId: "evt_1", title: "见张总", date: "2026-05-09", startTime: "15:00" },
    });
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "见张总", date: "2026-05-09", startTime: "15:00" });
    const reminderStore = createMemoryWechatReminderStore(
      buildWechatReminderJobs({ id: "evt_1", title: "见张总", start: "2026-05-09 15:00" }, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES),
    );

    const result = await handleCalendarAgentRequest({
      text: "刚才那个改到四点",
      state,
      decisionClient: decisionClient({
        type: "update_event",
        target: { kind: "last_event" },
        patch: { startTime: "16:00" },
      }),
      calendar,
      wechatReminderStore: reminderStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "update_event" });
    await expect(reminderStore.list()).resolves.toMatchObject([
      { eventId: "evt_1", start: "2026-05-09 16:00", leadMinutes: 40, status: "pending" },
    ]);
  });

  it("skips WeChat reminders when the created event explicitly disables reminders", async () => {
    const reminderStore = createMemoryWechatReminderStore();

    await handleCalendarAgentRequest({
      text: "明天下午三点见张总，不用提醒",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        action: "create_event",
        event: { title: "见张总", date: "2026-05-09", startTime: "15:00", reminderMinutes: 0 },
      }),
      calendar: createFakeCalendar(),
      wechatReminderStore: reminderStore,
    });

    await expect(reminderStore.list()).resolves.toEqual([]);
  });

  it("registers an at-time WeChat reminder for explicit reminder events", async () => {
    const reminderStore = createMemoryWechatReminderStore();

    const result = await handleCalendarAgentRequest({
      text: "明天上午8点提醒我一下1011的TS",
      requestId: "req_create_at_time_reminder",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        type: "create_event",
        event: { title: "1011 的 TS", date: "2026-05-09", startTime: "08:00", reminderAtStart: true },
      }),
      calendar: createFakeCalendar(),
      wechatReminderStore: reminderStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_create_at_time_reminder" });
    await expect(reminderStore.list()).resolves.toMatchObject([
      {
        eventId: "evt_1",
        title: "1011 的 TS",
        start: "2026-05-09 08:00",
        leadMinutes: 0,
        leadSource: "at_start",
        dueAt: "2026-05-09T00:00:00.000Z",
        status: "pending",
      },
    ]);
  });

  it("turns an inbox item with reminderAt into an at-time reminder and removes it after calendar creation", async () => {
    const seedStore = createMemorySeedLiteStore([{ seedId: "seed_1", title: "订1011的PS", reminderAt: "2026-05-16 08:00" }]);
    const reminderStore = createMemoryWechatReminderStore();

    const result = await handleCalendarAgentRequest({
      text: "把订1011的PS这个提醒转成日程",
      requestId: "req_todo_reminder_to_calendar",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        action: "create_event",
        event: {
          title: "订1011的PS",
          date: "2026-05-16",
          startTime: "08:00",
          reminderAtStart: true,
          sourceIds: ["seed_1"],
        },
      }),
      calendar: createFakeCalendar(),
      seedStore,
      wechatReminderStore: reminderStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_todo_reminder_to_calendar" });
    await expect(seedStore.list()).resolves.toEqual([]);
    await expect(reminderStore.list()).resolves.toMatchObject([
      {
        title: "订1011的PS",
        start: "2026-05-16 08:00",
        leadMinutes: 0,
        leadSource: "at_start",
      },
    ]);
  });

  it("repairs duplicate remember_todo for an existing reminderAt inbox item into an executable reminder", async () => {
    const seedStore = createMemorySeedLiteStore([{ seedId: "seed_1", title: "订1011的PS", reminderAt: "2026-05-16 08:00" }]);
    const reminderStore = createMemoryWechatReminderStore();

    const result = await handleCalendarAgentRequest({
      text: "把第一个提醒转成日程，到时候提醒我",
      requestId: "req_repair_duplicate_todo_reminder",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({ type: "remember_todo", title: "订1011的PS", autoSchedule: false }),
      calendar: createFakeCalendar(),
      seedStore,
      wechatReminderStore: reminderStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_repair_duplicate_todo_reminder" });
    await expect(seedStore.list()).resolves.toEqual([]);
    await expect(reminderStore.list()).resolves.toMatchObject([
      { title: "订1011的PS", start: "2026-05-16 08:00", leadMinutes: 0, leadSource: "at_start" },
    ]);
  });

  it("rejects inbox-backed reminders when the source reminder time does not match", async () => {
    const seedStore = createMemorySeedLiteStore([{ seedId: "seed_1", title: "订1011的PS", reminderAt: "2026-05-16 08:00" }]);
    const reminderStore = createMemoryWechatReminderStore();

    const result = await handleCalendarAgentRequest({
      text: "把第一个提醒转成日程，到时候提醒我",
      requestId: "req_reject_mismatched_todo_reminder",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        type: "create_event",
        event: {
          title: "订1011的PS",
          date: "2026-05-16",
          startTime: "09:00",
          reminderAtStart: true,
          sourceIds: ["seed_1"],
        },
      }),
      calendar: createFakeCalendar(),
      seedStore,
      wechatReminderStore: reminderStore,
    });

    expect(result).toMatchObject({ ok: false, actionType: "create_event", requestId: "req_reject_mismatched_todo_reminder" });
    await expect(seedStore.list()).resolves.toEqual([{ seedId: "seed_1", title: "订1011的PS", reminderAt: "2026-05-16 08:00" }]);
    await expect(reminderStore.list()).resolves.toEqual([]);
  });

  it("lists events through the bridge", async () => {
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "电话会", date: "2026-05-09", startTime: "10:00" });

    const result = await handleCalendarAgentRequest({
      text: "查一下明天日程",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({ action: "list_events", date: "2026-05-09" }),
      calendar,
    });

    expect(result.ok).toBe(true);
    expect(result.actionType).toBe("list_events");
    expect(result.reply).toContain("电话会");
  });

  it("passes server-owned time context into the model decision", async () => {
    let receivedNow = "";
    let receivedTimezone = "";

    const result = await handleCalendarAgentRequest({
      text: "查一下明天日程",
      state: createShortTermStateStore(),
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
      decisionClient: {
        decide: async (request) => {
          receivedNow = request.now || "";
          receivedTimezone = request.timezone || "";
          return { action: "list_events", date: "2026-05-09" };
        },
      },
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "list_events" });
    expect(receivedNow).toBe("2026-05-08T09:00:00+08:00");
    expect(receivedTimezone).toBe("Asia/Shanghai");
  });

  it("updates the last event using existing state resolution", async () => {
    const state = createShortTermStateStore();
    const calendar = createFakeCalendar();
    await handleCalendarAgentRequest({
      text: "明天三点见张总",
      state,
      decisionClient: decisionClient({
        action: "create_event",
        event: { title: "见张总", date: "2026-05-09", startTime: "15:00" },
      }),
      calendar,
    });

    const result = await handleCalendarAgentRequest({
      text: "改成见李总",
      requestId: "req_update",
      state,
      decisionClient: decisionClient({
        action: "update_event",
        target: { kind: "last_event", eventId: "ignored_by_state" },
        patch: { title: "见李总" },
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "update_event", requestId: "req_update" });
    expect(result.reply).toContain("已修改");
  });

  it("stores a pending create conflict instead of writing when the target time is occupied", async () => {
    const state = createShortTermStateStore();
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "已有电话会", date: "2026-05-09", startTime: "15:00" });
    let createCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "明天下午三点见张总",
      requestId: "req_create_conflict",
      state,
      decisionClient: decisionClient({
        action: "create_event",
        event: { title: "见张总", date: "2026-05-09", startTime: "15:00" },
      }),
      calendar: {
        ...calendar,
        createEvent: async (event) => {
          createCalls += 1;
          return calendar.createEvent(event);
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_conflict", requestId: "req_create_conflict" });
    expect(result.reply).toContain("这个时间已有日程");
    expect(result.reply).toContain("已有电话会");
    expect(result.reply).toContain("OK");
    expect(createCalls).toBe(0);
    expect(state.snapshot().pending_conflict).toEqual({
      action: { type: "create_event", event: { title: "见张总", date: "2026-05-09", startTime: "15:00" } },
      conflicts: [{ existingEventId: "evt_1", title: "已有电话会", start: "2026-05-09 15:00" }],
    });
  });

  it("lets the model confirm a pending create conflict with natural wording", async () => {
    const state = createShortTermStateStore({
      pending_conflict: {
        action: { type: "create_event", event: { title: "见张总", date: "2026-05-09", startTime: "15:00" } },
        conflicts: [{ existingEventId: "evt_1", title: "已有电话会", start: "2026-05-09 15:00" }],
      },
    });
    let decideCalls = 0;
    let createdEvent: unknown;

    const result = await handleCalendarAgentRequest({
      text: "OK",
      requestId: "req_confirm_conflict_create",
      state,
      decisionClient: {
        decide: async () => {
          decideCalls += 1;
          return { type: "confirm_create", confirmed: true };
        },
      },
      calendar: {
        ...createFakeCalendar(),
        createEvent: async (event) => {
          createdEvent = event;
          return { ok: true, data: { id: "evt_created", title: event.title, start: `${event.date} ${event.startTime}` } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_confirm_conflict_create" });
    expect(result.reply).toContain("已新增日程");
    expect(decideCalls).toBe(1);
    expect(createdEvent).toEqual({ title: "见张总", date: "2026-05-09", startTime: "15:00" });
    expect(state.snapshot().pending_conflict).toBeUndefined();
  });

  it("registers reminders after confirming a pending create conflict", async () => {
    const state = createShortTermStateStore({
      pending_conflict: {
        action: { type: "create_event", event: { title: "见张总", date: "2026-05-09", startTime: "15:00" } },
        conflicts: [{ existingEventId: "evt_1", title: "已有电话会", start: "2026-05-09 15:00" }],
      },
    });
    const reminderStore = createMemoryWechatReminderStore();

    await handleCalendarAgentRequest({
      text: "确认",
      requestId: "req_confirm_conflict_reminder",
      state,
      decisionClient: decisionClient({ type: "confirm_create", confirmed: true }),
      calendar: createFakeCalendar(),
      wechatReminderStore: reminderStore,
    });

    await expect(reminderStore.list()).resolves.toMatchObject([
      { eventId: "evt_1", leadMinutes: 40 },
    ]);
  });

  it("lets the model cancel a pending create conflict with natural wording", async () => {
    const state = createShortTermStateStore({
      pending_conflict: {
        action: { type: "create_event", event: { title: "见张总", date: "2026-05-09", startTime: "15:00" } },
        conflicts: [{ existingEventId: "evt_1", title: "已有电话会", start: "2026-05-09 15:00" }],
      },
    });
    let decideCalls = 0;
    let createCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "算了",
      requestId: "req_cancel_conflict_create",
      state,
      decisionClient: {
        decide: async () => {
          decideCalls += 1;
          return { type: "confirm_create", confirmed: false };
        },
      },
      calendar: {
        ...createFakeCalendar(),
        createEvent: async (event) => {
          createCalls += 1;
          return { ok: true, data: { id: "evt_created", title: event.title, start: `${event.date} ${event.startTime}` } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_conflict_cancel", requestId: "req_cancel_conflict_create" });
    expect(result.reply).toBe("已取消创建。");
    expect(decideCalls).toBe(1);
    expect(createCalls).toBe(0);
    expect(state.snapshot().pending_conflict).toBeUndefined();
  });

  it("lets the model revise a pending create conflict to a new time", async () => {
    const state = createShortTermStateStore({
      pending_conflict: {
        action: { type: "create_event", event: { title: "见张总", date: "2026-05-09", startTime: "15:00" } },
        conflicts: [{ existingEventId: "evt_1", title: "已有电话会", start: "2026-05-09 15:00" }],
      },
    });
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "已有电话会", date: "2026-05-09", startTime: "15:00" });
    let createdEvent: unknown;

    const result = await handleCalendarAgentRequest({
      text: "那改到 4 点吧",
      requestId: "req_revise_conflict_create",
      state,
      decisionClient: decisionClient({
        action: "create_event",
        event: { title: "见张总", date: "2026-05-09", startTime: "16:00" },
      }),
      calendar: {
        ...calendar,
        createEvent: async (event) => {
          createdEvent = event;
          return calendar.createEvent(event);
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_revise_conflict_create" });
    expect(result.reply).toContain("已新增日程");
    expect(createdEvent).toEqual({ title: "见张总", date: "2026-05-09", startTime: "16:00" });
    expect(state.snapshot().pending_conflict).toBeUndefined();
  });

  it("keeps pending conflict when the revised create time still conflicts", async () => {
    const state = createShortTermStateStore({
      pending_conflict: {
        action: { type: "create_event", event: { title: "见张总", date: "2026-05-09", startTime: "15:00" } },
        conflicts: [{ existingEventId: "evt_1", title: "已有电话会", start: "2026-05-09 15:00" }],
      },
    });
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "已有沟通", date: "2026-05-09", startTime: "15:30" });
    let createCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "那改到 3 点半",
      requestId: "req_revise_conflict_create_still_conflicts",
      state,
      decisionClient: decisionClient({
        action: "create_event",
        event: { title: "见张总", date: "2026-05-09", startTime: "15:30" },
      }),
      calendar: {
        ...calendar,
        createEvent: async (event) => {
          createCalls += 1;
          return calendar.createEvent(event);
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_conflict", requestId: "req_revise_conflict_create_still_conflicts" });
    expect(createCalls).toBe(0);
    expect(state.snapshot().pending_conflict).toEqual({
      action: { type: "create_event", event: { title: "见张总", date: "2026-05-09", startTime: "15:30" } },
      conflicts: [{ existingEventId: "evt_1", title: "已有沟通", start: "2026-05-09 15:30" }],
    });
  });

  it("blocks an entire batch create when any item conflicts", async () => {
    const state = createShortTermStateStore();
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "已有投委会", date: "2026-05-09", startTime: "09:00" });
    let createCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "明天九点投委会，下午两点客户电话",
      requestId: "req_batch_conflict",
      state,
      decisionClient: decisionClient({
        type: "create_events",
        events: [
          { title: "投委会", date: "2026-05-09", startTime: "09:00" },
          { title: "客户电话", date: "2026-05-09", startTime: "14:00" },
        ],
      }),
      calendar: {
        ...calendar,
        createEvent: async (event) => {
          createCalls += 1;
          return calendar.createEvent(event);
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_conflict", requestId: "req_batch_conflict" });
    expect(result.reply).toContain("已有投委会");
    expect(createCalls).toBe(0);
    expect(state.snapshot().pending_conflict?.action).toEqual({
      type: "create_events",
      events: [
        { title: "投委会", date: "2026-05-09", startTime: "09:00" },
        { title: "客户电话", date: "2026-05-09", startTime: "14:00" },
      ],
    });
  });

  it("stores an incomplete create draft and asks for the missing time without writing the calendar", async () => {
    const state = createShortTermStateStore();
    let createCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "明天约张总开个会",
      requestId: "req_pending_create",
      state,
      decisionClient: decisionClient({
        action: "create_event",
        event: { title: "约张总开会", date: "2026-05-09" },
      }),
      calendar: {
        ...createFakeCalendar(),
        createEvent: async (event) => {
          createCalls += 1;
          return { ok: true, data: { id: "evt_should_not_create", title: event.title, start: `${event.date} ${event.startTime}` } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "clarify", requestId: "req_pending_create" });
    expect(result.reply).toBe("这个日程几点开始？");
    expect(createCalls).toBe(0);
    expect(state.snapshot().pending_clarification).toEqual({
      question: "这个日程几点开始？",
      missing: ["startTime"],
      createDraft: {
        title: "约张总开会",
        date: "2026-05-09",
      },
    });
  });

  it("repairs a useless reminder-content clarification into a created event when the user already gave content and time", async () => {
    const state = createShortTermStateStore();
    let createdEvent: unknown;
    const sourceText = "都总，这是我们结合群里讨论和杨院反馈修改后的 TS，您看看是否有补充意见？没问题的话，我们就发给投资人。\n\n今天10点";

    const result = await handleCalendarAgentRequest({
      text: sourceText,
      requestId: "req_repair_useless_reminder_clarify",
      now: "2026-05-15T08:16:00+08:00",
      timezone: "Asia/Shanghai",
      state,
      decisionClient: decisionClient({
        type: "clarify",
        question: "您想提醒自己什么事？",
        missing: ["title"],
      }),
      calendar: {
        ...createFakeCalendar(),
        createEvent: async (event) => {
          createdEvent = event;
          return { ok: true, data: { id: "evt_repaired_ts", title: event.title, start: event.date + " " + event.startTime } };
        },
      },
      clarifyEventDraftRepairer: async (input) => {
        expect(input.sourceText).toBe(sourceText);
        expect(input.clarify.question).toBe("您想提醒自己什么事？");
        return {
          ok: true,
          draft: {
            title: "确认 TS 修改意见",
            date: "2026-05-15",
            startTime: "10:00",
            notes: "都总，这是我们结合群里讨论和杨院反馈修改后的 TS，您看看是否有补充意见？没问题的话，我们就发给投资人。",
          },
        };
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_repair_useless_reminder_clarify" });
    expect(result.reply).toContain("已新增日程");
    expect(createdEvent).toEqual({
      title: "确认 TS 修改意见",
      date: "2026-05-15",
      startTime: "10:00",
      notes: "都总，这是我们结合群里讨论和杨院反馈修改后的 TS，您看看是否有补充意见？没问题的话，我们就发给投资人。",
    });
    expect(state.snapshot().pending_clarification).toBeUndefined();
  });

  it("keeps a necessary clarification when the title repair layer cannot form a complete event", async () => {
    const state = createShortTermStateStore();
    let createCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "提醒我处理材料",
      requestId: "req_repair_keeps_necessary_clarify",
      state,
      decisionClient: decisionClient({
        type: "clarify",
        question: "这个提醒是什么时间？",
        missing: ["date", "startTime"],
      }),
      calendar: {
        ...createFakeCalendar(),
        createEvent: async (event) => {
          createCalls += 1;
          return { ok: true, data: { id: "evt_should_not_repair", title: event.title, start: event.date + " " + event.startTime } };
        },
      },
      clarifyEventDraftRepairer: async () => ({ ok: false, message: "缺少明确时间。" }),
    });

    expect(result).toMatchObject({ ok: true, actionType: "clarify", requestId: "req_repair_keeps_necessary_clarify" });
    expect(result.reply).toBe("这个提醒是什么时间？");
    expect(createCalls).toBe(0);
    expect(state.snapshot().pending_clarification).toEqual({ question: "这个提醒是什么时间？", missing: ["date", "startTime"] });
  });

  it("uses the repair layer's concise missing-time question and draft for continuation", async () => {
    const state = createShortTermStateStore();
    let createCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "都总，这是我们结合群里讨论和杨院反馈修改后的 TS，您看看是否有补充意见？没问题的话，我们就发给投资人。\n\n今天",
      requestId: "req_repair_missing_time_draft",
      state,
      decisionClient: decisionClient({
        type: "clarify",
        question: "这是要创建一个日程吗？具体标题和时间是什么？",
        missing: ["title", "startTime"],
      }),
      calendar: {
        ...createFakeCalendar(),
        createEvent: async (event) => {
          createCalls += 1;
          return { ok: true, data: { id: "evt_should_not_create", title: event.title, start: event.date + " " + event.startTime } };
        },
      },
      clarifyEventDraftRepairer: async () => ({
        ok: false,
        message: "这个日程几点开始？",
        missing: ["startTime"],
        createDraft: {
          title: "确认 TS 修改意见",
          date: "2026-05-15",
        },
      }),
    });

    expect(result).toMatchObject({ ok: true, actionType: "clarify", requestId: "req_repair_missing_time_draft" });
    expect(result.reply).toBe("这个日程几点开始？");
    expect(createCalls).toBe(0);
    expect(state.snapshot().pending_clarification).toEqual({
      question: "这个日程几点开始？",
      missing: ["startTime"],
      createDraft: {
        title: "确认 TS 修改意见",
        date: "2026-05-15",
      },
    });
  });

  it("creates directly when a model clarification carries a complete event draft", async () => {
    const state = createShortTermStateStore();
    let createdEvent: unknown;

    const result = await handleCalendarAgentRequest({
      text: "都总，这是我们结合群里讨论和杨院反馈修改后的 TS，您看看是否有补充意见？没问题的话，我们就发给投资人。\n\n今天10点",
      requestId: "req_complete_draft_type_clarify",
      state,
      decisionClient: decisionClient({
        type: "clarify",
        question: "请问这是什么类型的日程？比如会议、电话沟通、还是提醒？",
        missing: ["eventType"],
        createDraft: {
          title: "确认 TS 修改意见",
          date: "2026-05-15",
          startTime: "10:00",
          notes: "都总，这是我们结合群里讨论和杨院反馈修改后的 TS，您看看是否有补充意见？没问题的话，我们就发给投资人。",
        },
      }),
      calendar: {
        ...createFakeCalendar(),
        createEvent: async (event) => {
          createdEvent = event;
          return { ok: true, data: { id: "evt_ts", title: event.title, start: `${event.date} ${event.startTime}` } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_complete_draft_type_clarify" });
    expect(result.reply).toContain("已新增日程");
    expect(createdEvent).toEqual({
      title: "确认 TS 修改意见",
      date: "2026-05-15",
      startTime: "10:00",
      notes: "都总，这是我们结合群里讨论和杨院反馈修改后的 TS，您看看是否有补充意见？没问题的话，我们就发给投资人。",
    });
    expect(state.snapshot().pending_clarification).toBeUndefined();
  });

  it("captures a no-date no-time create draft as Seed Lite without writing the calendar", async () => {
    const state = createShortTermStateStore();
    let createCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "回头整理路演材料",
      requestId: "req_seed_lite",
      now: "2026-05-11T14:10:00+08:00",
      state,
      decisionClient: decisionClient({
        action: "create_event",
        event: { title: "整理路演材料" },
      }),
      calendar: {
        ...createFakeCalendar(),
        createEvent: async (event) => {
          createCalls += 1;
          return { ok: true, data: { id: "evt_should_not_create_seed", title: event.title, start: `${event.date} ${event.startTime}` } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "seed_lite", requestId: "req_seed_lite" });
    expect(result.reply).toBe("已先记下：整理路演材料\n之后可以说“帮我安排这个”，也可以在早晚报里直接处理。");
    expect(createCalls).toBe(0);
    expect(state.snapshot().pending_clarification).toBeUndefined();
    expect(state.snapshot().seed_items).toEqual([
      {
        seedId: "seed_1",
        title: "整理路演材料",
        createdAt: "2026-05-11T14:10:00+08:00",
        sourceText: "回头整理路演材料",
      },
    ]);
  });

  it("auto-schedules a natural no-time todo and lets the user revise the created time later", async () => {
    const state = createShortTermStateStore();
    const seedStore = createMemorySeedLiteStore();
    const calendar = createFakeCalendar();

    const created = await handleCalendarAgentRequest({
      text: "把拿币的事项弄完",
      requestId: "req_auto_schedule_todo",
      now: "2026-05-14T10:10:00+08:00",
      state,
      seedStore,
      decisionClient: decisionClient({
        type: "remember_todo",
        title: "拿币",
      }),
      calendar,
    });

    expect(created).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_auto_schedule_todo" });
    expect(created.reply).toContain("已新增日程");
    expect(created.reply).toContain("拿币");
    await expect(seedStore.list()).resolves.toEqual([]);
    await expect(calendar.listEvents({ date: "2026-05-14" })).resolves.toMatchObject({
      ok: true,
      data: [{ id: "evt_1", title: "拿币", start: "2026-05-14 11:00", end: "2026-05-14 12:00" }],
    });

    const revised = await handleCalendarAgentRequest({
      text: "改成 11 点",
      requestId: "req_auto_schedule_todo_revise",
      now: "2026-05-14T10:12:00+08:00",
      state,
      seedStore,
      decisionClient: decisionClient({
        type: "update_event",
        target: { kind: "last_event" },
        patch: { startTime: "11:00" },
      }),
      calendar,
    });

    expect(revised).toMatchObject({ ok: true, actionType: "update_event", requestId: "req_auto_schedule_todo_revise" });
    await expect(calendar.listEvents({ date: "2026-05-14" })).resolves.toMatchObject({
      ok: true,
      data: [{ id: "evt_1", title: "拿币", start: "2026-05-14 11:00" }],
    });
  });

  it("lists pending todos as an inbox without writing the calendar", async () => {
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "拿币", createdAt: "2026-05-14T09:00:00+08:00" },
      { seedId: "seed_2", title: "整理材料", targetDate: "2026-05-18" },
      { seedId: "seed_3", title: "订票", reminderAt: "2026-05-18 09:00" },
    ]);
    let createCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "我还有哪些待推进",
      requestId: "req_todo_inbox_list",
      state: createShortTermStateStore(),
      seedStore,
      decisionClient: decisionClient({ type: "manage_todos", operation: "list" }),
      calendar: {
        ...createFakeCalendar(),
        createEvent: async (event) => {
          createCalls += 1;
          return { ok: true, data: { id: "evt_should_not_create", title: event.title, start: `${event.date} ${event.startTime}` } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "manage_todos", requestId: "req_todo_inbox_list" });
    expect(result.reply).toContain("待推进收件箱");
    expect(result.reply).toContain("1. 拿币");
    expect(result.reply).toContain("2. 整理材料");
    expect(result.reply).toContain("2026-05-18");
    expect(result.reply).toContain("3. 订票（提醒：2026-05-18 09:00）");
    expect(result.reply).toContain("可以直接说");
    expect(result.reply).toContain("待推进里的第几个完成了");
    expect(result.reply).toContain("待安排里的第几个安排一下");
    expect(result.reply).toContain("待提醒里的第几个不用提醒");
    expect(result.reply).not.toContain("第几个完成了”“第几个明天处理”“把第几个安排一下");
    expect(result.reply).not.toContain("这个先别提醒");
    expect(createCalls).toBe(0);
  });

  it("includes pending todos in daily briefing and lets the next reply complete one", async () => {
    const state = createShortTermStateStore();
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "拿币" },
      { seedId: "seed_2", title: "整理材料" },
    ]);

    const briefing = await handleCalendarAgentRequest({
      text: "今天工作台",
      requestId: "req_workbench",
      today: "2026-05-14",
      state,
      seedStore,
      decisionClient: decisionClient({ type: "daily_briefing", briefingType: "morning" }),
      calendar: createFakeCalendar(),
    });

    expect(briefing).toMatchObject({ ok: true, actionType: "daily_briefing", requestId: "req_workbench" });
    expect(briefing.reply).toContain("待处理工作台");
    expect(briefing.reply).toContain("待推进");
    expect(briefing.reply).toContain("2. 整理材料");
    expect(briefing.reply).toContain("第几个完成了");

    const completed = await handleCalendarAgentRequest({
      text: "第二个完成了",
      requestId: "req_workbench_complete",
      state,
      seedStore,
      decisionClient: decisionClient({ type: "manage_todos", operation: "complete", target: { itemNumber: 2 } }),
      calendar: createFakeCalendar(),
    });

    expect(completed).toMatchObject({ ok: true, actionType: "manage_todos", requestId: "req_workbench_complete" });
    await expect(seedStore.list()).resolves.toEqual([{ seedId: "seed_1", title: "拿币" }]);
  });

  it("schedules all pending schedule inbox items through a group target", async () => {
    const state = createShortTermStateStore();
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "整理材料", targetDate: "2026-05-14" },
      { seedId: "seed_2", title: "订 1011 的 PS", reminderAt: "2026-05-14 08:00" },
      { seedId: "seed_3", title: "拿币" },
    ]);

    const result = await handleCalendarAgentRequest({
      text: "待安排的都给我推荐一下",
      requestId: "req_schedule_pending_schedule_group",
      state,
      seedStore,
      decisionClient: decisionClient({
        type: "propose_schedule",
        date: "2026-05-14",
        preferredWindow: "afternoon",
        items: [{ target: { group: "pending_schedule" } }],
      }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "propose_schedule", requestId: "req_schedule_pending_schedule_group" });
    expect(result.reply).toContain("整理材料");
    expect(result.reply).not.toContain("订 1011 的 PS");
    expect(result.reply).not.toContain("拿币");
    expect(state.snapshot().pending_schedule?.options[0]?.items).toEqual([
      expect.objectContaining({ title: "整理材料", sourceIds: ["seed_1"] }),
    ]);
  });

  it("shows current inbox options when a todo target cannot be resolved", async () => {
    const result = await handleCalendarAgentRequest({
      text: "第三个完成了",
      requestId: "req_todo_missing_target_with_options",
      state: createShortTermStateStore(),
      seedStore: createMemorySeedLiteStore([
        { seedId: "seed_1", title: "拿币" },
        { seedId: "seed_2", title: "整理材料" },
      ]),
      decisionClient: decisionClient({ type: "manage_todos", operation: "complete", target: { itemNumber: 3 } }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: false, actionType: "manage_todos", requestId: "req_todo_missing_target_with_options" });
    expect(result.reply).toContain("没有找到第 3 个待推进");
    expect(result.reply).toContain("当前待推进收件箱");
    expect(result.reply).toContain("1. 拿币");
    expect(result.reply).toContain("2. 整理材料");
    expect(result.reply).toContain("待推进里的第几个完成了");
  });

  it("uses a natural capture reply when the user only wants to remember a todo", async () => {
    const result = await handleCalendarAgentRequest({
      text: "先记着整理路演材料",
      requestId: "req_seed_capture_natural_reply",
      state: createShortTermStateStore(),
      seedStore: createMemorySeedLiteStore(),
      decisionClient: decisionClient({ type: "remember_todo", title: "整理路演材料", autoSchedule: false }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "seed_lite", requestId: "req_seed_capture_natural_reply" });
    expect(result.reply).toContain("已先记下：整理路演材料");
    expect(result.reply).toContain("之后可以说“帮我安排这个”");
  });

  it("completes, deletes, and updates pending todos through the API bridge", async () => {
    const state = createShortTermStateStore();
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "拿币" },
      { seedId: "seed_2", title: "整理材料" },
      { seedId: "seed_3", title: "写邮件" },
    ]);

    const completed = await handleCalendarAgentRequest({
      text: "拿币那个完成了",
      requestId: "req_todo_complete",
      state,
      seedStore,
      decisionClient: decisionClient({ type: "manage_todos", operation: "complete", target: { title: "拿币" } }),
      calendar: createFakeCalendar(),
    });

    expect(completed).toMatchObject({ ok: true, actionType: "manage_todos", requestId: "req_todo_complete" });
    expect(completed.reply).toContain("已完成待推进：拿币");
    expect(completed.reply).toContain("还有 2 件待推进，可以说“看看待推进收件箱”继续处理。");
    await expect(seedStore.list()).resolves.toEqual([
      { seedId: "seed_2", title: "整理材料" },
      { seedId: "seed_3", title: "写邮件" },
    ]);

    const deleted = await handleCalendarAgentRequest({
      text: "第二个先别提醒了",
      requestId: "req_todo_delete",
      state,
      seedStore,
      decisionClient: decisionClient({ type: "manage_todos", operation: "delete", target: { itemNumber: 2 } }),
      calendar: createFakeCalendar(),
    });

    expect(deleted).toMatchObject({ ok: true, actionType: "manage_todos", requestId: "req_todo_delete" });
    expect(deleted.reply).toContain("已取消待推进：写邮件");
    expect(deleted.reply).toContain("还有 1 件待推进，可以说“看看待推进收件箱”继续处理。");
    await expect(seedStore.list()).resolves.toEqual([{ seedId: "seed_2", title: "整理材料" }]);

    const updated = await handleCalendarAgentRequest({
      text: "把第一个改成下周处理",
      requestId: "req_todo_update",
      state,
      seedStore,
      decisionClient: decisionClient({
        type: "manage_todos",
        operation: "update",
        target: { itemNumber: 1 },
        patch: { targetDate: "2026-05-18", reminderAt: "2026-05-18 14:00" },
      }),
      calendar: createFakeCalendar(),
    });

    expect(updated).toMatchObject({ ok: true, actionType: "manage_todos", requestId: "req_todo_update" });
    expect(updated.reply).toContain("已更新待推进：整理材料");
    expect(updated.reply).toContain("2026-05-18");
    expect(updated.reply).toContain("提醒：2026-05-18 14:00");
    await expect(seedStore.list()).resolves.toEqual([{ seedId: "seed_2", title: "整理材料", targetDate: "2026-05-18", reminderAt: "2026-05-18 14:00" }]);
  });

  it("completes multiple pending todos through one inbox action", async () => {
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "拿币" },
      { seedId: "seed_2", title: "整理材料" },
      { seedId: "seed_3", title: "写邮件" },
    ]);

    const result = await handleCalendarAgentRequest({
      text: "第一个和第三个都完成了",
      requestId: "req_todo_batch_complete",
      state: createShortTermStateStore(),
      seedStore,
      decisionClient: decisionClient({ type: "manage_todos", operation: "complete", target: { itemNumbers: [1, 3] } }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "manage_todos", requestId: "req_todo_batch_complete" });
    expect(result.reply).toContain("已完成待推进：拿币、写邮件");
    await expect(seedStore.list()).resolves.toEqual([{ seedId: "seed_2", title: "整理材料" }]);
  });

  it("does not change pending todos when a batch target is partly missing", async () => {
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "拿币" },
      { seedId: "seed_2", title: "整理材料" },
    ]);

    const result = await handleCalendarAgentRequest({
      text: "第一个和第三个都完成了",
      requestId: "req_todo_batch_missing",
      state: createShortTermStateStore(),
      seedStore,
      decisionClient: decisionClient({ type: "manage_todos", operation: "complete", target: { itemNumbers: [1, 3] } }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: false, actionType: "manage_todos", requestId: "req_todo_batch_missing" });
    expect(result.reply).toContain("没有找到第 3 个待推进");
    await expect(seedStore.list()).resolves.toEqual([
      { seedId: "seed_1", title: "拿币" },
      { seedId: "seed_2", title: "整理材料" },
    ]);
  });

  it("deletes multiple pending todos through one inbox action", async () => {
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "拿币" },
      { seedId: "seed_2", title: "整理材料" },
      { seedId: "seed_3", title: "写邮件" },
    ]);

    const result = await handleCalendarAgentRequest({
      text: "前两个不用再记了",
      requestId: "req_todo_batch_delete",
      state: createShortTermStateStore(),
      seedStore,
      decisionClient: decisionClient({ type: "manage_todos", operation: "delete", target: { itemNumbers: [1, 2] } }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "manage_todos", requestId: "req_todo_batch_delete" });
    expect(result.reply).toContain("已取消待推进：拿币、整理材料");
    await expect(seedStore.list()).resolves.toEqual([{ seedId: "seed_3", title: "写邮件" }]);
  });

  it("fails closed when a todo management target is ambiguous", async () => {
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "整理材料" },
      { seedId: "seed_2", title: "整理路演材料" },
    ]);

    const result = await handleCalendarAgentRequest({
      text: "整理那个完成了",
      requestId: "req_todo_ambiguous",
      state: createShortTermStateStore(),
      seedStore,
      decisionClient: decisionClient({ type: "manage_todos", operation: "complete", target: { title: "整理" } }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: false, actionType: "manage_todos", requestId: "req_todo_ambiguous" });
    expect(result.reply).toContain("找到多个待推进");
    expect(result.reply).toContain("请说对应分组里的第几个");
    expect(result.reply).not.toContain("请说第几个。");
    await expect(seedStore.list()).resolves.toEqual([
      { seedId: "seed_1", title: "整理材料" },
      { seedId: "seed_2", title: "整理路演材料" },
    ]);
  });

  it("completes a pending create draft when the next reply supplies the missing time", async () => {
    const state = createShortTermStateStore({
      pending_clarification: {
        question: "这个日程几点开始？",
        missing: ["startTime"],
        createDraft: { title: "约张总开会", date: "2026-05-09" },
      },
    });
    let createdEvent: unknown;

    const result = await handleCalendarAgentRequest({
      text: "上午10点",
      requestId: "req_complete_pending_create",
      state,
      decisionClient: decisionClient({
        action: "create_event",
        event: { startTime: "10:00" },
      }),
      calendar: {
        ...createFakeCalendar(),
        createEvent: async (event) => {
          createdEvent = event;
          return { ok: true, data: { id: "evt_pending_create", title: event.title, start: `${event.date} ${event.startTime}` } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_complete_pending_create" });
    expect(result.reply).toContain("已新增日程");
    expect(createdEvent).toEqual({ title: "约张总开会", date: "2026-05-09", startTime: "10:00" });
    expect(state.snapshot().pending_clarification).toBeUndefined();
  });

  it("does not keep asking when a pending create draft is already complete", async () => {
    const state = createShortTermStateStore({
      pending_clarification: {
        question: "请问这是什么类型的日程？比如会议、电话沟通、还是提醒？",
        missing: ["eventType"],
        createDraft: { title: "确认 TS 修改意见", date: "2026-05-15", startTime: "10:00" },
      },
    });
    let createdEvent: unknown;

    const result = await handleCalendarAgentRequest({
      text: "提醒",
      requestId: "req_complete_pending_type_clarify",
      state,
      decisionClient: decisionClient({
        type: "clarify",
        question: "请问这是一个什么样的提醒？比如提醒自己做什么事？",
        missing: ["reminderKind"],
      }),
      calendar: {
        ...createFakeCalendar(),
        createEvent: async (event) => {
          createdEvent = event;
          return { ok: true, data: { id: "evt_ts_reminder", title: event.title, start: `${event.date} ${event.startTime}` } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_complete_pending_type_clarify" });
    expect(result.reply).toContain("已新增日程");
    expect(createdEvent).toEqual({ title: "确认 TS 修改意见", date: "2026-05-15", startTime: "10:00" });
    expect(state.snapshot().pending_clarification).toBeUndefined();
  });

  it("clears a pending create draft when a new unrelated command is handled", async () => {
    const state = createShortTermStateStore({
      pending_clarification: {
        question: "这个日程几点开始？",
        missing: ["startTime"],
        createDraft: { title: "约张总开会", date: "2026-05-09" },
      },
    });
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "路演", date: "2026-05-09", startTime: "15:00" });

    const result = await handleCalendarAgentRequest({
      text: "查一下明天日程",
      requestId: "req_clear_pending_create",
      state,
      decisionClient: decisionClient({ action: "list_events", date: "2026-05-09" }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "list_events", requestId: "req_clear_pending_create" });
    expect(result.reply).toContain("路演");
    expect(state.snapshot().pending_clarification).toBeUndefined();
  });

  it("fills the missing date from last_event state for time-only updates", async () => {
    const state = createShortTermStateStore({
      last_event: { eventId: "evt_1", title: "饭局", date: "2026-05-08", startTime: "20:00" },
    });
    let receivedPatch: unknown;

    const result = await handleCalendarAgentRequest({
      text: "刚才那个饭局改到晚上9点",
      requestId: "req_update_time",
      state,
      decisionClient: decisionClient({
        type: "update_event",
        target: { kind: "last_event" },
        patch: { startTime: "21:00" },
      }),
      calendar: {
        ...createFakeCalendar(),
        updateEvent: async (input) => {
          receivedPatch = input.patch;
          return { ok: true, data: { id: input.eventId, title: "饭局", start: `${input.patch.date} ${input.patch.startTime}` } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "update_event", requestId: "req_update_time" });
    expect(receivedPatch).toEqual({ date: "2026-05-08", startTime: "21:00", endTime: "22:00" });
  });

  it("fails closed for time-only updates when last_event has no date", async () => {
    const state = createShortTermStateStore({ last_event: { eventId: "evt_1", title: "饭局" } });
    let updateCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "刚才那个饭局改到晚上9点",
      requestId: "req_update_time_no_date",
      state,
      decisionClient: decisionClient({
        type: "update_event",
        target: { kind: "last_event" },
        patch: { startTime: "21:00" },
      }),
      calendar: {
        ...createFakeCalendar(),
        updateEvent: async (input) => {
          updateCalls += 1;
          return { ok: true, data: { id: input.eventId, title: "饭局", start: "" } };
        },
      },
    });

    expect(result).toMatchObject({ ok: false, actionType: "update_event", requestId: "req_update_time_no_date" });
    expect(result.reply).toBe("没有成功：这个日程是哪一天？");
    expect(updateCalls).toBe(0);
  });

  it("rejects duplicate message ids before model or calendar execution", async () => {
    let decideCalls = 0;
    const result = await handleCalendarAgentRequest({
      text: "明天下午三点见张总",
      messageId: "msg_dup",
      state: createShortTermStateStore(),
      seenMessageIds: new Set(["msg_dup"]),
      decisionClient: { decide: async () => { decideCalls += 1; return { action: "list_events", date: "2026-05-09" }; } },
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: false, actionType: "rejected" });
    expect(result.reply).toContain("已经处理过");
    expect(decideCalls).toBe(0);
  });

  it("stores listed events as briefing items for later item-number updates", async () => {
    const state = createShortTermStateStore();
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "电话会", date: "2026-05-09", startTime: "10:00" });

    await handleCalendarAgentRequest({
      text: "查一下明天日程",
      state,
      decisionClient: decisionClient({ action: "list_events", date: "2026-05-09" }),
      calendar,
    });

    expect(state.snapshot().briefing_items).toEqual([
      { itemNumber: 1, eventId: "evt_1", title: "电话会", date: "2026-05-09", startTime: "10:00" },
    ]);
  });

  it("keeps the queried date in listed time-only events for later item-number updates", async () => {
    const state = createShortTermStateStore();

    await handleCalendarAgentRequest({
      text: "查一下明天日程",
      state,
      decisionClient: decisionClient({ action: "list_events", date: "2026-05-09" }),
      calendar: {
        ...createFakeCalendar(),
        listEvents: async () => ({ ok: true, data: [{ id: "evt_1", title: "电话会", start: "10:00" }] }),
      },
    });

    expect(state.snapshot().briefing_items).toEqual([
      { itemNumber: 1, eventId: "evt_1", title: "电话会", date: "2026-05-09", startTime: "10:00" },
    ]);
  });

  it("creates multiple scheduled events and stores numbered context for follow-up updates", async () => {
    const state = createShortTermStateStore();
    const calendar = createFakeCalendar();

    const createResult = await handleCalendarAgentRequest({
      text: "明天9点投委会，下午2点客户电话，都帮我记一下",
      requestId: "req_create_events",
      state,
      decisionClient: decisionClient({
        type: "create_events",
        events: [
          { title: "投委会", date: "2026-05-12", startTime: "09:00" },
          { title: "客户电话", date: "2026-05-12", startTime: "14:00" },
        ],
      }),
      calendar,
    });

    expect(createResult).toMatchObject({ ok: true, actionType: "create_events", requestId: "req_create_events" });
    expect(createResult.reply).toContain("已新增 2 个日程");
    expect(state.snapshot()).toMatchObject({
      last_event: { eventId: "evt_2", title: "客户电话", date: "2026-05-12", startTime: "14:00" },
      briefing_items: [
        { itemNumber: 1, eventId: "evt_1", title: "投委会", date: "2026-05-12", startTime: "09:00" },
        { itemNumber: 2, eventId: "evt_2", title: "客户电话", date: "2026-05-12", startTime: "14:00" },
      ],
      recent_event_items: [
        { itemNumber: 1, eventId: "evt_1", title: "投委会", date: "2026-05-12", startTime: "09:00" },
        { itemNumber: 2, eventId: "evt_2", title: "客户电话", date: "2026-05-12", startTime: "14:00" },
      ],
    });

    const updateResult = await handleCalendarAgentRequest({
      text: "把第二个改到下午3点",
      requestId: "req_update_second_created",
      state,
      decisionClient: decisionClient({
        type: "update_event",
        target: { kind: "briefing_item", itemNumber: 2 },
        patch: { startTime: "15:00" },
      }),
      calendar,
    });

    expect(updateResult).toMatchObject({ ok: true, actionType: "update_event", requestId: "req_update_second_created" });
    expect(updateResult.reply).toContain("已修改");
    await expect(calendar.listEvents({ date: "2026-05-12" })).resolves.toMatchObject({
      ok: true,
      data: [
        { id: "evt_1", title: "投委会", start: "2026-05-12 09:00" },
        { id: "evt_2", title: "客户电话", start: "2026-05-12 15:00" },
      ],
    });
  });

  it("locks the third recently displayed created event for deletion", async () => {
    const state = createShortTermStateStore();
    const calendar = createFakeCalendar();

    await handleCalendarAgentRequest({
      text: "明天9点去牙医，下午2点取快递，晚上7点健身",
      requestId: "req_create_three_recent_events",
      state,
      decisionClient: decisionClient({
        type: "create_events",
        events: [
          { title: "去牙医", date: "2026-05-17", startTime: "09:00" },
          { title: "取快递", date: "2026-05-17", startTime: "14:00" },
          { title: "健身", date: "2026-05-17", startTime: "19:00" },
        ],
      }),
      calendar,
    });

    const result = await handleCalendarAgentRequest({
      text: "把第三个去掉吧",
      requestId: "req_delete_third_recent_event",
      state,
      decisionClient: decisionClient({
        type: "request_delete_event",
        target: { kind: "recent_event_item", itemNumber: 3 },
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "request_delete_event", requestId: "req_delete_third_recent_event" });
    expect(result.reply).toContain("确认删除");
    expect(result.reply).toContain("健身");
    expect(state.snapshot().pending_delete).toEqual({
      eventId: "evt_3",
      title: "健身",
      source: "recent_event_item",
      itemNumber: 3,
      date: "2026-05-17",
      startTime: "19:00",
    });
  });

  it("proposes open schedule slots without writing calendar", async () => {
    const state = createShortTermStateStore();
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "已有会议", date: "2026-05-12", startTime: "09:00", endTime: "10:00" });

    const result = await handleCalendarAgentRequest({
      text: "明天帮我安排看材料",
      requestId: "req_propose_schedule",
      state,
      decisionClient: decisionClient({
        type: "propose_schedule",
        date: "2026-05-12",
        items: [{ title: "看材料" }],
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "propose_schedule", requestId: "req_propose_schedule" });
    expect(result.reply).toContain("1. 2026-05-12 10:00 看材料");
    expect(result.reply).toContain("看材料");
    expect(state.snapshot().pending_schedule?.options[0]?.items[0]).toMatchObject({
      itemNumber: 1,
      title: "看材料",
      date: "2026-05-12",
      startTime: "10:00",
      durationMinutes: 60,
    });
    await expect(calendar.listEvents({ date: "2026-05-12" })).resolves.toMatchObject({
      ok: true,
      data: [{ id: "evt_1", title: "已有会议", start: "2026-05-12 09:00" }],
    });
  });

  it("creates the explicit event and keeps an afternoon pending schedule for the unfinished item", async () => {
    const state = createShortTermStateStore();
    const calendar = createFakeCalendar();
    const memoryDreamStore = createMemoryMemoryDreamStore({
      entries: [
        {
          id: "mem_preferred_15",
          kind: "preference_candidate",
          summary: "排程偏好：优先安排在 15:00",
          sourceIds: ["obs_afternoon"],
          confidence: 0.82,
          status: "stable",
          reinforcementCount: 2,
          firstSeenAt: "2026-05-14T01:00:00.000Z",
          lastSeenAt: "2026-05-15T01:00:00.000Z",
          updatedAt: "2026-05-15T01:00:00.000Z",
        },
      ],
    });

    const result = await handleCalendarAgentRequest({
      text: "周六上午10点 澄澄游泳\n下午 和hanqi吃饭以及去奥莱",
      requestId: "req_mixed_create_schedule",
      now: "2026-05-15T11:38:00+08:00",
      timezone: "Asia/Shanghai",
      state,
      decisionClient: decisionClient({
        type: "create_and_propose_schedule",
        events: [{ title: "澄澄游泳", date: "2026-05-16", startTime: "10:00" }],
        date: "2026-05-16",
        preferredWindow: "afternoon",
        items: [{ title: "和 hanqi 吃饭以及去奥莱", durationMinutes: 120 }],
      }),
      calendar,
      memoryDreamStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_and_propose_schedule", requestId: "req_mixed_create_schedule" });
    expect(result.reply).toContain("已新增日程");
    expect(result.reply).toContain("澄澄游泳");
    expect(result.reply).toContain("1. 2026-05-16 15:00 和 hanqi 吃饭以及去奥莱");
    expect(result.reply).toContain("和 hanqi 吃饭以及去奥莱");
    await expect(calendar.listEvents({ date: "2026-05-16" })).resolves.toMatchObject({
      ok: true,
      data: [{ id: "evt_1", title: "澄澄游泳", start: "2026-05-16 10:00" }],
    });
    expect(state.snapshot().pending_schedule?.options[0]?.items[0]).toMatchObject({
      title: "和 hanqi 吃饭以及去奥莱",
      date: "2026-05-16",
      startTime: "15:00",
      durationMinutes: 120,
    });
  });

  it("keeps afternoon mixed scheduling away from morning preference slots", async () => {
    const state = createShortTermStateStore();
    const calendar = createFakeCalendar();
    const memoryDreamStore = createMemoryMemoryDreamStore({
      entries: [
        {
          id: "mem_preferred_9",
          kind: "preference_candidate",
          summary: "排程偏好：优先安排在 09:00",
          sourceIds: ["obs_9"],
          confidence: 0.8,
          status: "stable",
          reinforcementCount: 2,
          firstSeenAt: "2026-05-14T01:00:00.000Z",
          lastSeenAt: "2026-05-15T01:00:00.000Z",
          updatedAt: "2026-05-15T01:00:00.000Z",
        },
        {
          id: "mem_preferred_11",
          kind: "preference_candidate",
          summary: "排程偏好：优先安排在 11:00",
          sourceIds: ["obs_11"],
          confidence: 0.8,
          status: "stable",
          reinforcementCount: 2,
          firstSeenAt: "2026-05-14T01:00:00.000Z",
          lastSeenAt: "2026-05-15T01:00:00.000Z",
          updatedAt: "2026-05-15T01:00:00.000Z",
        },
      ],
    });

    const result = await handleCalendarAgentRequest({
      text: "后天上午10点开会，下午帮我找个时间做一下材料",
      requestId: "req_mixed_create_schedule_strict_afternoon",
      now: "2026-05-16T08:50:00+08:00",
      timezone: "Asia/Shanghai",
      state,
      decisionClient: decisionClient({
        type: "create_and_propose_schedule",
        events: [{ title: "开会", date: "2026-05-18", startTime: "10:00" }],
        date: "2026-05-18",
        preferredWindow: "afternoon",
        items: [{ title: "做一下材料", durationMinutes: 60 }],
      }),
      calendar,
      memoryDreamStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_and_propose_schedule", requestId: "req_mixed_create_schedule_strict_afternoon" });
    expect(result.reply).not.toContain("2026-05-18 09:00");
    expect(result.reply).not.toContain("2026-05-18 11:00");
    expect(result.reply).toContain("回复“选 1/2/3”确认。");
    expect(result.reply).not.toContain("第一个改到 11 点");
    expect(state.snapshot().pending_schedule?.options.map((option) => option.items[0]?.startTime)).toEqual(["14:00", "14:30", "15:00"]);
  });

  it("keeps the unfinished schedule proposal when the explicit event conflicts", async () => {
    const state = createShortTermStateStore();
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "湛湛游泳", date: "2026-05-16", startTime: "10:00" });
    const memoryDreamStore = createMemoryMemoryDreamStore({
      entries: [
        {
          id: "mem_preferred_15_conflict",
          kind: "preference_candidate",
          summary: "排程偏好：优先安排在 15:00",
          sourceIds: ["obs_afternoon"],
          confidence: 0.82,
          status: "stable",
          reinforcementCount: 2,
          firstSeenAt: "2026-05-14T01:00:00.000Z",
          lastSeenAt: "2026-05-15T01:00:00.000Z",
          updatedAt: "2026-05-15T01:00:00.000Z",
        },
      ],
    });

    const result = await handleCalendarAgentRequest({
      text: "周六上午10点 湛湛游泳\n下午 和hanqi吃饭以及去奥莱",
      requestId: "req_mixed_create_conflict_schedule",
      now: "2026-05-15T12:28:00+08:00",
      timezone: "Asia/Shanghai",
      state,
      decisionClient: decisionClient({
        type: "create_and_propose_schedule",
        events: [{ title: "湛湛游泳", date: "2026-05-16", startTime: "10:00" }],
        date: "2026-05-16",
        preferredWindow: "afternoon",
        items: [{ title: "和 hanqi 吃饭以及去奥莱", durationMinutes: 120 }],
      }),
      calendar,
      memoryDreamStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_and_propose_schedule", requestId: "req_mixed_create_conflict_schedule" });
    expect(result.reply).toContain("这个时间已有日程");
    expect(result.reply).toContain("湛湛游泳");
    expect(result.reply).toContain("1. 2026-05-16 15:00 和 hanqi 吃饭以及去奥莱");
    expect(result.reply).toContain("和 hanqi 吃饭以及去奥莱");
    await expect(calendar.listEvents({ date: "2026-05-16" })).resolves.toMatchObject({
      ok: true,
      data: [{ id: "evt_1", title: "湛湛游泳", start: "2026-05-16 10:00" }],
    });
    expect(state.snapshot().pending_conflict).toMatchObject({
      action: { type: "create_event", event: { title: "湛湛游泳", date: "2026-05-16", startTime: "10:00" } },
      conflicts: [{ existingEventId: "evt_1", title: "湛湛游泳", start: "2026-05-16 10:00" }],
    });
    expect(state.snapshot().pending_schedule?.options[0]?.items[0]).toMatchObject({
      title: "和 hanqi 吃饭以及去奥莱",
      date: "2026-05-16",
      startTime: "15:00",
      durationMinutes: 120,
    });
  });

  it("shows every requested event when a batch create hits a partial conflict", async () => {
    const state = createShortTermStateStore();
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "湛湛游泳", date: "2026-05-16", startTime: "10:00" });

    const result = await handleCalendarAgentRequest({
      text: "周六上午10点湛湛游泳，下午3点和 hanqi 吃饭以及去奥莱",
      requestId: "req_batch_create_partial_conflict_visible",
      now: "2026-05-15T12:28:00+08:00",
      timezone: "Asia/Shanghai",
      state,
      decisionClient: decisionClient({
        type: "create_events",
        events: [
          { title: "湛湛游泳", date: "2026-05-16", startTime: "10:00" },
          { title: "和 hanqi 吃饭以及去奥莱", date: "2026-05-16", startTime: "15:00" },
        ],
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_conflict", requestId: "req_batch_create_partial_conflict_visible" });
    expect(result.reply).toContain("这个时间已有日程");
    expect(result.reply).toContain("湛湛游泳");
    expect(result.reply).toContain("本次请求还包括");
    expect(result.reply).toContain("2026年5月16日 星期六 15:00 和 hanqi 吃饭以及去奥莱");
    expect(state.snapshot().pending_conflict).toMatchObject({
      action: {
        type: "create_events",
        events: [
          { title: "湛湛游泳", date: "2026-05-16", startTime: "10:00" },
          { title: "和 hanqi 吃饭以及去奥莱", date: "2026-05-16", startTime: "15:00" },
        ],
      },
    });
    await expect(calendar.listEvents({ date: "2026-05-16" })).resolves.toMatchObject({
      ok: true,
      data: [{ id: "evt_1", title: "湛湛游泳", start: "2026-05-16 10:00" }],
    });
  });

  it("uses memory dream schedule preferences when proposing slots", async () => {
    const state = createShortTermStateStore();
    const memoryDreamStore = createMemoryMemoryDreamStore({
      entries: [
        {
          id: "mem_preferred_11",
          kind: "preference_candidate",
          summary: "排程偏好：优先安排在 11:00",
          sourceIds: ["obs_1", "obs_2"],
          confidence: 0.8,
          status: "stable",
          reinforcementCount: 2,
          firstSeenAt: "2026-05-12T01:00:00.000Z",
          lastSeenAt: "2026-05-13T01:00:00.000Z",
          updatedAt: "2026-05-13T01:00:00.000Z",
        },
      ],
    });

    const result = await handleCalendarAgentRequest({
      text: "明天帮我安排看材料",
      requestId: "req_propose_schedule_with_memory",
      state,
      decisionClient: decisionClient({
        type: "propose_schedule",
        date: "2026-05-12",
        items: [{ title: "看材料" }],
      }),
      calendar: createFakeCalendar(),
      memoryDreamStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "propose_schedule", requestId: "req_propose_schedule_with_memory" });
    expect(state.snapshot().pending_schedule?.options[0]?.items[0]).toMatchObject({
      title: "看材料",
      startTime: "11:00",
    });
  });

  it("uses memory dream schedule candidates when the user asks to arrange remembered todos", async () => {
    const state = createShortTermStateStore();
    const memoryDreamStore = createMemoryMemoryDreamStore({
      entries: [
        {
          id: "mem_schedule_dcf",
          kind: "schedule_candidate",
          summary: "排程候选：看 DCF 模型",
          sourceIds: ["seed_1"],
          confidence: 0.86,
          status: "stable",
          reinforcementCount: 1,
          firstSeenAt: "2026-05-12T01:00:00.000Z",
          lastSeenAt: "2026-05-13T01:00:00.000Z",
          updatedAt: "2026-05-13T01:00:00.000Z",
        },
      ],
    });

    const result = await handleCalendarAgentRequest({
      text: "明天把记着的事安排一下",
      requestId: "req_propose_schedule_from_memory_candidates",
      state,
      decisionClient: decisionClient({
        type: "propose_schedule",
        date: "2026-05-12",
        items: [],
      }),
      calendar: createFakeCalendar(),
      memoryDreamStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "propose_schedule", requestId: "req_propose_schedule_from_memory_candidates" });
    expect(result.reply).toContain("看 DCF 模型");
    expect(state.snapshot().pending_schedule?.options[0]?.items[0]).toMatchObject({
      title: "看 DCF 模型",
      date: "2026-05-12",
      startTime: "09:00",
    });
  });

  it("uses structured memory schedule date and time when arranging remembered todos", async () => {
    const state = createShortTermStateStore();
    const memoryDreamStore = createMemoryMemoryDreamStore({
      entries: [
        {
          id: "mem_schedule_material",
          kind: "schedule_candidate",
          summary: "排程候选：整理材料",
          sourceIds: ["seed_1"],
          confidence: 0.86,
          status: "stable",
          reinforcementCount: 1,
          firstSeenAt: "2026-05-12T01:00:00.000Z",
          lastSeenAt: "2026-05-13T01:00:00.000Z",
          updatedAt: "2026-05-13T01:00:00.000Z",
          metadata: {
            targetDate: "2026-05-16",
            preferredStartTime: "14:00",
            durationMinutes: 90,
          },
        } as never,
      ],
    });

    const result = await handleCalendarAgentRequest({
      text: "把记着的事安排一下",
      requestId: "req_propose_schedule_from_memory_metadata",
      state,
      decisionClient: decisionClient({
        type: "propose_schedule",
        items: [],
      }),
      calendar: createFakeCalendar(),
      memoryDreamStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "propose_schedule", requestId: "req_propose_schedule_from_memory_metadata" });
    expect(state.snapshot().pending_schedule?.options[0]?.items[0]).toMatchObject({
      title: "整理材料",
      date: "2026-05-16",
      startTime: "14:00",
      endTime: "15:30",
      durationMinutes: 90,
    });
  });

  it("keeps explicit schedule dates ahead of memory schedule defaults", async () => {
    const state = createShortTermStateStore();
    const memoryDreamStore = createMemoryMemoryDreamStore({
      entries: [
        {
          id: "mem_schedule_material",
          kind: "schedule_candidate",
          summary: "排程候选：整理材料",
          sourceIds: ["seed_1"],
          confidence: 0.86,
          status: "stable",
          reinforcementCount: 1,
          firstSeenAt: "2026-05-12T01:00:00.000Z",
          lastSeenAt: "2026-05-13T01:00:00.000Z",
          updatedAt: "2026-05-13T01:00:00.000Z",
          metadata: {
            targetDate: "2026-05-16",
            preferredStartTime: "14:00",
          },
        } as never,
      ],
    });

    const result = await handleCalendarAgentRequest({
      text: "明天把记着的事安排一下",
      requestId: "req_explicit_date_wins_memory_metadata",
      state,
      decisionClient: decisionClient({
        type: "propose_schedule",
        date: "2026-05-17",
        items: [],
      }),
      calendar: createFakeCalendar(),
      memoryDreamStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "propose_schedule", requestId: "req_explicit_date_wins_memory_metadata" });
    expect(state.snapshot().pending_schedule?.options[0]?.items[0]).toMatchObject({
      title: "整理材料",
      date: "2026-05-17",
      startTime: "14:00",
    });
  });

  it("uses current pending todos when arranging todos before dream candidates exist", async () => {
    const state = createShortTermStateStore();
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "拿币", createdAt: "2026-05-14T09:00:00+08:00" },
    ]);
    const calendar = createFakeCalendar();

    const result = await handleCalendarAgentRequest({
      text: "帮我安排待办",
      requestId: "req_schedule_seed_inbox_without_dream",
      now: "2026-05-14T10:10:00+08:00",
      state,
      seedStore,
      decisionClient: decisionClient({
        type: "propose_schedule",
        items: [],
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "propose_schedule", requestId: "req_schedule_seed_inbox_without_dream" });
    expect(result.reply).toContain("拿币");
    expect(state.snapshot().pending_schedule?.options[0]?.items[0]).toMatchObject({
      title: "拿币",
      sourceIds: ["seed_1"],
      date: "2026-05-14",
      startTime: "11:00",
    });
    await expect(seedStore.list()).resolves.toEqual([
      expect.objectContaining({ seedId: "seed_1", title: "拿币" }),
    ]);
    await expect(calendar.listEvents({ date: "2026-05-14" })).resolves.toMatchObject({ ok: true, data: [] });
  });

  it("confirms the selected recommended schedule slot", async () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          { optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "10:00", endTime: "11:00", durationMinutes: 60 }] },
          { optionNumber: 2, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "11:00", endTime: "12:00", durationMinutes: 60 }] },
        ],
      },
    });
    const calendar = createFakeCalendar();

    const result = await handleCalendarAgentRequest({
      text: "选第二个",
      requestId: "req_confirm_schedule_second",
      state,
      decisionClient: decisionClient({ type: "confirm_schedule", confirmed: true, optionNumber: 2 }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_confirm_schedule_second" });
    expect(state.snapshot().pending_schedule).toBeUndefined();
    await expect(calendar.listEvents({ date: "2026-05-12" })).resolves.toMatchObject({
      ok: true,
      data: [{ id: "evt_1", title: "看材料", start: "2026-05-12 11:00", end: "2026-05-12 12:00" }],
    });
  });

  it("completes Seed Lite items only after remembered schedule candidates are created", async () => {
    const state = createShortTermStateStore();
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "看 DCF 模型", createdAt: "2026-05-12T01:00:00.000Z" },
    ]);
    const memoryDreamStore = createMemoryMemoryDreamStore({
      entries: [
        {
          id: "mem_schedule_dcf",
          kind: "schedule_candidate",
          summary: "排程候选：看 DCF 模型",
          sourceIds: ["seed_1"],
          confidence: 0.86,
          status: "stable",
          reinforcementCount: 1,
          firstSeenAt: "2026-05-12T01:00:00.000Z",
          lastSeenAt: "2026-05-13T01:00:00.000Z",
          updatedAt: "2026-05-13T01:00:00.000Z",
        },
      ],
    });
    const calendar = createFakeCalendar();

    const proposed = await handleCalendarAgentRequest({
      text: "明天把记着的事安排一下",
      requestId: "req_schedule_seed_complete_propose",
      state,
      decisionClient: decisionClient({ type: "propose_schedule", date: "2026-05-12", items: [] }),
      calendar,
      memoryDreamStore,
      seedStore,
    });

    expect(proposed).toMatchObject({ ok: true, actionType: "propose_schedule" });
    await expect(seedStore.list()).resolves.toEqual([
      expect.objectContaining({ seedId: "seed_1", title: "看 DCF 模型" }),
    ]);

    const confirmed = await handleCalendarAgentRequest({
      text: "确认",
      requestId: "req_schedule_seed_complete_confirm",
      state,
      decisionClient: decisionClient({ type: "confirm_schedule", confirmed: true }),
      calendar,
      memoryDreamStore,
      seedStore,
    });

    expect(confirmed).toMatchObject({ ok: true, actionType: "create_event" });
    await expect(seedStore.list()).resolves.toEqual([]);
  });

  it("auto-creates the first remembered schedule candidate when the user asks for a suitable time", async () => {
    const state = createShortTermStateStore();
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "看 DCF 模型", createdAt: "2026-05-12T01:00:00.000Z" },
    ]);
    const memoryDreamStore = createMemoryMemoryDreamStore({
      entries: [
        {
          id: "mem_schedule_dcf",
          kind: "schedule_candidate",
          summary: "排程候选：看 DCF 模型",
          sourceIds: ["seed_1"],
          confidence: 0.86,
          status: "stable",
          reinforcementCount: 1,
          firstSeenAt: "2026-05-12T01:00:00.000Z",
          lastSeenAt: "2026-05-13T01:00:00.000Z",
          updatedAt: "2026-05-13T01:00:00.000Z",
        },
      ],
    });
    const calendar = createFakeCalendar();

    const result = await handleCalendarAgentRequest({
      text: "你觉得什么时候合适",
      requestId: "req_auto_create_memory_schedule",
      now: "2026-05-14T10:10:00+08:00",
      state,
      seedStore,
      memoryDreamStore,
      decisionClient: decisionClient({
        type: "propose_schedule",
        items: [],
        autoCreate: true,
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_auto_create_memory_schedule" });
    expect(state.snapshot().pending_schedule).toBeUndefined();
    await expect(seedStore.list()).resolves.toEqual([]);
    await expect(calendar.listEvents({ date: "2026-05-14" })).resolves.toMatchObject({
      ok: true,
      data: [{ id: "evt_1", title: "看 DCF 模型", start: "2026-05-14 11:00", end: "2026-05-14 12:00" }],
    });
  });

  it("lets the model revise a single recommended schedule slot", async () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          { optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "10:00", endTime: "11:00", durationMinutes: 60 }] },
        ],
      },
    });
    const calendar = createFakeCalendar();

    const result = await handleCalendarAgentRequest({
      text: "改成 11 点",
      requestId: "req_revise_single_schedule",
      state,
      decisionClient: decisionClient({ type: "confirm_schedule", confirmed: true, itemChanges: [{ startTime: "11:00" }] }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_revise_single_schedule" });
    await expect(calendar.listEvents({ date: "2026-05-12" })).resolves.toMatchObject({
      ok: true,
      data: [{ id: "evt_1", title: "看材料", start: "2026-05-12 11:00", end: "2026-05-12 12:00" }],
    });
  });

  it("uses reminder override when confirming a recommended schedule slot", async () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          { optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "10:00", endTime: "11:00", durationMinutes: 60 }] },
        ],
      },
    });
    const reminderStore = createMemoryWechatReminderStore();

    const result = await handleCalendarAgentRequest({
      text: "这个提前两小时提醒我",
      requestId: "req_confirm_schedule_reminder_override",
      state,
      decisionClient: decisionClient({ type: "confirm_schedule", confirmed: true, itemChanges: [{ reminderMinutes: 120 }] }),
      calendar: createFakeCalendar(),
      wechatReminderStore: reminderStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_confirm_schedule_reminder_override" });
    await expect(reminderStore.list()).resolves.toMatchObject([
      { eventId: "evt_1", title: "看材料", leadMinutes: 120 },
    ]);
  });

  it("registers the default WeChat reminder when confirming a recommended schedule slot", async () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          { optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "10:00", endTime: "11:00", durationMinutes: 60 }] },
        ],
      },
    });
    const reminderStore = createMemoryWechatReminderStore();

    const result = await handleCalendarAgentRequest({
      text: "确认",
      requestId: "req_confirm_schedule_default_reminder",
      state,
      decisionClient: decisionClient({ type: "confirm_schedule", confirmed: true }),
      calendar: createFakeCalendar(),
      wechatReminderStore: reminderStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_confirm_schedule_default_reminder" });
    await expect(reminderStore.list()).resolves.toMatchObject([
      { eventId: "evt_1", title: "看材料", leadMinutes: 40, status: "pending" },
    ]);
  });

  it("records schedule reminder changes as memory dream feedback", async () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          { optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "10:00", endTime: "11:00", durationMinutes: 60 }] },
        ],
      },
    });
    const observations: unknown[] = [];

    const result = await handleCalendarAgentRequest({
      text: "这个不用提醒",
      requestId: "req_schedule_reminder_feedback_observation",
      state,
      decisionClient: decisionClient({ type: "confirm_schedule", confirmed: true, itemChanges: [{ reminderMinutes: 0 }] }),
      calendar: createFakeCalendar(),
      memoryDreamStore: {
        async load() {
          return { observations: [], entries: [], dreamRuns: [] };
        },
        async save() {},
        async addObservation(observation) {
          observations.push(observation);
          return { id: "obs_schedule_reminder_feedback", ...observation };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_schedule_reminder_feedback_observation" });
    expect(observations).toContainEqual(
      expect.objectContaining({
        scheduleFeedback: expect.objectContaining({
          kind: "schedule_reminder_changed",
          preferredReminderMinutes: [0],
          reasonCodes: ["schedule_feedback_reminder_disabled"],
        }),
      }),
    );
  });

  it("records bounded multi-reminder schedule feedback for memory dream", async () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          { optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "10:00", endTime: "11:00", durationMinutes: 60 }] },
        ],
      },
    });
    const observations: unknown[] = [];

    const result = await handleCalendarAgentRequest({
      text: "这个比较重要，再提醒一次",
      requestId: "req_schedule_multi_reminder_feedback",
      state,
      decisionClient: decisionClient({ type: "confirm_schedule", confirmed: true, itemChanges: [{ reminderMinutes: [10, 120, 40, 120, 5] }] }),
      calendar: createFakeCalendar(),
      memoryDreamStore: {
        async load() {
          return { observations: [], entries: [], dreamRuns: [] };
        },
        async save() {},
        async addObservation(observation) {
          observations.push(observation);
          return { id: "obs_schedule_multi_reminder_feedback", ...observation };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_schedule_multi_reminder_feedback" });
    expect(observations).toContainEqual(
      expect.objectContaining({
        scheduleFeedback: expect.objectContaining({
          kind: "schedule_reminder_changed",
          preferredReminderMinutes: [120, 40, 10],
          reasonCodes: ["schedule_feedback_reminder_changed"],
        }),
      }),
    );
  });

  it("records schedule time changes as memory dream feedback", async () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          { optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "10:00", endTime: "11:00", durationMinutes: 60 }] },
        ],
      },
    });
    const observations: unknown[] = [];

    const result = await handleCalendarAgentRequest({
      text: "改成 11 点",
      requestId: "req_schedule_feedback_observation",
      state,
      decisionClient: decisionClient({ type: "confirm_schedule", confirmed: true, itemChanges: [{ startTime: "11:00" }] }),
      calendar: createFakeCalendar(),
      memoryDreamStore: {
        async load() {
          return { observations: [], entries: [], dreamRuns: [] };
        },
        async save() {},
        async addObservation(observation) {
          observations.push(observation);
          return { id: "obs_schedule_feedback", ...observation };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_schedule_feedback_observation" });
    expect(observations).toContainEqual(
      expect.objectContaining({
        scheduleFeedback: expect.objectContaining({
          kind: "schedule_time_changed",
          preferredStartTimes: ["11:00"],
          reasonCodes: ["schedule_feedback_changed_time"],
        }),
      }),
    );
  });

  it("records schedule date changes as memory dream feedback", async () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          { optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "10:00", endTime: "11:00", durationMinutes: 60 }] },
        ],
      },
    });
    const observations: unknown[] = [];

    const result = await handleCalendarAgentRequest({
      text: "明天吧",
      requestId: "req_schedule_date_feedback_observation",
      state,
      decisionClient: decisionClient({ type: "confirm_schedule", confirmed: true, itemChanges: [{ date: "2026-05-13" }] }),
      calendar: createFakeCalendar(),
      memoryDreamStore: {
        async load() {
          return { observations: [], entries: [], dreamRuns: [] };
        },
        async save() {},
        async addObservation(observation) {
          observations.push(observation);
          return { id: "obs_schedule_date_feedback", ...observation };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_schedule_date_feedback_observation" });
    expect(observations).toContainEqual(
      expect.objectContaining({
        scheduleFeedback: expect.objectContaining({
          kind: "schedule_time_changed",
          targetDate: "2026-05-13",
          reasonCodes: ["schedule_feedback_changed_date"],
        }),
      }),
    );
  });

  it("reproposes a pending schedule for a later preference without writing calendar", async () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          { optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "10:00", endTime: "11:00", durationMinutes: 60 }] },
        ],
      },
    });
    const calendar = createFakeCalendar();

    const result = await handleCalendarAgentRequest({
      text: "换下午再给我几个",
      requestId: "req_repropose_schedule_afternoon",
      state,
      decisionClient: decisionClient({ type: "propose_schedule", preferredStartTime: "14:00", contextRef: "pending_schedule" }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "propose_schedule", requestId: "req_repropose_schedule_afternoon" });
    expect(result.reply).toContain("1. 2026-05-12 14:00 看材料");
    expect(state.snapshot().pending_schedule?.options[0]?.items[0]).toMatchObject({
      title: "看材料",
      date: "2026-05-12",
      startTime: "14:00",
    });
    await expect(calendar.listEvents({ date: "2026-05-12" })).resolves.toMatchObject({ ok: true, data: [] });
  });

  it("does not reuse a stale pending schedule when a new blank schedule request has no continuation reference", async () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          { optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "10:00", endTime: "11:00", durationMinutes: 60 }] },
        ],
      },
    });
    const seedStore = createMemorySeedLiteStore([{ seedId: "seed_1", title: "拿币" }]);
    const calendar = createFakeCalendar();

    const result = await handleCalendarAgentRequest({
      text: "帮我安排一下",
      requestId: "req_schedule_new_blank_ignores_stale_pending",
      now: "2026-05-14T10:00:00+08:00",
      state,
      seedStore,
      decisionClient: decisionClient({ type: "propose_schedule", items: [] }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "propose_schedule", requestId: "req_schedule_new_blank_ignores_stale_pending" });
    expect(result.reply).toContain("拿币");
    expect(result.reply).not.toContain("看材料");
    expect(state.snapshot().pending_schedule?.options[0]?.items[0]).toMatchObject({
      title: "拿币",
      date: "2026-05-14",
    });
    expect(state.snapshot().pending_schedule?.options[0]?.items[0]?.startTime).not.toBe("10:00");
  });

  it("keeps a pending schedule stable when the follow-up has no new constraints", async () => {
    let listCalls = 0;
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          { optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "10:00", endTime: "11:00", durationMinutes: 60 }] },
        ],
      },
    });
    const calendar: CalendarAdapter = {
      ...createFakeCalendar(),
      async listEvents() {
        listCalls += 1;
        return { ok: true, data: [] };
      },
    };

    const result = await handleCalendarAgentRequest({
      text: "刚才那个推荐再发我一下",
      requestId: "req_schedule_stable_draft",
      state,
      decisionClient: decisionClient({ type: "propose_schedule", contextRef: "pending_schedule" }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "propose_schedule", requestId: "req_schedule_stable_draft" });
    expect(result.reply).toContain("1. 2026-05-12 10:00 看材料");
    expect(listCalls).toBe(0);
  });

  it("reproposes a pending schedule with the requested number of options", async () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          { optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "10:00", endTime: "11:00", durationMinutes: 60 }] },
        ],
      },
    });
    const calendar = createFakeCalendar();

    const result = await handleCalendarAgentRequest({
      text: "多给我几个候选时间",
      requestId: "req_repropose_schedule_more_options",
      state,
      decisionClient: decisionClient({ type: "propose_schedule", optionCount: 5, contextRef: "pending_schedule" }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "propose_schedule", requestId: "req_repropose_schedule_more_options" });
    expect(state.snapshot().pending_schedule?.options).toHaveLength(5);
    await expect(calendar.listEvents({ date: "2026-05-12" })).resolves.toMatchObject({ ok: true, data: [] });
  });

  it("reproposes a pending schedule from a coarse afternoon window", async () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          { optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "10:00", endTime: "11:00", durationMinutes: 60 }] },
        ],
      },
    });
    const calendar = createFakeCalendar();

    const result = await handleCalendarAgentRequest({
      text: "换下午再给我几个",
      requestId: "req_repropose_schedule_window_afternoon",
      state,
      decisionClient: decisionClient({ type: "propose_schedule", preferredWindow: "afternoon", optionCount: 2, contextRef: "pending_schedule" }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "propose_schedule", requestId: "req_repropose_schedule_window_afternoon" });
    expect(state.snapshot().pending_schedule?.options).toHaveLength(2);
    expect(state.snapshot().pending_schedule?.options[0]?.items[0]).toMatchObject({
      title: "看材料",
      date: "2026-05-12",
      startTime: "14:00",
    });
    await expect(calendar.listEvents({ date: "2026-05-12" })).resolves.toMatchObject({ ok: true, data: [] });
  });

  it("reproposes a pending schedule into a materially later window", async () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          { optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "10:00", endTime: "11:00", durationMinutes: 60 }] },
        ],
      },
    });
    const calendar = createFakeCalendar();

    const result = await handleCalendarAgentRequest({
      text: "晚一点再推荐",
      requestId: "req_repropose_schedule_window_later",
      state,
      decisionClient: decisionClient({ type: "propose_schedule", preferredWindow: "later", contextRef: "pending_schedule" }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "propose_schedule", requestId: "req_repropose_schedule_window_later" });
    expect(state.snapshot().pending_schedule?.options[0]?.items[0]).toMatchObject({
      title: "看材料",
      date: "2026-05-12",
      startTime: "15:00",
    });
    await expect(calendar.listEvents({ date: "2026-05-12" })).resolves.toMatchObject({ ok: true, data: [] });
  });

  it("applies corresponding revisions to multiple recommended schedule items", async () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          {
            optionNumber: 1,
            items: [
              { itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "10:00", endTime: "11:00", durationMinutes: 60 },
              { itemNumber: 2, title: "写邮件", date: "2026-05-12", startTime: "11:00", endTime: "12:00", durationMinutes: 60 },
            ],
          },
        ],
      },
    });
    const calendar = createFakeCalendar();

    const result = await handleCalendarAgentRequest({
      text: "第一个改 11 点，第二个改下午 3 点",
      requestId: "req_revise_multi_schedule",
      state,
      decisionClient: decisionClient({
        type: "confirm_schedule",
        confirmed: true,
        itemChanges: [
          { itemNumber: 1, startTime: "11:00" },
          { itemNumber: 2, startTime: "15:00" },
        ],
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_events", requestId: "req_revise_multi_schedule" });
    await expect(calendar.listEvents({ date: "2026-05-12" })).resolves.toMatchObject({
      ok: true,
      data: [
        { id: "evt_1", title: "看材料", start: "2026-05-12 11:00", end: "2026-05-12 12:00" },
        { id: "evt_2", title: "写邮件", start: "2026-05-12 15:00", end: "2026-05-12 16:00" },
      ],
    });
  });

  it("repairs a model date when the user only gave an explicit weekday", async () => {
    const calendar = createFakeCalendar();

    const result = await handleCalendarAgentRequest({
      text: "周一记得智能总问 fanyu 八卦",
      requestId: "req_weekday_single_repair",
      now: "2026-05-14T15:39:00+08:00",
      timezone: "Asia/Shanghai",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        action: "create_event",
        event: { title: "智能总问 fanyu 八卦", date: "2026-05-14", startTime: "10:00" },
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_weekday_single_repair" });
    expect(result.reply).toContain("2026年5月18日 星期一");
    await expect(calendar.listEvents({ date: "2026-05-18" })).resolves.toMatchObject({
      ok: true,
      data: [{ id: "evt_1", title: "智能总问 fanyu 八卦", start: "2026-05-18 10:00" }],
    });
  });

  it("repairs next-week weekday dates even when the wrong model date has the same weekday", async () => {
    const calendar = createFakeCalendar();

    const result = await handleCalendarAgentRequest({
      text: "下周一的下午 4:00 提醒我，问一下肖博，木奇那边聊得怎么样",
      requestId: "req_next_week_monday_same_weekday_repair",
      now: "2026-05-17T09:00:00+08:00",
      timezone: "Asia/Shanghai",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        action: "create_event",
        event: {
          title: "问一下肖博，木奇那边聊得怎么样",
          date: "2026-05-25",
          startTime: "16:00",
        },
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_next_week_monday_same_weekday_repair" });
    expect(result.reply).toContain("2026年5月18日 星期一");
    await expect(calendar.listEvents({ date: "2026-05-18" })).resolves.toMatchObject({
      ok: true,
      data: [{ id: "evt_1", title: "问一下肖博，木奇那边聊得怎么样", start: "2026-05-18 16:00" }],
    });
  });

  it("repairs batch creation when model dates conflict with explicit weekdays in the user text", async () => {
    const calendar = createFakeCalendar();
    let createCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "周一上午九点投委会，周二上午十点客户电话，周二下午三点复盘",
      requestId: "req_weekday_mismatch",
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({
        type: "create_events",
        events: [
          { title: "投委会", date: "2026-05-11", startTime: "09:00" },
          { title: "客户电话", date: "2026-05-12", startTime: "10:00" },
          { title: "复盘", date: "2026-05-13", startTime: "15:00" },
        ],
      }),
      calendar: {
        ...calendar,
        createEvent: async (event) => {
          createCalls += 1;
          return calendar.createEvent(event);
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_events", requestId: "req_weekday_mismatch" });
    expect(result.reply).toContain("已新增 3 个日程");
    expect(createCalls).toBe(3);
    await expect(calendar.listEvents({ date: "2026-05-12" })).resolves.toMatchObject({
      ok: true,
      data: expect.arrayContaining([
        { id: "evt_2", title: "客户电话", start: "2026-05-12 10:00" },
        { id: "evt_3", title: "复盘", start: "2026-05-12 15:00" },
      ]),
    });
  });

  it("handles morning briefing through the API bridge and stores briefing item references", async () => {
    const state = createShortTermStateStore();
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "投委会", date: "2026-05-08", startTime: "09:00" });

    const result = await handleCalendarAgentRequest({
      text: "发我今天早报",
      requestId: "req_morning_briefing",
      today: "2026-05-08",
      state,
      decisionClient: decisionClient({ action: "daily_briefing", briefingType: "morning" }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "daily_briefing", requestId: "req_morning_briefing" });
    expect(result.reply).toContain("早报");
    expect(result.reply).toContain("投委会");
    expect(state.snapshot().briefing_items).toEqual([
      { itemNumber: 1, eventId: "evt_1", title: "投委会", date: "2026-05-08", startTime: "09:00" },
    ]);
  });

  it("refreshes recent event items after a briefing so numbered follow-up updates use the visible list", async () => {
    const state = createShortTermStateStore({
      recent_event_items: [
        { itemNumber: 1, eventId: "evt_old_1", title: "国金", date: "2026-05-26", startTime: "14:00" },
        { itemNumber: 2, eventId: "evt_old_2", title: "基石dd", date: "2026-05-28", startTime: "10:00" },
      ],
    });
    const events = [
      { id: "evt_today_1", title: "锐盟交流", start: "2026-05-26 09:00" },
      { id: "evt_today_2", title: "国金", start: "2026-05-26 14:00" },
    ];
    let updatedEventId = "";
    const calendar: CalendarAdapter = {
      ...createFakeCalendar(),
      listEvents: async () => ({ ok: true, data: events }),
      updateEvent: async (input) => {
        updatedEventId = input.eventId;
        const event = events.find((candidate) => candidate.id === input.eventId);
        if (!event) return { ok: false, code: "not_found", message: "没有找到日程。" };
        if (input.patch.date && input.patch.startTime) event.start = `${input.patch.date} ${input.patch.startTime}`;
        return { ok: true, data: event };
      },
    };

    await handleCalendarAgentRequest({
      text: "今天什么安排",
      requestId: "req_today_visible_list",
      today: "2026-05-26",
      state,
      decisionClient: decisionClient({ action: "daily_briefing", briefingType: "morning" }),
      calendar,
    });

    const result = await handleCalendarAgentRequest({
      text: "把第二个改到4点",
      requestId: "req_update_visible_second",
      today: "2026-05-26",
      state,
      decisionClient: decisionClient({
        action: "update_event",
        target: { kind: "recent_event_item", itemNumber: 2 },
        patch: { startTime: "16:00" },
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "update_event", requestId: "req_update_visible_second" });
    expect(updatedEventId).toBe("evt_today_2");
    expect(result.reply).toContain("2026年5月26日 星期二 16:00 国金");
  });

  it("sends an end time when moving a visible event by start time only so Feishu applies the change", async () => {
    const state = createShortTermStateStore({
      recent_event_items: [{ itemNumber: 1, eventId: "evt_1", title: "国金", date: "2026-05-26", startTime: "14:00" }],
    });
    const events = [{ id: "evt_1", title: "国金", start: "2026-05-26 14:00", end: "2026-05-26 15:00" }];
    let receivedPatch: unknown;
    const calendar: CalendarAdapter = {
      ...createFakeCalendar(),
      listEvents: async () => ({ ok: true, data: events }),
      updateEvent: async (input) => {
        receivedPatch = input.patch;
        const event = events.find((candidate) => candidate.id === input.eventId);
        if (!event) return { ok: false, code: "not_found", message: "没有找到日程。" };
        if (input.patch.date && input.patch.startTime && input.patch.endTime) {
          event.start = `${input.patch.date} ${input.patch.startTime}`;
          event.end = `${input.patch.date} ${input.patch.endTime}`;
        }
        return { ok: true, data: event };
      },
    };

    const result = await handleCalendarAgentRequest({
      text: "今天下午2点的会改到4点",
      requestId: "req_move_requires_end_time",
      today: "2026-05-26",
      state,
      decisionClient: decisionClient({
        action: "update_event",
        target: { kind: "recent_event_item", itemNumber: 1 },
        patch: { startTime: "16:00" },
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "update_event", requestId: "req_move_requires_end_time" });
    expect(receivedPatch).toEqual({ date: "2026-05-26", startTime: "16:00", endTime: "17:00" });
    expect(result.reply).toContain("2026年5月26日 星期二 16:00 国金");
  });

  it("handles evening briefing through the API bridge for tomorrow", async () => {
    const state = createShortTermStateStore();
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "董事会", date: "2026-05-09", startTime: "10:00" });

    const result = await handleCalendarAgentRequest({
      text: "给我晚报",
      requestId: "req_evening_briefing",
      today: "2026-05-08",
      state,
      decisionClient: decisionClient({ action: "daily_briefing", briefingType: "evening" }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "daily_briefing", requestId: "req_evening_briefing" });
    expect(result.reply).toContain("晚报");
    expect(result.reply).toContain("董事会");
  });

  it("keeps the briefing target date for time-only event starts before follow-up updates", async () => {
    const state = createShortTermStateStore();
    const calendar: CalendarAdapter = {
      ...createFakeCalendar(),
      listEvents: async () => ({
        ok: true,
        data: [
          { id: "evt_1", title: "上午会议", start: "09:30" },
          { id: "evt_2", title: "沐曦-伊辛智能", start: "16:00" },
        ],
      }),
      updateEvent: async (input) => ({
        ok: true,
        data: {
          id: input.eventId,
          title: "沐曦-伊辛智能",
          start: input.patch.date && input.patch.startTime ? `${input.patch.date} ${input.patch.startTime}` : "2026-05-19 16:00",
        },
      }),
    };

    await handleCalendarAgentRequest({
      text: "给我晚报",
      requestId: "req_evening_time_only_briefing",
      today: "2026-05-18",
      state,
      decisionClient: decisionClient({ action: "daily_briefing", briefingType: "evening" }),
      calendar,
    });

    const result = await handleCalendarAgentRequest({
      text: "把下午4点的改成上午10点",
      requestId: "req_update_time_only_briefing_item",
      state,
      decisionClient: decisionClient({
        action: "update_event",
        target: { kind: "briefing_item", itemNumber: 2 },
        patch: { startTime: "10:00" },
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "update_event", requestId: "req_update_time_only_briefing_item" });
    expect(result.reply).toContain("10:00");
    expect(result.reply).not.toContain("16:00 沐曦-伊辛智能");
  });

  it("updates a briefing item by resolving it to the real event id through the API bridge", async () => {
    const state = createShortTermStateStore({ briefing_items: [{ itemNumber: 2, eventId: "evt_2", title: "电话会" }] });
    let receivedEventId = "";
    const calendar: CalendarAdapter = {
      ...createFakeCalendar(),
      updateEvent: async (input) => {
        receivedEventId = input.eventId;
        return { ok: true, data: { id: input.eventId, title: input.patch.title || "电话会", start: "2026-05-09 10:00" } };
      },
    };

    const result = await handleCalendarAgentRequest({
      text: "把第2条改成和李总电话会",
      requestId: "req_briefing_item_update",
      state,
      decisionClient: decisionClient({
        action: "update_event",
        target: { kind: "briefing_item", itemNumber: 2 },
        patch: { title: "和李总电话会" },
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "update_event", requestId: "req_briefing_item_update" });
    expect(receivedEventId).toBe("evt_2");
    expect(result.reply).toContain("已修改");
  });

  it("fails closed when an API briefing item reference is missing", async () => {
    const state = createShortTermStateStore({ briefing_items: [{ itemNumber: 1, eventId: "evt_1", title: "电话会" }] });
    let updateCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "把第3条改成和李总电话会",
      requestId: "req_missing_briefing_item",
      state,
      decisionClient: decisionClient({
        action: "update_event",
        target: { kind: "briefing_item", itemNumber: 3 },
        patch: { title: "和李总电话会" },
      }),
      calendar: {
        ...createFakeCalendar(),
        updateEvent: async (input) => {
          updateCalls += 1;
          return { ok: true, data: { id: input.eventId, title: "不应写入", start: "" } };
        },
      },
    });

    expect(result).toMatchObject({ ok: false, actionType: "update_event", requestId: "req_missing_briefing_item" });
    expect(result.reply).toContain("没有找到日报里的第 3 条");
    expect(updateCalls).toBe(0);
  });

  it("stores a pending delete from last_event without calling calendar delete", async () => {
    const state = createShortTermStateStore({
      last_event: { eventId: "evt_1", title: "电话会", date: "2026-05-09", startTime: "10:00" },
    });
    let deleteCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "删掉刚才那个",
      requestId: "req_delete_request",
      state,
      decisionClient: decisionClient({
        type: "request_delete_event",
        target: { kind: "last_event" },
      }),
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async (input) => {
          deleteCalls += 1;
          return { ok: true, data: { eventId: input.eventId } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "request_delete_event", requestId: "req_delete_request" });
    expect(result.reply).toContain("确认删除");
    expect(result.reply).toContain("OK");
    expect(result.reply).toContain("算了");
    expect(state.snapshot().pending_delete).toEqual({
      eventId: "evt_1",
      title: "电话会",
      source: "last_event",
      date: "2026-05-09",
      startTime: "10:00",
    });
    expect(deleteCalls).toBe(0);
  });

  it("executes delete only from pending delete state after confirmation", async () => {
    const state = createShortTermStateStore({
      pending_delete: { eventId: "evt_real", title: "电话会", source: "last_event", date: "2026-05-09", startTime: "10:00" },
    });
    let deletedEventId = "";

    const result = await handleCalendarAgentRequest({
      text: "确认删除",
      requestId: "req_delete_confirm",
      state,
      decisionClient: decisionClient({ type: "confirm_delete", confirmed: true }),
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async (input) => {
          deletedEventId = input.eventId;
          return { ok: true, data: { eventId: input.eventId } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "confirm_delete", requestId: "req_delete_confirm" });
    expect(result.reply).toBe("已删除日程：\n2026年5月9日 星期六 10:00 电话会");
    expect(deletedEventId).toBe("evt_real");
    expect(state.snapshot().pending_delete).toBeUndefined();
  });

  it("cancels pending WeChat reminders after deleting a calendar event", async () => {
    const state = createShortTermStateStore({
      pending_delete: { eventId: "evt_real", title: "取快递", source: "last_event", date: "2026-05-17", startTime: "14:00" },
    });
    const reminderStore = createMemoryWechatReminderStore([
      ...buildWechatReminderJobs({ id: "evt_real", title: "取快递", start: "2026-05-17 14:00" }, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES),
      ...buildWechatReminderJobs({ id: "evt_keep", title: "健身", start: "2026-05-17 19:00" }, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES),
    ]);

    const result = await handleCalendarAgentRequest({
      text: "确认删除",
      requestId: "req_delete_confirm_cancel_reminder",
      state,
      decisionClient: decisionClient({ type: "confirm_delete", confirmed: true }),
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async (input) => ({ ok: true, data: { eventId: input.eventId } }),
      },
      wechatReminderStore: reminderStore,
    });

    expect(result).toMatchObject({ ok: true, actionType: "confirm_delete", requestId: "req_delete_confirm_cancel_reminder" });
    await expect(reminderStore.list()).resolves.toMatchObject([
      { eventId: "evt_keep", title: "健身", status: "pending" },
    ]);
  });

  it("lets the model interpret pending delete confirmation before deleting", async () => {
    const state = createShortTermStateStore({
      pending_delete: { eventId: "evt_real", title: "电话会", source: "last_event" },
    });
    let decideCalls = 0;
    let deletedEventId = "";

    const result = await handleCalendarAgentRequest({
      text: "OK",
      requestId: "req_delete_confirm_gate",
      state,
      decisionClient: {
        decide: async () => {
          decideCalls += 1;
          return { type: "confirm_delete", confirmed: true };
        },
      },
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async (input) => {
          deletedEventId = input.eventId;
          return { ok: true, data: { eventId: input.eventId } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "confirm_delete", requestId: "req_delete_confirm_gate" });
    expect(deletedEventId).toBe("evt_real");
    expect(decideCalls).toBe(1);
  });

  it("rejects duplicate pending delete confirmation before deleting", async () => {
    const state = createShortTermStateStore({
      pending_delete: { eventId: "evt_real", title: "电话会", source: "last_event" },
    });
    let deleteCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "确认删除",
      messageId: "msg_confirm",
      requestId: "req_duplicate_confirm",
      seenMessageIds: new Set(["msg_confirm"]),
      state,
      decisionClient: {
        decide: async () => ({ action: "clarify", question: "不应调用模型", missing: ["none"] }),
      },
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async (input) => {
          deleteCalls += 1;
          return { ok: true, data: { eventId: input.eventId } };
        },
      },
    });

    expect(result).toMatchObject({ ok: false, actionType: "rejected", requestId: "req_duplicate_confirm" });
    expect(deleteCalls).toBe(0);
    expect(state.snapshot().pending_delete).toEqual({ eventId: "evt_real", title: "电话会", source: "last_event" });
  });

  it("lets the model interpret pending delete cancellation", async () => {
    const state = createShortTermStateStore({
      pending_delete: { eventId: "evt_real", title: "电话会", source: "last_event" },
    });
    let decideCalls = 0;
    let deleteCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "算了",
      requestId: "req_delete_cancel_gate",
      state,
      decisionClient: {
        decide: async () => {
          decideCalls += 1;
          return { type: "confirm_delete", confirmed: false };
        },
      },
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async (input) => {
          deleteCalls += 1;
          return { ok: true, data: { eventId: input.eventId } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "confirm_delete", requestId: "req_delete_cancel_gate" });
    expect(result.reply).toBe("已取消删除。");
    expect(decideCalls).toBe(1);
    expect(deleteCalls).toBe(0);
    expect(state.snapshot().pending_delete).toBeUndefined();
  });

  it("clears stale pending delete before handling a new non-confirm request", async () => {
    const state = createShortTermStateStore({
      pending_delete: { eventId: "evt_real", title: "电话会", source: "last_event" },
    });
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "路演", date: "2026-05-09", startTime: "10:00" });

    const result = await handleCalendarAgentRequest({
      text: "查一下明天日程",
      requestId: "req_new_query_clears_delete",
      state,
      decisionClient: { decide: async () => ({ action: "list_events", date: "2026-05-09" }) },
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "list_events", requestId: "req_new_query_clears_delete" });
    expect(state.snapshot().pending_delete).toBeUndefined();
  });

  it("keeps pending delete state when calendar delete fails", async () => {
    const state = createShortTermStateStore({
      pending_delete: { eventId: "evt_real", title: "电话会", source: "last_event" },
    });

    const result = await handleCalendarAgentRequest({
      text: "确认删除",
      requestId: "req_delete_confirm_failed",
      state,
      decisionClient: decisionClient({ type: "confirm_delete", confirmed: true }),
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async () => ({ ok: false, code: "network_error", message: "删除失败。" }),
      },
    });

    expect(result).toMatchObject({ ok: false, actionType: "confirm_delete", requestId: "req_delete_confirm_failed" });
    expect(result.reply).toContain("删除失败");
    expect(state.snapshot().pending_delete).toEqual({ eventId: "evt_real", title: "电话会", source: "last_event" });
  });

  it("keeps pending delete state and gives retry guidance when Feishu delete is rate limited", async () => {
    const state = createShortTermStateStore({
      pending_delete: { eventId: "evt_real", title: "电话会", source: "last_event", date: "2026-05-09", startTime: "10:00" },
    });

    const result = await handleCalendarAgentRequest({
      text: "确认删除",
      requestId: "req_delete_confirm_rate_limited",
      state,
      decisionClient: decisionClient({ type: "confirm_delete", confirmed: true }),
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async () => ({
          ok: false,
          code: "api_error",
          message: "飞书日历 API 返回错误：current operation rate limited",
        }),
      },
    });

    expect(result).toMatchObject({ ok: false, actionType: "confirm_delete", requestId: "req_delete_confirm_rate_limited" });
    expect(result.reply).toContain("飞书现在限流");
    expect(result.reply).toContain("稍后再回复确认删除");
    expect(result.reply).toContain("电话会");
    expect(state.snapshot().pending_delete).toEqual({
      eventId: "evt_real",
      title: "电话会",
      source: "last_event",
      date: "2026-05-09",
      startTime: "10:00",
    });
  });

  it("does not write pending delete when last_event is missing", async () => {
    const state = createShortTermStateStore();

    const result = await handleCalendarAgentRequest({
      text: "删掉刚才那个",
      requestId: "req_delete_missing_last_event",
      state,
      decisionClient: decisionClient({
        type: "request_delete_event",
        target: { kind: "last_event" },
      }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: false, actionType: "request_delete_event", requestId: "req_delete_missing_last_event" });
    expect(result.reply).toContain("没有找到刚才那个日程");
    expect(state.snapshot().pending_delete).toBeUndefined();
  });

  it("cancels pending delete without calling calendar delete", async () => {
    const state = createShortTermStateStore({
      pending_delete: { eventId: "evt_1", title: "电话会", source: "last_event" },
    });
    let deleteCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "先别删了",
      requestId: "req_delete_cancel",
      state,
      decisionClient: decisionClient({ type: "confirm_delete", confirmed: false }),
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async (input) => {
          deleteCalls += 1;
          return { ok: true, data: { eventId: input.eventId } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "confirm_delete", requestId: "req_delete_cancel" });
    expect(result.reply).toBe("已取消删除。");
    expect(deleteCalls).toBe(0);
    expect(state.snapshot().pending_delete).toBeUndefined();
  });

  it("fails closed when delete confirmation has no pending delete state", async () => {
    let deleteCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "确认删除",
      requestId: "req_delete_missing_pending",
      state: createShortTermStateStore(),
      decisionClient: decisionClient({ type: "confirm_delete", confirmed: true }),
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async (input) => {
          deleteCalls += 1;
          return { ok: true, data: { eventId: input.eventId } };
        },
      },
    });

    expect(result).toMatchObject({ ok: false, actionType: "confirm_delete", requestId: "req_delete_missing_pending" });
    expect(result.reply).toContain("没有待确认的删除");
    expect(deleteCalls).toBe(0);
  });

  it("stores a pending delete from a briefing item reference", async () => {
    const state = createShortTermStateStore({
      briefing_items: [{ itemNumber: 2, eventId: "evt_2", title: "董事会", date: "2026-05-09", startTime: "14:00" }],
    });

    const result = await handleCalendarAgentRequest({
      text: "删掉第2条",
      requestId: "req_delete_briefing_item",
      state,
      decisionClient: decisionClient({
        type: "request_delete_event",
        target: { kind: "briefing_item", itemNumber: 2 },
      }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "request_delete_event", requestId: "req_delete_briefing_item" });
    expect(state.snapshot().pending_delete).toEqual({
      eventId: "evt_2",
      title: "董事会",
      source: "briefing_item",
      itemNumber: 2,
      date: "2026-05-09",
      startTime: "14:00",
    });
  });

  it("locks an explicit delete query by date time and title instead of stale numbered context", async () => {
    const state = createShortTermStateStore({
      briefing_items: [
        { itemNumber: 1, eventId: "evt_today_dinner", title: "和朋友吃饭", date: "2026-05-16", startTime: "19:00" },
      ],
    });
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "和朋友吃饭", date: "2026-05-16", startTime: "19:00" });
    await calendar.createEvent({ title: "健身", date: "2026-05-17", startTime: "19:00" });

    const result = await handleCalendarAgentRequest({
      text: "去掉明天晚上7点的健身",
      requestId: "req_delete_explicit_query",
      state,
      decisionClient: decisionClient({
        type: "request_delete_event",
        target: { kind: "event_query", date: "2026-05-17", startTime: "19:00", title: "健身" },
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "request_delete_event", requestId: "req_delete_explicit_query" });
    expect(result.reply).toContain("确认删除");
    expect(result.reply).toContain("健身");
    expect(result.reply).not.toContain("和朋友吃饭");
    expect(state.snapshot().pending_delete).toEqual({
      eventId: "evt_2",
      title: "健身",
      source: "event_query",
      date: "2026-05-17",
      startTime: "19:00",
    });
  });

  it("lists candidates when an explicit delete query matches multiple events", async () => {
    const state = createShortTermStateStore();
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "健身", date: "2026-05-17", startTime: "19:00" });
    await calendar.createEvent({ title: "健身课", date: "2026-05-17", startTime: "19:00" });

    const result = await handleCalendarAgentRequest({
      text: "去掉明天晚上7点的健身",
      requestId: "req_delete_explicit_query_ambiguous",
      state,
      decisionClient: decisionClient({
        type: "request_delete_event",
        target: { kind: "event_query", date: "2026-05-17", startTime: "19:00", title: "健身" },
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "request_delete_event", requestId: "req_delete_explicit_query_ambiguous" });
    expect(result.reply).toContain("匹配到多个日程");
    expect(result.reply).toContain("请回复要删除第几个");
    expect(state.snapshot().pending_delete).toMatchObject({
      source: "event_query",
      eventIds: ["evt_1", "evt_2"],
      requireSelection: true,
    });
  });

  it("does not delete all fuzzy query candidates when the user confirms without choosing one", async () => {
    const state = createShortTermStateStore({
      pending_delete: {
        source: "event_query",
        title: "匹配到的 2 个日程",
        eventIds: ["evt_1", "evt_2"],
        requireSelection: true,
        items: [
          { eventId: "evt_1", title: "健身", date: "2026-05-17", startTime: "19:00" },
          { eventId: "evt_2", title: "健身课", date: "2026-05-17", startTime: "19:00" },
        ],
      },
    } as never);
    let deleteCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "确认",
      requestId: "req_delete_query_requires_selection",
      state,
      decisionClient: decisionClient({ type: "confirm_delete", confirmed: true }),
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async (input) => {
          deleteCalls += 1;
          return { ok: true, data: { eventId: input.eventId } };
        },
      },
    });

    expect(result).toMatchObject({ ok: false, actionType: "confirm_delete", requestId: "req_delete_query_requires_selection" });
    expect(result.reply).toContain("请先回复要删除第几个");
    expect(deleteCalls).toBe(0);
    expect(state.snapshot().pending_delete).toBeDefined();
  });

  it("updates a unique event found by structured query", async () => {
    const state = createShortTermStateStore();
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "健身", date: "2026-05-17", startTime: "15:00" });

    const result = await handleCalendarAgentRequest({
      text: "把周日下午的健身改到4点",
      requestId: "req_update_explicit_query",
      state,
      decisionClient: decisionClient({
        type: "update_event",
        target: { kind: "event_query", date: "2026-05-17", timeWindow: "afternoon", title: "健身" },
        patch: { startTime: "16:00" },
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: true, actionType: "update_event", requestId: "req_update_explicit_query" });
    expect(result.reply).toContain("已修改");
    await expect(calendar.listEvents({ date: "2026-05-17" })).resolves.toMatchObject({
      ok: true,
      data: [{ id: "evt_1", title: "健身", start: "2026-05-17 16:00" }],
    });
  });

  it("fails closed when Feishu returns an updated event that does not reflect the requested time", async () => {
    const state = createShortTermStateStore({
      recent_event_items: [{ itemNumber: 1, eventId: "evt_1", title: "国金", date: "2026-05-26", startTime: "14:00" }],
    });
    let updateCalls = 0;
    const calendar: CalendarAdapter = {
      ...createFakeCalendar(),
      updateEvent: async (input) => {
        updateCalls += 1;
        return { ok: true, data: { id: input.eventId, title: "国金", start: "2026-05-26 14:00" } };
      },
    };

    const result = await handleCalendarAgentRequest({
      text: "把今天2点的会改到4点",
      requestId: "req_stale_update_response",
      state,
      decisionClient: decisionClient({
        type: "update_event",
        target: { kind: "recent_event_item", itemNumber: 1 },
        patch: { startTime: "16:00" },
      }),
      calendar,
    });

    expect(result).toMatchObject({ ok: false, actionType: "update_event", requestId: "req_stale_update_response" });
    expect(result.reply).toContain("没有成功");
    expect(result.reply).toContain("没有体现修改后的时间");
    expect(updateCalls).toBe(1);
  });

  it("locks all events from an explicit date delete query before batch deletion", async () => {
    const state = createShortTermStateStore();
    const events = [
      { id: "evt_1", title: "Navi主日历真实入口验证", start: "2026-05-12 10:00" },
      { id: "evt_2", title: "基石", start: "2026-05-12 14:00" },
      { id: "evt_3", title: "周三会议", start: "2026-05-13 11:00" },
    ];
    let deleteCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "把周二所有日程删掉",
      requestId: "req_delete_tuesday_all",
      state,
      decisionClient: decisionClient({
        type: "request_delete_events",
        query: { date: "2026-05-12" },
      } as never),
      calendar: {
        ...createFakeCalendar(),
        listEvents: async () => ({ ok: true, data: events.filter((event) => event.start.startsWith("2026-05-12")) }),
        deleteEvent: async (input) => {
          deleteCalls += 1;
          return { ok: true, data: { eventId: input.eventId } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "request_delete_events", requestId: "req_delete_tuesday_all" });
    expect(result.reply).toContain("确认删除以下 2 个日程");
    expect(result.reply).toContain("OK");
    expect(result.reply).toContain("算了");
    expect(result.reply).toContain("Navi主日历真实入口验证");
    expect(result.reply).toContain("基石");
    expect(deleteCalls).toBe(0);
    expect(state.snapshot().pending_delete).toMatchObject({
      source: "date_query",
      eventIds: ["evt_1", "evt_2"],
      title: "2026年5月12日 星期二的 2 个日程",
    });
  });

  it("confirms locked batch deletion with the model decision", async () => {
    const state = createShortTermStateStore({
      pending_delete: {
        source: "date_query",
        title: "2026年5月12日 星期二的 2 个日程",
        eventIds: ["evt_1", "evt_2"],
        items: [
          { eventId: "evt_1", title: "Navi主日历真实入口验证", date: "2026-05-12", startTime: "10:00" },
          { eventId: "evt_2", title: "基石", date: "2026-05-12", startTime: "14:00" },
        ],
      },
    } as never);
    const deletedEventIds: string[] = [];

    const result = await handleCalendarAgentRequest({
      text: "删掉",
      requestId: "req_confirm_batch_delete",
      state,
      decisionClient: decisionClient({ type: "confirm_delete", confirmed: true }),
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async (input) => {
          deletedEventIds.push(input.eventId);
          return { ok: true, data: { eventId: input.eventId } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "confirm_delete", requestId: "req_confirm_batch_delete" });
    expect(result.reply).toContain("已删除 2 个日程");
    expect(result.reply).toContain("Navi主日历真实入口验证");
    expect(result.reply).toContain("基石");
    expect(deletedEventIds).toEqual(["evt_1", "evt_2"]);
    expect(state.snapshot().pending_delete).toBeUndefined();
  });

  it("deletes only selected locked batch items chosen by the model", async () => {
    const state = createShortTermStateStore({
      pending_delete: {
        source: "date_query",
        title: "2026年5月12日 星期二的 2 个日程",
        eventIds: ["evt_1", "evt_2"],
        items: [
          { eventId: "evt_1", title: "Navi主日历真实入口验证", date: "2026-05-12", startTime: "10:00" },
          { eventId: "evt_2", title: "基石", date: "2026-05-12", startTime: "14:00" },
        ],
      },
    } as never);
    const deletedEventIds: string[] = [];

    const result = await handleCalendarAgentRequest({
      text: "只删第一个",
      requestId: "req_confirm_batch_delete_first",
      state,
      decisionClient: decisionClient({ type: "confirm_delete", confirmed: true, itemNumbers: [1] }),
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async (input) => {
          deletedEventIds.push(input.eventId);
          return { ok: true, data: { eventId: input.eventId } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "confirm_delete", requestId: "req_confirm_batch_delete_first" });
    expect(result.reply).toContain("已删除 1 个日程");
    expect(result.reply).toContain("Navi主日历真实入口验证");
    expect(result.reply).not.toContain("基石");
    expect(deletedEventIds).toEqual(["evt_1"]);
    expect(state.snapshot().pending_delete).toBeUndefined();
  });

  it("fails closed when selected batch delete item number is outside the locked list", async () => {
    const state = createShortTermStateStore({
      pending_delete: {
        source: "date_query",
        title: "2026年5月12日 星期二的 2 个日程",
        eventIds: ["evt_1", "evt_2"],
        items: [
          { eventId: "evt_1", title: "Navi主日历真实入口验证", date: "2026-05-12", startTime: "10:00" },
          { eventId: "evt_2", title: "基石", date: "2026-05-12", startTime: "14:00" },
        ],
      },
    } as never);
    let deleteCalls = 0;

    const result = await handleCalendarAgentRequest({
      text: "删第三个",
      requestId: "req_confirm_batch_delete_out_of_range",
      state,
      decisionClient: decisionClient({ type: "confirm_delete", confirmed: true, itemNumbers: [3] }),
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async (input) => {
          deleteCalls += 1;
          return { ok: true, data: { eventId: input.eventId } };
        },
      },
    });

    expect(result).toMatchObject({ ok: false, actionType: "confirm_delete", requestId: "req_confirm_batch_delete_out_of_range" });
    expect(result.reply).toContain("没有找到待删除列表里的第 3 条");
    expect(deleteCalls).toBe(0);
    expect(state.snapshot().pending_delete).toBeDefined();
  });

  it("does not write pending delete when briefing item reference is missing", async () => {
    const state = createShortTermStateStore({ briefing_items: [{ itemNumber: 1, eventId: "evt_1", title: "投委会" }] });

    const result = await handleCalendarAgentRequest({
      text: "删掉第3条",
      requestId: "req_delete_missing_briefing_item",
      state,
      decisionClient: decisionClient({
        type: "request_delete_event",
        target: { kind: "briefing_item", itemNumber: 3 },
      }),
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: false, actionType: "request_delete_event", requestId: "req_delete_missing_briefing_item" });
    expect(result.reply).toContain("没有找到日报里的第 3 条");
    expect(state.snapshot().pending_delete).toBeUndefined();
  });
});
