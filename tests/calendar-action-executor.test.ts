// 日历动作执行器测试：只验证动作分发，不触碰真实飞书。

import { describe, expect, it } from "vitest";
import { executeCalendarAction } from "../src/calendar/action-executor.js";
import type { CalendarAdapter } from "../src/calendar/action-executor.js";

function createRecordingAdapter(calls: string[] = []): CalendarAdapter {
  return {
    async createEvent(event) {
      calls.push("create");
      return { ok: true, data: { id: "evt_1", title: event.title, start: `${event.date} ${event.startTime}` } };
    },
    async listEvents() {
      calls.push("list");
      return { ok: true, data: [{ id: "evt_1", title: "见张总", start: "2026-05-09 15:00" }] };
    },
    async updateEvent(input) {
      calls.push("update");
      return { ok: true, data: { id: input.eventId, title: input.patch.title || "见张总", start: "" } };
    },
    async deleteEvent(input) {
      calls.push("delete");
      return { ok: true, data: { eventId: input.eventId } };
    },
  };
}

describe("executeCalendarAction", () => {
  it("dispatches create, list, and update actions to adapter", async () => {
    const calls: string[] = [];
    const adapter = createRecordingAdapter(calls);

    await expect(
      executeCalendarAction(
        { type: "create_event", event: { title: "见张总", date: "2026-05-09", startTime: "15:00" } },
        adapter,
      ),
    ).resolves.toEqual({ ok: true, data: { id: "evt_1", title: "见张总", start: "2026-05-09 15:00" } });

    await expect(executeCalendarAction({ type: "list_events", date: "2026-05-09" }, adapter)).resolves.toEqual({
      ok: true,
      data: [{ id: "evt_1", title: "见张总", start: "2026-05-09 15:00" }],
    });

    await expect(
      executeCalendarAction(
        { type: "update_event", target: { kind: "last_event", eventId: "evt_1" }, patch: { title: "见李总" } },
        adapter,
      ),
    ).resolves.toEqual({ ok: true, data: { id: "evt_1", title: "见李总", start: "" } });

    expect(calls).toEqual(["create", "list", "update"]);
  });

  it("executes batch create through the same calendar adapter", async () => {
    const createdTitles: string[] = [];
    const adapter: CalendarAdapter = {
      ...createRecordingAdapter(),
      async createEvent(event) {
        createdTitles.push(event.title);
        return {
          ok: true,
          data: { id: `evt_${createdTitles.length}`, title: event.title, start: `${event.date} ${event.startTime}` },
        };
      },
    };

    await expect(
      executeCalendarAction(
        {
          type: "create_events",
          events: [
            { title: "投委会", date: "2026-05-12", startTime: "09:00" },
            { title: "客户电话", date: "2026-05-12", startTime: "14:00" },
          ],
        },
        adapter,
      ),
    ).resolves.toEqual({
      ok: true,
      data: [
        { id: "evt_1", title: "投委会", start: "2026-05-12 09:00" },
        { id: "evt_2", title: "客户电话", start: "2026-05-12 14:00" },
      ],
    });
    expect(createdTitles).toEqual(["投委会", "客户电话"]);
  });

  it("stops batch create on the first calendar failure", async () => {
    let createCalls = 0;
    const adapter: CalendarAdapter = {
      ...createRecordingAdapter(),
      async createEvent(event) {
        createCalls += 1;
        if (createCalls === 2) return { ok: false, code: "api_error", message: "第二条写入失败。" };
        return { ok: true, data: { id: "evt_1", title: event.title, start: `${event.date} ${event.startTime}` } };
      },
    };

    await expect(
      executeCalendarAction(
        {
          type: "create_events",
          events: [
            { title: "投委会", date: "2026-05-12", startTime: "09:00" },
            { title: "客户电话", date: "2026-05-12", startTime: "14:00" },
            { title: "复盘", date: "2026-05-12", startTime: "20:00" },
          ],
        },
        adapter,
      ),
    ).resolves.toEqual({ ok: false, code: "api_error", message: "第二条写入失败。" });
    expect(createCalls).toBe(2);
  });

  it("skips clarify, schedule controls, and daily briefing without calling adapter", async () => {
    const calls: string[] = [];
    const adapter = createRecordingAdapter(calls);

    await expect(
      executeCalendarAction({ type: "clarify", question: "几点？", missing: ["startTime"] }, adapter),
    ).resolves.toEqual({
      ok: false,
      code: "skipped",
      message: "clarify 不执行日历工具。",
    });

    await expect(executeCalendarAction({ type: "daily_briefing", briefingType: "morning" }, adapter)).resolves.toEqual({
      ok: false,
      code: "skipped",
      message: "daily_briefing 留到后续阶段处理。",
    });

    await expect(
      executeCalendarAction({ type: "propose_schedule", date: "2026-05-12", items: [{ title: "看材料" }] }, adapter),
    ).resolves.toEqual({
      ok: false,
      code: "skipped",
      message: "propose_schedule 由 API Bridge 生成排程推荐。",
    });

    await expect(executeCalendarAction({ type: "confirm_schedule", confirmed: true, optionNumber: 1 }, adapter)).resolves.toEqual({
      ok: false,
      code: "skipped",
      message: "confirm_schedule 由 API Bridge 执行排程确认。",
    });

    await expect(executeCalendarAction({ type: "dismiss_context" }, adapter)).resolves.toEqual({
      ok: false,
      code: "skipped",
      message: "dismiss_context 由 API Bridge 清理短期上下文。",
    });

    expect(calls).toEqual([]);
  });

  it("skips briefing item update without writing calendar", async () => {
    const calls: string[] = [];
    const adapter = createRecordingAdapter(calls);

    await expect(
      executeCalendarAction(
        { type: "update_event", target: { kind: "briefing_item", itemNumber: 1 }, patch: { title: "见李总" } },
        adapter,
      ),
    ).resolves.toEqual({
      ok: false,
      code: "skipped",
      message: "briefing_item 修改留到日报阶段处理。",
    });

    expect(calls).toEqual([]);
  });
});
