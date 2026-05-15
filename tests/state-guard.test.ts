import { describe, expect, it } from "vitest";
import { createShortTermStateStore } from "../src/state/index.js";

describe("state guard", () => {
  it("drops long-term memory and scheduling fields", () => {
    const store = createShortTermStateStore();

    store.update({
      habits: ["每天九点开会"],
      long_term_memory: { boss: "张总" },
      auto_schedule: true,
      pending_schedule: {
        date: "2026-05-12",
        options: [{ optionNumber: 1, items: [{ itemNumber: 1, eventId: "evt_bad", title: "无效" }] }],
      },
      briefing_items: [{ itemNumber: 1, eventId: "evt_1", title: "早会" }],
    });

    expect(store.snapshot()).toEqual({
      briefing_items: [{ itemNumber: 1, eventId: "evt_1", title: "早会" }],
    });
  });

  it("keeps only safe pending schedule recommendation fields", () => {
    const store = createShortTermStateStore();

    store.update({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          {
            optionNumber: 1,
            items: [
              {
                itemNumber: 1,
                title: "看材料",
                date: "2026-05-12",
                startTime: "11:00",
                endTime: "12:00",
                durationMinutes: 60,
                eventId: "evt_model_should_not_set",
              },
            ],
          },
        ],
      },
    });

    expect(store.snapshot()).toEqual({
      pending_schedule: {
        date: "2026-05-12",
        options: [
          {
            optionNumber: 1,
            items: [{ itemNumber: 1, title: "看材料", date: "2026-05-12", startTime: "11:00", endTime: "12:00", durationMinutes: 60 }],
          },
        ],
      },
    });
  });

  it("drops briefing items without stable positive item numbers", () => {
    const store = createShortTermStateStore();

    store.update({
      briefing_items: [
        { itemNumber: 0, eventId: "evt_bad", title: "无效" },
        { itemNumber: 2, eventId: "evt_good", title: "有效" },
      ],
    });

    expect(store.snapshot()).toEqual({
      briefing_items: [{ itemNumber: 2, eventId: "evt_good", title: "有效" }],
    });
  });
});
