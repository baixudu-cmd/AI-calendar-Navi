// 进阶真实压测 runner：用真实模型和 fake calendar 验证状态链路，不写飞书。

import { handleCalendarAgentRequest } from "../agent-api/index.js";
import type { CalendarAdapter } from "../calendar/action-executor.js";
import type { FeishuCalendarEvent } from "../calendar/feishu/types.js";
import type { EventDraft } from "../contract/index.js";
import type { DecisionClient } from "../decision/index.js";
import { createShortTermStateStore } from "../state/index.js";
import {
  ADVANCED_REGRESSION_TODAY,
  type AdvancedFinalEventExpectation,
  type AdvancedFinalSeedExpectation,
  type AdvancedRegressionScenario,
  type AdvancedSeedEvent,
  type AdvancedStepExpectation,
} from "./advanced-regression-cases.js";
import type { RegressionFailureFamily } from "./basic-regression.js";
import { createMemorySeedLiteStore, type SeedLiteItem } from "../seed-lite/index.js";

export type AdvancedRegressionFailure = {
  scenarioId: string;
  stepIndex: number;
  family: RegressionFailureFamily;
  message: string;
  actionType?: string;
};

export type AdvancedRegressionResult = {
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  failures: AdvancedRegressionFailure[];
};

export type AdvancedRegressionProgress = {
  index: number;
  total: number;
  scenarioId: string;
  status: "started" | "passed" | "failed";
  family?: RegressionFailureFamily;
};

export type AdvancedRegressionInput = {
  scenarios: AdvancedRegressionScenario[];
  decisionClient: DecisionClient;
  now?: string;
  timezone?: string;
  today?: string;
  onProgress?: (progress: AdvancedRegressionProgress) => void;
};

// 顺序运行进阶场景；每个场景独立状态，避免互相污染。
export async function runAdvancedRegression(input: AdvancedRegressionInput): Promise<AdvancedRegressionResult> {
  const failures: AdvancedRegressionFailure[] = [];
  const total = input.scenarios.length;

  for (const [scenarioIndex, scenario] of input.scenarios.entries()) {
    const index = scenarioIndex + 1;
    input.onProgress?.({ index, total, scenarioId: scenario.id, status: "started" });
    const failure = await runScenario(scenario, input);
    if (failure) {
      failures.push(failure);
      input.onProgress?.({ index, total, scenarioId: scenario.id, status: "failed", family: failure.family });
    } else {
      input.onProgress?.({ index, total, scenarioId: scenario.id, status: "passed" });
    }
  }

  return {
    summary: {
      total,
      passed: total - failures.length,
      failed: failures.length,
    },
    failures,
  };
}

// 生成简短报告，只输出数量和问题族。
export function formatAdvancedRegressionReport(result: AdvancedRegressionResult): string {
  const lines = [
    `Advanced regression: ${result.summary.failed === 0 ? "passed" : "failed"}`,
    `Total: ${result.summary.total}`,
    `Passed: ${result.summary.passed}`,
    `Failed: ${result.summary.failed}`,
  ];

  if (result.failures.length > 0) {
    lines.push("Failure families:");
    for (const [family, count] of Object.entries(countFamilies(result.failures))) {
      lines.push(`- ${family}: ${count}`);
    }
  }

  return lines.join("\n");
}

