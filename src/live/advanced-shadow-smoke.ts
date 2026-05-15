// 进阶 shadow smoke：通过 HTTP shadow route 和 OpenClaw caller payload 验证连续入口状态。

import { once } from "node:events";
import type { Server } from "node:http";
import { createControlledShadowRoute } from "../agent-api/controlled-shadow-route.js";
import { createShadowHttpServer } from "../agent-api/shadow-http-server.js";
import type { DeterministicCalendarAdapter } from "../calendar-api/index.js";
import type { EventDraft } from "../contract/index.js";
import type { DecisionClient } from "../decision/index.js";
import { buildOpenClawShadowPayload, callOpenClawShadowRoute, type CalendarAgentResponse } from "../openclaw/shadow-caller.js";
import { createShortTermStateStore } from "../state/index.js";

type FakeCalendarEvent = { id: string; title: string; start: string };

export type AdvancedShadowSmokeExpectedEvent = {
  title: string;
  date: string;
  startTime: string;
};

export type AdvancedShadowSmokeStepInput = {
  text: string;
  expectedAction: string;
  expectOk?: boolean;
  messageId?: string;
  requestId?: string;
  secret?: string;
};

export type AdvancedShadowSmokeScenario = {
  id: string;
  date: string;
  seedEvents: EventDraft[];
  decisions: unknown[];
  steps: AdvancedShadowSmokeStepInput[];
  expectedFinalEvents: AdvancedShadowSmokeExpectedEvent[];
};

export type AdvancedShadowSmokeStep = {
  scenarioId: string;
  actionType: string;
  ok: boolean;
  message: string;
};

export type AdvancedShadowSmokeFailure = {
  scenarioId: string;
  family: "agent" | "final_state" | "cleanup";
  message: string;
};

export type AdvancedShadowSmokeResult = {
  ok: boolean;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  steps: AdvancedShadowSmokeStep[];
  failures: AdvancedShadowSmokeFailure[];
};

export type AdvancedShadowSmokeInput = {
  scenarios?: AdvancedShadowSmokeScenario[];
  today?: string;
  now?: string;
  timezone?: string;
  secret?: string;
};

const DEFAULT_DATE = "2026-05-20";
const DEFAULT_SECRET = "shadow-smoke-secret";

// 运行进阶 shadow smoke；默认只用 fake calendar，不访问飞书或微信。
export async function runAdvancedShadowSmoke(input: AdvancedShadowSmokeInput = {}): Promise<AdvancedShadowSmokeResult> {
  const today = input.today || DEFAULT_DATE;
  const now = input.now || `${today}T09:00:00+08:00`;
  const timezone = input.timezone || "Asia/Shanghai";
  const secret = input.secret || DEFAULT_SECRET;
  const scenarios = input.scenarios || createDefaultAdvancedShadowSmokeScenarios(today);
  const steps: AdvancedShadowSmokeStep[] = [];
  const failures: AdvancedShadowSmokeFailure[] = [];

  for (const scenario of scenarios) {
    const failure = await runScenario({ scenario, today, now, timezone, secret, steps });
    if (failure) failures.push(failure);
  }

  return {
    ok: failures.length === 0,
    summary: {
      total: scenarios.length,
      passed: scenarios.length - failures.length,
      failed: failures.length,
    },
    steps,
    failures,
  };
}

// 生成 CLI 可读报告，只输出汇总和动作，不输出 secret 或模型细节。
export function formatAdvancedShadowSmokeReport(result: AdvancedShadowSmokeResult): string {
  const lines = [
    `Advanced shadow smoke: ${result.ok ? "passed" : "failed"}`,
    `Total: ${result.summary.total}`,
    `Passed: ${result.summary.passed}`,
    `Failed: ${result.summary.failed}`,
  ];

  for (const step of result.steps) {
    lines.push(`${step.scenarioId}: ${step.ok ? "ok" : "failed"} - ${step.actionType}`);
  }

  if (result.failures.length > 0) {
    lines.push("Failure families:");
    for (const [family, count] of Object.entries(countFamilies(result.failures))) {
      lines.push(`- ${family}: ${count}`);
    }
  }

  return lines.join("\n");
}

