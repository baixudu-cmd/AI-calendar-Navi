// 进阶飞书 smoke runner：用测试日历验证 API Bridge 的状态动作，并清理本轮创建的事件。

import { once } from "node:events";
import type { Server } from "node:http";
import { createControlledShadowRoute } from "../agent-api/controlled-shadow-route.js";
import { createShadowHttpServer } from "../agent-api/shadow-http-server.js";
import { handleCalendarAgentRequest } from "../agent-api/index.js";
import {
  createEvent,
  deleteEvent,
  listEvents,
  type DeterministicCalendarAdapter,
} from "../calendar-api/index.js";
import type { FeishuCalendarEvent } from "../calendar/feishu/types.js";
import type { AppConfig } from "../config/index.js";
import type { EventDraft } from "../contract/index.js";
import type { DecisionClient } from "../decision/index.js";
import { callOpenClawShadowRoute } from "../openclaw/shadow-caller.js";
import { createShortTermStateStore, type ShortTermState } from "../state/index.js";
import { evaluateLiveConfigGate } from "./config-gate.js";

export type AdvancedFeishuSmokeSeedEvent = EventDraft;

export type AdvancedFeishuSmokeExpectedEvent = {
  title: string;
  date: string;
  startTime: string;
};

export type AdvancedFeishuSmokeScenario = {
  id: string;
  date: string;
  seedEvents: AdvancedFeishuSmokeSeedEvent[];
  steps: string[];
  expectedStepActions?: string[];
  expectedFinalEvents: AdvancedFeishuSmokeExpectedEvent[];
  initialLastEventIndex?: number;
};

export type AdvancedFeishuSmokeStep = {
  scenarioId: string;
  name: "config" | "baseline" | "seed" | "agent" | "verify" | "cleanup";
  ok: boolean;
  message: string;
};

export type AdvancedFeishuSmokeFailure = {
  scenarioId: string;
  family: "config" | "seed" | "agent" | "final_state" | "cleanup";
  message: string;
};

export type AdvancedFeishuSmokeResult = {
  ok: boolean;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  steps: AdvancedFeishuSmokeStep[];
  failures: AdvancedFeishuSmokeFailure[];
};

export type AdvancedFeishuSmokeInput = {
  adapter: DeterministicCalendarAdapter;
  config: AppConfig;
  decisionClient: DecisionClient;
  scenarios?: AdvancedFeishuSmokeScenario[];
  today?: string;
  now?: string;
  useShadowRoute?: boolean;
  shadowSecret?: string;
};

export const DEFAULT_ADVANCED_FEISHU_SMOKE_DATE = "2026-05-20";