async function runScenario(
  scenario: AdvancedRegressionScenario,
  input: AdvancedRegressionInput,
): Promise<AdvancedRegressionFailure | null> {
  const state = createShortTermStateStore(scenario.initialState);
  const calendar = createFakeAdvancedCalendar(scenario.seedEvents || []);
  const seedStore = createMemorySeedLiteStore(scenario.seedItems || []);

  for (const [stepIndex, step] of scenario.steps.entries()) {
    try {
      const response = await handleCalendarAgentRequest({
        text: step.text,
        requestId: `${scenario.id}_${stepIndex + 1}`,
        messageId: `${scenario.id}_${stepIndex + 1}`,
        state,
        decisionClient: input.decisionClient,
        calendar: calendar.adapter,
        seedStore,
        today: input.today || ADVANCED_REGRESSION_TODAY,
        now: input.now,
        timezone: input.timezone,
      });
      const failure = compareStepExpectation(scenario.id, stepIndex + 1, step.expected, response);
      if (failure) return failure;
      if (step.expectedEventsAfterStep) {
        const stepStateFailure = compareFinalEvents(
          scenario.id,
          stepIndex + 1,
          step.expectedEventsAfterStep,
          calendar.snapshot(),
        );
        if (stepStateFailure) return stepStateFailure;
      }
      if (step.expectedSeedItemsAfterStep) {
        const seedStateFailure = await compareFinalSeedItems(
          scenario.id,
          stepIndex + 1,
          step.expectedSeedItemsAfterStep,
          await seedStore.list(),
        );
        if (seedStateFailure) return seedStateFailure;
      }
    } catch (error) {
      return {
        scenarioId: scenario.id,
        stepIndex: stepIndex + 1,
        family: error instanceof Error && error.message.includes("超时") ? "model_timeout" : "model_intent",
        message: error instanceof Error ? error.message : "进阶回归执行失败。",
        actionType: "model_error",
      };
    }
  }

  const eventFailure = compareFinalEvents(scenario.id, scenario.steps.length, scenario.expectedFinalEvents, calendar.snapshot());
  if (eventFailure) return eventFailure;
  if (scenario.expectedFinalSeedItems) {
    return compareFinalSeedItems(scenario.id, scenario.steps.length, scenario.expectedFinalSeedItems, await seedStore.list());
  }
  return null;
}

function compareStepExpectation(
  scenarioId: string,
  stepIndex: number,
  expected: AdvancedStepExpectation,
  response: { ok: boolean; actionType: string; reply: string },
): AdvancedRegressionFailure | null {
  const expectedOk = expected.ok ?? true;
  const acceptedActionTypes = expected.actionTypes || [expected.actionType];
  if (!acceptedActionTypes.includes(response.actionType)) {
    return {
      scenarioId,
      stepIndex,
      family: "model_intent",
      message: `expected ${acceptedActionTypes.join(" or ")}, got ${response.actionType}`,
      actionType: response.actionType,
    };
  }

  if (response.ok !== expectedOk) {
    return {
      scenarioId,
      stepIndex,
      family: "calendar_api",
      message: `expected ok ${expectedOk}, got ${response.ok}`,
      actionType: response.actionType,
    };
  }

  const missingReply = (expected.replyIncludes || []).find((text) => !response.reply.includes(text));
  if (missingReply) {
    return {
      scenarioId,
      stepIndex,
      family: "model_intent",
      message: `reply missing ${missingReply}`,
      actionType: response.actionType,
    };
  }

  return null;
}

function compareFinalEvents(
  scenarioId: string,
  stepIndex: number,
  expected: AdvancedFinalEventExpectation[],
  actual: StoredEvent[],
): AdvancedRegressionFailure | null {
  if (actual.length !== expected.length) {
    return {
      scenarioId,
      stepIndex,
      family: "calendar_api",
      message: `expected ${expected.length} final events, got ${actual.length}`,
      actionType: "final_state",
    };
  }

  for (const expectedEvent of expected) {
    const actualEvent = actual.find((event) => event.id === expectedEvent.id);
    if (!actualEvent) {
      return {
        scenarioId,
        stepIndex,
        family: "calendar_api",
        message: `final event missing ${expectedEvent.id}`,
        actionType: "final_state",
      };
    }
    const mismatch = compareFinalEvent(expectedEvent, actualEvent);
    if (mismatch) {
      return {
        scenarioId,
        stepIndex,
        family: "calendar_api",
        message: mismatch,
        actionType: "final_state",
      };
    }
  }

  return null;
}

function compareFinalEvent(expected: AdvancedFinalEventExpectation, actual: StoredEvent): string | null {
  const expectedTitles = expected.titles || [expected.title];
  if (!expectedTitles.includes(actual.title)) return `final title mismatch for ${expected.id}: ${actual.title}`;
  if (actual.date !== expected.date) return `final date mismatch for ${expected.id}: ${actual.date}`;
  const expectedStartTimes = expected.startTimes || [expected.startTime];
  if (!expectedStartTimes.includes(actual.startTime)) return `final startTime mismatch for ${expected.id}: ${actual.startTime}`;
  return null;
}

