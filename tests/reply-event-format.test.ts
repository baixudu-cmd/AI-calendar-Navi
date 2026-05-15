// 日程展示格式测试：确保微信回复里能稳定看到日期、星期、时间和标题。

import { describe, expect, it } from "vitest";
import { formatCalendarEventDetail, formatCalendarEventLine } from "../src/reply/event-format.js";

describe("calendar event reply formatting", () => {
  it("formats a full date-time event with Chinese date and weekday", () => {
    expect(formatCalendarEventDetail({ id: "evt_1", title: "见张总", start: "2026-05-09 15:00" })).toBe(
      "2026年5月9日 星期六 15:00 见张总",
    );
  });

  it("uses fallback date when the calendar event only has a time", () => {
    expect(formatCalendarEventLine({ id: "evt_1", title: "电话会", start: "09:30" }, 2, { fallbackDate: "2026-05-10" })).toBe(
      "2. 2026年5月10日 星期日 09:30 电话会",
    );
  });

  it("falls back to title when the start value is missing a stable date or time", () => {
    expect(formatCalendarEventLine({ id: "evt_1", title: "待确认事项", start: "" }, 1)).toBe("1. 待确认事项");
  });
});
