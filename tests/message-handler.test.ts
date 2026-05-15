// 本地微信消息处理测试：确认只编排已有模块，不绑定真实微信或飞书。

import { describe, expect, it } from "vitest";
import { handleWeChatMessage } from "../src/app/message-handler.js";
import type { CalendarAdapter } from "../src/calendar/action-executor.js";
import { createShortTermStateStore } from "../src/state/index.js";

function createAdapter(): CalendarAdapter {
  return {
    async createEvent(event) {
      return { ok: true, data: { id: "evt_1", title: event.title, start: `${event.date} ${event.startTime}` } };
    },
    async listEvents() {
      return {
        ok: true,
        data: [
          { id: "evt_1", title: "见张总", start: "2026-05-09 15:00" },
          { id: "evt_2", title: "电话会", start: "2026-05-09 18:00" },
        ],
      };
    },
    async updateEvent(input) {
      return { ok: true, data: { id: input.eventId, title: input.patch.title || "见张总", start: "" } };
    },
    async deleteEvent(input) {
      return { ok: true, data: { eventId: input.eventId } };
    },
  };
}

describe("handleWeChatMessage", () => {
  it("creates event from normalized text message and stores last event only after tool success", async () => {
    const state = createShortTermStateStore();

    const result = await handleWeChatMessage({
      message: { id: "wx_1", kind: "text", text: "  明天下午三点见张总  " },
      state,
      decisionClient: {
        decide: async (request) => {
          expect(request.text).toBe("明天下午三点见张总");
          return { action: "create_event", event: { title: "见张总", date: "2026-05-09", startTime: "15:00" } };
        },
      },
      calendar: createAdapter(),
    });

    expect(result).toEqual({ ok: true, reply: "已新增日程：\n2026年5月9日 星期六 15:00 见张总" });
    expect(state.snapshot().last_event).toEqual({ eventId: "evt_1", title: "见张总", date: "2026-05-09", startTime: "15:00" });
  });

  it("lists events and stores briefing item references for later phases", async () => {
    const state = createShortTermStateStore();

    const result = await handleWeChatMessage({
      message: { id: "wx_2", kind: "voice_transcript", transcript: "查一下明天日程" },
      state,
      decisionClient: { decide: async () => ({ action: "list_events", date: "2026-05-09" }) },
      calendar: createAdapter(),
    });

    expect(result).toEqual({
      ok: true,
      reply: "找到 2 个日程：\n1. 2026年5月9日 星期六 15:00 见张总\n2. 2026年5月9日 星期六 18:00 电话会",
    });
    expect(state.snapshot().briefing_items).toEqual([
      { itemNumber: 1, eventId: "evt_1", title: "见张总", date: "2026-05-09", startTime: "15:00" },
      { itemNumber: 2, eventId: "evt_2", title: "电话会", date: "2026-05-09", startTime: "18:00" },
    ]);
  });

  it("keeps voice transcript digits and Latin abbreviations while doing text hygiene", async () => {
    const state = createShortTermStateStore();

    await handleWeChatMessage({
      message: { id: "wx_voice_hygiene", kind: "voice_transcript", transcript: "  明天上午８点提醒我一下 １０１１ 的 ＴＳ  " },
      state,
      decisionClient: {
        decide: async (request) => {
          expect(request.text).toBe("明天上午8点提醒我一下 1011 的 TS");
          return { action: "list_events", date: "2026-05-09" };
        },
      },
      calendar: createAdapter(),
    });
  });

  it("returns clarify without calling calendar", async () => {
    let called = false;
    const calendar: CalendarAdapter = {
      async createEvent() {
        called = true;
        return { ok: true, data: { id: "evt_1", title: "会", start: "" } };
      },
      async listEvents() {
        called = true;
        return { ok: true, data: [] };
      },
      async updateEvent() {
        called = true;
        return { ok: true, data: { id: "evt_1", title: "会", start: "" } };
      },
      async deleteEvent() {
        called = true;
        return { ok: true, data: { eventId: "evt_1" } };
      },
    };

    const result = await handleWeChatMessage({
      message: { id: "wx_3", kind: "text", text: "明天见张总" },
      state: createShortTermStateStore(),
      decisionClient: { decide: async () => ({ action: "create_event", event: { title: "见张总", date: "2026-05-09" } }) },
      calendar,
    });

    expect(result).toEqual({ ok: true, reply: "这个日程几点开始？" });
    expect(called).toBe(false);
  });

  it("does not fake success when calendar fails", async () => {
    const result = await handleWeChatMessage({
      message: { id: "wx_4", kind: "text", text: "明天下午三点见张总" },
      state: createShortTermStateStore(),
      decisionClient: {
        decide: async () => ({ action: "create_event", event: { title: "见张总", date: "2026-05-09", startTime: "15:00" } }),
      },
      calendar: {
        ...createAdapter(),
        createEvent: async () => ({ ok: false, code: "api_error", message: "飞书失败" }),
      },
    });

    expect(result).toEqual({ ok: true, reply: "没有成功：飞书失败" });
  });

  it("does not trust model-provided last_event id when local state has a different last event", async () => {
    const state = createShortTermStateStore({ last_event: { eventId: "evt_real", title: "真实日程" } });
    let updatedEventId = "";

    const result = await handleWeChatMessage({
      message: { id: "wx_5", kind: "text", text: "把刚才那个改成见李总" },
      state,
      decisionClient: {
        decide: async () => ({
          action: "update_event",
          target: { kind: "last_event", eventId: "evt_hallucinated" },
          patch: { title: "见李总" },
        }),
      },
      calendar: {
        ...createAdapter(),
        updateEvent: async (input) => {
          updatedEventId = input.eventId;
          return { ok: true, data: { id: input.eventId, title: input.patch.title || "真实日程", start: "" } };
        },
      },
    });

    expect(result).toEqual({ ok: true, reply: "已修改日程：\n见李总" });
    expect(updatedEventId).toBe("evt_real");
  });

  it("fills the missing date from last_event state before updating time", async () => {
    const state = createShortTermStateStore({
      last_event: { eventId: "evt_real", title: "饭局", date: "2026-05-08", startTime: "20:00" },
    });
    let receivedPatch: unknown;

    const result = await handleWeChatMessage({
      message: { id: "wx_6", kind: "text", text: "刚才那个饭局改到晚上9点" },
      state,
      decisionClient: {
        decide: async () => ({
          type: "update_event",
          target: { kind: "last_event" },
          patch: { startTime: "21:00" },
        }),
      },
      calendar: {
        ...createAdapter(),
        updateEvent: async (input) => {
          receivedPatch = input.patch;
          return { ok: true, data: { id: input.eventId, title: "饭局", start: `${input.patch.date} ${input.patch.startTime}` } };
        },
      },
    });

    expect(result).toEqual({ ok: true, reply: "已修改日程：\n2026年5月8日 星期五 21:00 饭局" });
    expect(receivedPatch).toEqual({ date: "2026-05-08", startTime: "21:00" });
  });

  it("does not execute a time-only update when last_event has no date", async () => {
    const state = createShortTermStateStore({ last_event: { eventId: "evt_real", title: "饭局" } });
    let updateCalls = 0;

    const result = await handleWeChatMessage({
      message: { id: "wx_7", kind: "text", text: "刚才那个饭局改到晚上9点" },
      state,
      decisionClient: {
        decide: async () => ({
          type: "update_event",
          target: { kind: "last_event" },
          patch: { startTime: "21:00" },
        }),
      },
      calendar: {
        ...createAdapter(),
        updateEvent: async (input) => {
          updateCalls += 1;
          return { ok: true, data: { id: input.eventId, title: "饭局", start: "" } };
        },
      },
    });

    expect(result).toEqual({ ok: true, reply: "没有成功：这个日程是哪一天？" });
    expect(updateCalls).toBe(0);
  });
});
