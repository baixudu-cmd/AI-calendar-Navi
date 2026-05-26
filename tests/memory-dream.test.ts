import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  consolidateMemoryDream,
  createFileMemoryDreamStore,
  createMemoryMemoryDreamStore,
} from "../src/memory-dream/index.js";
import { createMemorySeedLiteStore } from "../src/seed-lite/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), "navi-memory-dream-"));
  tempDirs.push(dir);
  return join(dir, "state", "memory-dream.json");
}

describe("memory dream", () => {
  it("appends assistant observations to a local file store", async () => {
    const store = createFileMemoryDreamStore(tempFile());

    await store.addObservation({
      observedAt: "2026-05-13T01:00:00.000Z",
      requestId: "req_1",
      messageId: "msg_1",
      sourceText: "明天三点见张总",
      actionType: "create_event",
      ok: true,
      reply: "已新增日程：\n2026年5月14日 星期四 15:00 见张总",
      createdEvents: [{ title: "见张总", date: "2026-05-14", startTime: "15:00" }],
    });

    await expect(store.load()).resolves.toMatchObject({
      observations: [
        {
          requestId: "req_1",
          messageId: "msg_1",
          actionType: "create_event",
          ok: true,
          createdEvents: [{ title: "见张总", date: "2026-05-14", startTime: "15:00" }],
        },
      ],
    });
  });

  it("keeps concurrent file observations instead of overwriting the last writer", async () => {
    const store = createFileMemoryDreamStore(tempFile());

    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        store.addObservation({
          observedAt: `2026-05-13T01:0${index}:00.000Z`,
          requestId: `req_${index}`,
          messageId: `msg_${index}`,
          sourceText: `第 ${index} 条`,
          actionType: "create_event",
          ok: true,
          reply: `已新增日程：\n2026年5月14日 星期四 1${index}:00 事项${index}`,
          createdEvents: [{ title: `事项${index}`, date: "2026-05-14", startTime: `1${index}:00` }],
        }),
      ),
    );

    await expect(store.load()).resolves.toMatchObject({
      observations: expect.arrayContaining([
        expect.objectContaining({ requestId: "req_0" }),
        expect.objectContaining({ requestId: "req_1" }),
        expect.objectContaining({ requestId: "req_2" }),
        expect.objectContaining({ requestId: "req_3" }),
        expect.objectContaining({ requestId: "req_4" }),
      ]),
    });
    expect((await store.load()).observations).toHaveLength(5);
  });

  it("consolidates Seed Lite items into pending-note memory entries", async () => {
    const store = createMemoryMemoryDreamStore();
    const seedStore = createMemorySeedLiteStore([
      { seedId: "seed_1", title: "整理投委会材料", createdAt: "2026-05-13T00:00:00.000Z" },
    ]);

    const result = await consolidateMemoryDream({
      store,
      seedStore,
      now: "2026-05-13T03:20:00.000Z",
      since: "2026-05-12T03:20:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.entries).toContainEqual(
      expect.objectContaining({
        kind: "pending_note",
        summary: "待推进：整理投委会材料",
        sourceIds: ["seed_1"],
      }),
    );
    expect(result.entries).toContainEqual(
      expect.objectContaining({
        kind: "schedule_candidate",
        summary: "排程候选：整理投委会材料",
        sourceIds: ["seed_1"],
        status: "candidate",
      }),
    );
  });

  it("keeps todo schedule sense metadata on dream schedule candidates", async () => {
    const store = createMemoryMemoryDreamStore();
    const seedStore = createMemorySeedLiteStore([
      {
        seedId: "seed_1",
        title: "整理材料",
        targetDate: "2026-05-16",
        reminderAt: "2026-05-16 14:00",
        createdAt: "2026-05-13T00:00:00.000Z",
      },
    ]);

    const result = await consolidateMemoryDream({
      store,
      seedStore,
      now: "2026-05-13T03:20:00.000Z",
      since: "2026-05-12T03:20:00.000Z",
    });

    expect(result.entries).toContainEqual(
      expect.objectContaining({
        kind: "schedule_candidate",
        summary: "排程候选：整理材料",
        sourceIds: ["seed_1"],
        metadata: {
          targetDate: "2026-05-16",
          preferredStartTime: "14:00",
          preferredStartTimes: ["14:00"],
          reasonCodes: ["seed_target_date", "seed_reminder_time"],
        },
      }),
    );
  });

  it("consolidates successful recent actions and ignores older observations", async () => {
    const store = createMemoryMemoryDreamStore({
      observations: [
        {
          id: "old",
          observedAt: "2026-05-10T01:00:00.000Z",
          requestId: "req_old",
          actionType: "create_event",
          ok: true,
          sourceText: "很久以前的日程",
          reply: "已新增日程：旧日程",
        },
        {
          id: "new",
          observedAt: "2026-05-13T01:00:00.000Z",
          requestId: "req_new",
          actionType: "create_event",
          ok: true,
          sourceText: "明天三点见张总",
          reply: "已新增日程：\n2026年5月14日 星期四 15:00 见张总",
        },
      ],
      entries: [],
      dreamRuns: [],
    });

    const result = await consolidateMemoryDream({
      store,
      now: "2026-05-13T03:20:00.000Z",
      since: "2026-05-12T03:20:00.000Z",
    });

    expect(result.entries).toContainEqual(
      expect.objectContaining({
        kind: "interaction_history",
        summary: "最近成功处理：create_event",
        sourceIds: ["new"],
      }),
    );
    expect(result.entries.flatMap((entry) => entry.sourceIds)).not.toContain("old");
  });

  it("adds reflection candidates without injecting memory into decisions", async () => {
    const store = createMemoryMemoryDreamStore({
      observations: [
        {
          id: "create_1",
          observedAt: "2026-05-13T01:00:00.000Z",
          requestId: "req_create_1",
          actionType: "create_event",
          ok: true,
          sourceText: "今天十点 DCF",
          reply: "已新增日程：\n2026年5月13日 星期三 10:00-11:00 DCF",
        },
        {
          id: "create_2",
          observedAt: "2026-05-13T02:00:00.000Z",
          requestId: "req_create_2",
          actionType: "create_event",
          ok: true,
          sourceText: "明天十点阅盟材料",
          reply: "已新增日程：\n2026年5月14日 星期四 10:00，阅盟材料",
        },
        {
          id: "update_1",
          observedAt: "2026-05-13T03:00:00.000Z",
          requestId: "req_update_1",
          actionType: "update_event",
          ok: true,
          sourceText: "DCF 改到早上十点",
          reply: "已修改日程：DCF",
        },
      ],
    });

    const result = await consolidateMemoryDream({
      store,
      now: "2026-05-13T04:00:00.000Z",
      since: "2026-05-12T04:00:00.000Z",
    });

    expect(result.entries).toContainEqual(
      expect.objectContaining({
        kind: "recurring_pattern",
        summary: "重复模式：近期多次成功处理 create_event",
        sourceIds: ["create_1", "create_2"],
        status: "stable",
        reinforcementCount: 2,
      }),
    );
    expect(result.entries).toContainEqual(
      expect.objectContaining({
        kind: "correction_signal",
        summary: "纠错信号：用户近期修改过已锁定日程",
        sourceIds: ["update_1"],
        status: "candidate",
        reinforcementCount: 1,
      }),
    );
    expect(result.entries).toContainEqual(
      expect.objectContaining({
        kind: "preference_candidate",
        summary: "排程偏好：优先安排在 10:00",
        sourceIds: ["create_1", "create_2"],
        status: "stable",
        reinforcementCount: 2,
      }),
    );
  });

  it("builds schedule preferences from structured created events before reply text", async () => {
    const store = createMemoryMemoryDreamStore({
      observations: [
        {
          id: "create_structured_1",
          observedAt: "2026-05-13T01:00:00.000Z",
          requestId: "req_create_structured_1",
          actionType: "create_event",
          ok: true,
          sourceText: "今天十点 DCF",
          reply: "已新增日程：DCF",
          createdEvents: [{ title: "DCF", date: "2026-05-13", startTime: "10:00" }],
        },
        {
          id: "create_structured_2",
          observedAt: "2026-05-13T02:00:00.000Z",
          requestId: "req_create_structured_2",
          actionType: "create_events",
          ok: true,
          sourceText: "明天十点阅盟材料",
          reply: "已新增日程：阅盟材料",
          createdEvents: [{ title: "阅盟材料", date: "2026-05-14", startTime: "10:00" }],
        },
      ],
    });

    const result = await consolidateMemoryDream({
      store,
      now: "2026-05-13T04:00:00.000Z",
      since: "2026-05-12T04:00:00.000Z",
    });

    expect(result.entries).toContainEqual(
      expect.objectContaining({
        kind: "preference_candidate",
        summary: "排程偏好：优先安排在 10:00",
        sourceIds: ["create_structured_1", "create_structured_2"],
        status: "stable",
        reinforcementCount: 2,
      }),
    );
  });

  it("turns schedule confirmation changes into schedule sense correction metadata", async () => {
    const store = createMemoryMemoryDreamStore({
      observations: [
        {
          id: "schedule_feedback_1",
          observedAt: "2026-05-13T01:00:00.000Z",
          requestId: "req_schedule_feedback_1",
          actionType: "create_event",
          ok: true,
          sourceText: "改晚点，11点吧",
          reply: "已新增日程：整理材料",
          scheduleFeedback: {
            kind: "schedule_time_changed",
            targetDate: "2026-05-14",
            preferredStartTimes: ["11:00"],
            reasonCodes: ["schedule_feedback_changed_date", "schedule_feedback_changed_time"],
          },
        } as never,
      ],
    });

    const result = await consolidateMemoryDream({
      store,
      now: "2026-05-13T04:00:00.000Z",
      since: "2026-05-12T04:00:00.000Z",
    });

    expect(result.entries).toContainEqual(
      expect.objectContaining({
        kind: "correction_signal",
        summary: "纠错信号：用户调整过排程推荐",
        metadata: expect.objectContaining({
          targetDate: "2026-05-14",
          preferredStartTimes: ["11:00"],
          reasonCodes: ["schedule_feedback_changed_date", "schedule_feedback_changed_time"],
        }),
      }),
    );
  });

  it("turns schedule reminder changes into schedule sense correction metadata", async () => {
    const store = createMemoryMemoryDreamStore({
      observations: [
        {
          id: "schedule_feedback_reminder_1",
          observedAt: "2026-05-13T01:00:00.000Z",
          requestId: "req_schedule_feedback_reminder_1",
          actionType: "create_event",
          ok: true,
          sourceText: "这个不用提醒",
          reply: "已新增日程：整理材料",
          scheduleFeedback: {
            kind: "schedule_reminder_changed",
            preferredReminderMinutes: [0],
            reasonCodes: ["schedule_feedback_reminder_disabled"],
          },
        } as never,
      ],
    });

    const result = await consolidateMemoryDream({
      store,
      now: "2026-05-13T04:00:00.000Z",
      since: "2026-05-12T04:00:00.000Z",
    });

    expect(result.entries).toContainEqual(
      expect.objectContaining({
        kind: "correction_signal",
        summary: "纠错信号：用户调整过排程推荐",
        metadata: expect.objectContaining({
          preferredReminderMinutes: [0],
          reasonCodes: ["schedule_feedback_reminder_disabled"],
        }),
      }),
    );
  });

  it("keeps multi-reminder correction metadata bounded and ordered", async () => {
    const store = createMemoryMemoryDreamStore({
      observations: [
        {
          id: "schedule_feedback_multi_reminder_1",
          observedAt: "2026-05-13T01:00:00.000Z",
          requestId: "req_schedule_feedback_multi_reminder_1",
          actionType: "create_event",
          ok: true,
          sourceText: "这个比较重要，再提醒一次",
          reply: "已新增日程：整理材料",
          scheduleFeedback: {
            kind: "schedule_reminder_changed",
            preferredReminderMinutes: [10, 120, 40, 120, 5],
            reasonCodes: ["schedule_feedback_reminder_changed"],
          },
        } as never,
      ],
    });

    const result = await consolidateMemoryDream({
      store,
      now: "2026-05-13T04:00:00.000Z",
      since: "2026-05-12T04:00:00.000Z",
    });

    expect(result.entries).toContainEqual(
      expect.objectContaining({
        kind: "correction_signal",
        summary: "纠错信号：用户调整过排程推荐",
        metadata: expect.objectContaining({
          preferredReminderMinutes: [120, 40, 10],
          reasonCodes: ["schedule_feedback_reminder_changed"],
        }),
      }),
    );
  });

  it("marks old unused entries as stale without deleting them", async () => {
    const store = createMemoryMemoryDreamStore({
      entries: [
        {
          id: "mem_old",
          kind: "preference_candidate",
          summary: "偏好候选：旧习惯",
          sourceIds: ["old_source"],
          confidence: 0.6,
          firstSeenAt: "2026-03-01T00:00:00.000Z",
          lastSeenAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
          status: "candidate",
          reinforcementCount: 1,
        },
      ],
    });

    const result = await consolidateMemoryDream({
      store,
      now: "2026-05-13T04:00:00.000Z",
      since: "2026-05-12T04:00:00.000Z",
    });

    expect(result.entries).toContainEqual(
      expect.objectContaining({
        id: "mem_old",
        status: "stale",
        reinforcementCount: 1,
      }),
    );
  });

  it("normalizes malformed entry metadata without dropping old snapshots", async () => {
    const store = createMemoryMemoryDreamStore({
      entries: [
        {
          id: "mem_schedule",
          kind: "schedule_candidate",
          summary: "排程候选：整理材料",
          sourceIds: ["seed_1"],
          confidence: 0.8,
          status: "candidate",
          reinforcementCount: 1,
          firstSeenAt: "2026-05-13T00:00:00.000Z",
          lastSeenAt: "2026-05-13T00:00:00.000Z",
          updatedAt: "2026-05-13T00:00:00.000Z",
          metadata: {
            targetDate: "not-a-date",
            preferredStartTime: "25:99",
            preferredStartTimes: ["14:00", "bad"],
            preferredWindows: ["afternoon", "bad"],
            durationMinutes: 90,
            reasonCodes: ["seed_target_date", ""],
          },
        } as never,
      ],
    });

    await expect(store.load()).resolves.toMatchObject({
      entries: [
        expect.objectContaining({
          summary: "排程候选：整理材料",
          metadata: expect.objectContaining({
            preferredStartTimes: ["14:00"],
            preferredWindows: ["afternoon"],
            durationMinutes: 90,
            reasonCodes: ["seed_target_date"],
          }),
        }),
      ],
    });
  });
});
