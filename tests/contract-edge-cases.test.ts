import { describe, expect, it } from "vitest";
import { normalizeDecision } from "../src/contract/index.js";

describe("contract edge cases", () => {
  it.each(["delete_event", "auto_schedule", "seed_memory"])("rejects forbidden action %s", (action) => {
    expect(normalizeDecision({ action })).toEqual({
      ok: false,
      reason: "unknown_action",
      message: `不支持的动作：${action}`,
    });
  });

  it.each([null, "create_event", {}, { event: {} }])("rejects malformed output %#", (value) => {
    const result = normalizeDecision(value);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("malformed_decision");
  });

  it("clarifies when list_events is missing date and range", () => {
    expect(normalizeDecision({ action: "list_events" })).toEqual({
      ok: true,
      action: {
        type: "clarify",
        question: "这个日程是哪一天？",
        missing: ["date"],
      },
    });
  });

  it("clarifies when update_event target is ambiguous", () => {
    expect(normalizeDecision({ action: "update_event", patch: { startTime: "15:00" } })).toEqual({
      ok: true,
      action: {
        type: "clarify",
        question: "你想改哪一个日程？",
        missing: ["target"],
      },
    });
  });

  it.each([{ startTime: "16:00" }, { endTime: "17:00" }])(
    "accepts time-only update_event patches for later state resolution %#",
    (patch) => {
      expect(
        normalizeDecision({
          action: "update_event",
          target: { kind: "last_event", eventId: "event-1" },
          patch,
        }),
      ).toEqual({
        ok: true,
        action: {
          type: "update_event",
          target: { kind: "last_event", eventId: "event-1" },
          patch,
        },
      });
    },
  );

  it.each([{ date: "2026-05-09" }, { unknown: "value" }])("clarifies when update_event patch has no executable fields %#", (patch) => {
    expect(
      normalizeDecision({
        action: "update_event",
        target: { kind: "last_event", eventId: "event-1" },
        patch,
      }),
    ).toEqual({
      ok: true,
      action: {
        type: "clarify",
        question: "你想把这个日程改成什么？",
        missing: ["patch"],
      },
    });
  });

  it.each([
    {
      name: "create_event date",
      decision: { action: "create_event", event: { title: "会", date: "2026-02-30", startTime: "15:00" } },
      missing: "date",
    },
    {
      name: "create_event startTime",
      decision: { action: "create_event", event: { title: "会", date: "2026-05-09", startTime: "25:00" } },
      missing: "startTime",
    },
    {
      name: "list_events date",
      decision: { action: "list_events", date: "2026-13-09" },
      missing: "date",
    },
    {
      name: "update_event startTime",
      decision: {
        action: "update_event",
        target: { kind: "last_event", eventId: "event-1" },
        patch: { date: "2026-05-09", startTime: "9点" },
      },
      missing: "startTime",
    },
  ])("clarifies invalid date or time in $name", ({ decision, missing }) => {
    const result = normalizeDecision(decision);

    expect(result.ok).toBe(true);
    expect(result.ok && result.action).toMatchObject({
      type: "clarify",
      missing: [missing],
    });
  });
});
