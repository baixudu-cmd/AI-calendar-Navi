import { describe, expect, it } from "vitest";
import { normalizeDecision, validateAction } from "../src/contract/index.js";

describe("contract validation", () => {
  it("accepts a complete create_event action", () => {
    const result = normalizeDecision({
      action: "create_event",
      event: {
        title: "见张总",
        date: "2026-05-09",
        startTime: "15:00",
        endTime: "16:00",
        location: "办公室",
        reminderMinutes: 30,
        notes: "带资料",
      },
    });

    expect(result).toEqual({
      ok: true,
      action: {
        type: "create_event",
        event: {
          title: "见张总",
          date: "2026-05-09",
          startTime: "15:00",
          endTime: "16:00",
          location: "办公室",
          reminderMinutes: 30,
          notes: "带资料",
        },
      },
    });
  });

  it("turns incomplete create_event into a single clarify question", () => {
    const result = normalizeDecision({
      action: "create_event",
      event: {
        title: "见张总",
        date: "2026-05-09",
      },
    });

    expect(result).toEqual({
      ok: true,
      action: {
        type: "clarify",
        question: "这个日程几点开始？",
        missing: ["startTime"],
        createDraft: { title: "见张总", date: "2026-05-09" },
      },
    });
  });

  it("does not ask the user to name a schedule when the title is missing", () => {
    const result = normalizeDecision({
      action: "create_event",
      event: {
        date: "2026-05-09",
        startTime: "15:00",
      },
    });

    expect(result).toEqual({
      ok: true,
      action: {
        type: "clarify",
        question: "我会根据内容整理标题；请再发一次要记录的原文。",
        missing: ["title"],
        createDraft: { date: "2026-05-09", startTime: "15:00" },
      },
    });
  });

  it("accepts internal create_events actions from the tool adapter", () => {
    const result = normalizeDecision({
      type: "create_events",
      events: [
        { title: "投委会", date: "2026-05-12", startTime: "09:00" },
        { title: "客户电话", date: "2026-05-12", startTime: "14:00" },
      ],
    });

    expect(result).toEqual({
      ok: true,
      action: {
        type: "create_events",
        events: [
          { title: "投委会", date: "2026-05-12", startTime: "09:00" },
          { title: "客户电话", date: "2026-05-12", startTime: "14:00" },
        ],
      },
    });
  });

  it("turns incomplete internal create_events into a clarify action without partial execution", () => {
    const result = normalizeDecision({
      type: "create_events",
      events: [
        { title: "投委会", date: "2026-05-12", startTime: "09:00" },
        { title: "客户电话", date: "2026-05-12" },
      ],
    });

    expect(result).toEqual({
      ok: true,
      action: {
        type: "clarify",
        question: "这个日程几点开始？",
        missing: ["startTime"],
      },
    });
  });

  it("accepts internal confirm_create actions from the tool adapter", () => {
    const result = normalizeDecision({
      type: "confirm_create",
      confirmed: true,
    });

    expect(result).toEqual({
      ok: true,
      action: { type: "confirm_create", confirmed: true },
    });
  });

  it("accepts internal schedule proposal and confirmation actions from the tool adapter", () => {
    expect(
      normalizeDecision({
        type: "propose_schedule",
        date: "2026-05-12",
        items: [{ title: "看材料", durationMinutes: 45 }],
        optionCount: 5,
      }),
    ).toEqual({
      ok: true,
      action: { type: "propose_schedule", date: "2026-05-12", items: [{ title: "看材料", durationMinutes: 45 }], optionCount: 5 },
    });

    expect(
      normalizeDecision({
        type: "confirm_schedule",
        confirmed: true,
        optionNumber: 2,
        itemChanges: [{ itemNumber: 1, startTime: "11:00" }],
      }),
    ).toEqual({
      ok: true,
      action: { type: "confirm_schedule", confirmed: true, optionNumber: 2, itemChanges: [{ itemNumber: 1, startTime: "11:00" }] },
    });
  });

  it("accepts only the five v1 action types", () => {
    const actionTypes = [
      "create_event",
      "list_events",
      "update_event",
      "daily_briefing",
      "clarify",
    ];

    expect(actionTypes.every((type) => validateAction({ action: type }).known)).toBe(true);
    expect(validateAction({ action: "delete_event" }).known).toBe(false);
  });
});
