// 确定性日历 API 测试：模型不直接写飞书，只能调用这些锁定能力。

import { describe, expect, it } from "vitest";
import {
  clearCalendar,
  createEvent,
  deleteEvent,
  deleteManyEvents,
  listEvents,
  updateEvent,
  type DeterministicCalendarAdapter,
} from "../src/calendar-api/index.js";

function createAdapter(): DeterministicCalendarAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async createEvent(event) {
      calls.push(`create:${event.title}`);
      return { ok: true, data: { id: "evt_1", title: event.title, start: `${event.date} ${event.startTime}` } };
    },
    async listEvents() {
      calls.push("list");
      return { ok: true, data: [{ id: "evt_1", title: "见张总", start: "2026-05-09 15:00" }] };
    },
    async updateEvent(input) {
      calls.push(`update:${input.eventId}`);
      return { ok: true, data: { id: input.eventId, title: input.patch.title || "见张总", start: "" } };
    },
    async deleteEvent(input) {
      calls.push(`delete:${input.eventId}`);
      return { ok: true, data: { eventId: input.eventId } };
    },
  };
}

describe("deterministic calendar API", () => {
  it("delegates create, list, and update to the adapter", async () => {
    const adapter = createAdapter();

    await expect(createEvent(adapter, { title: "见张总", date: "2026-05-09", startTime: "15:00" })).resolves.toEqual({
      ok: true,
      data: { id: "evt_1", title: "见张总", start: "2026-05-09 15:00" },
    });
    await expect(listEvents(adapter, { date: "2026-05-09" })).resolves.toEqual({
      ok: true,
      data: [{ id: "evt_1", title: "见张总", start: "2026-05-09 15:00" }],
    });
    await expect(updateEvent(adapter, { eventId: "evt_1", patch: { title: "见李总" } })).resolves.toEqual({
      ok: true,
      data: { id: "evt_1", title: "见李总", start: "" },
    });
    expect(adapter.calls).toEqual(["create:见张总", "list", "update:evt_1"]);
  });

  it("sorts listed events by start time before user-facing replies", async () => {
    const adapter = createAdapter();
    adapter.listEvents = async () => ({
      ok: true,
      data: [
        { id: "evt_1", title: "阅盟材料", start: "2026-05-13 18:00" },
        { id: "evt_2", title: "DCF", start: "2026-05-13 10:00" },
      ],
    });

    await expect(listEvents(adapter, { date: "2026-05-13" })).resolves.toEqual({
      ok: true,
      data: [
        { id: "evt_2", title: "DCF", start: "2026-05-13 10:00" },
        { id: "evt_1", title: "阅盟材料", start: "2026-05-13 18:00" },
      ],
    });
  });

  it("deletes exactly one explicit event id", async () => {
    const adapter = createAdapter();

    await expect(deleteEvent(adapter, { eventId: "evt_1" })).resolves.toEqual({
      ok: true,
      data: { eventId: "evt_1" },
    });
    expect(adapter.calls).toEqual(["delete:evt_1"]);
  });

  it("rejects delete without an explicit event id", async () => {
    const adapter = createAdapter();

    await expect(deleteEvent(adapter, { eventId: "" })).resolves.toEqual({
      ok: false,
      code: "guard_rejected",
      message: "删除日程需要明确的事件 ID。",
    });
    expect(adapter.calls).toEqual([]);
  });

  it("requires explicit confirmation for batch delete", async () => {
    const adapter = createAdapter();

    await expect(deleteManyEvents(adapter, { eventIds: ["evt_1", "evt_2"], confirmed: false })).resolves.toEqual({
      ok: false,
      code: "confirmation_required",
      message: "批量删除需要先确认。",
    });
    expect(adapter.calls).toEqual([]);
  });

  it("deletes many only after confirmation", async () => {
    const adapter = createAdapter();

    await expect(deleteManyEvents(adapter, { eventIds: ["evt_1", "evt_2"], confirmed: true })).resolves.toEqual({
      ok: true,
      data: { deletedEventIds: ["evt_1", "evt_2"] },
    });
    expect(adapter.calls).toEqual(["delete:evt_1", "delete:evt_2"]);
  });

  it("does not allow clearCalendar in the assistant runtime", async () => {
    const adapter = createAdapter();

    await expect(clearCalendar(adapter, { confirmed: true })).resolves.toEqual({
      ok: false,
      code: "guard_rejected",
      message: "全删日历没有开放给助手运行时。",
    });
    expect(adapter.calls).toEqual([]);
  });
});