async function compareFinalSeedItems(
  scenarioId: string,
  stepIndex: number,
  expected: AdvancedFinalSeedExpectation[],
  actual: SeedLiteItem[],
): Promise<AdvancedRegressionFailure | null> {
  if (actual.length !== expected.length) {
    return {
      scenarioId,
      stepIndex,
      family: "calendar_api",
      message: `expected ${expected.length} final seed items, got ${actual.length}`,
      actionType: "final_seed_state",
    };
  }

  for (const expectedItem of expected) {
    const actualItem = actual.find((item) => item.seedId === expectedItem.seedId);
    if (!actualItem) {
      return {
        scenarioId,
        stepIndex,
        family: "calendar_api",
        message: `final seed item missing ${expectedItem.seedId}`,
        actionType: "final_seed_state",
      };
    }
    if (actualItem.title !== expectedItem.title) {
      return {
        scenarioId,
        stepIndex,
        family: "calendar_api",
        message: `final seed title mismatch for ${expectedItem.seedId}`,
        actionType: "final_seed_state",
      };
    }
    const expectedTargetDates = expectedItem.targetDates || (expectedItem.targetDate ? [expectedItem.targetDate] : [""]);
    if (!expectedTargetDates.includes(actualItem.targetDate || "")) {
      return {
        scenarioId,
        stepIndex,
        family: "calendar_api",
        message: `final seed targetDate mismatch for ${expectedItem.seedId}`,
        actionType: "final_seed_state",
      };
    }
    if (expectedItem.reminderAt !== undefined && (actualItem.reminderAt || null) !== expectedItem.reminderAt) {
      return {
        scenarioId,
        stepIndex,
        family: "calendar_api",
        message: `final seed reminderAt mismatch for ${expectedItem.seedId}`,
        actionType: "final_seed_state",
      };
    }
  }

  return null;
}

function countFamilies(failures: AdvancedRegressionFailure[]): Record<string, number> {
  return failures.reduce<Record<string, number>>((acc, failure) => {
    acc[failure.family] = (acc[failure.family] || 0) + 1;
    return acc;
  }, {});
}

function createFakeAdvancedCalendar(seedEvents: AdvancedSeedEvent[]): { adapter: CalendarAdapter; snapshot: () => StoredEvent[] } {
  const events = seedEvents.map(toStoredEvent);

  return {
    adapter: {
      async createEvent(event) {
        const created = toStoredEvent({ id: `evt_${events.length + 1}`, title: event.title, date: event.date, startTime: event.startTime });
        events.push(created);
        return { ok: true, data: toFeishuEvent(created) };
      },
      async listEvents(input) {
        const filtered = events.filter((event) => {
          if (input.date) return event.date === input.date;
          if (input.range) return event.date >= input.range.startDate && event.date <= input.range.endDate;
          return true;
        });
        return { ok: true, data: filtered.map(toFeishuEvent) };
      },
      async updateEvent(input) {
        const event = events.find((candidate) => candidate.id === input.eventId);
        if (!event) return { ok: false, code: "not_found", message: "没有找到日程。" };
        applyPatch(event, input.patch);
        return { ok: true, data: toFeishuEvent(event) };
      },
      async deleteEvent(input) {
        const index = events.findIndex((event) => event.id === input.eventId);
        if (index === -1) return { ok: false, code: "not_found", message: "没有找到日程。" };
        events.splice(index, 1);
        return { ok: true, data: { eventId: input.eventId } };
      },
    },
    snapshot() {
      return events.map(toStoredEvent);
    },
  };
}

type StoredEvent = AdvancedSeedEvent;

function toStoredEvent(event: AdvancedSeedEvent): StoredEvent {
  return { id: event.id, title: event.title, date: event.date, startTime: event.startTime };
}

function toFeishuEvent(event: StoredEvent): FeishuCalendarEvent {
  return { id: event.id, title: event.title, start: `${event.date} ${event.startTime}` };
}

function applyPatch(event: StoredEvent, patch: Partial<EventDraft>) {
  if (patch.title) event.title = patch.title;
  if (patch.date) event.date = patch.date;
  if (patch.startTime) event.startTime = patch.startTime;
}
