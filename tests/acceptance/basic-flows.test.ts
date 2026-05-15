// 本地验收题库：用 fake 模型决策和 fake 日历验证核心链路。

import { describe, expect, it } from "vitest";
import { handleWeChatMessage } from "../../src/app/message-handler.js";
import type { CalendarAdapter } from "../../src/calendar/action-executor.js";
import { createShortTermStateStore } from "../../src/state/index.js";

function createAcceptanceCalendar(): CalendarAdapter & { updates: string[] } {
  const updates: string[] = [];
  return {
    async createEvent(event) {
      return { ok: true, data: { id: "evt_created", title: event.title, start: `${event.date} ${event.startTime}` } };
    },
    async listEvents(input) {
      if (input.date === "2026-05-09") {
        return {
          ok: true,
          data: [
            { id: "evt_1", title: "见张总", start: "15:00" },
            { id: "evt_2", title: "电话会", start: "18:00" },
          ],
        };
      }
      if (input.date === "2026-05-10") return { ok: true, data: [{ id: "evt_3", title: "晨会", start: "09:00" }] };
      return { ok: true, data: [] };
    },
    async updateEvent(input) {
      updates.push(input.eventId);
      return { ok: true, data: { id: input.eventId, title: input.patch.title || "改后", start: "" } };
    },
    async deleteEvent(input) {
      return { ok: true, data: { eventId: input.eventId } };
    },
    updates,
  };
}

describe("basic acceptance flows", () => {
  it("covers create, clarify, list, update, briefing, and briefing item update", async () => {
    const state = createShortTermStateStore();
    const calendar = createAcceptanceCalendar();

    await expect(
      handleWeChatMessage({
        message: { id: "a1", kind: "text", text: "明天下午三点见张总" },
        state,
        decisionClient: { decide: async () => ({ action: "create_event", event: { title: "见张总", date: "2026-05-09", startTime: "15:00" } }) },
        calendar,
        today: "2026-05-09",
      }),
    ).resolves.toEqual({ ok: true, reply: "已新增日程：\n2026年5月9日 星期六 15:00 见张总" });

    await expect(
      handleWeChatMessage({
        message: { id: "a2", kind: "text", text: "明天见张总" },
        state,
        decisionClient: { decide: async () => ({ action: "create_event", event: { title: "见张总", date: "2026-05-09" } }) },
        calendar,
        today: "2026-05-09",
      }),
    ).resolves.toEqual({ ok: true, reply: "这个日程几点开始？" });

    await expect(
      handleWeChatMessage({
        message: { id: "a3", kind: "text", text: "查明天日程" },
        state,
        decisionClient: { decide: async () => ({ action: "list_events", date: "2026-05-09" }) },
        calendar,
        today: "2026-05-09",
      }),
    ).resolves.toEqual({
      ok: true,
      reply: "找到 2 个日程：\n1. 2026年5月9日 星期六 15:00 见张总\n2. 2026年5月9日 星期六 18:00 电话会",
    });

    await expect(
      handleWeChatMessage({
        message: { id: "a4", kind: "text", text: "把刚才那个改成见李总" },
        state,
        decisionClient: {
          decide: async () => ({ action: "update_event", target: { kind: "last_event", eventId: "evt_created" }, patch: { title: "见李总" } }),
        },
        calendar,
        today: "2026-05-09",
      }),
    ).resolves.toEqual({ ok: true, reply: "已修改日程：\n见李总" });

    await expect(
      handleWeChatMessage({
        message: { id: "a5", kind: "text", text: "早报" },
        state,
        decisionClient: { decide: async () => ({ action: "daily_briefing", briefingType: "morning" }) },
        calendar,
        today: "2026-05-09",
      }),
    ).resolves.toEqual({
      ok: true,
      reply: "早报｜2026年5月9日 星期六\n今日日程：\n1. 2026年5月9日 星期六 15:00 见张总\n2. 2026年5月9日 星期六 18:00 电话会",
    });

    await expect(
      handleWeChatMessage({
        message: { id: "a6", kind: "text", text: "把第 2 个改成和王总电话会" },
        state,
        decisionClient: {
          decide: async () => ({ action: "update_event", target: { kind: "briefing_item", itemNumber: 2 }, patch: { title: "和王总电话会" } }),
        },
        calendar,
        today: "2026-05-09",
      }),
    ).resolves.toEqual({ ok: true, reply: "已修改日程：\n和王总电话会" });

    expect(calendar.updates).toContain("evt_2");
  });
});