// 默认覆盖进阶入口最关键的三条连续状态链路。
export function createDefaultAdvancedShadowSmokeScenarios(today: string): AdvancedShadowSmokeScenario[] {
  const tomorrow = addDays(today, 1);
  return [
    {
      id: "briefing-title-update",
      date: today,
      seedEvents: [{ title: "投委会", date: today, startTime: "09:00" }],
      decisions: [
        { action: "daily_briefing", briefingType: "morning" },
        { type: "update_event", target: { kind: "briefing_item", itemNumber: 1 }, patch: { title: "投委会预沟通" } },
      ],
      steps: [
        { text: "发我今天早报", expectedAction: "daily_briefing" },
        { text: "把第1条改成投委会预沟通", expectedAction: "update_event" },
      ],
      expectedFinalEvents: [{ title: "投委会预沟通", date: today, startTime: "09:00" }],
    },
    {
      id: "delete-confirm",
      date: today,
      seedEvents: [{ title: "电话会", date: today, startTime: "10:00" }],
      decisions: [
        { type: "request_delete_event", target: { kind: "last_event" } },
        { type: "confirm_delete", confirmed: true },
      ],
      steps: [
        { text: "删掉刚才那个", expectedAction: "request_delete_event" },
        { text: "确认删除", expectedAction: "confirm_delete" },
      ],
      expectedFinalEvents: [],
    },
    {
      id: "create-draft-clarification",
      date: tomorrow,
      seedEvents: [],
      decisions: [
        { action: "create_event", event: { title: "约张总开会", date: tomorrow } },
        { action: "create_event", event: { startTime: "10:00" } },
      ],
      steps: [
        { text: "明天约张总开会", expectedAction: "clarify" },
        { text: "上午10点", expectedAction: "create_event" },
      ],
      expectedFinalEvents: [{ title: "约张总开会", date: tomorrow, startTime: "10:00" }],
    },
  ];
}

async function runScenario(input: {
  scenario: AdvancedShadowSmokeScenario;
  today: string;
  now: string;
  timezone: string;
  secret: string;
  steps: AdvancedShadowSmokeStep[];
}): Promise<AdvancedShadowSmokeFailure | null> {
  const calendar = createFakeCalendar(input.scenario.seedEvents);
  const state = createShortTermStateStore(createInitialState(input.scenario, calendar.snapshotRaw()));
  const route = createControlledShadowRoute({
    expectedSecret: input.secret,
    state,
    seenMessageIds: new Set<string>(),
    decisionClient: createScriptedDecisionClient(input.scenario.decisions),
    calendar,
    today: input.today,
    now: input.now,
    timezone: input.timezone,
  });
  const server = createShadowHttpServer({ route });
  let url = "";

  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("shadow smoke server missing address");
    url = `http://127.0.0.1:${address.port}/calendar-agent/shadow`;

    for (const [index, step] of input.scenario.steps.entries()) {
      const response = await callStep({
        url,
        step,
        scenarioId: input.scenario.id,
        index,
        defaultSecret: input.secret,
      });
      input.steps.push({
        scenarioId: input.scenario.id,
        actionType: response.actionType,
        ok: response.ok,
        message: response.reply,
      });

      if (response.ok !== (step.expectOk ?? true) || response.actionType !== step.expectedAction) {
        return {
          scenarioId: input.scenario.id,
          family: "agent",
          message: `expected ${step.expectedAction}, got ${response.actionType}`,
        };
      }
    }

    const mismatch = compareFinalEvents(input.scenario.expectedFinalEvents, calendar.snapshotRaw());
    if (mismatch) return { scenarioId: input.scenario.id, family: "final_state", message: mismatch };
    return null;
  } catch (error) {
    return {
      scenarioId: input.scenario.id,
      family: "agent",
      message: error instanceof Error ? error.message : "进阶 shadow smoke 执行失败。",
    };
  } finally {
    await closeServer(server);
  }
}

async function callStep(input: {
  url: string;
  step: AdvancedShadowSmokeStepInput;
  scenarioId: string;
  index: number;
  defaultSecret: string;
}): Promise<CalendarAgentResponse> {
  const requestId = input.step.requestId || `${input.scenarioId}_${input.index + 1}`;
  const messageId = input.step.messageId || `${input.scenarioId}_${input.index + 1}`;
  const secret = input.step.secret || input.defaultSecret;
  const callInput = { url: input.url, text: input.step.text, messageId, requestId, secret };

  if (input.step.expectOk === false) return callShadowRouteAllowFailure(callInput);
  return callOpenClawShadowRoute(callInput);
}

