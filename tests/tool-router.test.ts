// 工具路由测试：验证薄工具调用只转成现有 CalendarAction，不直接碰飞书客户端。

import { describe, expect, it } from "vitest";
import { executeCalendarAction } from "../src/calendar/action-executor.js";
import {
  toolCallToCalendarAction,
  validateToolCall,
  type AdaptableCalendarToolCall,
  type CalendarToolCall,
} from "../src/tool-contract/index.js";

describe("toolCallToCalendarAction", () => {
  it("routes calendar.create_event to the current create_event action", () => {
    const validated = validateToolCall({
      toolName: "calendar.create_event",
      arguments: { title: "见张总", date: "2026-05-09", startTime: "10:00" },
    });

    expect(validated.ok && toolCallToCalendarAction(expectAdaptableToolCall(validated.call))).toEqual({
      type: "create_event",
      event: { title: "见张总", date: "2026-05-09", startTime: "10:00" },
    });
  });

  it("routes calendar.list_events to the current list_events action", () => {
    const validated = validateToolCall({
      toolName: "calendar.list_events",
      arguments: { range: { startDate: "2026-05-09", endDate: "2026-05-10" } },
    });

    expect(validated.ok && toolCallToCalendarAction(expectAdaptableToolCall(validated.call))).toEqual({
      type: "list_events",
      range: { startDate: "2026-05-09", endDate: "2026-05-10" },
    });
  });

  it("keeps last_event as a reference and ignores model-provided event id", () => {
    const validated = validateToolCall({
      toolName: "calendar.update_event",
      arguments: {
        target: { kind: "last_event", eventId: "model_should_not_win" },
        patch: { title: "见李总" },
      },
    });

    expect(validated.ok && toolCallToCalendarAction(expectAdaptableToolCall(validated.call))).toEqual({
      type: "update_event",
      target: { kind: "last_event", eventId: "" },
      patch: { title: "见李总" },
    });
  });

  it("routes briefing_item as a reference shape only", () => {
    const validated = validateToolCall({
      toolName: "calendar.update_event",
      arguments: {
        target: { kind: "briefing_item", itemNumber: 2, eventId: "ignored" },
        patch: { title: "改电话会" },
      },
    });

    expect(validated.ok && toolCallToCalendarAction(expectAdaptableToolCall(validated.call))).toEqual({
      type: "update_event",
      target: { kind: "briefing_item", itemNumber: 2 },
      patch: { title: "改电话会" },
    });
  });

  it("keeps daily_briefing and clarify away from calendar writes", async () => {
    const dailyBriefing = validateToolCall({
      toolName: "calendar.daily_briefing",
      arguments: { briefingType: "morning" },
    });
    const clarify = validateToolCall({
      toolName: "assistant.clarify",
      arguments: { question: "这个日程是哪一天？", missing: ["date"] },
    });
    const adapter = {
      createEvent: async () => {
        throw new Error("should not write");
      },
      listEvents: async () => {
        throw new Error("should not list");
      },
      updateEvent: async () => {
        throw new Error("should not update");
      },
      deleteEvent: async () => {
        throw new Error("should not delete");
      },
    };

    expect(dailyBriefing.ok && toolCallToCalendarAction(expectAdaptableToolCall(dailyBriefing.call))).toEqual({
      type: "daily_briefing",
      briefingType: "morning",
    });
    expect(clarify.ok && toolCallToCalendarAction(expectAdaptableToolCall(clarify.call))).toEqual({
      type: "clarify",
      question: "这个日程是哪一天？",
      missing: ["date"],
    });
    if (!dailyBriefing.ok || !clarify.ok) throw new Error("unexpected invalid tool call");

    await expect(executeCalendarAction(toolCallToCalendarAction(expectAdaptableToolCall(dailyBriefing.call)), adapter)).resolves.toMatchObject({
      ok: false,
      code: "skipped",
    });
    await expect(executeCalendarAction(toolCallToCalendarAction(expectAdaptableToolCall(clarify.call)), adapter)).resolves.toMatchObject({
      ok: false,
      code: "skipped",
    });
  });
});

function expectAdaptableToolCall(call: CalendarToolCall): AdaptableCalendarToolCall {
  if (call.toolName === "calendar.delete_event") throw new Error("delete_event is not adapted in this test");
  return call;
}
