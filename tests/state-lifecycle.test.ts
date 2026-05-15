import { describe, expect, it } from "vitest";
import { createShortTermStateStore } from "../src/state/index.js";
import { expirePendingInteractionState } from "../src/state/lifecycle.js";

describe("pending interaction lifecycle", () => {
  it("keeps pending delete only for delete confirmation", () => {
    const state = createShortTermStateStore({
      pending_delete: { eventId: "evt_1", title: "旧删除", source: "last_event" },
      pending_conflict: {
        action: { type: "create_event", event: { title: "冲突会", date: "2026-05-14", startTime: "10:00" } },
        conflicts: [{ title: "已有会", start: "2026-05-14 10:00" }],
      },
      pending_schedule: {
        date: "2026-05-14",
        options: [{ optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-14", startTime: "11:00", durationMinutes: 60 }] }],
      },
    });

    expirePendingInteractionState(state, "confirm_delete");

    expect(state.snapshot()).toMatchObject({
      pending_delete: { eventId: "evt_1", title: "旧删除", source: "last_event" },
    });
    expect(state.snapshot().pending_conflict).toBeUndefined();
    expect(state.snapshot().pending_schedule).toBeUndefined();
  });

  it("keeps pending conflict only for create confirmation", () => {
    const state = createShortTermStateStore({
      pending_delete: { eventId: "evt_1", title: "旧删除", source: "last_event" },
      pending_conflict: {
        action: { type: "create_event", event: { title: "冲突会", date: "2026-05-14", startTime: "10:00" } },
        conflicts: [{ title: "已有会", start: "2026-05-14 10:00" }],
      },
    });

    expirePendingInteractionState(state, "confirm_create");

    expect(state.snapshot().pending_delete).toBeUndefined();
    expect(state.snapshot().pending_conflict).toMatchObject({
      action: { type: "create_event", event: { title: "冲突会", date: "2026-05-14", startTime: "10:00" } },
    });
  });

  it("keeps pending schedule only for schedule confirmation", () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-14",
        options: [{ optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-14", startTime: "11:00", durationMinutes: 60 }] }],
      },
      pending_image_draft: { title: "图片会", date: "2026-05-14", startTime: "09:00" },
    });

    expirePendingInteractionState(state, "confirm_schedule");

    expect(state.snapshot().pending_schedule).toBeDefined();
    expect(state.snapshot().pending_image_draft).toBeUndefined();
  });

  it("keeps pending schedule only for explicit schedule reproposal", () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-14",
        options: [{ optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-14", startTime: "11:00", durationMinutes: 60 }] }],
      },
    });

    expirePendingInteractionState(state, { type: "propose_schedule", items: [], contextRef: "pending_schedule" });

    expect(state.snapshot().pending_schedule).toBeDefined();
  });

  it("clears stale pending schedule when a new schedule request has no continuation reference", () => {
    const state = createShortTermStateStore({
      pending_schedule: {
        date: "2026-05-14",
        options: [{ optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-14", startTime: "11:00", durationMinutes: 60 }] }],
      },
    });

    expirePendingInteractionState(state, { type: "propose_schedule", items: [] });

    expect(state.snapshot().pending_schedule).toBeUndefined();
  });

  it("keeps mixed conflict and schedule states while resolving either side", () => {
    const state = createShortTermStateStore({
      pending_conflict: {
        action: { type: "create_event", event: { title: "湛湛游泳", date: "2026-05-16", startTime: "10:00" } },
        conflicts: [{ title: "湛湛游泳", start: "2026-05-16 10:00" }],
      },
      pending_schedule: {
        date: "2026-05-16",
        options: [
          {
            optionNumber: 1,
            items: [{ itemNumber: 1, title: "和 hanqi 吃饭以及去奥莱", date: "2026-05-16", startTime: "15:00", durationMinutes: 120 }],
          },
        ],
      },
    });

    expirePendingInteractionState(state, "confirm_create");

    expect(state.snapshot().pending_conflict).toBeDefined();
    expect(state.snapshot().pending_schedule).toBeDefined();

    expirePendingInteractionState(state, "confirm_schedule");

    expect(state.snapshot().pending_conflict).toBeDefined();
    expect(state.snapshot().pending_schedule).toBeDefined();
  });

  it("clears all pending interaction states for media requests", () => {
    const state = createShortTermStateStore({
      pending_delete: { eventId: "evt_1", title: "旧删除", source: "last_event" },
      pending_conflict: {
        action: { type: "create_event", event: { title: "冲突会", date: "2026-05-14", startTime: "10:00" } },
        conflicts: [{ title: "已有会", start: "2026-05-14 10:00" }],
      },
      pending_schedule: {
        date: "2026-05-14",
        options: [{ optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-14", startTime: "11:00", durationMinutes: 60 }] }],
      },
      pending_image_draft: { title: "图片会", date: "2026-05-14", startTime: "09:00" },
    });

    expirePendingInteractionState(state, "media_request");

    expect(state.snapshot().pending_delete).toBeUndefined();
    expect(state.snapshot().pending_conflict).toBeUndefined();
    expect(state.snapshot().pending_schedule).toBeUndefined();
    expect(state.snapshot().pending_image_draft).toBeUndefined();
  });
});