async function callShadowRouteAllowFailure(input: {
  url: string;
  text: string;
  messageId: string;
  requestId: string;
  secret: string;
}): Promise<CalendarAgentResponse> {
  const response = await fetch(input.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildOpenClawShadowPayload(input)),
  });
  const body = await response.json();
  if (!isCalendarAgentResponse(body)) throw new Error("shadow route returned invalid response");
  return body;
}

function createScriptedDecisionClient(decisions: unknown[]): DecisionClient {
  let index = 0;
  return {
    decide: async () => {
      const decision = decisions[index];
      index += 1;
      return decision || { action: "clarify", question: "没有可用动作。", missing: ["unknown"] };
    },
  };
}

type StoredEvent = { id: string; title: string; date: string; startTime: string };

function createFakeCalendar(seedEvents: EventDraft[]): DeterministicCalendarAdapter & { snapshotRaw(): StoredEvent[] } {
  const events = seedEvents.map((event, index) => ({
    id: `evt_${index + 1}`,
    title: event.title,
    date: event.date,
    startTime: event.startTime,
  }));

  return {
    async createEvent(event) {
      const created = {
        id: `evt_${events.length + 1}`,
        title: event.title,
        date: event.date,
        startTime: event.startTime,
      };
      events.push(created);
      return { ok: true, data: toFeishuEvent(created) };
    },
    async listEvents(input) {
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
      const event = events.find((candidate) => candidate.id === input.eventId);
      if (!event) return { ok: false, code: "not_found", message: "没有找到日程。" };
      if (input.patch.title) event.title = input.patch.title;
      if (input.patch.date) event.date = input.patch.date;
      if (input.patch.startTime) event.startTime = input.patch.startTime;
      return { ok: true, data: toFeishuEvent(event) };
    },
    async deleteEvent(input) {
      const index = events.findIndex((event) => event.id === input.eventId);
      if (index === -1) return { ok: false, code: "not_found", message: "没有找到日程。" };
      events.splice(index, 1);
      return { ok: true, data: { eventId: input.eventId } };
    },
    snapshotRaw() {
      return events.map((event) => ({ ...event }));
    },
  };
}

function createInitialState(scenario: AdvancedShadowSmokeScenario, events: StoredEvent[]) {
  if (scenario.id !== "delete-confirm") return {};
  const event = events[0];
  if (!event) return {};
  return {
    last_event: {
      eventId: event.id,
      title: event.title,
      date: event.date,
      startTime: event.startTime,
    },
  };
}

function toFeishuEvent(event: StoredEvent): FakeCalendarEvent {
  return { id: event.id, title: event.title, start: `${event.date} ${event.startTime}` };
}

function compareFinalEvents(expected: AdvancedShadowSmokeExpectedEvent[], actualEvents: StoredEvent[]): string | null {
  if (actualEvents.length !== expected.length) return `expected ${expected.length} final events, got ${actualEvents.length}`;

  for (const expectedEvent of expected) {
    const found = actualEvents.find(
      (event) =>
        event.title === expectedEvent.title &&
        event.date === expectedEvent.date &&
        event.startTime === expectedEvent.startTime,
    );
    if (!found) return `final event missing ${expectedEvent.title} ${expectedEvent.date} ${expectedEvent.startTime}`;
  }

  return null;
}

async function closeServer(server: Server) {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

function isCalendarAgentResponse(value: unknown): value is CalendarAgentResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CalendarAgentResponse).ok === "boolean" &&
    typeof (value as CalendarAgentResponse).reply === "string" &&
    typeof (value as CalendarAgentResponse).actionType === "string" &&
    typeof (value as CalendarAgentResponse).requestId === "string"
  );
}

function addDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function countFamilies(failures: AdvancedShadowSmokeFailure[]): Record<string, number> {
  return failures.reduce<Record<string, number>>((acc, failure) => {
    acc[failure.family] = (acc[failure.family] || 0) + 1;
    return acc;
  }, {});
}
