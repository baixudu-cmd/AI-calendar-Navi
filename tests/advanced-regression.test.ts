// 进阶回归测试：验证场景目录、runner 基础行为和最终状态校验合同。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runAdvancedRegression, formatAdvancedRegressionReport } from "../src/live/advanced-regression.js";
import {
  advancedRegressionCategories,
  advancedRegressionScenarios,
  type AdvancedRegressionCategory,
  type AdvancedRegressionScenario,
} from "../src/live/advanced-regression-cases.js";
import { selectAdvancedRegressionScenarios } from "../src/live/advanced-regression-variants.js";
import type { DecisionClient } from "../src/decision/index.js";

describe("advanced regression", () => {
  it("defines the 100-scenario advanced catalog with required category coverage", () => {
    expect(advancedRegressionScenarios).toHaveLength(100);
    expect(new Set(advancedRegressionScenarios.map((scenario) => scenario.id)).size).toBe(100);
    expect(countByCategory()).toEqual({
      briefing_title_update: 6,
      briefing_time_update: 6,
      evening_briefing_update: 6,
      last_event_time_update: 6,
      last_event_title_update: 6,
      delete_confirm: 5,
      delete_cancel: 5,
      create_draft_clarification: 8,
      batch_create_context: 6,
      mixed_create_schedule: 6,
      schedule_context: 18,
      todo_auto_schedule: 7,
      todo_inbox_management: 15,
    });
  });

  it("keeps every advanced scenario ready for final fake-calendar checks", () => {
    for (const scenario of advancedRegressionScenarios) {
      expect(advancedRegressionCategories).toContain(scenario.category);
      expect(scenario.steps.length).toBeGreaterThan(0);
      expect(scenario.expectedFinalEvents).toBeDefined();
      for (const step of scenario.steps) {
        if (!step.expectedEventsAfterStep) continue;
        expect(step.expectedEventsAfterStep.length).toBeGreaterThan(0);
      }
      for (const event of scenario.expectedFinalEvents) {
        expect(event).toEqual({
          id: expect.any(String),
          title: expect.any(String),
          ...(event.titles ? { titles: expect.arrayContaining([expect.any(String)]) } : {}),
          date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          startTime: expect.stringMatching(/^\d{2}:\d{2}$/),
          ...(event.startTimes ? { startTimes: expect.arrayContaining([expect.stringMatching(/^\d{2}:\d{2}$/)]) } : {}),
        });
        for (const title of event.titles || []) expect(title.trim().length).toBeGreaterThan(0);
        for (const startTime of event.startTimes || []) expect(startTime).toMatch(/^\d{2}:\d{2}$/);
      }
      for (const item of scenario.expectedFinalSeedItems || []) {
        const targetDates = item.targetDates || (item.targetDate ? [item.targetDate] : []);
        expect(item).toEqual({
          seedId: expect.any(String),
          title: expect.any(String),
          ...(item.targetDate ? { targetDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } : {}),
          ...(item.targetDates ? { targetDates: expect.arrayContaining([expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)]) } : {}),
          ...(item.reminderAt !== undefined ? { reminderAt: item.reminderAt === null ? null : expect.any(String) } : {}),
        });
        for (const targetDate of targetDates) expect(targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("can rotate advanced scenario wording while preserving ids and expectations", () => {
    const variants = selectAdvancedRegressionScenarios({ seed: "round-2" });

    expect(variants).toHaveLength(100);
    expect(variants.map((scenario) => scenario.id)).toEqual(advancedRegressionScenarios.map((scenario) => scenario.id));
    expect(variants.map((scenario) => scenario.category)).toEqual(advancedRegressionScenarios.map((scenario) => scenario.category));
    expect(variants.map((scenario) => scenario.expectedFinalEvents)).toEqual(
      advancedRegressionScenarios.map((scenario) => scenario.expectedFinalEvents),
    );
    expect(countChangedStepTexts(variants)).toBeGreaterThanOrEqual(100);
  });

  it("keeps rotated briefing time prompts broad enough for all-day events", () => {
    const variants = selectAdvancedRegressionScenarios({ seed: "round-2" });
    const briefingTimeOpeners = variants
      .filter((scenario) => scenario.category === "briefing_time_update")
      .map((scenario) => scenario.steps[0].text);

    expect(briefingTimeOpeners.every((text) => text.includes("早报"))).toBe(true);
    expect(briefingTimeOpeners.every((text) => !text.includes("早上") && !text.includes("上午"))).toBe(true);
  });

  it("runs advanced scenarios without a real Feishu calendar", async () => {
    const scenario = findScenario("advanced_briefing_title_001");
    const result = await runAdvancedRegression({
      scenarios: [scenario],
      decisionClient: createScriptedDecisionClient([
        { action: "daily_briefing", briefingType: "morning" },
        {
          type: "update_event",
          target: { kind: "briefing_item", itemNumber: 1 },
          patch: { title: "投委会预沟通" },
        },
      ]),
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(result.failures).toEqual([]);
  });

  it("classifies wrong advanced action without exposing every case detail", async () => {
    const scenario = findScenario("advanced_briefing_title_001");
    const result = await runAdvancedRegression({
      scenarios: [scenario],
      decisionClient: createScriptedDecisionClient([
        { action: "list_events", date: "2026-05-08" },
        { action: "list_events", date: "2026-05-08" },
      ]),
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(result.summary).toEqual({ total: 1, passed: 0, failed: 1 });
    expect(result.failures[0]).toMatchObject({ family: "model_intent" });
    expect(formatAdvancedRegressionReport(result)).toContain("Advanced regression: failed");
    expect(formatAdvancedRegressionReport(result)).toContain("- model_intent: 1");
  });

  it("classifies final event mismatch as a calendar_api failure", async () => {
    const scenario = withFinalEvents(findScenario("advanced_last_event_title_001"), [
      { id: "evt_lh_001", title: "见李总", date: "2026-05-08", startTime: "10:00" },
    ]);

    const result = await runAdvancedRegression({
      scenarios: [scenario],
      decisionClient: createScriptedDecisionClient([
        {
          type: "update_event",
          target: { kind: "last_event" },
          patch: { title: "见王总" },
        },
      ]),
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(result.summary).toEqual({ total: 1, passed: 0, failed: 1 });
    expect(result.failures[0]).toMatchObject({ family: "calendar_api" });
  });

  it("checks delete request intermediate state before confirmation", async () => {
    const baseScenario = findScenario("advanced_delete_confirm_001");
    const scenario: AdvancedRegressionScenario = {
      ...baseScenario,
      steps: [
        { ...baseScenario.steps[0], expectedEventsAfterStep: [] },
        ...baseScenario.steps.slice(1),
      ],
    };

    const result = await runAdvancedRegression({
      scenarios: [scenario],
      decisionClient: createScriptedDecisionClient([{ type: "request_delete_event", target: { kind: "last_event" } }]),
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(result.summary).toEqual({ total: 1, passed: 0, failed: 1 });
    expect(result.failures[0]).toMatchObject({ family: "calendar_api" });
  });

  it("runs an incomplete create draft scenario through clarification and final creation", async () => {
    const scenario = findScenario("advanced_create_draft_001");
    const result = await runAdvancedRegression({
      scenarios: [scenario],
      decisionClient: createScriptedDecisionClient([
        {
          action: "create_event",
          event: { title: "约张总开会", date: "2026-05-09" },
        },
        {
          action: "create_event",
          event: { startTime: "10:00" },
        },
      ]),
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(result.failures).toEqual([]);
  });

  it("runs a natural todo auto-schedule scenario through final creation", async () => {
    const scenario = findScenario("advanced_todo_auto_schedule_001");
    const result = await runAdvancedRegression({
      scenarios: [scenario],
      decisionClient: createScriptedDecisionClient([
        {
          type: "remember_todo",
          title: "拿币",
          autoSchedule: true,
        },
      ]),
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(result.failures).toEqual([]);
  });

  it("runs todo inbox management without touching the fake calendar", async () => {
    const scenario = findScenario("advanced_todo_inbox_002");
    const result = await runAdvancedRegression({
      scenarios: [scenario],
      decisionClient: createScriptedDecisionClient([
        {
          type: "manage_todos",
          operation: "complete",
          target: { title: "拿币" },
        },
      ]),
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(result.failures).toEqual([]);
  });

  it("runs batch todo inbox completion without touching the fake calendar", async () => {
    const scenario = findScenario("advanced_todo_inbox_005");
    const result = await runAdvancedRegression({
      scenarios: [scenario],
      decisionClient: createScriptedDecisionClient([
        {
          type: "manage_todos",
          operation: "complete",
          target: { itemNumbers: [1, 3] },
        },
      ]),
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(result.failures).toEqual([]);
  });

  it("runs batch create context and updates the second created event", async () => {
    const scenario = findScenario("advanced_batch_create_context_001");
    const result = await runAdvancedRegression({
      scenarios: [scenario],
      decisionClient: createScriptedDecisionClient([
        {
          type: "create_events",
          events: [
            { title: "投委会", date: "2026-05-09", startTime: "09:00" },
            { title: "客户电话", date: "2026-05-09", startTime: "14:00" },
          ],
        },
        {
          type: "update_event",
          target: { kind: "briefing_item", itemNumber: 2 },
          patch: { startTime: "15:00" },
        },
      ]),
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(result.failures).toEqual([]);
  });

  it("runs schedule recommendation context through proposal and selection", async () => {
    const scenario = findScenario("advanced_schedule_context_001");
    const result = await runAdvancedRegression({
      scenarios: [scenario],
      decisionClient: createScriptedDecisionClient([
        {
          type: "propose_schedule",
          date: "2026-05-09",
          items: [{ title: "看锐盟材料" }],
        },
        {
          type: "confirm_schedule",
          confirmed: true,
          optionNumber: 2,
        },
      ]),
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(result.failures).toEqual([]);
  });

  it("runs schedule reproposal context before final selection", async () => {
    const scenario = findScenario("advanced_schedule_context_004");
    const result = await runAdvancedRegression({
      scenarios: [scenario],
      decisionClient: createScriptedDecisionClient([
        {
          type: "propose_schedule",
          date: "2026-05-09",
          items: [{ title: "整理投委会材料" }],
        },
        {
          type: "propose_schedule",
          preferredStartTime: "14:00",
          contextRef: "pending_schedule",
        },
        {
          type: "confirm_schedule",
          confirmed: true,
          optionNumber: 1,
        },
      ]),
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(result.failures).toEqual([]);
  });

  it("accepts raw list output for a natural tomorrow-arrangement opener if follow-up remains editable", async () => {
    const scenario = findScenario("advanced_evening_briefing_003");
    const result = await runAdvancedRegression({
      scenarios: [scenario],
      decisionClient: createScriptedDecisionClient([
        { action: "list_events", date: "2026-05-09" },
        {
          type: "update_event",
          target: { kind: "briefing_item", itemNumber: 1 },
          patch: { title: "项目复盘会" },
        },
      ]),
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(result.failures).toEqual([]);
  });

  it("accepts next-week todo target dates when the wording does not specify a weekday", async () => {
    const scenario = findScenario("advanced_todo_inbox_004");
    const result = await runAdvancedRegression({
      scenarios: [scenario],
      decisionClient: createScriptedDecisionClient([
        {
          type: "manage_todos",
          operation: "update",
          target: { itemNumber: 1 },
          patch: { targetDate: "2026-05-15" },
        },
      ]),
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(result.failures).toEqual([]);
  });

  it("accepts a bounded set of final event titles when the model compresses a natural task title", async () => {
    const scenario = findScenario("advanced_schedule_context_005");
    const result = await runAdvancedRegression({
      scenarios: [scenario],
      decisionClient: createScriptedDecisionClient([
        {
          type: "propose_schedule",
          date: "2026-05-08",
          items: [{ title: "拿币" }],
        },
        {
          type: "propose_schedule",
          date: "2026-05-09",
          items: [],
          contextRef: "pending_schedule",
        },
        {
          type: "confirm_schedule",
          confirmed: true,
          optionNumber: 1,
        },
      ]),
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(result.failures).toEqual([]);
  });

  it("expects no-reminder wording to keep the todo and clear only reminder metadata", async () => {
    const scenario = findScenario("advanced_todo_inbox_003");
    const result = await runAdvancedRegression({
      scenarios: [scenario],
      decisionClient: createScriptedDecisionClient([
        {
          type: "manage_todos",
          operation: "update",
          target: { itemNumber: 2 },
          patch: { clearReminder: true },
        },
      ]),
      now: "2026-05-08T09:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(result.failures).toEqual([]);
  });

  it("keeps the advanced regression CLI away from real Feishu, WeChat, OpenClaw, and legacy action paths", () => {
    const source = readFileSync(new URL("../src/live/advanced-regression-cli.ts", import.meta.url), "utf8");

    expect(source).not.toContain("../calendar/feishu/live");
    expect(source).not.toContain("../openclaw/");
    expect(source).not.toContain("openclaw");
    expect(source).not.toContain("wechat");
    expect(source).not.toContain("legacy-action");
    expect(source).not.toContain("action-compat");
  });
});

function countByCategory(): Record<AdvancedRegressionCategory, number> {
  return advancedRegressionScenarios.reduce(
    (acc, scenario) => {
      acc[scenario.category] += 1;
      return acc;
    },
    Object.fromEntries(advancedRegressionCategories.map((category) => [category, 0])) as Record<AdvancedRegressionCategory, number>,
  );
}

function countChangedStepTexts(variants: AdvancedRegressionScenario[]): number {
  return variants.reduce((count, scenario, scenarioIndex) => {
    const baseScenario = advancedRegressionScenarios[scenarioIndex];
    return (
      count +
      scenario.steps.filter((step, stepIndex) => step.text !== baseScenario.steps[stepIndex]?.text).length
    );
  }, 0);
}

function findScenario(id: string): AdvancedRegressionScenario {
  const scenario = advancedRegressionScenarios.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`没有找到进阶场景：${id}`);
  return scenario;
}

function withFinalEvents(
  scenario: AdvancedRegressionScenario,
  expectedFinalEvents: AdvancedRegressionScenario["expectedFinalEvents"],
): AdvancedRegressionScenario {
  return { ...scenario, expectedFinalEvents };
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
