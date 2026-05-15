import { describe, expect, it } from "vitest";
import { handleCalendarAgentRequest } from "../src/agent-api/index.js";
import type { CalendarAdapter } from "../src/calendar/action-executor.js";
import { buildModelDecisionMessages, createModelDecisionClient } from "../src/decision/model/index.js";
import { createShortTermStateStore } from "../src/state/index.js";

function createFakeCalendar(): CalendarAdapter {
  return {
    async createEvent(event) {
      return { ok: true, data: { id: "evt_model", title: event.title, start: `${event.date} ${event.startTime}` } };
    },
    async listEvents() {
      return { ok: true, data: [] };
    },
    async updateEvent(input) {
      return { ok: true, data: { id: input.eventId, title: input.patch.title || "改后", start: "" } };
    },
    async deleteEvent(input) {
      return { ok: true, data: { eventId: input.eventId } };
    },
  };
}

describe("Calendar Agent API model path", () => {
  it("lets model transport produce a contract that drives the core calendar API", async () => {
    const decisionClient = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          toolName: "calendar.create_event",
          arguments: { title: "见张总", date: "2026-05-09", startTime: "15:00", startTimeEvidence: "下午三点" },
        }),
      }),
    });

    const result = await handleCalendarAgentRequest({
      text: "明天下午三点见张总",
      requestId: "req_model",
      state: createShortTermStateStore(),
      decisionClient,
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_model" });
    expect(result.reply).toContain("已新增日程");
  });

  it("lets model transport create multiple events through toolName arguments", async () => {
    const created: Array<{ id: string; title: string; start: string }> = [];
    const decisionClient = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          toolName: "calendar.create_events",
          arguments: {
            events: [
              { title: "投委会", date: "2026-05-12", startTime: "09:00", startTimeEvidence: "9点" },
              { title: "客户电话", date: "2026-05-12", startTime: "14:00", startTimeEvidence: "下午2点" },
            ],
          },
        }),
      }),
    });

    const result = await handleCalendarAgentRequest({
      text: "明天9点投委会，下午2点客户电话，都帮我记一下",
      requestId: "req_model_batch_create",
      state: createShortTermStateStore(),
      decisionClient,
      calendar: {
        ...createFakeCalendar(),
        createEvent: async (event) => {
          const createdEvent = { id: `evt_model_${created.length + 1}`, title: event.title, start: `${event.date} ${event.startTime}` };
          created.push(createdEvent);
          return { ok: true, data: createdEvent };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "create_events", requestId: "req_model_batch_create" });
    expect(result.reply).toContain("已新增 2 个日程");
    expect(created).toEqual([
      { id: "evt_model_1", title: "投委会", start: "2026-05-12 09:00" },
      { id: "evt_model_2", title: "客户电话", start: "2026-05-12 14:00" },
    ]);
  });

  it("rejects legacy action JSON from model path before calendar write", async () => {
    let createCalled = false;
    const decisionClient = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          action: "create_event",
          event: { title: "见张总", date: "2026-05-09", startTime: "15:00" },
        }),
      }),
    });

    const result = await handleCalendarAgentRequest({
      text: "明天下午三点见张总",
      requestId: "legacy_action_model_path",
      state: createShortTermStateStore(),
      decisionClient,
      calendar: {
        async createEvent() {
          createCalled = true;
          return { ok: true, data: { id: "evt_wrong", title: "wrong", start: "2026-05-09 15:00" } };
        },
        async listEvents() {
          return { ok: true, data: [] };
        },
        async updateEvent() {
          return { ok: true, data: { id: "evt_wrong", title: "wrong", start: "2026-05-09 15:00" } };
        },
        async deleteEvent() {
          return { ok: true, data: { eventId: "evt_wrong" } };
        },
      },
    });

    expect(result).toMatchObject({ ok: false, actionType: "rejected" });
    expect(result.reply).toContain("工具 Schema 未通过");
    expect(createCalled).toBe(false);
  });

  it("lets model transport produce a daily briefing tool call through the API bridge", async () => {
    const decisionClient = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          toolName: "calendar.daily_briefing",
          arguments: { briefingType: "morning" },
        }),
      }),
    });

    const result = await handleCalendarAgentRequest({
      text: "发我今天早报",
      requestId: "req_model_briefing",
      today: "2026-05-08",
      state: createShortTermStateStore(),
      decisionClient,
      calendar: createFakeCalendar(),
    });

    expect(result).toMatchObject({ ok: true, actionType: "daily_briefing", requestId: "req_model_briefing" });
    expect(result.reply).toContain("早报");
  });

  it("lets model transport store a clarify create draft and complete it later", async () => {
    const state = createShortTermStateStore();
    const clarifyClient = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          toolName: "assistant.clarify",
          arguments: {
            question: "这个日程几点开始？",
            missing: ["startTime"],
            createDraft: { title: "见张总", date: "2026-05-09" },
          },
        }),
      }),
    });

    const clarifyResult = await handleCalendarAgentRequest({
      text: "明天约张总开会",
      requestId: "req_model_create_draft",
      state,
      decisionClient: clarifyClient,
      calendar: createFakeCalendar(),
    });

    expect(clarifyResult).toMatchObject({ ok: true, actionType: "clarify", requestId: "req_model_create_draft" });
    expect(state.snapshot().pending_clarification?.createDraft).toEqual({ title: "见张总", date: "2026-05-09" });

    const completeClient = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          toolName: "assistant.clarify",
          arguments: {
            question: "这个日程叫什么？",
            missing: ["title"],
            createDraft: { startTime: "10:00" },
          },
        }),
      }),
    });

    const completeResult = await handleCalendarAgentRequest({
      text: "上午10点",
      requestId: "req_model_complete_draft",
      state,
      decisionClient: completeClient,
      calendar: createFakeCalendar(),
    });

    expect(completeResult).toMatchObject({ ok: true, actionType: "create_event", requestId: "req_model_complete_draft" });
    expect(state.snapshot().pending_clarification).toBeUndefined();
  });

  it("does not teach the model to wait for pending image draft confirmation", () => {
    const messages = buildModelDecisionMessages({
      text: "确认",
      state: {
        pending_image_draft: {
          title: "雷达试验交流",
          date: "2026-05-12",
          startTime: "10:00",
          endTime: "10:45",
        },
      },
      now: "2026-05-12T10:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(messages[0]?.content).not.toContain("pending_image_draft");
  });

  it("clears stale pending image drafts before normal text decisions", async () => {
    const state = createShortTermStateStore({
      pending_image_draft: {
        title: "雷达试验交流",
        date: "2026-05-12",
        startTime: "10:00",
        endTime: "10:45",
        location: "腾讯会议 370 310 601",
      },
    } as never);
    let createCalls = 0;
    const decisionClient = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          toolName: "assistant.clarify",
          arguments: {
            question: "请直接说要新增的日程内容。",
            missing: ["title"],
          },
        }),
      }),
    });

    const result = await handleCalendarAgentRequest({
      text: "确认",
      requestId: "req_image_draft_confirm",
      state,
      decisionClient,
      calendar: {
        ...createFakeCalendar(),
        createEvent: async (event) => {
          createCalls += 1;
          return { ok: true, data: { id: "evt_image_draft", title: event.title, start: `${event.date} ${event.startTime}` } };
        },
      },
    });

    expect(result).toMatchObject({ ok: true, actionType: "clarify", requestId: "req_image_draft_confirm" });
    expect(createCalls).toBe(0);
    expect(state.snapshot().pending_image_draft).toBeUndefined();
  });

  it("rejects legacy daily briefing action JSON from model path", async () => {
    let listCalled = false;
    const decisionClient = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          action: "daily_briefing",
          briefingType: "morning",
        }),
      }),
    });

    const result = await handleCalendarAgentRequest({
      text: "发我今天早报",
      requestId: "legacy_briefing_action_model_path",
      today: "2026-05-08",
      state: createShortTermStateStore(),
      decisionClient,
      calendar: {
        ...createFakeCalendar(),
        async listEvents() {
          listCalled = true;
          return { ok: true, data: [] };
        },
      },
    });

    expect(result).toMatchObject({ ok: false, actionType: "rejected" });
    expect(result.reply).toContain("工具 Schema 未通过");
    expect(listCalled).toBe(false);
  });

  it("lets model transport request and confirm delete through toolName arguments", async () => {
    const state = createShortTermStateStore({ last_event: { eventId: "evt_model_delete", title: "电话会" } });
    const deleteRequestClient = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          toolName: "calendar.delete_event",
          arguments: { target: { kind: "last_event" } },
        }),
      }),
    });

    const requestResult = await handleCalendarAgentRequest({
      text: "删掉刚才那个",
      requestId: "req_model_delete_request",
      state,
      decisionClient: deleteRequestClient,
      calendar: createFakeCalendar(),
    });

    expect(requestResult).toMatchObject({ ok: true, actionType: "request_delete_event", requestId: "req_model_delete_request" });
    expect(state.snapshot().pending_delete).toMatchObject({ eventId: "evt_model_delete" });

    let deletedEventId = "";
    const confirmClient = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          toolName: "calendar.confirm_delete",
          arguments: { confirmed: true },
        }),
      }),
    });

    const confirmResult = await handleCalendarAgentRequest({
      text: "确认删除",
      requestId: "req_model_delete_confirm",
      state,
      decisionClient: confirmClient,
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async (input) => {
          deletedEventId = input.eventId;
          return { ok: true, data: { eventId: input.eventId } };
        },
      },
    });

    expect(confirmResult).toMatchObject({ ok: true, actionType: "confirm_delete", requestId: "req_model_delete_confirm" });
    expect(deletedEventId).toBe("evt_model_delete");
  });

  it("rejects model confirm delete calls that include raw eventId", async () => {
    let deleteCalled = false;
    const decisionClient = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          toolName: "calendar.confirm_delete",
          arguments: { confirmed: true, eventId: "evt_hallucinated" },
        }),
      }),
    });

    const result = await handleCalendarAgentRequest({
      text: "删第一个",
      requestId: "req_model_delete_event_id_rejected",
      state: createShortTermStateStore({ pending_delete: { eventId: "evt_real", title: "电话会", source: "last_event" } }),
      decisionClient,
      calendar: {
        ...createFakeCalendar(),
        deleteEvent: async () => {
          deleteCalled = true;
          return { ok: true, data: { eventId: "evt_hallucinated" } };
        },
      },
    });

    expect(result).toMatchObject({ ok: false, actionType: "rejected", requestId: "req_model_delete_event_id_rejected" });
    expect(result.reply).toContain("工具 Schema 未通过");
    expect(deleteCalled).toBe(false);
  });

  it("rejects legacy delete action JSON from model path before calendar delete", async () => {
    let deleteCalled = false;
    const decisionClient = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          action: "delete_event",
          target: { kind: "last_event", eventId: "evt_wrong" },
        }),
      }),
    });

    const result = await handleCalendarAgentRequest({
      text: "删掉刚才那个",
      requestId: "legacy_delete_action_model_path",
      state: createShortTermStateStore({ last_event: { eventId: "evt_real", title: "电话会" } }),
      decisionClient,
      calendar: {
        ...createFakeCalendar(),
        async deleteEvent() {
          deleteCalled = true;
          return { ok: true, data: { eventId: "evt_wrong" } };
        },
      },
    });

    expect(result).toMatchObject({ ok: false, actionType: "rejected" });
    expect(result.reply).toContain("工具 Schema 未通过");
    expect(deleteCalled).toBe(false);
  });

  it("rejects legacy confirm delete action JSON from model path before calendar delete", async () => {
    let deleteCalled = false;
    const decisionClient = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          action: "confirm_delete",
          confirmed: true,
        }),
      }),
    });

    const result = await handleCalendarAgentRequest({
      text: "请执行确认删除",
      requestId: "legacy_confirm_delete_action_model_path",
      state: createShortTermStateStore({ pending_delete: { eventId: "evt_real", title: "电话会", source: "last_event" } }),
      decisionClient,
      calendar: {
        ...createFakeCalendar(),
        async deleteEvent() {
          deleteCalled = true;
          return { ok: true, data: { eventId: "evt_wrong" } };
        },
      },
    });

    expect(result).toMatchObject({ ok: false, actionType: "rejected" });
    expect(result.reply).toContain("工具 Schema 未通过");
    expect(deleteCalled).toBe(false);
  });
});