// 运行受控进阶 smoke；真实写入目标由 live config gate 限制为专用测试日历。
export async function runAdvancedFeishuSmoke(input: AdvancedFeishuSmokeInput): Promise<AdvancedFeishuSmokeResult> {
  const gate = evaluateLiveConfigGate(input.config);
  if (!gate.ok) {
    return {
      ok: false,
      summary: { total: 0, passed: 0, failed: 1 },
      steps: [{ scenarioId: "config", name: "config", ok: false, message: gate.failures.join("；") }],
      failures: [{ scenarioId: "config", family: "config", message: gate.failures.join("；") }],
    };
  }

  const today = input.today || DEFAULT_ADVANCED_FEISHU_SMOKE_DATE;
  const now = input.now || `${today}T09:00:00+08:00`;
  const scenarios = input.scenarios || createDefaultAdvancedFeishuSmokeScenarios(today);
  const steps: AdvancedFeishuSmokeStep[] = [];
  const failures: AdvancedFeishuSmokeFailure[] = [];

  for (const scenario of scenarios) {
    const failure = await runScenario({ ...input, today, now }, scenario, steps);
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

// 生成 CLI 可读的短报告，不展开密钥或逐条模型细节。
export function formatAdvancedFeishuSmokeReport(result: AdvancedFeishuSmokeResult): string {
  const lines = [
    `Advanced Feishu smoke: ${result.ok ? "passed" : "failed"}`,
    `Total: ${result.summary.total}`,
    `Passed: ${result.summary.passed}`,
    `Failed: ${result.summary.failed}`,
  ];

  for (const step of result.steps) {
    lines.push(`${step.scenarioId}/${step.name}: ${step.ok ? "ok" : "failed"} - ${step.message}`);
  }

  if (result.failures.length > 0) {
    lines.push("Failure families:");
    for (const [family, count] of Object.entries(countFamilies(result.failures))) {
      lines.push(`- ${family}: ${count}`);
    }
  }

  return lines.join("\n");
}

// 默认只覆盖受控进阶状态动作，不开放自由真实日历测试。
export function createDefaultAdvancedFeishuSmokeScenarios(today: string): AdvancedFeishuSmokeScenario[] {
  const tomorrow = addDays(today, 1);
  return [
    {
      id: "briefing-title-update",
      date: today,
      seedEvents: [{ title: "投委会", date: today, startTime: "09:00" }],
      steps: ["发我今天早报", "把第1条改成投委会预沟通"],
      expectedFinalEvents: [{ title: "投委会预沟通", date: today, startTime: "09:00" }],
    },
    {
      id: "delete-confirm",
      date: today,
      initialLastEventIndex: 0,
      seedEvents: [{ title: "电话会", date: today, startTime: "10:00" }],
      steps: ["删掉刚才那个", "确认删除"],
      expectedFinalEvents: [],
    },
    {
      id: "delete-cancel",
      date: today,
      initialLastEventIndex: 0,
      seedEvents: [{ title: "客户晚餐", date: today, startTime: "19:00" }],
      steps: ["删掉刚才那个", "取消"],
      expectedFinalEvents: [{ title: "客户晚餐", date: today, startTime: "19:00" }],
    },
    {
      id: "create-draft-clarification",
      date: tomorrow,
      seedEvents: [],
      steps: ["明天约张总开会", "上午10点"],
      expectedStepActions: ["clarify", "create_event"],
      expectedFinalEvents: [{ title: "约张总开会", date: tomorrow, startTime: "10:00" }],
    },
  ];
}

async function runScenario(
  input: AdvancedFeishuSmokeInput & { today: string },
  scenario: AdvancedFeishuSmokeScenario,
  steps: AdvancedFeishuSmokeStep[],
): Promise<AdvancedFeishuSmokeFailure | null> {
  const createdIds: string[] = [];
  let scenarioFailure: AdvancedFeishuSmokeFailure | null = null;
  let knownRemainingCreatedIds: string[] | undefined;
  let baselineIds: Set<string> | undefined;
  let shadowServer: Server | undefined;
  let shadowUrl = "";

  try {
    const baseline = await listScenarioBaseline(input.adapter, scenario, steps);
    if (!baseline.ok) {
      scenarioFailure = baseline.failure;
    } else {
      baselineIds = baseline.ids;
      const seeded = await seedScenario(input.adapter, scenario, createdIds, steps);
      if (!seeded.ok) {
        scenarioFailure = seeded.failure;
      } else {
        const state = createShortTermStateStore(createInitialState(scenario, seeded.events));
        if (input.useShadowRoute) {
          const shadow = await startScenarioShadowRoute(input, state);
          shadowServer = shadow.server;
          shadowUrl = shadow.url;
        }
        for (const [index, text] of scenario.steps.entries()) {
          const requestId = `${scenario.id}_${index + 1}`;
          const messageId = `${scenario.id}_${index + 1}`;
          const response = await invokeScenarioStep({
            text,
            requestId,
            messageId,
            state,
            input,
            shadowUrl,
          });
          steps.push({
            scenarioId: scenario.id,
            name: "agent",
            ok: response.ok,
            message: `${response.actionType}`,
          });

          if (response.ok && response.actionType === "create_event") {
            const recorded = recordAgentCreatedEventId(state, createdIds);
            if (!recorded.ok) {
              scenarioFailure = { scenarioId: scenario.id, family: "agent", message: recorded.message };
              break;
            }
          }

          const expectedAction = scenario.expectedStepActions?.[index];
          if (expectedAction && response.actionType !== expectedAction) {
            scenarioFailure = {
              scenarioId: scenario.id,
              family: "agent",
              message: `expected step ${index + 1} action ${expectedAction}, got ${response.actionType}`,
            };
            break;
          }

          if (!response.ok) {
            scenarioFailure = { scenarioId: scenario.id, family: "agent", message: response.reply };
            break;
          }
        }

        if (!scenarioFailure) {
          const verified = await verifyFinalState(input.adapter, scenario, createdIds, steps, baselineIds);
          knownRemainingCreatedIds = verified.remainingCreatedIds;
          if (!verified.ok) scenarioFailure = verified.failure;
        }
      }
    }
  } catch (error) {
    scenarioFailure = {
      scenarioId: scenario.id,
      family: "agent",
      message: error instanceof Error ? error.message : "进阶飞书 smoke 执行失败。",
    };
  }

  await closeScenarioShadowRoute(shadowServer);
  const cleanupFailure = await cleanupCreatedEvents(input.adapter, scenario, createdIds, steps, knownRemainingCreatedIds, baselineIds);
  return scenarioFailure ?? cleanupFailure;
}

async function invokeScenarioStep(input: {
  text: string;
  requestId: string;
  messageId: string;
  state: ReturnType<typeof createShortTermStateStore>;
  input: AdvancedFeishuSmokeInput & { today: string };
  shadowUrl: string;
}) {
  if (input.input.useShadowRoute) {
    return callOpenClawShadowRoute({
      url: input.shadowUrl,
      text: input.text,
      requestId: input.requestId,
      messageId: input.messageId,
      secret: input.input.shadowSecret || "advanced-shadow-feishu-smoke-secret",
    });
  }

  return handleCalendarAgentRequest({
    text: input.text,
    requestId: input.requestId,
    messageId: input.messageId,
    state: input.state,
    decisionClient: input.input.decisionClient,
    calendar: input.input.adapter,
    today: input.input.today,
    now: input.input.now,
    timezone: input.input.config.timezone,
  });
}

async function startScenarioShadowRoute(
  input: AdvancedFeishuSmokeInput & { today: string },
  state: ReturnType<typeof createShortTermStateStore>,
): Promise<{ server: Server; url: string }> {
  const route = createControlledShadowRoute({
    expectedSecret: input.shadowSecret || "advanced-shadow-feishu-smoke-secret",
    state,
    seenMessageIds: new Set<string>(),
    decisionClient: input.decisionClient,
    calendar: input.adapter,
    today: input.today,
    now: input.now,
    timezone: input.config.timezone,
  });
  const server = createShadowHttpServer({ route });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("shadow Feishu smoke server missing address");
  return { server, url: `http://127.0.0.1:${address.port}/calendar-agent/shadow` };
}

async function closeScenarioShadowRoute(server?: Server) {
  if (!server?.listening) return;
  server.close();
  await once(server, "close");
}

async function listScenarioBaseline(
  adapter: DeterministicCalendarAdapter,
  scenario: AdvancedFeishuSmokeScenario,
  steps: AdvancedFeishuSmokeStep[],
): Promise<{ ok: true; ids: Set<string> } | { ok: false; failure: AdvancedFeishuSmokeFailure }> {
  const listed = await listEvents(adapter, { date: scenario.date });
  steps.push({
    scenarioId: scenario.id,
    name: "baseline",
    ok: listed.ok,
    message: listed.ok ? "listed" : listed.message,
  });
  if (!listed.ok) return { ok: false, failure: { scenarioId: scenario.id, family: "final_state", message: listed.message } };
  return { ok: true, ids: new Set(listed.data.map((event) => event.id)) };
}

async function seedScenario(
  adapter: DeterministicCalendarAdapter,
  scenario: AdvancedFeishuSmokeScenario,
  createdIds: string[],
  steps: AdvancedFeishuSmokeStep[],
): Promise<{ ok: true; events: FeishuCalendarEvent[] } | { ok: false; failure: AdvancedFeishuSmokeFailure }> {
  const events: FeishuCalendarEvent[] = [];
  for (const event of scenario.seedEvents) {
    const result = await createEvent(adapter, event);
    steps.push({
      scenarioId: scenario.id,
      name: "seed",
      ok: result.ok,
      message: result.ok ? "created" : result.message,
    });
    if (!result.ok) return { ok: false, failure: { scenarioId: scenario.id, family: "seed", message: result.message } };
    if (!result.data.id.trim()) {
      return { ok: false, failure: { scenarioId: scenario.id, family: "seed", message: "飞书返回了空事件 ID。" } };
    }
    createdIds.push(result.data.id);
    events.push(result.data);
  }

  return { ok: true, events };
}

function createInitialState(scenario: AdvancedFeishuSmokeScenario, events: FeishuCalendarEvent[]): ShortTermState {
  if (scenario.initialLastEventIndex === undefined) return {};
  const event = events[scenario.initialLastEventIndex];
  if (!event) return {};
  const time = parseEventTime(event);
  return {
    last_event: {
      eventId: event.id,
      title: event.title,
      date: time.date,
      startTime: time.startTime,
    },
  };
}

async function verifyFinalState(
  adapter: DeterministicCalendarAdapter,
  scenario: AdvancedFeishuSmokeScenario,
  createdIds: string[],
  steps: AdvancedFeishuSmokeStep[],
  baselineIds: Set<string>,
): Promise<
  | { ok: true; remainingCreatedIds: string[] }
  | { ok: false; failure: AdvancedFeishuSmokeFailure; remainingCreatedIds?: string[] }
> {
  const listed = await listEvents(adapter, { date: scenario.date });
  steps.push({
    scenarioId: scenario.id,
    name: "verify",
    ok: listed.ok,
    message: listed.ok ? "listed" : listed.message,
  });
  if (!listed.ok) return { ok: false, failure: { scenarioId: scenario.id, family: "final_state", message: listed.message } };

  const untrackedNewEvent = listed.data.find((event) => !baselineIds.has(event.id) && !createdIds.includes(event.id));
  const remainingCreated = listed.data.filter((event) => createdIds.includes(event.id));
  const actual = remainingCreated
    .map((event) => ({ id: event.id, title: event.title, ...parseEventTime(event) }));

  if (untrackedNewEvent) {
    return {
      ok: false,
      failure: {
        scenarioId: scenario.id,
        family: "final_state",
        message: `发现未跟踪的新事件：${untrackedNewEvent.title}`,
      },
      remainingCreatedIds: remainingCreated.map((event) => event.id),
    };
  }

  const mismatch = compareFinalEvents(scenario.expectedFinalEvents, actual);
  if (mismatch) {
    return {
      ok: false,
      failure: { scenarioId: scenario.id, family: "final_state", message: mismatch },
      remainingCreatedIds: remainingCreated.map((event) => event.id),
    };
  }

  return { ok: true, remainingCreatedIds: remainingCreated.map((event) => event.id) };
}

async function cleanupCreatedEvents(
  adapter: DeterministicCalendarAdapter,
  scenario: AdvancedFeishuSmokeScenario,
  createdIds: string[],
  steps: AdvancedFeishuSmokeStep[],
  knownRemainingCreatedIds?: string[],
  baselineIds?: Set<string>,
): Promise<AdvancedFeishuSmokeFailure | null> {
  if (createdIds.length === 0 && !baselineIds) return null;

  const remainingCreatedIds = knownRemainingCreatedIds ?? (await listRemainingCreatedIds(adapter, scenario, createdIds));
  if (!Array.isArray(remainingCreatedIds)) return remainingCreatedIds;

  for (const eventId of remainingCreatedIds) {
    const deleted = await deleteEvent(adapter, { eventId });
    steps.push({
      scenarioId: scenario.id,
      name: "cleanup",
      ok: deleted.ok,
      message: deleted.ok ? "deleted" : deleted.message,
    });
    if (!deleted.ok) return { scenarioId: scenario.id, family: "cleanup", message: deleted.message };
  }

  return null;
}

async function listRemainingCreatedIds(
  adapter: DeterministicCalendarAdapter,
  scenario: AdvancedFeishuSmokeScenario,
  createdIds: string[],
): Promise<string[] | AdvancedFeishuSmokeFailure> {
  const listed = await listEvents(adapter, { date: scenario.date });
  if (!listed.ok) {
    return { scenarioId: scenario.id, family: "cleanup", message: listed.message };
  }

  return listed.data.map((event) => event.id).filter((eventId) => createdIds.includes(eventId));
}

function recordAgentCreatedEventId(
  state: ReturnType<typeof createShortTermStateStore>,
  createdIds: string[],
): { ok: true } | { ok: false; message: string } {
  const eventId = state.snapshot().last_event?.eventId;
  if (!eventId) return { ok: false, message: "创建成功后没有记录事件 ID，无法安全校验或清理。" };
  if (!createdIds.includes(eventId)) createdIds.push(eventId);
  return { ok: true };
}

function compareFinalEvents(
  expected: AdvancedFeishuSmokeExpectedEvent[],
  actual: Array<AdvancedFeishuSmokeExpectedEvent & { id: string }>,
): string | null {
  if (actual.length !== expected.length) return `expected ${expected.length} final events, got ${actual.length}`;

  for (const expectedEvent of expected) {
    const match = actual.find(
      (event) =>
        event.title === expectedEvent.title &&
        event.date === expectedEvent.date &&
        event.startTime === expectedEvent.startTime,
    );
    if (!match) return `final event missing ${expectedEvent.title} ${expectedEvent.date} ${expectedEvent.startTime}`;
  }

  return null;
}

function parseEventTime(event: FeishuCalendarEvent): { date: string; startTime: string } {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(event.start);
  if (!match) return { date: "", startTime: "" };
  return { date: match[1], startTime: match[2] };
}

function countFamilies(failures: AdvancedFeishuSmokeFailure[]): Record<string, number> {
  return failures.reduce<Record<string, number>>((acc, failure) => {
    acc[failure.family] = (acc[failure.family] || 0) + 1;
    return acc;
  }, {});
}

function addDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
