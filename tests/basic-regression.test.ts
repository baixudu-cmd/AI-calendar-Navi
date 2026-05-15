import { describe, expect, it } from "vitest";
import { BASIC_REGRESSION_NOW, basicRegressionCases, selectBasicRegressionCases } from "../src/live/basic-regression-cases.js";
import {
  classifyRegressionFailure,
  formatBasicRegressionReport,
  runBasicRegression,
} from "../src/live/basic-regression.js";
import type { CalendarAdapter } from "../src/calendar/action-executor.js";
import type { DecisionClient } from "../src/decision/index.js";

function createThrowingCalendar(): CalendarAdapter {
  return {
    async createEvent() {
      throw new Error("calendar should not be called");
    },
    async listEvents() {
      throw new Error("calendar should not be called");
    },
    async updateEvent() {
      throw new Error("calendar should not be called");
    },
    async deleteEvent() {
      throw new Error("calendar should not be called");
    },
  };
}

describe("basic real regression", () => {
  it("defines at least 40 finance-style base cases across basic action categories", () => {
    const basicCases = selectBasicRegressionCases({ stage: "basic" });

    expect(basicCases.length).toBeGreaterThanOrEqual(40);
    expect(new Set(basicCases.map((testCase) => testCase.expected.type))).toEqual(
      new Set(["create_event", "list_events", "update_event", "daily_briefing"]),
    );
    expect(new Set(basicCases.map((testCase) => testCase.stage))).toEqual(new Set(["basic"]));
    expect(basicCases.some((testCase) => testCase.text.includes("投委会"))).toBe(true);
    expect(basicCases.some((testCase) => testCase.text.includes("路演"))).toBe(true);
    expect(BASIC_REGRESSION_NOW).toBe("2026-05-08T09:00:00+08:00");
    expect(basicCases.find((testCase) => testCase.id === "create_001")?.expected.date).toBe("2026-05-09");
    expect(basicCases.find((testCase) => testCase.id === "create_002")?.expected.date).toBe("2026-05-08");
    expect(
      basicCases
        .filter((testCase) => testCase.expected.type === "update_event" && Boolean(testCase.expected.startTime))
        .every((testCase) => Boolean(testCase.initialState?.last_event?.date)),
      ).toBe(true);
  });

  it("can rotate wording while preserving basic categories and expectations", () => {
    const baseCases = selectBasicRegressionCases({ stage: "basic" });
    const rotated = selectBasicRegressionCases({ stage: "basic", seed: "seed-a" });

    expect(rotated).toHaveLength(baseCases.length);
    expect(rotated.map((testCase) => testCase.id)).toEqual(baseCases.map((testCase) => testCase.id));
    expect(rotated.map((testCase) => testCase.stage)).toEqual(baseCases.map((testCase) => testCase.stage));
    expect(rotated.map((testCase) => testCase.expected)).toEqual(baseCases.map((testCase) => testCase.expected));
    expect(rotated.map((testCase) => testCase.initialState)).toEqual(baseCases.map((testCase) => testCase.initialState));
    expect(rotated.some((testCase, index) => testCase.text !== baseCases[index]?.text)).toBe(true);
  });

  it("keeps advanced regression out of the single-message basic runner", () => {
    expect(selectBasicRegressionCases({ stage: "advanced" })).toEqual([]);
  });

  it("keeps daily briefing cases clearly summary-oriented instead of raw list wording", () => {
    const briefingCases = selectBasicRegressionCases({ stage: "basic" }).filter(
      (testCase) => testCase.expected.type === "daily_briefing",
    );

    expect(
      briefingCases.every((testCase) => ["早报", "晚报", "总览", "复盘"].some((cue) => testCase.text.includes(cue))),
    ).toBe(true);
  });

  it("runs model-only regression without calling calendar", async () => {
    const decisionClient: DecisionClient = {
      decide: async (request) => {
        if (request.text.includes("明天7点")) {
          return { action: "create_event", event: { title: "开会", date: "2026-05-09", startTime: "07:00" } };
        }
        return { action: "list_events", date: "2026-05-09" };
      },
    };

    const result = await runBasicRegression({
      cases: [
        {
          id: "create_meeting",
          text: "我明天7点开会，记录一下",
          expected: { type: "create_event", titleIncludes: "开会", date: "2026-05-09", startTime: "07:00" },
        },
        {
          id: "list_tomorrow",
          text: "查一下明天日程",
          expected: { type: "list_events", date: "2026-05-09" },
        },
      ],
      decisionClient,
      calendar: createThrowingCalendar(),
      executeCalendar: false,
    });

    expect(result.summary).toEqual({ total: 2, passed: 2, failed: 0 });
    expect(result.failures).toEqual([]);
  });

  it("treats time-only update patches as valid when last_event state has the date", async () => {
    const result = await runBasicRegression({
      cases: [
        {
          id: "update_time_from_state",
          text: "刚才那个饭局改到晚上9点",
          initialState: { last_event: { eventId: "evt_1", title: "饭局", date: "2026-05-08", startTime: "20:00" } },
          expected: { type: "update_event", date: "2026-05-08", startTime: "21:00" },
        },
      ],
      decisionClient: {
        decide: async () => ({
          type: "update_event",
          target: { kind: "last_event" },
          patch: { startTime: "21:00" },
        }),
      },
      calendar: createThrowingCalendar(),
      executeCalendar: false,
    });

    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
  });

  it("accepts equivalent title keywords for rotated wording", async () => {
    const result = await runBasicRegression({
      cases: [
        {
          id: "rotated_title",
          text: "明天早上7点有个会，帮我记上",
          expected: { type: "create_event", titleIncludes: ["开会", "会"], date: "2026-05-09", startTime: "07:00" },
        },
      ],
      decisionClient: {
        decide: async () => ({
          action: "create_event",
          event: { title: "有个会", date: "2026-05-09", startTime: "07:00" },
        }),
      },
      calendar: createThrowingCalendar(),
      executeCalendar: false,
    });

    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
  });

  it("still rejects titles outside the allowed equivalent keywords", async () => {
    const result = await runBasicRegression({
      cases: [
        {
          id: "wrong_rotated_title",
          text: "明天早上7点有个会，帮我记上",
          expected: { type: "create_event", titleIncludes: ["开会", "会"], date: "2026-05-09", startTime: "07:00" },
        },
      ],
      decisionClient: {
        decide: async () => ({
          action: "create_event",
          event: { title: "吃饭", date: "2026-05-09", startTime: "07:00" },
        }),
      },
      calendar: createThrowingCalendar(),
      executeCalendar: false,
    });

    expect(result.summary).toEqual({ total: 1, passed: 0, failed: 1 });
    expect(result.failures[0]).toMatchObject({ family: "title_extraction" });
  });

  it("emits ordered progress events without exposing case text", async () => {
    const events: unknown[] = [];

    const result = await runBasicRegression({
      cases: [
        {
          id: "progress_pass",
          text: "明天7点开会，记录一下",
          expected: { type: "create_event", titleIncludes: "开会", date: "2026-05-09", startTime: "07:00" },
        },
        {
          id: "progress_fail",
          text: "查一下明天日程",
          expected: { type: "list_events", date: "2026-05-09" },
        },
      ],
      decisionClient: {
        decide: async (request) => {
          if (request.text.includes("7点")) {
            return { action: "create_event", event: { title: "开会", date: "2026-05-09", startTime: "07:00" } };
          }
          return { action: "create_event", event: { title: "错误", date: "2026-05-10", startTime: "09:00" } };
        },
      },
      calendar: createThrowingCalendar(),
      executeCalendar: false,
      onProgress: (progress) => events.push(progress),
    });

    expect(result.summary).toEqual({ total: 2, passed: 1, failed: 1 });
    expect(events).toEqual([
      { index: 1, total: 2, caseId: "progress_pass", status: "started" },
      { index: 1, total: 2, caseId: "progress_pass", status: "passed" },
      { index: 2, total: 2, caseId: "progress_fail", status: "started" },
      { index: 2, total: 2, caseId: "progress_fail", status: "failed", family: "model_intent" },
    ]);
    expect(JSON.stringify(events)).not.toContain("明天7点开会");
    expect(JSON.stringify(events)).not.toContain("查一下明天日程");
  });

  it("classifies wrong action type as model intent failure", async () => {
    const result = await runBasicRegression({
      cases: [
        {
          id: "wrong_action",
          text: "我晚上8点吃个饭",
          expected: { type: "create_event", titleIncludes: "饭", date: "2026-05-08", startTime: "20:00" },
        },
      ],
      decisionClient: { decide: async () => ({ action: "list_events", date: "2026-05-08" }) },
      calendar: createThrowingCalendar(),
      executeCalendar: false,
    });

    expect(result.summary).toEqual({ total: 1, passed: 0, failed: 1 });
    expect(result.failures[0]).toMatchObject({ family: "model_intent" });
  });

  it("classifies malformed decisions as contract failures", async () => {
    const result = await runBasicRegression({
      cases: [
        {
          id: "bad_contract",
          text: "明天见张总",
          expected: { type: "create_event", titleIncludes: "张总" },
        },
      ],
      decisionClient: { decide: async () => ({ notAction: "create_event" }) },
      calendar: createThrowingCalendar(),
      executeCalendar: false,
    });

    expect(result.failures[0]).toMatchObject({ family: "contract" });
  });

  it("classifies model tool schema rejection as tool_schema failure", async () => {
    const result = await runBasicRegression({
      cases: [
        {
          id: "tool_schema_rejected",
          text: "明天见张总",
          expected: { type: "create_event", titleIncludes: "张总" },
        },
      ],
      decisionClient: {
        decide: async () => ({
          action: "__tool_schema_rejected__",
          reason: "missing_arguments",
          error: "缺少参数：date",
        }),
      },
      calendar: createThrowingCalendar(),
      executeCalendar: false,
    });

    expect(result.failures[0]).toMatchObject({ family: "tool_schema" });
  });

  it("classifies tool schema failures separately from model intent failures", async () => {
    expect(classifyRegressionFailure({ reason: "tool_schema_rejected" })).toBe("tool_schema");
    expect(classifyRegressionFailure({ reason: "unknown_tool" })).toBe("tool_schema");
    expect(classifyRegressionFailure({ reason: "missing_arguments" })).toBe("tool_schema");
    expect(classifyRegressionFailure({ reason: "invalid_arguments" })).toBe("tool_schema");
    expect(classifyRegressionFailure({ reason: "guard_rejected" })).toBe("tool_schema");
  });

  it("continues and classifies a timed out model decision", async () => {
    const result = await runBasicRegression({
      cases: [
        {
          id: "slow_model",
          text: "明天7点开会",
          expected: { type: "create_event", titleIncludes: "开会", date: "2026-05-09", startTime: "07:00" },
        },
        {
          id: "normal_model",
          text: "查一下明天日程",
          expected: { type: "list_events", date: "2026-05-09" },
        },
      ],
      decisionClient: {
        decide: async (request) => {
          if (request.text.includes("7点")) {
            return new Promise(() => {});
          }
          return { action: "list_events", date: "2026-05-09" };
        },
      },
      calendar: createThrowingCalendar(),
      executeCalendar: false,
      perCaseTimeoutMs: 5,
    });

    expect(result.summary).toEqual({ total: 2, passed: 1, failed: 1 });
    expect(result.failures[0]).toMatchObject({
      caseId: "slow_model",
      family: "model_timeout",
      actionType: "timeout",
    });
  });

  it("continues and classifies a thrown model error", async () => {
    const result = await runBasicRegression({
      cases: [
        {
          id: "provider_error",
          text: "我晚上8点吃个饭",
          expected: { type: "create_event", titleIncludes: "饭", date: "2026-05-08", startTime: "20:00" },
        },
        {
          id: "normal_after_error",
          text: "查一下明天日程",
          expected: { type: "list_events", date: "2026-05-09" },
        },
      ],
      decisionClient: {
        decide: async (request) => {
          if (request.text.includes("吃个饭")) {
            throw new Error("模型服务调用超时，请检查 provider 响应速度。");
          }
          return { action: "list_events", date: "2026-05-09" };
        },
      },
      calendar: createThrowingCalendar(),
      executeCalendar: false,
      perCaseTimeoutMs: 50,
    });

    expect(result.summary).toEqual({ total: 2, passed: 1, failed: 1 });
    expect(result.failures[0]).toMatchObject({
      caseId: "provider_error",
      family: "model_timeout",
      actionType: "model_error",
    });
  });

  it("redacts model error text in regression reports", () => {
    const report = formatBasicRegressionReport({
      summary: { total: 1, passed: 0, failed: 1 },
      failures: [
        {
          caseId: "provider_error",
          text: "我晚上8点吃个饭",
          family: "model_timeout",
          message: "模型服务调用超时，请检查 provider 响应速度。",
          actionType: "model_error",
        },
      ],
    });

    expect(report).toContain("model_timeout: 1");
    expect(report).not.toContain("我晚上8点吃个饭");
    expect(report).not.toContain("provider_error");
  });

  it("formats concise report with pass/fail counts and failure families", () => {
    const report = formatBasicRegressionReport({
      summary: { total: 2, passed: 1, failed: 1 },
      failures: [
        {
          caseId: "case_1",
          text: "明天见张总",
          family: "time_extraction",
          message: "date mismatch",
          actionType: "create_event",
        },
      ],
    });

    expect(report).toContain("Basic regression: failed");
    expect(report).toContain("Passed: 1");
    expect(report).toContain("Failed: 1");
    expect(report).toContain("time_extraction: 1");
    expect(report).not.toContain("secret");
  });

  it("classifies field mismatches without prescribing regex patches", () => {
    expect(classifyRegressionFailure({ expectedField: "date", actualActionType: "create_event" })).toBe("time_extraction");
    expect(classifyRegressionFailure({ expectedField: "title", actualActionType: "create_event" })).toBe("title_extraction");
    expect(classifyRegressionFailure({ expectedField: "unknown", actualActionType: "clarify" })).toBe("clarification");
    expect(classifyRegressionFailure({ reason: "model_timeout" })).toBe("model_timeout");
  });
});
