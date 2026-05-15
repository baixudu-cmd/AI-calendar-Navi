// 日报消息处理测试：验证 handler 能编排日报和日报内序号修改。

import { describe, expect, it } from "vitest";
import { handleWeChatMessage } from "../src/app/message-handler.js";
import type { CalendarAdapter } from "../src/calendar/action-executor.js";
import { createShortTermStateStore } from "../src/state/index.js";

function createCalendar(): CalendarAdapter & { updates: string[] } {
  const updates: string[] = [];
  return {
    async createEvent(event) {
      return { ok: true, data: { id: "created", title: event.title, start: `${event.date} ${event.startTime}` } };
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

describe("handleWeChatMessage briefing integration", () => {
  it("handles morning and evening briefing", async () => {
    const state = createShortTermStateStore();
    const calendar = createCalendar();

    await expect(
      handleWeChatMessage({
        message: { id: "wx_1", kind: "text", text: "早报" },
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
        message: { id: "wx_2", kind: "text", text: "晚报" },
        state,
        decisionClient: { decide: async () => ({ action: "daily_briefing", briefingType: "evening" }) },
        calendar,
        today: "2026-05-09",
      }),
    ).resolves.toEqual({ ok: true, reply: "晚报｜2026年5月10日 星期日\n明日日程：\n1. 2026年5月10日 星期日 09:00 晨会" });
  });

  it("updates a briefing item by resolving it to the real event id", async () => {
    const state = createShortTermStateStore({ briefing_items: [{ itemNumber: 2, eventId: "evt_2", title: "电话会" }] });
    const calendar = createCalendar();

    const result = await handleWeChatMessage({
      message: { id: "wx_3", kind: "text", text: "把第 2 个改成和李总电话会" },
      state,
      decisionClient: {
        decide: async () => ({
          action: "update_event",
          target: { kind: "briefing_item", itemNumber: 2 },
          patch: { title: "和李总电话会" },
        }),
      },
      calendar,
      today: "2026-05-09",
    });

    expect(result).toEqual({ ok: true, reply: "已修改日程：\n和李总电话会" });
    expect(calendar.updates).toEqual(["evt_2"]);
  });

  it("does not write calendar when briefing item number is missing", async () => {
    const calendar = createCalendar();

    const result = await handleWeChatMessage({
      message: { id: "wx_4", kind: "text", text: "把第 3 个改一下" },
      state: createShortTermStateStore(),
      decisionClient: {
        decide: async () => ({ action: "update_event", target: { kind: "briefing_item", itemNumber: 3 }, patch: { title: "改" } }),
      },
      calendar,
      today: "2026-05-09",
    });

    expect(result).toEqual({ ok: true, reply: "没有成功：没有找到日报里的第 3 条。" });
    expect(calendar.updates).toEqual([]);
  });
});
