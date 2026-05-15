// fake sandbox 流程测试：用内存 adapter 验证 create/list/update，不访问外部 API。

import { describe, expect, it } from "vitest";
import { executeCalendarAction } from "../src/calendar/action-executor.js";
import type { CalendarAdapter } from "../src/calendar/action-executor.js";
import type { FeishuCalendarEvent, FeishuResult } from "../src/calendar/feishu/types.js";

function createFakeSandboxAdapter(): CalendarAdapter {
  const events = new Map<string, FeishuCalendarEvent>();
  let nextId = 1;

  return {
    async createEvent(event) {
      const id = `evt_${nextId}`;
      nextId += 1;
      const created = { id, title: event.title, start: `${event.date} ${event.startTime}` };
      events.set(id, created);
      return { ok: true, data: created };
    },

    async listEvents() {
      return { ok: true, data: Array.from(events.values()) };
    },

    async updateEvent(input): Promise<FeishuResult<FeishuCalendarEvent>> {
      const current = events.get(input.eventId);
      if (!current) {
        return { ok: false, code: "not_found", message: "日程不存在。" };
      }

      const updated = {
        ...current,
        ...(input.patch.title ? { title: input.patch.title } : {}),
        ...(input.patch.date && input.patch.startTime ? { start: `${input.patch.date} ${input.patch.startTime}` } : {}),
      };
      events.set(input.eventId, updated);
      return { ok: true, data: updated };
    },

    async deleteEvent(input) {
      events.delete(input.eventId);
      return { ok: true, data: { eventId: input.eventId } };
    },
  };
}

describe("fake Feishu sandbox flow", () => {
  it("creates, lists, and updates events without external APIs", async () => {
    const adapter = createFakeSandboxAdapter();

    const created = await executeCalendarAction(
      { type: "create_event", event: { title: "见张总", date: "2026-05-09", startTime: "15:00" } },
      adapter,
    );
    expect(created.ok).toBe(true);
    if (!created.ok || Array.isArray(created.data)) {
      throw new Error("expected single created event");
    }
    const eventId = created.data.id;

    await expect(executeCalendarAction({ type: "list_events", date: "2026-05-09" }, adapter)).resolves.toEqual({
      ok: true,
      data: [{ id: eventId, title: "见张总", start: "2026-05-09 15:00" }],
    });

    await expect(
      executeCalendarAction(
        { type: "update_event", target: { kind: "last_event", eventId }, patch: { title: "见李总" } },
        adapter,
      ),
    ).resolves.toEqual({
      ok: true,
      data: { id: eventId, title: "见李总", start: "2026-05-09 15:00" },
    });
  });

  it("does not write when action is clarify", async () => {
    const adapter = createFakeSandboxAdapter();

    await executeCalendarAction({ type: "clarify", question: "几点？", missing: ["startTime"] }, adapter);

    await expect(executeCalendarAction({ type: "list_events", date: "2026-05-09" }, adapter)).resolves.toEqual({
      ok: true,
      data: [],
    });
  });
});
