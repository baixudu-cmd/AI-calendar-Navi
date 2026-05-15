// 回执层测试：确认用户可见回复只来自动作合同和工具结果。

import { describe, expect, it } from "vitest";
import { buildActionReply } from "../src/reply/index.js";

describe("buildActionReply", () => {
  it("replies from create/update tool success", () => {
    expect(
      buildActionReply(
        { type: "create_event", event: { title: "见张总", date: "2026-05-09", startTime: "15:00" } },
        {
          ok: true,
          data: { id: "evt_1", title: "见张总", start: "2026-05-09 15:00" },
        },
      ),
    ).toBe("已新增日程：\n2026年5月9日 星期六 15:00 见张总");

    expect(
      buildActionReply(
        { type: "update_event", target: { kind: "last_event", eventId: "evt_1" }, patch: { title: "见李总" } },
        {
          ok: true,
          data: { id: "evt_1", title: "见李总", start: "2026-05-09 15:00" },
        },
      ),
    ).toBe("已修改日程：\n2026年5月9日 星期六 15:00 见李总");
  });

  it("lists events concisely", () => {
    expect(
      buildActionReply(
        { type: "list_events", date: "2026-05-09" },
        {
          ok: true,
          data: [
            { id: "evt_1", title: "见张总", start: "2026-05-09 15:00" },
            { id: "evt_2", title: "电话会", start: "2026-05-09 18:00" },
          ],
        },
      ),
    ).toBe("找到 2 个日程：\n1. 2026年5月9日 星期六 15:00 见张总\n2. 2026年5月9日 星期六 18:00 电话会");
  });

  it("shows the queried date when list result is empty", () => {
    expect(
      buildActionReply(
        { type: "list_events", date: "2026-05-09" },
        {
          ok: true,
          data: [],
        },
      ),
    ).toBe("没有找到 2026年5月9日 星期六 的日程。");
  });

  it("replies batch create with created count instead of query wording", () => {
    expect(
      buildActionReply(
        {
          type: "create_events",
          events: [
            { title: "投委会", date: "2026-05-12", startTime: "09:00" },
            { title: "客户电话", date: "2026-05-12", startTime: "14:00" },
          ],
        },
        {
          ok: true,
          data: [
            { id: "evt_1", title: "投委会", start: "2026-05-12 09:00" },
            { id: "evt_2", title: "客户电话", start: "2026-05-12 14:00" },
          ],
        },
      ),
    ).toBe("已新增 2 个日程：\n1. 2026年5月12日 星期二 09:00 投委会\n2. 2026年5月12日 星期二 14:00 客户电话");
  });

  it("replies clarify and failures without pretending success", () => {
    expect(buildActionReply({ type: "clarify", question: "这个日程几点开始？", missing: ["startTime"] })).toBe(
      "这个日程几点开始？",
    );
    expect(
      buildActionReply(
        { type: "create_event", event: { title: "会", date: "2026-05-09", startTime: "15:00" } },
        {
          ok: false,
          code: "api_error",
          message: "飞书日历 API 返回错误。",
        },
      ),
    ).toBe("没有成功：飞书日历 API 返回错误。");
  });
});
