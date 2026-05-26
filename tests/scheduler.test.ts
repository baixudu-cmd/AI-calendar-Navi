// 排程模块测试：验证推荐位生成、确认，以及来自做梦候选的安全转换。

import { describe, expect, it } from "vitest";
import { formatScheduleProposalReply, proposeSchedule, selectScheduleItemsFromMemoryDream, selectSchedulePreferencesFromMemoryDream } from "../src/scheduler/index.js";
import type { CalendarAdapter } from "../src/calendar/action-executor.js";
import type { MemoryDreamEntry } from "../src/memory-dream/index.js";

describe("scheduler memory dream bridge", () => {
  it("turns active dream schedule candidates into proposal items", () => {
    const entries: MemoryDreamEntry[] = [
      dreamEntry("mem_1", "schedule_candidate", "排程候选：整理投委会材料", "candidate", 0.72),
      dreamEntry("mem_2", "schedule_candidate", "排程候选：看 DCF 模型", "stable", 0.86),
      dreamEntry("mem_3", "schedule_candidate", "排程候选：旧事项", "stale", 0.9),
      dreamEntry("mem_4", "pending_note", "待推进：只记录，不直接排程", "candidate", 0.9),
    ];

    expect(selectScheduleItemsFromMemoryDream(entries)).toEqual([
      { title: "看 DCF 模型", sourceIds: ["src_2"], confidence: 0.86 },
      { title: "整理投委会材料", sourceIds: ["src_1"], confidence: 0.72 },
    ]);
  });

  it("maps structured dream schedule metadata into proposal item defaults", () => {
    const entries: MemoryDreamEntry[] = [
      dreamEntry("mem_1", "schedule_candidate", "排程候选：整理材料", "candidate", 0.72, {
        targetDate: "2026-05-16",
        durationMinutes: 90,
        preferredReminderMinutes: [0],
        reasonCodes: ["seed_target_date", "seed_reminder_time"],
      }),
    ];

    expect(selectScheduleItemsFromMemoryDream(entries)).toEqual([
      { title: "整理材料", sourceIds: ["src_1"], confidence: 0.72, date: "2026-05-16", durationMinutes: 90, reminderMinutes: 0, reasonCodes: ["seed_target_date", "seed_reminder_time"] },
    ]);
  });

  it("keeps dream candidate confidence on proposal items", () => {
    const entries: MemoryDreamEntry[] = [
      dreamEntry("mem_1", "schedule_candidate", "排程候选：整理材料", "candidate", 0.42),
    ];

    expect(selectScheduleItemsFromMemoryDream(entries)).toEqual([
      { title: "整理材料", sourceIds: ["src_1"], confidence: 0.42 },
    ]);
  });

  it("limits dream schedule candidates to five items", () => {
    const entries = Array.from({ length: 8 }, (_, index) =>
      dreamEntry(`mem_${index}`, "schedule_candidate", `排程候选：事项${index}`, "candidate", 0.7),
    );

    expect(selectScheduleItemsFromMemoryDream(entries)).toHaveLength(5);
  });

  it("extracts schedule preferences from personal habit memories", () => {
    const entries: MemoryDreamEntry[] = [
      dreamEntry("mem_1", "preference_candidate", "排程偏好：优先安排在 11:00", "stable", 0.8),
      dreamEntry("mem_2", "preference_candidate", "偏好候选：排程优先 15:30", "candidate", 0.7),
      dreamEntry("mem_3", "preference_candidate", "排程偏好：优先安排在 07:00", "stable", 0.9),
      dreamEntry("mem_4", "preference_candidate", "排程偏好：优先安排在 16:00", "rejected", 0.9),
      dreamEntry("mem_5", "preference_candidate", "排程偏好：优先安排在 15:15", "stable", 0.9),
    ];

    expect(selectSchedulePreferencesFromMemoryDream(entries)).toEqual({
      preferredStartTimes: ["11:00", "15:30"],
    });
  });

  it("extracts structured schedule preferences before legacy summary fallback", () => {
    const entries: MemoryDreamEntry[] = [
      dreamEntry("mem_1", "preference_candidate", "排程偏好：优先安排在 11:00", "stable", 0.8, {
        preferredStartTime: "14:00",
        preferredStartTimes: ["15:00"],
        preferredWindows: ["afternoon"],
      }),
      dreamEntry("mem_2", "schedule_candidate", "排程候选：整理材料", "candidate", 0.7, {
        preferredStartTime: "16:00",
        preferredWindows: ["later"],
      }),
    ];

    expect(selectSchedulePreferencesFromMemoryDream(entries)).toEqual({
      preferredStartTimes: ["14:00", "15:00", "16:00", "11:00"],
      preferredWindows: ["afternoon", "later"],
    });
  });

  it("keeps multi-reminder schedule preferences bounded and ordered", () => {
    const entries: MemoryDreamEntry[] = [
      dreamEntry("mem_1", "preference_candidate", "排程偏好：重要事项多提醒", "stable", 0.8, {
        preferredReminderMinutes: [10, 120, 40, 120, 5],
      }),
    ];

    expect(selectSchedulePreferencesFromMemoryDream(entries)).toEqual({
      preferredStartTimes: [],
      preferredReminderMinutes: [120, 40, 10],
    });
  });

  it("uses personal schedule preferences to order recommendations", async () => {
    const result = await proposeSchedule({
      calendar: emptyCalendar(),
      date: "2026-05-14",
      items: [{ title: "整理材料" }],
      optionCount: 2,
      preferences: { preferredStartTimes: ["11:00"] },
    });

    expect(result).toMatchObject({
      ok: true,
      pendingSchedule: {
        options: [
          { optionNumber: 1, items: [{ title: "整理材料", startTime: "11:00" }] },
          { optionNumber: 2, items: [{ title: "整理材料", startTime: "09:00" }] },
        ],
      },
    });
  });

  it("applies reminder preferences to schedule candidates without explicit reminders", async () => {
    const result = await proposeSchedule({
      calendar: emptyCalendar(),
      date: "2026-05-14",
      items: [{ title: "整理材料" }],
      optionCount: 1,
      preferences: { preferredReminderMinutes: [120, 40] },
    });

    expect(result).toMatchObject({
      ok: true,
      pendingSchedule: {
        options: [{ optionNumber: 1, items: [{ title: "整理材料", reminderMinutes: [120, 40] }] }],
      },
    });
  });

  it("uses coarse schedule windows to order recommendations", async () => {
    const result = await proposeSchedule({
      calendar: emptyCalendar(),
      date: "2026-05-14",
      items: [{ title: "整理材料" }],
      optionCount: 2,
      preferences: { preferredWindows: ["afternoon"] },
    });

    expect(result).toMatchObject({
      ok: true,
      pendingSchedule: {
        options: [
          { optionNumber: 1, items: [{ title: "整理材料", startTime: "14:00" }] },
          { optionNumber: 2, items: [{ title: "整理材料", startTime: "14:30" }] },
        ],
      },
    });
  });

  it("keeps explicit afternoon windows ahead of morning personal preferences", async () => {
    const result = await proposeSchedule({
      calendar: emptyCalendar(),
      date: "2026-05-14",
      items: [{ title: "整理材料" }],
      optionCount: 3,
      preferences: { preferredStartTimes: ["09:00", "11:00", "14:00"], preferredWindows: ["afternoon"] },
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      const startTimes = result.pendingSchedule.options.map((option) => option.items[0]?.startTime);
      expect(startTimes).toEqual(["14:00", "14:30", "15:00"]);
    }
  });

  it("treats later as a materially later schedule window", async () => {
    const result = await proposeSchedule({
      calendar: emptyCalendar(),
      date: "2026-05-14",
      items: [{ title: "整理材料" }],
      optionCount: 2,
      preferences: { preferredWindows: ["later"] },
    });

    expect(result).toMatchObject({
      ok: true,
      pendingSchedule: {
        options: [
          { optionNumber: 1, items: [{ title: "整理材料", startTime: "15:00" }] },
          { optionNumber: 2, items: [{ title: "整理材料", startTime: "15:30" }] },
        ],
      },
    });
  });

  it("explains why recommended schedule slots are suitable", async () => {
    const result = await proposeSchedule({
      calendar: emptyCalendar(),
      date: "2026-05-14",
      items: [{ title: "整理材料", reasonCodes: ["seed_target_date", "seed_reminder_time"] }],
      optionCount: 1,
      preferences: { preferredStartTimes: ["11:00"] },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(formatScheduleProposalReply(result.pendingSchedule)).toContain("原因：来自待推进目标日期和提醒时间，且这段时间没有冲突");
      expect(formatScheduleProposalReply(result.pendingSchedule)).toContain("共 1 个候选");
      expect(formatScheduleProposalReply(result.pendingSchedule)).toContain("确认前不会写入日历");
      expect(formatScheduleProposalReply(result.pendingSchedule)).toContain("\n1. 2026-05-14 11:00 整理材料");
      expect(formatScheduleProposalReply(result.pendingSchedule)).toContain("回复“选 1”确认。");
      expect(formatScheduleProposalReply(result.pendingSchedule)).not.toContain("第一个改到 11 点");
    }
  });

  it("shows a cautious confidence line for low-confidence schedule recommendations", async () => {
    const result = await proposeSchedule({
      calendar: emptyCalendar(),
      date: "2026-05-14",
      items: [{ title: "整理材料", confidence: 0.42 }],
      optionCount: 1,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(formatScheduleProposalReply(result.pendingSchedule)).toContain("把握：偏低，我先给候选，确认前不会写入日历");
    }
  });
});

function emptyCalendar(): CalendarAdapter {
  return {
    async createEvent() {
      throw new Error("不应写日历。");
    },
    async listEvents() {
      return { ok: true, data: [] };
    },
    async updateEvent() {
      throw new Error("不应改日历。");
    },
    async deleteEvent() {
      throw new Error("不应删日历。");
    },
  };
}

function dreamEntry(
  id: string,
  kind: MemoryDreamEntry["kind"],
  summary: string,
  status: MemoryDreamEntry["status"],
  confidence: number,
  metadata?: unknown,
): MemoryDreamEntry {
  return {
    id,
    kind,
    summary,
    sourceIds: [id.replace("mem_", "src_")],
    confidence,
    status,
    reinforcementCount: 1,
    firstSeenAt: "2026-05-13T00:00:00.000Z",
    lastSeenAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...(metadata ? { metadata } : {}),
  } as MemoryDreamEntry;
}
