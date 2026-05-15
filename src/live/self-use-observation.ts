// P4 自用观察模拟：用脚本化模型和假日历跑微信入口形状，不触碰真实飞书。

import { handleCalendarAgentRequest, type CalendarAgentResponse } from "../agent-api/index.js";
import type { CalendarAdapter } from "../calendar/action-executor.js";
import type { DeleteEventResult, FeishuCalendarEvent, FeishuResult, ListEventsInput, UpdateEventInput } from "../calendar/feishu/types.js";
import type { EventDraft } from "../contract/index.js";
import type { DecisionClient, DecisionRequest } from "../decision/index.js";
import { createShortTermStateStore } from "../state/index.js";

export type SelfUseObservationStepResult = {
  id: string;
  passed: boolean;
  actionType: string;
  message?: string;
};

export type SelfUseObservationResult = {
  ok: boolean;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  steps: SelfUseObservationStepResult[];
  failures: SelfUseObservationStepResult[];
};

type ScriptedDecision = { id: string; value: unknown };

const TODAY = "2026-05-14";
const TOMORROW = "2026-05-15";
const NOW = "2026-05-14T09:00:00+08:00";

// 执行 P4 模拟观察；每一步都走同一个 API bridge 和短期状态。
export async function runSelfUseObservation(): Promise<SelfUseObservationResult> {
  const state = createShortTermStateStore();
  const calendar = createObservationCalendar();
  const decisions = createScriptedDecisionClient([
    {
      id: "create_visible_event",
      value: { action: "create_event", event: { title: "P4上午例会", date: TODAY, startTime: "09:30" } },
    },
    {
      id: "batch_create",
      value: {
        type: "create_events",
        events: [
          { title: "投委会", date: TOMORROW, startTime: "09:00" },
          { title: "客户电话", date: TOMORROW, startTime: "14:00" },
        ],
      },
    },
    {
      id: "batch_context_update",
      value: { type: "update_event", target: { kind: "briefing_item", itemNumber: 2 }, patch: { startTime: "15:00" } },
    },
    { id: "empty_list_reply", value: { action: "list_events", date: "2026-05-20" } },
    { id: "empty_morning_briefing", value: { action: "daily_briefing", briefingType: "morning" } },
    { id: "delete_request", value: { type: "request_delete_event", target: { kind: "last_event" } } },
    { id: "delete_confirm", value: { type: "confirm_delete", confirmed: true } },
  ]);
  const seenMessageIds = new Set<string>();

  const steps: SelfUseObservationStepResult[] = [];
  steps.push(
    await assertResponse("create_visible_event", () =>
      send({
        text: "今天9点半P4上午例会，记一下",
        messageId: "p4_msg_create",
        state,
        calendar,
        decisions,
        seenMessageIds,
      }),
      { actionType: "create_event", includes: ["已新增日程", "2026年5月14日 星期四", "09:30", "P4上午例会"] },
    ),
  );
  steps.push(
    await assertResponse("batch_create", () =>
      send({
        text: "明天9点投委会，下午2点客户电话，都帮我记一下",
        messageId: "p4_msg_batch",
        state,
        calendar,
        decisions,
        seenMessageIds,
      }),
      { actionType: "create_events", includes: ["已新增 2 个日程", "1. 2026年5月15日 星期五 09:00 投委会", "2. 2026年5月15日 星期五 14:00 客户电话"] },
    ),
  );
  steps.push(
    await assertResponse("batch_context_update", () =>
      send({
        text: "把第二个改到下午3点",
        messageId: "p4_msg_update_second",
        state,
        calendar,
        decisions,
        seenMessageIds,
      }),
      { actionType: "update_event", includes: ["已修改日程", "2026年5月15日 星期五 15:00 客户电话"] },
    ),
  );
  steps.push(
    await assertResponse("empty_list_reply", () =>
      send({
        text: "查一下5月20号日程",
        messageId: "p4_msg_empty_list",
        state,
        calendar,
        decisions,
        seenMessageIds,
      }),
      { actionType: "list_events", includes: ["没有找到 2026年5月20日 星期三 的日程"] },
    ),
  );
  steps.push(
    await assertResponse("empty_morning_briefing", () =>
      send({
        text: "发我今天早报",
        messageId: "p4_msg_empty_briefing",
        state,
        calendar,
        decisions,
        seenMessageIds,
        today: "2026-05-21",
      }),
      { actionType: "daily_briefing", includes: ["早报｜2026年5月21日 星期四", "这一天没有日程"] },
    ),
  );
  steps.push(await runDeleteConfirmationStep({ state, calendar, decisions, seenMessageIds }));
  steps.push(
    await assertResponse("duplicate_message_guard", () =>
      handleCalendarAgentRequest({
        text: "查一下今天日程",
        messageId: "p4_msg_create",
        requestId: "p4_req_duplicate_message_guard",
        state,
        calendar,
        decisionClient: decisions,
        seenMessageIds,
        today: TODAY,
        now: NOW,
        timezone: "Asia/Shanghai",
      }),
      { actionType: "rejected", ok: false, includes: ["已经处理过"] },
    ),
  );

  const failures = steps.filter((step) => !step.passed);
  return {
    ok: failures.length === 0,
    summary: { total: steps.length, passed: steps.length - failures.length, failed: failures.length },
    steps,
    failures,
  };
}

