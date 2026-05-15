// 进阶飞书 smoke 测试：验证 runner 只走测试日历、API Bridge 和 calendar-api。

import { describe, expect, it } from "vitest";
import type { DeterministicCalendarAdapter } from "../src/calendar-api/index.js";
import type { EventDraft } from "../src/contract/index.js";
import type { DecisionClient } from "../src/decision/index.js";
import {
  DEFAULT_ADVANCED_FEISHU_SMOKE_DATE,
  createDefaultAdvancedFeishuSmokeScenarios,
  runAdvancedFeishuSmoke,
  formatAdvancedFeishuSmokeReport,
} from "../src/live/advanced-feishu-smoke.js";

const passedConfig = {
  appName: "minical-agent",
  timezone: "Asia/Shanghai",
  modelProvider: "openai-compatible",
  modelBaseUrl: "https://example.test/v1",
  modelApiKey: "secret-model-key",
  modelName: "fake-model",
  feishuAppId: "app-id",
  feishuAppSecret: "secret-feishu-key",
  feishuCalendarId: "test-calendar-id",
  feishuTestCalendarId: "test-calendar-id",
  openclawWorkspace: "/home/example/.openclaw",
  wechatEntrySecret: "secret-wechat-key",
};

describe("advanced Feishu smoke runner", () => {
  it("uses a dedicated default smoke date instead of today's real calendar date", () => {
    expect(DEFAULT_ADVANCED_FEISHU_SMOKE_DATE).toBe("2026-05-20");
  });

  it("includes create draft clarification in the default smoke scenarios", () => {
    const scenarios = createDefaultAdvancedFeishuSmokeScenarios("2026-05-08");

    expect(scenarios).toHaveLength(4);
    expect(scenarios.find((scenario) => scenario.id === "create-draft-clarification")).toMatchObject({
      seedEvents: [],
      steps: ["明天约张总开会", "上午10点"],
      expectedStepActions: ["clarify", "create_event"],
      expectedFinalEvents: [{ title: "约张总开会", date: "2026-05-09", startTime: "10:00" }],
    });
  });

  it("updates a briefing item title through Calendar Agent and cleans up the created event", async () => {
    const adapter = createRecordingAdapter();
    const result = await runAdvancedFeishuSmoke({
      adapter,
      config: passedConfig,
      decisionClient: createScriptedDecisionClient([
        { action: "daily_briefing", briefingType: "morning" },
        {
          type: "update_event",
          target: { kind: "briefing_item", itemNumber: 1 },
          patch: { title: "投委会预沟通" },
        },
      ]),
      scenarios: [
        {
          id: "briefing-title",
          date: "2026-05-08",
          seedEvents: [{ title: "投委会", date: "2026-05-08", startTime: "09:00" }],
          steps: ["发我今天早报", "把第1条改成投委会预沟通"],
          expectedFinalEvents: [{ title: "投委会预沟通", date: "2026-05-08", startTime: "09:00" }],
        },
      ],
      today: "2026-05-08",
      now: "2026-05-08T09:00:00+08:00",
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(adapter.snapshot()).toEqual([]);
    expect(adapter.calls).toEqual([
      "list:2026-05-08",
      "create:投委会",
      "list:2026-05-08",
      "update:evt_1",
      "list:2026-05-08",
      "delete:evt_1",
    ]);
  });

  it("can run the briefing update through the controlled shadow HTTP route", async () => {
    const adapter = createRecordingAdapter();
    const result = await runAdvancedFeishuSmoke({
      adapter,
      config: passedConfig,
      decisionClient: createScriptedDecisionClient([
        { action: "daily_briefing", briefingType: "morning" },
        {
          type: "update_event",
          target: { kind: "briefing_item", itemNumber: 1 },
          patch: { title: "投委会预沟通" },
        },
      ]),
      scenarios: [
        {
          id: "shadow-briefing-title",
          date: "2026-05-08",
          seedEvents: [{ title: "投委会", date: "2026-05-08", startTime: "09:00" }],
          steps: ["发我今天早报", "把第1条改成投委会预沟通"],
          expectedFinalEvents: [{ title: "投委会预沟通", date: "2026-05-08", startTime: "09:00" }],
        },
      ],
      today: "2026-05-08",
      now: "2026-05-08T09:00:00+08:00",
      useShadowRoute: true,
      shadowSecret: "shadow-test-secret",
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(result.steps.filter((step) => step.name === "agent").map((step) => step.message)).toEqual([
      "daily_briefing",
      "update_event",
    ]);
    expect(adapter.snapshot()).toEqual([]);
    expect(adapter.calls).toEqual([
      "list:2026-05-08",
      "create:投委会",
      "list:2026-05-08",
      "update:evt_1",
      "list:2026-05-08",
      "delete:evt_1",
    ]);
  });

  it("injects deterministic now from the smoke date when no explicit now is provided", async () => {
    const adapter = createRecordingAdapter();
    const seenNow: Array<string | undefined> = [];
    const result = await runAdvancedFeishuSmoke({
      adapter,
      config: passedConfig,
      decisionClient: {
        decide: async (request) => {
          seenNow.push(request.now);
          return { action: "list_events", date: "2026-05-08" };
        },
      },
      scenarios: [
        {
          id: "deterministic-now",
          date: "2026-05-08",
          seedEvents: [],
          steps: ["查一下今天日程"],
          expectedStepActions: ["list_events"],
          expectedFinalEvents: [],
        },
      ],
      today: "2026-05-08",
    });

    expect(result.ok).toBe(true);
    expect(seenNow).toEqual(["2026-05-08T09:00:00+08:00"]);
  });

  it("confirms deleting the last event and does not try to clean up an already deleted event", async () => {
    const adapter = createRecordingAdapter();
    const result = await runAdvancedFeishuSmoke({
      adapter,
      config: passedConfig,
      decisionClient: createScriptedDecisionClient([
        { type: "request_delete_event", target: { kind: "last_event" } },
        { type: "confirm_delete", confirmed: true },
      ]),
      scenarios: [
        {
          id: "delete-confirm",
          date: "2026-05-08",
          initialLastEventIndex: 0,
          seedEvents: [{ title: "电话会", date: "2026-05-08", startTime: "10:00" }],
          steps: ["删掉刚才那个", "确认删除"],
          expectedFinalEvents: [],
        },
      ],
      today: "2026-05-08",
      now: "2026-05-08T09:00:00+08:00",
    });

    expect(result.ok).toBe(true);
    expect(adapter.snapshot()).toEqual([]);
    expect(adapter.calls).toEqual(["list:2026-05-08", "create:电话会", "delete:evt_1", "list:2026-05-08"]);
  });

  it("cancels deleting the last event and cleanup deletes only this run's created event", async () => {
    const adapter = createRecordingAdapter([{ id: "external_1", title: "外部日程", date: "2026-05-08", startTime: "08:00" }]);
    const result = await runAdvancedFeishuSmoke({
      adapter,
      config: passedConfig,
      decisionClient: createScriptedDecisionClient([
        { type: "request_delete_event", target: { kind: "last_event" } },
        { type: "confirm_delete", confirmed: false },
      ]),
      scenarios: [
        {
          id: "delete-cancel",
          date: "2026-05-08",
          initialLastEventIndex: 0,
          seedEvents: [{ title: "客户晚餐", date: "2026-05-08", startTime: "19:00" }],
          steps: ["删掉刚才那个", "取消"],
          expectedFinalEvents: [{ title: "客户晚餐", date: "2026-05-08", startTime: "19:00" }],
        },
      ],
      today: "2026-05-08",
      now: "2026-05-08T09:00:00+08:00",
    });

    expect(result.ok).toBe(true);
    expect(adapter.snapshot()).toEqual([{ id: "external_1", title: "外部日程", start: "2026-05-08 08:00" }]);
    expect(adapter.calls).toEqual(["list:2026-05-08", "create:客户晚餐", "list:2026-05-08", "delete:evt_2"]);
  });

  it("tracks, verifies, and cleans up an event created by the agent during create draft clarification", async () => {
    const adapter = createRecordingAdapter([{ id: "external_1", title: "外部日程", date: "2026-05-08", startTime: "08:00" }]);
    const result = await runAdvancedFeishuSmoke({
      adapter,
      config: passedConfig,
      decisionClient: createScriptedDecisionClient([
        { action: "create_event", event: { title: "张总会议", date: "2026-05-08" } },
        { action: "create_event", event: { startTime: "10:00" } },
      ]),
      scenarios: [
        {
          id: "create-draft",
          date: "2026-05-08",
          seedEvents: [],
          steps: ["明天约张总开会", "上午10点"],
          expectedStepActions: ["clarify", "create_event"],
          expectedFinalEvents: [{ title: "张总会议", date: "2026-05-08", startTime: "10:00" }],
        },
      ],
      today: "2026-05-08",
      now: "2026-05-08T09:00:00+08:00",
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(adapter.snapshot()).toEqual([{ id: "external_1", title: "外部日程", start: "2026-05-08 08:00" }]);
    expect(adapter.calls).toEqual(["list:2026-05-08", "list:2026-05-08", "create:张总会议", "list:2026-05-08", "delete:evt_2"]);
  });

  it("fails when a step returns the wrong action type and cleans up agent-created events", async () => {
    const adapter = createRecordingAdapter();
    const result = await runAdvancedFeishuSmoke({
      adapter,
      config: passedConfig,
      decisionClient: createScriptedDecisionClient([
        { action: "create_event", event: { title: "张总会议", date: "2026-05-08", startTime: "10:00" } },
      ]),
      scenarios: [
        {
          id: "create-draft-wrong-step",
          date: "2026-05-08",
          seedEvents: [],
          steps: ["明天约张总开会"],
          expectedStepActions: ["clarify"],
          expectedFinalEvents: [{ title: "张总会议", date: "2026-05-08", startTime: "10:00" }],
        },
      ],
      today: "2026-05-08",
      now: "2026-05-08T09:00:00+08:00",
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toEqual({ total: 1, passed: 0, failed: 1 });
    expect(result.failures[0]).toMatchObject({ scenarioId: "create-draft-wrong-step", family: "agent" });
    expect(adapter.snapshot()).toEqual([]);
    expect(adapter.calls).toEqual(["list:2026-05-08", "list:2026-05-08", "create:张总会议", "list:2026-05-08", "delete:evt_1"]);
  });

  it("fails when final Feishu state does not match expectation and still cleans up created events", async () => {
    const adapter = createRecordingAdapter();
    const result = await runAdvancedFeishuSmoke({
      adapter,
      config: passedConfig,
      decisionClient: createScriptedDecisionClient([{ action: "daily_briefing", briefingType: "morning" }]),
      scenarios: [
        {
          id: "final-mismatch",
          date: "2026-05-08",
          seedEvents: [{ title: "投委会", date: "2026-05-08", startTime: "09:00" }],
          steps: ["发我今天早报"],
          expectedFinalEvents: [{ title: "错误标题", date: "2026-05-08", startTime: "09:00" }],
        },
      ],
      today: "2026-05-08",
      now: "2026-05-08T09:00:00+08:00",
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toEqual({ total: 1, passed: 0, failed: 1 });
    expect(result.failures[0]).toMatchObject({ scenarioId: "final-mismatch", family: "final_state" });
    expect(adapter.snapshot()).toEqual([]);
    expect(formatAdvancedFeishuSmokeReport(result)).toContain("Advanced Feishu smoke: failed");
  });

  it("stops before calendar actions when live config gate fails", async () => {
    const adapter = createRecordingAdapter();
    const result = await runAdvancedFeishuSmoke({
      adapter,
      config: { ...passedConfig, feishuCalendarId: "primary" },
      decisionClient: createScriptedDecisionClient([]),
      scenarios: [],
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toEqual({ total: 0, passed: 0, failed: 1 });
    expect(result.failures[0]).toMatchObject({ scenarioId: "config", family: "config" });
    expect(adapter.calls).toEqual([]);
  });
});

type StoredEvent = { id: string; title: string; date: string; startTime: string };

function createRecordingAdapter(initialEvents: StoredEvent[] = []): DeterministicCalendarAdapter & {
  calls: string[];
  snapshot(): Array<{ id: string; title: string; start: string }>;
} {
  const calls: string[] = [];
  const events = initialEvents.map((event) => ({ ...event }));

  return {
    calls,
    async createEvent(event) {
      calls.push(`create:${event.title}`);
      const created = { id: `evt_${events.length + 1}`, title: event.title, date: event.date, startTime: event.startTime };
      events.push(created);
      return { ok: true, data: toFeishuEvent(created) };
    },
    async listEvents(input) {
      calls.push(`list:${input.date || input.range?.startDate || "all"}`);
      return {
        ok: true,
        data: events
          .filter((event) => {
            if (input.date) return event.date === input.date;
            if (input.range) return event.date >= input.range.startDate && event.date <= input.range.endDate;
            return true;
          })
          .map(toFeishuEvent),
      };
    },
    async updateEvent(input) {
      calls.push(`update:${input.eventId}`);
      const event = events.find((candidate) => candidate.id === input.eventId);
      if (!event) return { ok: false, code: "not_found", message: "没有找到日程。" };
      applyPatch(event, input.patch);
      return { ok: true, data: toFeishuEvent(event) };
    },
    async deleteEvent(input) {
      calls.push(`delete:${input.eventId}`);
      const index = events.findIndex((event) => event.id === input.eventId);
      if (index === -1) return { ok: false, code: "not_found", message: "没有找到日程。" };
      events.splice(index, 1);
      return { ok: true, data: { eventId: input.eventId } };
    },
    snapshot() {
      return events.map(toFeishuEvent);
    },
  };
}

function toFeishuEvent(event: StoredEvent) {
  return { id: event.id, title: event.title, start: `${event.date} ${event.startTime}` };
}

function applyPatch(event: StoredEvent, patch: Partial<EventDraft>) {
  if (patch.title) event.title = patch.title;
  if (patch.date) event.date = patch.date;
  if (patch.startTime) event.startTime = patch.startTime;
}

function createScriptedDecisionClient(decisions: unknown[]): DecisionClient {
  let index = 0;
  return {
    decide: async () => {
      const decision = decisions[index];
      index += 1;
      return decision;
    },
  };
}
