import { describe, expect, it } from "vitest";
import {
  createControlledShadowRoute,
  handleControlledShadowRoute,
  type ControlledShadowRouteRequest,
} from "../src/agent-api/controlled-shadow-route.js";
import type { CalendarAdapter } from "../src/calendar/action-executor.js";
import type { DecisionClient } from "../src/decision/index.js";
import { createShortTermStateStore } from "../src/state/index.js";

function createFakeCalendar(): CalendarAdapter {
  const events: Array<{ id: string; title: string; start: string }> = [];
  return {
    async createEvent(event) {
      const created = { id: `evt_${events.length + 1}`, title: event.title, start: `${event.date} ${event.startTime}` };
      events.push(created);
      return { ok: true, data: created };
    },
    async listEvents() {
      return { ok: true, data: events };
    },
    async updateEvent(input) {
      const event = events.find((candidate) => candidate.id === input.eventId);
      if (!event) return { ok: false, code: "not_found", message: "没有找到日程。" };
      if (input.patch.title) event.title = input.patch.title;
      return { ok: true, data: event };
    },
    async deleteEvent(input) {
      return { ok: true, data: { eventId: input.eventId } };
    },
  };
}

function decisionClient(decision: unknown): DecisionClient {
  return { decide: async () => decision };
}

describe("handleControlledShadowRoute", () => {
  it("rejects wrong secret before model or calendar execution", async () => {
    let decideCalls = 0;
    let createCalls = 0;

    const result = await handleControlledShadowRoute(
      { text: "明天下午三点见张总", requestId: "req_bad_secret", secret: "bad_secret" },
      {
        expectedSecret: "shadow_secret",
        state: createShortTermStateStore(),
        seenMessageIds: new Set(),
        decisionClient: { decide: async () => { decideCalls += 1; return { action: "list_events", date: "2026-05-09" }; } },
        calendar: {
          ...createFakeCalendar(),
          async createEvent(event) {
            createCalls += 1;
            return { ok: true, data: { id: "evt_bad_secret", title: event.title, start: "" } };
          },
        },
      },
    );

    expect(result).toMatchObject({ ok: false, actionType: "rejected", requestId: "req_bad_secret" });
    expect(result.reply).toContain("secret");
    expect(decideCalls).toBe(0);
    expect(createCalls).toBe(0);
  });

  it("rejects duplicate messages using server-owned seen message ids", async () => {
    let decideCalls = 0;

    const result = await handleControlledShadowRoute(
      { text: "明天下午三点见张总", messageId: "msg_dup", secret: "shadow_secret" },
      {
        expectedSecret: "shadow_secret",
        state: createShortTermStateStore(),
        seenMessageIds: new Set(["msg_dup"]),
        decisionClient: { decide: async () => { decideCalls += 1; return { action: "list_events", date: "2026-05-09" }; } },
        calendar: createFakeCalendar(),
      },
    );

    expect(result).toMatchObject({ ok: false, actionType: "rejected" });
    expect(result.reply).toContain("已经处理过");
    expect(decideCalls).toBe(0);
  });

  it("records handled message ids so repeated calls are rejected before model or calendar execution", async () => {
    let decideCalls = 0;
    const seenMessageIds = new Set<string>();
    const route = createControlledShadowRoute({
      expectedSecret: "shadow_secret",
      state: createShortTermStateStore(),
      seenMessageIds,
      decisionClient: {
        decide: async () => {
          decideCalls += 1;
          return {
            action: "create_event",
            event: { title: "见张总", date: "2026-05-09", startTime: "15:00" },
          };
        },
      },
      calendar: createFakeCalendar(),
    });

    const first = await route({ text: "明天下午三点见张总", messageId: "msg_once", secret: "shadow_secret" });
    const second = await route({ text: "明天下午三点见张总", messageId: "msg_once", secret: "shadow_secret" });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, actionType: "rejected" });
    expect(second.reply).toContain("已经处理过");
    expect(decideCalls).toBe(1);
  });

  it("creates an event with only caller metadata in the public request", async () => {
    const result = await handleControlledShadowRoute(
      { text: "明天下午三点见张总", requestId: "req_create", messageId: "msg_create", secret: "shadow_secret" },
      {
        expectedSecret: "shadow_secret",
        state: createShortTermStateStore(),
        seenMessageIds: new Set(),
        decisionClient: decisionClient({
          action: "create_event",
          event: { title: "见张总", date: "2026-05-09", startTime: "15:00" },
        }),
        calendar: createFakeCalendar(),
      },
    );

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_create" });
    expect(result.reply).toContain("已新增日程");
  });

  it("creates multiple events through the controlled shadow route", async () => {
    const result = await handleControlledShadowRoute(
      { text: "明天9点投委会，下午2点客户电话，都帮我记一下", requestId: "req_shadow_batch", secret: "shadow_secret" },
      {
        expectedSecret: "shadow_secret",
        state: createShortTermStateStore(),
        seenMessageIds: new Set(),
        decisionClient: decisionClient({
          type: "create_events",
          events: [
            { title: "投委会", date: "2026-05-12", startTime: "09:00" },
            { title: "客户电话", date: "2026-05-12", startTime: "14:00" },
          ],
        }),
        calendar: createFakeCalendar(),
      },
    );

    expect(result).toMatchObject({ ok: true, actionType: "create_events", requestId: "req_shadow_batch" });
    expect(result.reply).toContain("已新增 2 个日程");
  });

  it("creates a single-argument handler after server dependencies are fixed", async () => {
    const route = createControlledShadowRoute({
      expectedSecret: "shadow_secret",
      state: createShortTermStateStore(),
      seenMessageIds: new Set(),
      decisionClient: decisionClient({
        action: "list_events",
        date: "2026-05-09",
      }),
      calendar: createFakeCalendar(),
    });

    const result = await route({ text: "查一下明天日程", secret: "shadow_secret" });

    expect(result.actionType).toBe("list_events");
  });

  it("reads current time for each shadow route request instead of freezing at server startup", async () => {
    const seenNow: Array<string | undefined> = [];
    let now = "2026-05-16T08:00:00+08:00";
    const route = createControlledShadowRoute({
      expectedSecret: "shadow_secret",
      state: createShortTermStateStore(),
      seenMessageIds: new Set(),
      now: () => now,
      timezone: "Asia/Shanghai",
      decisionClient: {
        decide: async (request) => {
          seenNow.push(request.now);
          return { action: "list_events", date: request.now?.slice(0, 10) || "2026-05-16" };
        },
      },
      calendar: createFakeCalendar(),
    });

    await route({ text: "查一下今天日程", requestId: "req_time_1", secret: "shadow_secret" });
    now = "2026-05-17T08:00:00+08:00";
    await route({ text: "查一下今天日程", requestId: "req_time_2", secret: "shadow_secret" });

    expect(seenNow).toEqual(["2026-05-16T08:00:00+08:00", "2026-05-17T08:00:00+08:00"]);
  });

  it("handles daily briefing through the controlled shadow route without exposing server dependencies", async () => {
    const state = createShortTermStateStore();
    const calendar = createFakeCalendar();
    await calendar.createEvent({ title: "投委会", date: "2026-05-08", startTime: "09:00" });

    const route = createControlledShadowRoute({
      expectedSecret: "shadow_secret",
      today: "2026-05-08",
      state,
      seenMessageIds: new Set(),
      decisionClient: decisionClient({ action: "daily_briefing", briefingType: "morning" }),
      calendar,
    });

    const result = await route({ text: "发我今天早报", requestId: "req_shadow_briefing", secret: "shadow_secret" });

    expect(result).toMatchObject({ ok: true, actionType: "daily_briefing", requestId: "req_shadow_briefing" });
    expect(result.reply).toContain("投委会");
    expect(state.snapshot().briefing_items).toEqual([
      { itemNumber: 1, eventId: "evt_1", title: "投委会", date: "2026-05-08", startTime: "09:00" },
    ]);
  });

  it("keeps delete request and confirmation on the server-owned route state", async () => {
    const state = createShortTermStateStore({ last_event: { eventId: "evt_1", title: "电话会" } });
    let deletedEventId = "";
    const decisions = [
      { type: "request_delete_event", target: { kind: "last_event" } },
      { type: "confirm_delete", confirmed: true },
    ];
    const route = createControlledShadowRoute({
      expectedSecret: "shadow_secret",
      state,
      seenMessageIds: new Set(),
      decisionClient: {
        decide: async () => decisions.shift() || { action: "clarify", question: "没有动作。", missing: ["unknown"] },
      },
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async (input) => {
          deletedEventId = input.eventId;
          return { ok: true, data: { eventId: input.eventId } };
        },
      },
    });

    const requestResult = await route({ text: "删掉刚才那个", requestId: "req_shadow_delete_request", secret: "shadow_secret" });
    const confirmResult = await route({ text: "确认删除", requestId: "req_shadow_delete_confirm", secret: "shadow_secret" });

    expect(requestResult).toMatchObject({ ok: true, actionType: "request_delete_event", requestId: "req_shadow_delete_request" });
    expect(confirmResult).toMatchObject({ ok: true, actionType: "confirm_delete", requestId: "req_shadow_delete_confirm" });
    expect(deletedEventId).toBe("evt_1");
    expect(state.snapshot().pending_delete).toBeUndefined();
  });

  it("returns image dry-run without calling the model or calendar", async () => {
    let decideCalls = 0;
    let listCalls = 0;
    const result = await handleControlledShadowRoute(
      {
        text: "",
        requestId: "req_image",
        messageId: "msg_image",
        secret: "shadow_secret",
        media: { path: "/tmp/openclaw-weixin/inbound/image.png", type: "image/png" },
      },
      {
        expectedSecret: "shadow_secret",
        state: createShortTermStateStore(),
        seenMessageIds: new Set(),
        decisionClient: { decide: async () => { decideCalls += 1; return { action: "list_events", date: "2026-05-11" }; } },
        calendar: {
          ...createFakeCalendar(),
          async listEvents(query) {
            listCalls += 1;
            return createFakeCalendar().listEvents(query);
          },
        },
      },
    );

    expect(result).toMatchObject({ ok: true, actionType: "image_capture_dry_run", requestId: "req_image" });
    expect(result.reply).toContain("已收到图片");
    expect(result.reply).toContain("还未启用");
    expect(result.reply).not.toContain("/tmp/openclaw-weixin");
    expect(decideCalls).toBe(0);
    expect(listCalls).toBe(0);
  });

  it("creates parsed image events through the normal calendar create path", async () => {
    let createCalls = 0;
    let decideCalls = 0;
    let createdEvent: unknown;
    const state = createShortTermStateStore();

    const result = await handleControlledShadowRoute(
      {
        text: "",
        requestId: "req_image_draft",
        messageId: "msg_image_draft",
        secret: "shadow_secret",
        media: { path: "/tmp/openclaw-weixin/inbound/meeting.png", type: "image/png" },
      },
      {
        expectedSecret: "shadow_secret",
        state,
        seenMessageIds: new Set(),
        decisionClient: {
          decide: async () => {
            decideCalls += 1;
            return { action: "list_events", date: "2026-05-12" };
          },
        },
        calendar: {
          ...createFakeCalendar(),
          async createEvent(event) {
            createCalls += 1;
            createdEvent = event;
            return { ok: true, data: { id: "evt_image", title: event.title, start: `${event.date} ${event.startTime}` } };
          },
        },
        imageDraftParser: async () => ({
          ok: true,
          draft: {
            title: "雷达试验交流",
            date: "2026-05-12",
            startTime: "10:00",
            endTime: "10:45",
            location: "腾讯会议 370 310 601",
          },
        }),
      },
    );

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_image_draft" });
    expect(result.reply).toContain("已新增日程");
    expect(result.reply).toContain("雷达试验交流");
    expect(result.reply).not.toContain("确认后我再写入日历");
    expect(result.reply).not.toContain("/tmp/openclaw-weixin");
    expect(state.snapshot().pending_image_draft).toBeUndefined();
    expect(createdEvent).toEqual({
      title: "雷达试验交流",
      date: "2026-05-12",
      startTime: "10:00",
      endTime: "10:45",
      location: "腾讯会议 370 310 601",
    });
    expect(createCalls).toBe(1);
    expect(decideCalls).toBe(0);
  });

  it("blocks parsed image events when OCR weekday conflicts with the parsed date", async () => {
    let createCalls = 0;
    const result = await handleControlledShadowRoute(
      {
        text: "",
        requestId: "req_image_weekday_mismatch",
        messageId: "msg_image_weekday_mismatch",
        secret: "shadow_secret",
        media: { path: "/tmp/openclaw-weixin/inbound/meeting.png", type: "image/png" },
      },
      {
        expectedSecret: "shadow_secret",
        state: createShortTermStateStore(),
        seenMessageIds: new Set(),
        decisionClient: { decide: async () => ({ action: "list_events", date: "2026-05-12" }) },
        calendar: {
          ...createFakeCalendar(),
          async createEvent(event) {
            createCalls += 1;
            return { ok: true, data: { id: "evt_image", title: event.title, start: `${event.date} ${event.startTime}` } };
          },
        },
        imageDraftParser: async () => ({
          ok: true,
          sourceText: "雷达试验交流\n2026年5月12日 星期三 10:00-10:45",
          draft: {
            title: "雷达试验交流",
            date: "2026-05-12",
            startTime: "10:00",
            endTime: "10:45",
          },
        }),
      },
    );

    expect(result).toMatchObject({ ok: false, actionType: "create_event", requestId: "req_image_weekday_mismatch" });
    expect(result.reply).toContain("模型日期和你说的星期不一致");
    expect(createCalls).toBe(0);
  });

  it("fails closed for non-image media before model or calendar execution", async () => {
    let decideCalls = 0;
    const result = await handleControlledShadowRoute(
      {
        text: "",
        requestId: "req_file",
        messageId: "msg_file",
        secret: "shadow_secret",
        media: { path: "/tmp/openclaw-weixin/inbound/file.pdf", type: "application/pdf" },
      },
      {
        expectedSecret: "shadow_secret",
        state: createShortTermStateStore(),
        seenMessageIds: new Set(),
        decisionClient: { decide: async () => { decideCalls += 1; return { action: "list_events", date: "2026-05-11" }; } },
        calendar: createFakeCalendar(),
      },
    );

    expect(result).toMatchObject({ ok: false, actionType: "image_capture_rejected", requestId: "req_file" });
    expect(result.reply).toContain("只支持图片");
    expect(decideCalls).toBe(0);
  });

  it("keeps server dependencies out of the public request type", () => {
    const request: ControlledShadowRouteRequest = { text: "查一下明天日程", secret: "shadow_secret" };

    expect(request).toEqual({ text: "查一下明天日程", secret: "shadow_secret" });

    // @ts-expect-error 公开 request 类型不能接收模型客户端。
    const requestWithDecisionClient: ControlledShadowRouteRequest = { text: "x", secret: "s", decisionClient: decisionClient({ action: "clarify", question: "?", missing: ["date"] }) };
    // @ts-expect-error 公开 request 类型不能接收日历 adapter。
    const requestWithCalendar: ControlledShadowRouteRequest = { text: "x", secret: "s", calendar: createFakeCalendar() };
    // @ts-expect-error 公开 request 类型不能接收状态。
    const requestWithState: ControlledShadowRouteRequest = { text: "x", secret: "s", state: createShortTermStateStore() };
    // @ts-expect-error 公开 request 类型不能接收重复消息集合。
    const requestWithSeenMessageIds: ControlledShadowRouteRequest = { text: "x", secret: "s", seenMessageIds: new Set() };
    // @ts-expect-error 公开 request 类型不能接收服务端日期。
    const requestWithToday: ControlledShadowRouteRequest = { text: "x", secret: "s", today: "2026-05-08" };

    expect(requestWithDecisionClient).toBeDefined();
    expect(requestWithCalendar).toBeDefined();
    expect(requestWithState).toBeDefined();
    expect(requestWithSeenMessageIds).toBeDefined();
    expect(requestWithToday).toBeDefined();
  });
});
