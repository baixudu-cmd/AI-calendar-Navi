// Seed Lite 测试：验证待推进事项的新增、去重、修改和清理。

import { describe, expect, it } from "vitest";
import { createMemorySeedLiteStore } from "../src/seed-lite/index.js";

describe("Seed Lite store", () => {
  it("removes completed items by seed id", async () => {
    const store = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "看 DCF 模型" },
      { seedId: "seed_2", title: "整理材料" },
    ]);

    await expect(store.complete(["seed_1", "missing"])).resolves.toEqual([
      { seedId: "seed_2", title: "整理材料" },
    ]);
    await expect(store.list()).resolves.toEqual([{ seedId: "seed_2", title: "整理材料" }]);
  });

  it("updates item title, target date, and reminder time by seed id", async () => {
    const store = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "拿币" },
      { seedId: "seed_2", title: "整理材料" },
    ]);

    await expect(store.update(["seed_1"], { title: "拿币资料", targetDate: "2026-05-18", reminderAt: "2026-05-18 14:00" })).resolves.toEqual([
      { seedId: "seed_1", title: "拿币资料", targetDate: "2026-05-18", reminderAt: "2026-05-18 14:00" },
      { seedId: "seed_2", title: "整理材料" },
    ]);
  });

  it("clears an existing reminder without deleting the item", async () => {
    const store = createMemorySeedLiteStore([{ seedId: "seed_1", title: "整理 DCF", reminderAt: "2026-05-18 14:00" }]);

    await expect(store.update(["seed_1"], { clearReminder: true })).resolves.toEqual([{ seedId: "seed_1", title: "整理 DCF" }]);
  });
});