// 生成简短报告，只输出数量和失败步骤。
export function formatSelfUseObservationReport(result: SelfUseObservationResult): string {
  const lines = [
    `Self-use observation: ${result.ok ? "passed" : "failed"}`,
    `Total: ${result.summary.total}`,
    `Passed: ${result.summary.passed}`,
    `Failed: ${result.summary.failed}`,
  ];

  if (result.failures.length > 0) {
    lines.push("Failures:");
    for (const failure of result.failures) {
      lines.push(`- ${failure.id}: ${failure.message || failure.actionType}`);
    }
  }

  return lines.join("\n");
}

async function runDeleteConfirmationStep(input: {
  state: ReturnType<typeof createShortTermStateStore>;
  calendar: CalendarAdapter;
  decisions: DecisionClient;
  seenMessageIds: Set<string>;
}): Promise<SelfUseObservationStepResult> {
  const request = await send({
    text: "删掉刚才那个",
    messageId: "p4_msg_delete_request",
    state: input.state,
    calendar: input.calendar,
    decisions: input.decisions,
    seenMessageIds: input.seenMessageIds,
  });
  if (request.actionType !== "request_delete_event" || !request.reply.includes("确认删除")) {
    return { id: "delete_confirmation", passed: false, actionType: request.actionType, message: "删除请求没有进入确认态。" };
  }

  return assertResponse(
    "delete_confirmation",
    () =>
      send({
        text: "确认删除",
        messageId: "p4_msg_delete_confirm",
        state: input.state,
        calendar: input.calendar,
        decisions: input.decisions,
        seenMessageIds: input.seenMessageIds,
      }),
    { actionType: "confirm_delete", includes: ["已删除日程", "客户电话"] },
  );
}

async function assertResponse(
  id: string,
  run: () => Promise<CalendarAgentResponse>,
  expected: { actionType: string; ok?: boolean; includes: string[] },
): Promise<SelfUseObservationStepResult> {
  const response = await run();
  const expectedOk = expected.ok ?? true;
  if (response.actionType !== expected.actionType) {
    return { id, passed: false, actionType: response.actionType, message: `expected ${expected.actionType}` };
  }
  if (response.ok !== expectedOk) {
    return { id, passed: false, actionType: response.actionType, message: `expected ok ${expectedOk}` };
  }

  const missing = expected.includes.find((text) => !response.reply.includes(text));
  if (missing) return { id, passed: false, actionType: response.actionType, message: `missing ${missing}` };
  return { id, passed: true, actionType: response.actionType };
}

async function send(input: {
  text: string;
  messageId: string;
  state: ReturnType<typeof createShortTermStateStore>;
  calendar: CalendarAdapter;
  decisions: DecisionClient;
  seenMessageIds: Set<string>;
  today?: string;
}) {
  const response = await handleCalendarAgentRequest({
    text: input.text,
    messageId: input.messageId,
    requestId: `p4_req_${input.messageId}`,
    state: input.state,
    calendar: input.calendar,
    decisionClient: input.decisions,
    seenMessageIds: input.seenMessageIds,
    today: input.today || TODAY,
    now: NOW,
    timezone: "Asia/Shanghai",
  });
  if (response.actionType !== "rejected") input.seenMessageIds.add(input.messageId);
  return response;
}

function createScriptedDecisionClient(decisions: ScriptedDecision[]): DecisionClient {
  const queue = [...decisions];
  return {
    async decide(_request: DecisionRequest) {
      const next = queue.shift();
      if (!next) throw new Error("P4 模拟决策队列已用完。");
      return next.value;
    },
  };
}

function createObservationCalendar(): CalendarAdapter {
  const events: Array<{ id: string; title: string; date: string; startTime: string }> = [];

  return {
    async createEvent(event) {
      const created = { id: `evt_${events.length + 1}`, title: event.title, date: event.date, startTime: event.startTime };
      events.push(created);
      return { ok: true, data: toFeishuEvent(created) };
    },
    async listEvents(input) {
      return { ok: true, data: events.filter((event) => matchesListInput(event, input)).map(toFeishuEvent) };
    },
    async updateEvent(input) {
      const event = events.find((candidate) => candidate.id === input.eventId);
      if (!event) return notFound("没有找到日程。");
      if (input.patch.title) event.title = input.patch.title;
      if (input.patch.date) event.date = input.patch.date;
      if (input.patch.startTime) event.startTime = input.patch.startTime;
      return { ok: true, data: toFeishuEvent(event) };
    },
    async deleteEvent(input) {
      const index = events.findIndex((event) => event.id === input.eventId);
      if (index === -1) return notFound("没有找到日程。");
      events.splice(index, 1);
      return { ok: true, data: { eventId: input.eventId } };
    },
  };
}

function matchesListInput(event: { date: string }, input: ListEventsInput): boolean {
  if (input.date) return event.date === input.date;
  if (input.range) return event.date >= input.range.startDate && event.date <= input.range.endDate;
  return true;
}

function toFeishuEvent(event: { id: string; title: string; date: string; startTime: string }): FeishuCalendarEvent {
  return { id: event.id, title: event.title, start: `${event.date} ${event.startTime}` };
}

function notFound<T extends FeishuCalendarEvent | DeleteEventResult>(message: string): FeishuResult<T> {
  return { ok: false, code: "not_found", message };
}
