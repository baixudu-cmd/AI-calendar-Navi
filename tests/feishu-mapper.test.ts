// 飞书 mapper 测试，验证本地日程字段到飞书字段的转换。

import { describe, expect, it } from "vitest";
import {
  mapCreateEventPayload,
  mapListEventsQuery,
  mapUpdateEventPayload,
} from "../src/calendar/feishu/mapper.js";

describe("Feishu calendar mapper", () => {
  it("maps create_event draft into Feishu event payload", () => {
    expect(
      mapCreateEventPayload({
        title: "见张总",
        date: "2026-05-09",
        startTime: "15:00",
        endTime: "16:00",
        location: "办公室",
        reminderMinutes: 30,
        notes: "带资料",
      }),
    ).toEqual({
      summary: "见张总",
      start_time: { timestamp: "1778310000", timezone: "Asia/Shanghai" },
      end_time: { timestamp: "1778313600", timezone: "Asia/Shanghai" },
      location: { name: "办公室" },
      description: "带资料",
      reminders: [{ minutes: 30 }],
    });
  });

  it("defaults missing endTime to one hour after startTime", () => {
    expect(
      mapCreateEventPayload({
        title: "见张总",
        date: "2026-05-09",
        startTime: "15:00",
      }).end_time,
    ).toEqual({ timestamp: "1778313600", timezone: "Asia/Shanghai" });
  });

  it("defaults created events to a 40-minute Feishu reminder", () => {
    expect(
      mapCreateEventPayload({
        title: "见张总",
        date: "2026-05-09",
        startTime: "15:00",
      }),
    ).toMatchObject({
      reminders: [{ minutes: 40 }],
    });
  });

  it("maps daily recurrence into Feishu RRULE", () => {
    expect(
      mapCreateEventPayload({
        title: "站会",
        date: "2026-06-01",
        startTime: "09:00",
        recurrence: { frequency: "daily", interval: 1 },
      }),
    ).toMatchObject({
      recurrence: "FREQ=DAILY;INTERVAL=1",
    });
  });

  it("maps recurring at-start reminders into Feishu zero-minute reminders", () => {
    expect(
      mapCreateEventPayload({
        title: "吃药",
        date: "2026-06-11",
        startTime: "08:00",
        reminderAtStart: true,
        recurrence: { frequency: "daily", interval: 1 },
      }),
    ).toMatchObject({
      recurrence: "FREQ=DAILY;INTERVAL=1",
      reminders: [{ minutes: 0 }],
    });
  });

  it("maps weekly recurrence weekdays into Feishu RRULE", () => {
    expect(
      mapCreateEventPayload({
        title: "例会",
        date: "2026-06-01",
        startTime: "10:00",
        recurrence: { frequency: "weekly", interval: 1, byWeekday: ["MO", "WE", "FR"] },
      }),
    ).toMatchObject({
      recurrence: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR",
    });
  });

  it("maps recurring event count into Feishu RRULE", () => {
    expect(
      mapCreateEventPayload({
        title: "训练",
        date: "2026-06-01",
        startTime: "19:00",
        recurrence: { frequency: "daily", interval: 1, count: 10 },
      }),
    ).toMatchObject({
      recurrence: "FREQ=DAILY;INTERVAL=1;COUNT=10",
    });
  });

  it("clears Feishu reminders when a created event explicitly disables reminders", () => {
    expect(
      mapCreateEventPayload({
        title: "见张总",
        date: "2026-05-09",
        startTime: "15:00",
        reminderMinutes: 0,
      }),
    ).toMatchObject({
      reminders: [],
    });
  });

  it("keeps default one-hour end time after the start time across midnight", () => {
    const payload = mapCreateEventPayload({
      title: "夜间电话会",
      date: "2026-05-09",
      startTime: "23:30",
    });

    expect(Number(payload.end_time.timestamp)).toBeGreaterThan(Number(payload.start_time.timestamp));
  });

  it("maps list date and range into query objects", () => {
    expect(mapListEventsQuery({ date: "2026-05-09" })).toEqual({
      start_time: "1778256000",
      end_time: "1778342399",
    });
    expect(mapListEventsQuery({ range: { startDate: "2026-05-09", endDate: "2026-05-10" } })).toEqual({
      start_time: "1778256000",
      end_time: "1778428799",
    });
  });

  it("maps update patch into Feishu patch payload", () => {
    expect(mapUpdateEventPayload({ date: "2026-05-09", startTime: "16:30", location: "会议室 A" })).toEqual({
      start_time: { timestamp: "1778315400", timezone: "Asia/Shanghai" },
      location: { name: "会议室 A" },
    });
  });

  it("clears Feishu reminders when update patch disables reminders", () => {
    expect(mapUpdateEventPayload({ reminderMinutes: 0 })).toEqual({
      reminders: [],
    });
  });

  it("maps update at-start reminders into Feishu zero-minute reminders", () => {
    expect(mapUpdateEventPayload({ reminderAtStart: true })).toEqual({
      reminders: [{ minutes: 0 }],
    });
  });

  it("keeps at most three explicit Feishu reminders for important events", () => {
    expect(mapCreateEventPayload({ title: "重要会议", date: "2026-05-09", startTime: "15:00", reminderMinutes: [10, 120, 40, 120, 5] })).toMatchObject({
      reminders: [{ minutes: 120 }, { minutes: 40 }, { minutes: 10 }],
    });
    expect(mapUpdateEventPayload({ reminderMinutes: [10, 120, 40, 120, 5] })).toEqual({
      reminders: [{ minutes: 120 }, { minutes: 40 }, { minutes: 10 }],
    });
  });
});
