import { describe, expect, it } from "vitest";
import { createShortTermStateStore } from "../src/state/index.js";

describe("short-term state store", () => {
  it("stores only approved short-term fields", () => {
    const store = createShortTermStateStore();

    store.update({
      last_event: { eventId: "evt_1", title: "见张总", date: "2026-05-09", startTime: "15:00", extra: "drop" },
      pending_clarification: {
        question: "几点开始？",
        missing: ["startTime"],
        createDraft: {
          title: "见张总",
          date: "2026-05-09",
          startTime: "15:00",
          endTime: "16:00",
          location: "办公室",
          reminderMinutes: 10,
          notes: "带材料",
          extra: "drop",
        },
      },
      pending_create: { title: "不应保存", date: "2026-05-09", missing: ["startTime"] },
      briefing_items: [{ itemNumber: 1, eventId: "evt_1", title: "见张总", date: "2026-05-09", startTime: "15:00" }],
      pending_delete: { eventId: "evt_1", title: "见张总", source: "briefing_item", itemNumber: 1, extra: "drop" },
      seed_items: [
        {
          seedId: "seed_1",
          title: "整理材料",
          reminderAt: "2026-05-16 08:00",
          createdAt: "2026-05-11T14:10:00+08:00",
          sourceText: "回头整理材料",
          dueAt: "drop",
        },
      ],
      long_term_memory: "must not be saved",
    });

    expect(store.snapshot()).toEqual({
      last_event: { eventId: "evt_1", title: "见张总", date: "2026-05-09", startTime: "15:00" },
      pending_clarification: {
        question: "几点开始？",
        missing: ["startTime"],
        createDraft: {
          title: "见张总",
          date: "2026-05-09",
          startTime: "15:00",
          endTime: "16:00",
          location: "办公室",
          reminderMinutes: 10,
          notes: "带材料",
        },
      },
      briefing_items: [{ itemNumber: 1, eventId: "evt_1", title: "见张总", date: "2026-05-09", startTime: "15:00" }],
      pending_delete: { eventId: "evt_1", title: "见张总", source: "briefing_item", itemNumber: 1 },
      seed_items: [
        {
          seedId: "seed_1",
          title: "整理材料",
          reminderAt: "2026-05-16 08:00",
          createdAt: "2026-05-11T14:10:00+08:00",
          sourceText: "回头整理材料",
        },
      ],
    });
  });

  it("can clear pending clarification after a complete action", () => {
    const store = createShortTermStateStore({
      pending_clarification: { question: "几点开始？", missing: ["startTime"] },
    });

    store.clearPendingClarification();

    expect(store.snapshot()).toEqual({});
  });

  it("can clear pending delete after confirmation or cancel", () => {
    const store = createShortTermStateStore({
      pending_delete: { eventId: "evt_1", title: "见张总", source: "last_event" },
    });

    store.clearPendingDelete();

    expect(store.snapshot()).toEqual({});
  });

  it("keeps only safe batch pending delete fields", () => {
    const store = createShortTermStateStore({
      pending_delete: {
        source: "date_query",
        title: "2026年5月12日 星期二的 2 个日程",
        eventIds: ["evt_1", "", "evt_2", "evt_1"],
        items: [
          { eventId: "evt_1", title: "投委会", date: "2026-05-12", startTime: "10:00", extra: "drop" },
          { eventId: "", title: "无效" },
          { eventId: "evt_2", title: "基石", date: "bad", startTime: "14:00" },
        ],
        freeText: "drop",
      },
    } as never);

    expect(store.snapshot().pending_delete).toEqual({
      source: "date_query",
      title: "2026年5月12日 星期二的 2 个日程",
      eventIds: ["evt_1", "evt_2"],
      items: [
        { eventId: "evt_1", title: "投委会", date: "2026-05-12", startTime: "10:00" },
        { eventId: "evt_2", title: "基石", startTime: "14:00" },
      ],
    });
  });

  it("sanitizes pending image draft state", () => {
    const store = createShortTermStateStore({
      pending_image_draft: {
        title: "雷达试验交流",
        date: "2026-05-12",
        startTime: "10:00",
        endTime: "10:45",
        location: "腾讯会议 370 310 601",
        notes: "会议截图识别",
        unsafe: "drop",
      },
    } as never);

    expect(store.snapshot().pending_image_draft).toEqual({
      title: "雷达试验交流",
      date: "2026-05-12",
      startTime: "10:00",
      endTime: "10:45",
      location: "腾讯会议 370 310 601",
      notes: "会议截图识别",
    });
  });
});
