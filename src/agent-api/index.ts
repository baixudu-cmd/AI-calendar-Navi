// Calendar Agent API Bridge：未来给 OpenClaw 独立日程 Agent 调用的受控入口。

import { executeDailyBriefing, resolveBriefingItemUpdate } from "../briefing/index.js";
import { executeCalendarAction, type CalendarAdapter } from "../calendar/action-executor.js";
import { detectCreateConflicts } from "../calendar/conflict-guard.js";
import type { FeishuCalendarEvent } from "../calendar/feishu/types.js";
import { normalizeExplicitWeekdayCreateDates } from "../calendar/weekday-guard.js";
import type { ClarifyEventDraftRepairer } from "../clarify-repair/index.js";
import { deleteEvent, deleteManyEvents } from "../calendar-api/index.js";
import type { EnvSource } from "../config/index.js";
import type { CalendarAction, EventQuery, EventQueryReference, SchedulePreferredWindow } from "../contract/index.js";
import type { DecisionClient } from "../decision/index.js";
import { protectIncomingMessage } from "../entry/index.js";
import type { ImageDraftParser, ImageCalendarDraftParseResult } from "../image-capture/index.js";
import { runDecisionLoop } from "../loop/index.js";
import type { MemoryDreamCreatedEvent, MemoryDreamScheduleFeedback, MemoryDreamStore } from "../memory-dream/index.js";
import { formatCalendarDateLabel, formatCalendarEventDetail, formatCalendarEventLine } from "../reply/event-format.js";
import { buildActionReply } from "../reply/index.js";
import { buildSettingsSummary } from "../settings-summary/index.js";
import { buildStatusOverview } from "../status-overview/index.js";
import { briefingItemStateFromCalendarEvent, lastEventStateFromCalendarEvent } from "../state/calendar-event.js";
import type { BriefingItemState, PendingConflictState, PendingDeleteItemState, PendingDeleteState, PendingScheduleState, ShortTermStateStore } from "../state/index.js";
import { expirePendingInteractionState } from "../state/lifecycle.js";
import type { SeedLiteStore } from "../seed-lite/index.js";
import { buildWechatReminderJobs, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES, normalizeLeadMinutes, type WechatReminderStore } from "../wechat-reminder/index.js";
import { executeScheduleProposal, resolveScheduleConfirmation } from "./schedule-flow.js";
import {
  captureSeedLite,
  buildSeedLiteStatePatch,
  completeSeedLiteSources,
  executeTodoInboxAction,
  formatSeedCaptureReply,
  formatTodoInboxFailureReply,
  resolveScheduleTodoTargets,
  scheduleFallbackItemsFromSeedLite,
} from "./todo-inbox.js";

export type CalendarAgentRequest = {
  text: string;
  media?: CalendarAgentMedia;
  state: ShortTermStateStore;
  decisionClient: DecisionClient;
  calendar: CalendarAdapter;
  requestId?: string;
  messageId?: string;
  seenMessageIds?: ReadonlySet<string>;
  today?: string;
  now?: string;
  timezone?: string;
  seedStore?: SeedLiteStore;
  wechatReminderStore?: WechatReminderStore;
  defaultWechatReminderLeadMinutes?: number[];
  imageDraftParser?: ImageDraftParser;
  clarifyEventDraftRepairer?: ClarifyEventDraftRepairer;
  memoryDreamStore?: MemoryDreamStore;
  settingsEnv?: EnvSource;
};

export type CalendarAgentMedia = {
  path: string;
  type: string;
};

export type CalendarAgentResponse = {
  ok: boolean;
  reply: string;
  actionType: string;
  requestId: string;
  createdEvents?: MemoryDreamCreatedEvent[];
  scheduleFeedback?: MemoryDreamScheduleFeedback;
};

type UpdateEventPatch = Extract<CalendarAction, { type: "update_event" }>["patch"];

// 处理单次 Calendar Agent 请求；不绑定微信，不访问真实外部服务。
export async function handleCalendarAgentRequest(input: CalendarAgentRequest): Promise<CalendarAgentResponse> {
  const requestId = input.requestId || `agent_${Date.now()}`;
  const result = await handleCalendarAgentRequestCore(input, requestId);
  await recordMemoryDreamObservation(input, result, requestId);
  return result;
}

async function handleCalendarAgentRequestCore(input: CalendarAgentRequest, requestId: string): Promise<CalendarAgentResponse> {
  const protectedInput = protectIncomingMessage(
    { id: input.messageId || requestId, text: input.text || (input.media ? "用户发送了一张图片" : "") },
    input.seenMessageIds,
  );
  if (!protectedInput.ok) {
    return { ok: false, reply: protectedInput.message, actionType: "rejected", requestId };
  }

  if (input.media) {
    expirePendingInteractionState(input.state, "media_request");
    return handleMediaRequest(input.media, requestId, input, input.imageDraftParser, protectedInput.message.text);
  }

  if (input.seedStore) {
    syncSeedItemsForDecision(input.state, await input.seedStore.list());
  }

  const loopResult = await runDecisionLoop({
    message: protectedInput.message,
    state: input.state,
    decisionClient: input.decisionClient,
    now: input.now,
    timezone: input.timezone,
  });

  if (!loopResult.ok) {
    return { ok: false, reply: loopResult.message, actionType: "rejected", requestId };
  }

  expirePendingInteractionState(input.state, loopResult.action);

  if (loopResult.action.type === "remember_todo") {
    const existingReminder = findExistingReminderTodo(loopResult.action.title, input.state);
    if (existingReminder) {
      return executeCalendarAgentAction({
        action: {
          type: "create_event",
          event: {
            title: existingReminder.title,
            date: existingReminder.date,
            startTime: existingReminder.startTime,
            reminderAtStart: true,
            sourceIds: [existingReminder.seedId],
          },
        },
        requestId,
        sourceText: protectedInput.message.text,
        input,
      });
    }

    const seed = await captureSeedLite({
      title: loopResult.action.title,
      sourceText: protectedInput.message.text,
      createdAt: input.now,
      state: input.state,
      seedStore: input.seedStore,
    });
    if (loopResult.action.autoSchedule !== false) {
      return executeAutoScheduleTodo({
        title: seed.title,
        sourceIds: [seed.seedId],
        date: loopResult.action.date,
        preferredWindow: loopResult.action.preferredWindow,
        input,
        requestId,
        sourceText: protectedInput.message.text,
      });
    }
    return { ok: true, reply: formatSeedCaptureReply(seed.title), actionType: "seed_lite", requestId };
  }

  if (loopResult.action.type === "manage_todos") {
    const result = await executeTodoInboxAction(loopResult.action, input.seedStore, input.state);
    return { ...result, actionType: "manage_todos", requestId };
  }

  if (loopResult.action.type === "clarify") {
    const repairedDraft = await repairClarifyEventDraft({
      action: loopResult.action,
      sourceText: protectedInput.message.text,
      input,
    });
    if (repairedDraft.ok) {
      input.state.clearPendingClarification();
      return executeCalendarAgentAction({
        action: { type: "create_event", event: repairedDraft.draft },
        input,
        requestId,
        sourceText: protectedInput.message.text,
      });
    }
    if (repairedDraft.message && (repairedDraft.missing || repairedDraft.createDraft)) {
      input.state.update({
        pending_clarification: {
          question: repairedDraft.message,
          missing: repairedDraft.missing || loopResult.action.missing,
          ...(repairedDraft.createDraft ? { createDraft: repairedDraft.createDraft } : {}),
        },
      });
      return { ok: true, reply: repairedDraft.message, actionType: "clarify", requestId };
    }
    if (isSeedLiteCandidate(loopResult.action)) {
      const seed = await captureSeedLite({
        title: loopResult.action.createDraft.title,
        sourceText: protectedInput.message.text,
        createdAt: input.now,
        state: input.state,
        seedStore: input.seedStore,
      });
      return { ok: true, reply: formatSeedCaptureReply(seed.title), actionType: "seed_lite", requestId };
    }
    return { ok: true, reply: buildActionReply(loopResult.action), actionType: "clarify", requestId };
  }

  if (loopResult.action.type === "request_delete_event") {
    const pendingDelete = await resolvePendingDelete(loopResult.action, input.state, input.calendar);
    if (!pendingDelete.ok) {
      return { ok: false, reply: `没有成功：${pendingDelete.message}`, actionType: "request_delete_event", requestId };
    }
    input.state.update({ pending_delete: pendingDelete.pendingDelete });
    if (pendingDelete.pendingDelete.source === "event_query" && "items" in pendingDelete.pendingDelete) {
      return {
        ok: true,
        reply: `匹配到多个日程：\n${formatPendingDeleteItemsForReply(pendingDelete.pendingDelete.items)}\n请回复要删除第几个；不删可回复取消或算了。`,
        actionType: "request_delete_event",
        requestId,
      };
    }
    return {
      ok: true,
      reply: `确认删除：${pendingDelete.pendingDelete.title}？要删可以回复 OK 或确认；不删可回复取消或算了。`,
      actionType: "request_delete_event",
      requestId,
    };
  }

  if (loopResult.action.type === "request_delete_events") {
    const pendingDelete = await resolvePendingBatchDelete(loopResult.action.query, input.calendar);
    if (!pendingDelete.ok) {
      return { ok: false, reply: `没有成功：${pendingDelete.message}`, actionType: "request_delete_events", requestId };
    }
    input.state.update({ pending_delete: pendingDelete.pendingDelete });
    return {
      ok: true,
      reply: `确认删除以下 ${pendingDelete.pendingDelete.eventIds.length} 个日程：\n${formatPendingDeleteItemsForReply(pendingDelete.pendingDelete.items)}\n要删可以回复 OK 或确认；不删可回复取消或算了。`,
      actionType: "request_delete_events",
      requestId,
    };
  }

  if (loopResult.action.type === "confirm_delete") {
    const confirmation = await executeDeleteConfirmation(
      loopResult.action.confirmed,
      input.state,
      input.calendar,
      input.wechatReminderStore,
      loopResult.action.itemNumbers,
    );
    return { ...confirmation, actionType: "confirm_delete", requestId };
  }

  if (loopResult.action.type === "confirm_create") {
    const confirmation = await executePendingConflictControl({
      confirmed: loopResult.action.confirmed,
      state: input.state,
      calendar: input.calendar,
      seedStore: input.seedStore,
      wechatReminderStore: input.wechatReminderStore,
      defaultWechatReminderLeadMinutes: input.defaultWechatReminderLeadMinutes || DEFAULT_WECHAT_REMINDER_LEAD_MINUTES,
    });
    return { ...confirmation, requestId };
  }

  if (loopResult.action.type === "create_and_propose_schedule") {
    return executeCreateAndProposeSchedule({
      action: loopResult.action,
      input,
      requestId,
      sourceText: protectedInput.message.text,
    });
  }

  if (loopResult.action.type === "update_and_create_events") {
    return executeUpdateAndCreateEvents({
      action: loopResult.action,
      input,
      requestId,
      sourceText: protectedInput.message.text,
    });
  }

  if (loopResult.action.type === "propose_schedule") {
    const scheduleAction = await resolveScheduleTodoTargets(loopResult.action, input.seedStore, input.state);
    if (!scheduleAction.ok) {
      return { ok: false, reply: formatTodoInboxFailureReply(scheduleAction.message, scheduleAction.items), actionType: "propose_schedule", requestId };
    }
    const proposal = await executeScheduleProposal({
      action: scheduleAction.action,
      calendar: input.calendar,
      state: input.state,
      memoryDreamStore: input.memoryDreamStore,
      fallbackItems: await scheduleFallbackItemsFromSeedLite(input.seedStore, input.state),
      defaultDate: scheduleAction.defaultDate || defaultAutoScheduleDate(input.now),
      defaultStartTime: scheduleAction.defaultStartTime || (shouldUseAutoScheduleStartTime(scheduleAction.action) ? defaultAutoScheduleStartTime(input.now) : undefined),
    });
    if (proposal.ok && scheduleAction.action.autoCreate) {
      const autoCreated = await executeCurrentScheduleSelection({
        input,
        requestId,
        sourceText: protectedInput.message.text,
      });
      return autoCreated;
    }
    return { ...proposal, requestId };
  }

  if (loopResult.action.type === "confirm_schedule") {
    const pendingSchedule = input.state.snapshot().pending_schedule;
    const scheduleFeedback = buildScheduleFeedback(loopResult.action, pendingSchedule);
    const confirmation = resolveScheduleConfirmation({ action: loopResult.action, state: input.state });
    if (!confirmation.ok) return { ok: false, reply: `没有成功：${confirmation.message}`, actionType: "confirm_schedule", requestId };
    if ("canceled" in confirmation) return { ok: true, reply: "已取消安排。", actionType: "confirm_schedule_cancel", requestId, ...(scheduleFeedback ? { scheduleFeedback } : {}) };
    const result = await executeCalendarAgentAction({
      action: confirmation.action,
      input,
      requestId,
      sourceText: protectedInput.message.text,
    });
    if (isCreatedActionType(result.actionType)) await completeSeedLiteSources(confirmation.completedSourceIds || [], input.seedStore, input.state);
    return { ...result, ...(scheduleFeedback ? { scheduleFeedback } : {}) };
  }

  if (loopResult.action.type === "daily_briefing") {
    const briefing = await executeDailyBriefing({
      briefingType: loopResult.action.briefingType,
      date: loopResult.action.date,
      today: input.today || todayInShanghai(),
      state: input.state,
      calendar: input.calendar,
      seedStore: input.seedStore,
    });
    return { ok: briefing.ok, reply: briefing.reply, actionType: "daily_briefing", requestId };
  }

  if (loopResult.action.type === "settings_summary") {
    return {
      ok: true,
      reply: buildSettingsSummary({
        topic: loopResult.action.topic,
        env: input.settingsEnv,
        defaultWechatReminderLeadMinutes: input.defaultWechatReminderLeadMinutes || DEFAULT_WECHAT_REMINDER_LEAD_MINUTES,
      }),
      actionType: "settings_summary",
      requestId,
    };
  }

  if (loopResult.action.type === "status_overview") {
    const seedItems = input.seedStore ? await input.seedStore.list() : undefined;
    if (seedItems) syncSeedItemsForDecision(input.state, seedItems);
    return {
      ok: true,
      reply: buildStatusOverview({
        state: input.state.snapshot(),
        seedItems,
      }),
      actionType: "status_overview",
      requestId,
    };
  }

  if (loopResult.action.type === "dismiss_context") {
    clearPendingContext(input.state);
    return { ok: true, reply: "已清空当前待处理上下文。待推进收件箱和已创建日程都不会受影响。", actionType: "dismiss_context", requestId };
  }

  return executeCalendarAgentAction({
    action: loopResult.action,
    input,
    requestId,
    sourceText: protectedInput.message.text,
  });
}

function syncSeedItemsForDecision(state: ShortTermStateStore, items: Awaited<ReturnType<SeedLiteStore["list"]>>) {
  state.update(buildSeedLiteStatePatch(items));
}

function clearPendingContext(state: ShortTermStateStore) {
  state.clearPendingClarification();
  state.clearPendingDelete();
  state.clearPendingConflict();
  state.clearPendingSchedule();
  state.clearPendingImageDraft();
}

async function executeCreateAndProposeSchedule(input: {
  action: Extract<CalendarAction, { type: "create_and_propose_schedule" }>;
  input: CalendarAgentRequest;
  requestId: string;
  sourceText: string;
}): Promise<CalendarAgentResponse> {
  const createAction: CalendarAction =
    input.action.events.length === 1
      ? { type: "create_event", event: input.action.events[0] }
      : { type: "create_events", events: input.action.events };

  const created = await executeCalendarAgentAction({
    action: createAction,
    input: input.input,
    requestId: input.requestId,
    sourceText: input.sourceText,
  });
  if (!created.ok || (!isCreatedActionType(created.actionType) && created.actionType !== "create_conflict")) return created;

  const proposalAction: Extract<CalendarAction, { type: "propose_schedule" }> = {
    type: "propose_schedule",
    ...(input.action.date ? { date: input.action.date } : {}),
    items: input.action.items,
    ...(input.action.preferredStartTime ? { preferredStartTime: input.action.preferredStartTime } : {}),
    ...(input.action.preferredWindow ? { preferredWindow: input.action.preferredWindow } : {}),
    ...(input.action.optionCount ? { optionCount: input.action.optionCount } : {}),
  };
  const proposal = await executeScheduleProposal({
    action: proposalAction,
    calendar: input.input.calendar,
    state: input.input.state,
    memoryDreamStore: input.input.memoryDreamStore,
    fallbackItems: await scheduleFallbackItemsFromSeedLite(input.input.seedStore, input.input.state),
    defaultDate: input.action.date || defaultAutoScheduleDate(input.input.now),
    defaultStartTime: undefined,
  });
  if (!proposal.ok) {
    return {
      ok: true,
      reply: `${created.reply}\n\n但后面的事项还没排上：${proposal.reply.replace(/^没有成功：/, "")}`,
      actionType: "create_and_propose_schedule",
      requestId: input.requestId,
      ...(created.createdEvents ? { createdEvents: created.createdEvents } : {}),
    };
  }

  return {
    ok: true,
    reply: `${created.reply}\n\n${proposal.reply}`,
    actionType: "create_and_propose_schedule",
    requestId: input.requestId,
    ...(created.createdEvents ? { createdEvents: created.createdEvents } : {}),
  };
}

async function executeUpdateAndCreateEvents(input: {
  action: Extract<CalendarAction, { type: "update_and_create_events" }>;
  input: CalendarAgentRequest;
  requestId: string;
  sourceText: string;
}): Promise<CalendarAgentResponse> {
  const replies: string[] = [];

  for (const update of input.action.updates) {
    const updated = await executeCalendarAgentAction({
      action: { type: "update_event", target: update.target, patch: update.patch },
      input: input.input,
      requestId: input.requestId,
      sourceText: input.sourceText,
    });
    if (!updated.ok) return { ...updated, actionType: "update_and_create_events" };
    replies.push(updated.reply);
  }

  const createAction: CalendarAction =
    input.action.events.length === 1
      ? { type: "create_event", event: input.action.events[0] }
      : { type: "create_events", events: input.action.events };
  const created = await executeCalendarAgentAction({
    action: createAction,
    input: input.input,
    requestId: input.requestId,
    sourceText: input.sourceText,
  });
  if (!created.ok) return { ...created, reply: [...replies, created.reply].join("\n\n"), actionType: "update_and_create_events" };

  return {
    ok: true,
    reply: [...replies, created.reply].join("\n\n"),
    actionType: "update_and_create_events",
    requestId: input.requestId,
    ...(created.createdEvents ? { createdEvents: created.createdEvents } : {}),
  };
}

async function repairClarifyEventDraft(input: {
  action: Extract<CalendarAction, { type: "clarify" }>;
  sourceText: string;
  input: CalendarAgentRequest;
}): Promise<
  | { ok: true; draft: Extract<CalendarAction, { type: "create_event" }>["event"] }
  | { ok: false; message?: string; missing?: string[]; createDraft?: Partial<Extract<CalendarAction, { type: "create_event" }>["event"]> }
> {
  if (!input.input.clarifyEventDraftRepairer) return { ok: false };
  try {
    const repaired = await input.input.clarifyEventDraftRepairer({
      sourceText: input.sourceText,
      clarify: input.action,
      now: input.input.now,
      timezone: input.input.timezone,
    });
    if (!repaired.ok) {
      return {
        ok: false,
        message: repaired.message,
        missing: repaired.missing,
        createDraft: repaired.createDraft,
      };
    }
    return { ok: true, draft: repaired.draft };
  } catch (error) {
    console.warn(`clarify event draft repair skipped: ${error instanceof Error ? error.message : "unknown error"}`);
    return { ok: false };
  }
}

function findExistingReminderTodo(title: string, state: ShortTermStateStore): { seedId: string; title: string; date: string; startTime: string } | null {
  const item = (state.snapshot().seed_items || []).find((candidate) => candidate.title === title.trim());
  if (!item?.reminderAt) return null;
  const [date, startTime] = item.reminderAt.trim().split(" ");
  if (!isDateText(date) || !isTimeText(startTime)) return null;
  return { seedId: item.seedId, title: item.title, date, startTime };
}

function isDateText(value: string | undefined): value is string {
  if (!value) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isTimeText(value: string | undefined): value is string {
  if (!value) return false;
  const [hour, minute] = value.split(":").map(Number);
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

async function executeAutoScheduleTodo(input: {
  title: string;
  sourceIds: string[];
  date: string | undefined;
  preferredWindow: SchedulePreferredWindow | undefined;
  input: CalendarAgentRequest;
  requestId: string;
  sourceText: string;
}): Promise<CalendarAgentResponse> {
  const proposal = await executeScheduleProposal({
    action: {
      type: "propose_schedule",
      date: input.date,
      items: [{ title: input.title, sourceIds: input.sourceIds }],
      ...(input.preferredWindow ? { preferredWindow: input.preferredWindow } : {}),
    },
    calendar: input.input.calendar,
    state: input.input.state,
    memoryDreamStore: input.input.memoryDreamStore,
    defaultDate: defaultAutoScheduleDate(input.input.now),
    defaultStartTime: defaultAutoScheduleStartTime(input.input.now),
  });
  if (!proposal.ok) return { ...proposal, requestId: input.requestId };
  return executeCurrentScheduleSelection({
    input: input.input,
    requestId: input.requestId,
    sourceText: input.sourceText,
  });
}

async function executeCurrentScheduleSelection(input: {
  input: CalendarAgentRequest;
  requestId: string;
  sourceText: string;
}): Promise<CalendarAgentResponse> {
  const confirmation = resolveScheduleConfirmation({
    action: { type: "confirm_schedule", confirmed: true },
    state: input.input.state,
  });
  if (!confirmation.ok) return { ok: false, reply: `没有成功：${confirmation.message}`, actionType: "confirm_schedule", requestId: input.requestId };
  if ("canceled" in confirmation) return { ok: true, reply: "已取消安排。", actionType: "confirm_schedule_cancel", requestId: input.requestId };
  const result = await executeCalendarAgentAction({
    action: confirmation.action,
    input: input.input,
    requestId: input.requestId,
    sourceText: input.sourceText,
  });
  if (isCreatedActionType(result.actionType)) await completeSeedLiteSources(confirmation.completedSourceIds || [], input.input.seedStore, input.input.state);
  return result;
}

// 记录日程助手自己的交互样本；失败不能影响用户看到的日程处理结果。
async function recordMemoryDreamObservation(input: CalendarAgentRequest, result: CalendarAgentResponse, requestId: string) {
  if (!input.memoryDreamStore) return;
  try {
    await input.memoryDreamStore.addObservation({
      observedAt: input.now || new Date().toISOString(),
      requestId,
      ...(input.messageId ? { messageId: input.messageId } : {}),
      sourceText: input.text || (input.media ? "用户发送了一张图片" : ""),
      ...(input.media?.type ? { mediaType: input.media.type } : {}),
      actionType: result.actionType,
      ok: result.ok,
      reply: result.reply,
      ...(result.createdEvents ? { createdEvents: result.createdEvents } : {}),
      ...(result.scheduleFeedback ? { scheduleFeedback: result.scheduleFeedback } : {}),
    });
  } catch (error) {
    console.warn(`memory dream observation skipped: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function buildScheduleFeedback(
  action: Extract<CalendarAction, { type: "confirm_schedule" }>,
  pendingSchedule: PendingScheduleState | undefined,
): MemoryDreamScheduleFeedback | undefined {
  if (!pendingSchedule) return undefined;
  if (!action.confirmed) {
    return { kind: "schedule_canceled", reasonCodes: ["schedule_feedback_canceled"] };
  }

  const option = pendingSchedule.options.find((candidate) => candidate.optionNumber === (action.optionNumber || 1));
  const changedStartTimes = uniqueStrings((action.itemChanges || []).map((item) => item.startTime).filter((time): time is string => Boolean(time)));
  const changedDates = uniqueStrings((action.itemChanges || []).map((item) => item.date).filter((date): date is string => Boolean(date)));
  if (changedStartTimes.length > 0 || changedDates.length > 0) {
    return {
      kind: "schedule_time_changed",
      ...(changedDates.length === 1 ? { targetDate: changedDates[0] } : {}),
      preferredStartTimes: changedStartTimes,
      reasonCodes: [
        ...(changedDates.length > 0 ? ["schedule_feedback_changed_date"] : []),
        ...(changedStartTimes.length > 0 ? ["schedule_feedback_changed_time"] : []),
      ],
    };
  }

  const changedReminderMinutes = uniqueReminderMinutes((action.itemChanges || []).flatMap((item) => normalizeReminderMinutesList(item.reminderMinutes)));
  if (changedReminderMinutes.length > 0) {
    return {
      kind: "schedule_reminder_changed",
      preferredReminderMinutes: changedReminderMinutes,
      reasonCodes: changedReminderMinutes.includes(0) ? ["schedule_feedback_reminder_disabled"] : ["schedule_feedback_reminder_changed"],
    };
  }

  if (option && action.optionNumber && action.optionNumber !== 1) {
    return {
      kind: "schedule_option_selected",
      preferredStartTimes: uniqueStrings(option.items.map((item) => item.startTime)),
      reasonCodes: ["schedule_feedback_selected_option"],
    };
  }

  return undefined;
}

function normalizeReminderMinutesList(value: number | number[] | undefined): number[] {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return [value];
  if (!Array.isArray(value)) return [];
  const positives = [...new Set(value.filter((item): item is number => Number.isInteger(item) && item > 0))].sort((a, b) => b - a).slice(0, 3);
  if (positives.length > 0) return positives;
  return value.some((item) => item === 0) ? [0] : [];
}

function uniqueReminderMinutes(values: number[]): number[] {
  const positives = [...new Set(values.filter((item) => Number.isInteger(item) && item > 0))].sort((a, b) => b - a).slice(0, 3);
  if (positives.length > 0) return positives;
  return values.some((item) => item === 0) ? [0] : [];
}

function uniqueStrings(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

async function handleMediaRequest(
  media: CalendarAgentMedia,
  requestId: string,
  input: CalendarAgentRequest,
  imageDraftParser: ImageDraftParser | undefined,
  sourceText: string,
): Promise<CalendarAgentResponse> {
  if (!media.path || !media.type.startsWith("image/")) {
    return {
      ok: false,
      reply: "暂时只支持图片，其他文件不会进入日程助手。",
      actionType: "image_capture_rejected",
      requestId,
    };
  }

  if (imageDraftParser) {
    let parsed: ImageCalendarDraftParseResult;
    try {
      parsed = await imageDraftParser({ path: media.path, type: media.type });
    } catch {
      return {
        ok: false,
        reply: "图片内容没有识别清楚，本次不会写入日历。",
        actionType: "image_calendar_draft_rejected",
        requestId,
      };
    }

    if (!parsed.ok) {
      return {
        ok: false,
        reply: parsed.message,
        actionType: "image_calendar_draft_rejected",
        requestId,
      };
    }

    return executeCalendarAgentAction({
      action: { type: "create_event", event: parsed.draft },
      input,
      requestId,
      sourceText: parsed.sourceText || sourceText,
    });
  }

  return {
    ok: true,
    reply: "已收到图片。图片解析还未启用，本次不会写入日历。",
    actionType: "image_capture_dry_run",
    requestId,
  };
}

async function executeCalendarAgentAction(input: {
  action: CalendarAction;
  requestId: string;
  sourceText: string;
  input: CalendarAgentRequest;
}): Promise<CalendarAgentResponse> {
  const executableAction = await resolveExecutableAction(input.action, input.input.state, input.input.calendar);
  if (!executableAction.ok) {
    return { ok: false, reply: `没有成功：${executableAction.message}`, actionType: input.action.type, requestId: input.requestId };
  }

  const weekdayGuard = normalizeExplicitWeekdayCreateDates({
    text: input.sourceText,
    action: executableAction.action,
    now: input.input.now,
    timezone: input.input.timezone,
  });
  if (!weekdayGuard.ok) {
    return { ok: false, reply: `没有成功：${weekdayGuard.message}`, actionType: executableAction.action.type, requestId: input.requestId };
  }
  const normalizedAction = weekdayGuard.action;
  const stateBackedReminderGuard = validateStateBackedReminderEvidence(normalizedAction, input.input.state);
  if (!stateBackedReminderGuard.ok) {
    return { ok: false, reply: `没有成功：${stateBackedReminderGuard.message}`, actionType: normalizedAction.type, requestId: input.requestId };
  }

  const createConflicts = await detectCreateConflicts(normalizedAction, input.input.calendar);
  if (!createConflicts.ok) {
    return { ok: false, reply: `没有成功：${createConflicts.message}`, actionType: normalizedAction.type, requestId: input.requestId };
  }
  if (createConflicts.conflicts.length > 0 && isCreateAction(normalizedAction)) {
    input.input.state.update({
      pending_conflict: {
        action: normalizedAction,
        conflicts: createConflicts.conflicts,
      },
    });
    return { ok: true, reply: buildConflictReply(createConflicts.conflicts, normalizedAction), actionType: "create_conflict", requestId: input.requestId };
  }

  const execution = await executeCalendarAction(normalizedAction, input.input.calendar);
  if (execution.ok) {
    const updateVerification = verifyUpdateExecutionResult(normalizedAction, execution.data);
    if (!updateVerification.ok) {
      return { ok: false, reply: `没有成功：${updateVerification.message}`, actionType: normalizedAction.type, requestId: input.requestId };
    }
    updateState(input.input.state, normalizedAction, execution.data);
    if (normalizedAction.type === "create_event") input.input.state.clearPendingImageDraft();
    await registerWechatReminders({
      action: normalizedAction,
      data: execution.data,
      store: input.input.wechatReminderStore,
      defaultLeads: input.input.defaultWechatReminderLeadMinutes || DEFAULT_WECHAT_REMINDER_LEAD_MINUTES,
    });
    await refreshWechatRemindersAfterUpdate({
      action: normalizedAction,
      data: execution.data,
      store: input.input.wechatReminderStore,
      defaultLeads: input.input.defaultWechatReminderLeadMinutes || DEFAULT_WECHAT_REMINDER_LEAD_MINUTES,
    });
    await completeCreatedSeedSources(normalizedAction, input.input.seedStore, input.input.state);
  }

  const createdEvents = execution.ok && isCreateAction(normalizedAction) ? createdEventsFromCalendarData(execution.data) : [];
  return {
    ok: execution.ok,
    reply: buildActionReply(normalizedAction, execution),
    actionType: normalizedAction.type,
    requestId: input.requestId,
    ...(createdEvents.length > 0 ? { createdEvents } : {}),
  };
}

async function resolvePendingDelete(
  action: Extract<CalendarAction, { type: "request_delete_event" }>,
  state: ShortTermStateStore,
  calendar: CalendarAdapter,
): Promise<{ ok: true; pendingDelete: PendingDeleteState } | { ok: false; message: string }> {
  const snapshot = state.snapshot();
  const target = action.target;

  if (target.kind === "last_event") {
    if (!snapshot.last_event) return { ok: false, message: "没有找到刚才那个日程。" };
    return {
      ok: true,
      pendingDelete: {
        eventId: snapshot.last_event.eventId,
        title: snapshot.last_event.title,
        source: "last_event",
        date: snapshot.last_event.date,
        startTime: snapshot.last_event.startTime,
      },
    };
  }

  if (target.kind === "event_query") {
    return resolvePendingDeleteByEventQuery(target, state, calendar);
  }

  const source = target.kind === "recent_event_item" ? "recent_event_item" : "briefing_item";
  const item = target.kind === "recent_event_item"
    ? snapshot.recent_event_items?.find((candidate) => candidate.itemNumber === target.itemNumber)
    : snapshot.briefing_items?.find((candidate) => candidate.itemNumber === target.itemNumber);
  if (!item) {
    const label = target.kind === "recent_event_item" ? "刚才展示的日程" : "日报";
    return { ok: false, message: `没有找到${label}里的第 ${target.itemNumber} 条。` };
  }

  return {
    ok: true,
    pendingDelete: {
      eventId: item.eventId,
      title: item.title,
      source,
      itemNumber: item.itemNumber,
      date: item.date,
      startTime: item.startTime,
    },
  };
}

async function resolvePendingDeleteByEventQuery(
  target: EventQueryReference,
  state: ShortTermStateStore,
  calendar: CalendarAdapter,
): Promise<{ ok: true; pendingDelete: PendingDeleteState } | { ok: false; message: string }> {
  const matches = await findEventsByStructuredQuery(target, state, calendar);
  if (!matches.ok) return matches;
  if (matches.events.length === 0) return { ok: false, message: "没有找到匹配的日程。" };

  const items = matches.events.map(pendingDeleteItemFromCalendarEvent);
  if (items.length === 1) {
    return { ok: true, pendingDelete: { ...items[0], source: "event_query" } };
  }

  return {
    ok: true,
    pendingDelete: {
      source: "event_query",
      title: `匹配到的 ${items.length} 个日程`,
      eventIds: items.map((item) => item.eventId),
      items,
      requireSelection: true,
      ...(target.date ? { date: target.date } : {}),
      ...(target.range ? { range: target.range } : {}),
    },
  };
}

async function resolvePendingBatchDelete(
  query: EventQuery,
  calendar: CalendarAdapter,
): Promise<{ ok: true; pendingDelete: PendingDeleteState & { source: "date_query" } } | { ok: false; message: string }> {
  const listed = await calendar.listEvents(query);
  if (!listed.ok) return { ok: false, message: listed.message };
  if (listed.data.length === 0) return { ok: false, message: "没有找到要删除的日程。" };

  const items = listed.data.map((event) => pendingDeleteItemFromCalendarEvent(event));
  return {
    ok: true,
    pendingDelete: {
      source: "date_query",
      title: `${formatQueryLabel(query)}的 ${items.length} 个日程`,
      eventIds: items.map((item) => item.eventId),
      items,
      ...query,
    },
  };
}

async function findEventsByStructuredQuery(
  target: EventQueryReference,
  state: ShortTermStateStore,
  calendar: CalendarAdapter,
): Promise<{ ok: true; events: FeishuCalendarEvent[] } | { ok: false; message: string }> {
  const candidates = target.date || target.range ? await listCalendarEventsForStructuredQuery(target, calendar) : eventsFromShortTermState(state);
  if (!candidates.ok) return candidates;
  return { ok: true, events: candidates.events.filter((event) => eventMatchesStructuredQuery(event, target)) };
}

async function listCalendarEventsForStructuredQuery(
  target: EventQueryReference,
  calendar: CalendarAdapter,
): Promise<{ ok: true; events: FeishuCalendarEvent[] } | { ok: false; message: string }> {
  const query = target.date ? { date: target.date } : target.range ? { range: target.range } : undefined;
  if (!query) return { ok: true, events: [] };
  const result = await calendar.listEvents(query);
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, events: result.data };
}

function eventsFromShortTermState(state: ShortTermStateStore): { ok: true; events: FeishuCalendarEvent[] } {
  const snapshot = state.snapshot();
  const seen = new Set<string>();
  const events: FeishuCalendarEvent[] = [];
  const addItem = (item: { eventId: string; title: string; date?: string; startTime?: string }) => {
    if (seen.has(item.eventId)) return;
    seen.add(item.eventId);
    events.push({ id: item.eventId, title: item.title, start: item.date && item.startTime ? `${item.date} ${item.startTime}` : "" });
  };
  if (snapshot.last_event) addItem(snapshot.last_event);
  for (const item of snapshot.briefing_items || []) addItem(item);
  for (const item of snapshot.recent_event_items || []) addItem(item);
  return { ok: true, events };
}

function eventMatchesStructuredQuery(event: FeishuCalendarEvent, target: EventQueryReference): boolean {
  const parsed = parseEventStart(event.start);
  if (target.date && parsed.date !== target.date) return false;
  if (target.range && (!parsed.date || parsed.date < target.range.startDate || parsed.date > target.range.endDate)) return false;
  if (target.startTime && parsed.startTime !== target.startTime) return false;
  if (target.timeWindow && !timeBelongsToWindow(parsed.startTime, target.timeWindow)) return false;
  if (target.title && !eventTitleMatchesStructuredTarget(event.title, target.title, Boolean(target.date || target.range), Boolean(target.startTime || target.timeWindow))) return false;
  return true;
}

function timeBelongsToWindow(startTime: string | undefined, window: NonNullable<EventQueryReference["timeWindow"]>): boolean {
  if (!startTime) return false;
  const hour = Number(startTime.slice(0, 2));
  if (!Number.isInteger(hour)) return false;
  if (window === "morning") return hour >= 5 && hour < 12;
  if (window === "afternoon") return hour >= 12 && hour < 18;
  return hour >= 18 && hour <= 23;
}

function normalizeMatchText(value: string): string {
  return Array.from(value.normalize("NFKC").toLowerCase())
    .filter((char) => char.trim().length > 0)
    .join("");
}

function eventTitleMatchesStructuredTarget(eventTitle: string, targetTitle: string, hasDateScope: boolean, hasTimeScope: boolean): boolean {
  const eventText = normalizeMatchText(eventTitle);
  const targetText = normalizeMatchText(targetTitle);
  if (!targetText) return true;
  if (eventText.includes(targetText)) return true;
  if (!hasDateScope || !hasTimeScope) return false;

  const commonLength = longestCommonSubsequenceLength(eventText, targetText);
  return commonLength >= 2 && commonLength / targetText.length >= 0.5;
}

function longestCommonSubsequenceLength(left: string, right: string): number {
  const previous = Array(right.length + 1).fill(0);
  const current = Array(right.length + 1).fill(0);
  for (const leftChar of left) {
    for (let index = 0; index < right.length; index += 1) {
      current[index + 1] = leftChar === right[index] ? previous[index] + 1 : Math.max(previous[index + 1], current[index]);
    }
    previous.splice(0, previous.length, ...current);
    current.fill(0);
  }
  return previous[right.length];
}

async function executeDeleteConfirmation(
  confirmed: boolean,
  state: ShortTermStateStore,
  calendar: CalendarAdapter,
  wechatReminderStore: WechatReminderStore | undefined,
  itemNumbers: number[] = [],
): Promise<{ ok: boolean; reply: string }> {
  const pendingDelete = state.snapshot().pending_delete;
  if (!pendingDelete) return { ok: false, reply: "没有成功：没有待确认的删除。" };

  if (!confirmed) {
    state.clearPendingDelete();
    return { ok: true, reply: "已取消删除。" };
  }

  if (pendingDelete.source === "date_query" || "items" in pendingDelete) {
    if (pendingDelete.source === "event_query" && pendingDelete.requireSelection && itemNumbers.length === 0) {
      return { ok: false, reply: "没有成功：匹配到多个日程，请先回复要删除第几个。" };
    }
    const selection = selectPendingBatchDeleteItems(pendingDelete, itemNumbers);
    if (!selection.ok) return { ok: false, reply: `没有成功：${selection.message}` };
    const result = await deleteManyEvents(calendar, { eventIds: selection.eventIds, confirmed: true });
    if (!result.ok) return { ok: false, reply: formatDeleteExecutionFailure(result.message, formatPendingDeleteItemsForReply(selection.items)) };

    await cancelDeletedWechatReminders(wechatReminderStore, result.data.deletedEventIds);
    clearDeletedState(state, result.data.deletedEventIds);
    return { ok: true, reply: `已删除 ${result.data.deletedEventIds.length} 个日程：\n${formatPendingDeleteItemsForReply(selection.items)}` };
  }

  if (itemNumbers.length > 0 && (itemNumbers.length !== 1 || itemNumbers[0] !== 1)) {
    return { ok: false, reply: `没有成功：没有找到待删除列表里的第 ${itemNumbers[0]} 条。` };
  }

  const result = await deleteEvent(calendar, { eventId: pendingDelete.eventId });
  if (!result.ok) return { ok: false, reply: formatDeleteExecutionFailure(result.message, formatPendingDeleteForReply(pendingDelete)) };

  await cancelDeletedWechatReminders(wechatReminderStore, [pendingDelete.eventId]);
  clearDeletedState(state, [pendingDelete.eventId]);
  return { ok: true, reply: `已删除日程：\n${formatPendingDeleteForReply(pendingDelete)}` };
}

async function cancelDeletedWechatReminders(store: WechatReminderStore | undefined, eventIds: string[]) {
  if (!store) return;
  await store.cancelForEvents(eventIds);
}

function formatDeleteExecutionFailure(message: string, pendingText: string): string {
  if (isRateLimitedCalendarFailure(message)) {
    return `飞书现在限流，刚才这个删除还保留着：\n${pendingText}\n稍后再回复确认删除，我会继续处理。`;
  }

  return `没有成功：${message}`;
}

function isRateLimitedCalendarFailure(message: string): boolean {
  return message.toLowerCase().includes("rate limited");
}

function selectPendingBatchDeleteItems(
  pendingDelete: PendingDeleteState & { eventIds: string[]; items: PendingDeleteItemState[] },
  itemNumbers: number[],
): { ok: true; eventIds: string[]; items: typeof pendingDelete.items } | { ok: false; message: string } {
  if (itemNumbers.length === 0) {
    return { ok: true, eventIds: pendingDelete.eventIds, items: pendingDelete.items };
  }

  const selectedItems: typeof pendingDelete.items = [];
  for (const itemNumber of [...new Set(itemNumbers)]) {
    const item = pendingDelete.items[itemNumber - 1];
    if (!item) return { ok: false, message: `没有找到待删除列表里的第 ${itemNumber} 条。` };
    selectedItems.push(item);
  }

  return { ok: true, eventIds: selectedItems.map((item) => item.eventId), items: selectedItems };
}

async function executePendingConflictControl(input: {
  confirmed: boolean;
  state: ShortTermStateStore;
  calendar: CalendarAdapter;
  seedStore: SeedLiteStore | undefined;
  wechatReminderStore: WechatReminderStore | undefined;
  defaultWechatReminderLeadMinutes: number[];
}): Promise<{ ok: boolean; reply: string; actionType: string; createdEvents?: MemoryDreamCreatedEvent[] }> {
  const pendingConflict = input.state.snapshot().pending_conflict;
  if (!pendingConflict) return { ok: false, reply: "没有成功：没有待确认的创建。", actionType: "create_conflict" };

  if (!input.confirmed) {
    input.state.clearPendingConflict();
    return { ok: true, reply: "已取消创建。", actionType: "create_conflict_cancel" };
  }

  const execution = await executeCalendarAction(pendingConflict.action, input.calendar);
  if (execution.ok) {
    updateState(input.state, pendingConflict.action, execution.data);
    await registerWechatReminders({
      action: pendingConflict.action,
      data: execution.data,
      store: input.wechatReminderStore,
      defaultLeads: input.defaultWechatReminderLeadMinutes,
    });
    await completeCreatedSeedSources(pendingConflict.action, input.seedStore, input.state);
    input.state.clearPendingConflict();
  }
  const createdEvents = execution.ok ? createdEventsFromCalendarData(execution.data) : [];
  return {
    ok: execution.ok,
    reply: buildActionReply(pendingConflict.action, execution),
    actionType: pendingConflict.action.type,
    ...(createdEvents.length > 0 ? { createdEvents } : {}),
  };
}

function formatPendingDeleteForReply(pendingDelete: PendingDeleteState): string {
  if ("items" in pendingDelete) return formatPendingDeleteItemsForReply(pendingDelete.items);
  const start = pendingDelete.date && pendingDelete.startTime ? `${pendingDelete.date} ${pendingDelete.startTime}` : undefined;
  return formatCalendarEventDetail({ id: pendingDelete.eventId, title: pendingDelete.title, start });
}

function formatPendingDeleteItemsForReply(items: Array<{ eventId: string; title: string; date?: string; startTime?: string }>): string {
  return items
    .map((item, index) =>
      formatCalendarEventLine({ id: item.eventId, title: item.title, start: item.date && item.startTime ? `${item.date} ${item.startTime}` : undefined }, index + 1),
    )
    .join("\n");
}

function clearDeletedState(state: ShortTermStateStore, deletedEventIds: string[]) {
  const snapshot = state.snapshot();
  const deleted = new Set(deletedEventIds);
  state.update({
    pending_delete: undefined,
    ...(snapshot.last_event?.eventId && deleted.has(snapshot.last_event.eventId) ? { last_event: undefined } : {}),
    ...(snapshot.briefing_items
      ? { briefing_items: snapshot.briefing_items.filter((item) => !deleted.has(item.eventId)) }
      : {}),
    ...(snapshot.recent_event_items
      ? { recent_event_items: snapshot.recent_event_items.filter((item) => !deleted.has(item.eventId)) }
      : {}),
  });
}

function pendingDeleteItemFromCalendarEvent(event: FeishuCalendarEvent) {
  const parsed = parseEventStart(event.start);
  return {
    eventId: event.id,
    title: event.title,
    ...(parsed.date ? { date: parsed.date } : {}),
    ...(parsed.startTime ? { startTime: parsed.startTime } : {}),
  };
}

function parseEventStart(start: string | undefined): { date?: string; startTime?: string } {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(start || "");
  return match ? { date: match[1], startTime: match[2] } : {};
}

function formatQueryLabel(query: EventQuery): string {
  if ("date" in query) return formatCalendarDateLabel(query.date);
  return `${formatCalendarDateLabel(query.range.startDate)}到${formatCalendarDateLabel(query.range.endDate)}`;
}

function buildConflictReply(conflicts: PendingConflictState["conflicts"], action?: CalendarAction): string {
  const lines = conflicts.map((conflict, index) => formatCalendarEventLine({ id: conflict.existingEventId || "", title: conflict.title, start: conflict.start }, index + 1));
  const requestedLines = action ? formatRequestedCreateItems(action) : "";
  return [
    `这个时间已有日程：\n${lines.join("\n")}`,
    requestedLines,
    "如仍要创建，回复 OK 或确认都可以；不创建可回复取消或算了。",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatRequestedCreateItems(action: CalendarAction): string {
  if (action.type !== "create_event" && action.type !== "create_events") return "";
  const events = action.type === "create_event" ? [action.event] : action.events;
  if (events.length < 2) return "";
  const lines = events.map((event, index) =>
    formatCalendarEventLine({ id: "", title: event.title, start: `${event.date} ${event.startTime}` }, index + 1),
  );
  return `本次请求还包括这些尚未写入的日程：\n${lines.join("\n")}`;
}

function isCreateAction(action: CalendarAction): action is Extract<CalendarAction, { type: "create_event" | "create_recurring_event" | "create_events" }> {
  return action.type === "create_event" || action.type === "create_recurring_event" || action.type === "create_events";
}

function createdEventsFromCalendarData(data: FeishuCalendarEvent | FeishuCalendarEvent[]): MemoryDreamCreatedEvent[] {
  return (Array.isArray(data) ? data : [data]).map(createdEventFromCalendarEvent).filter((event): event is MemoryDreamCreatedEvent => Boolean(event));
}

function createdEventFromCalendarEvent(event: FeishuCalendarEvent): MemoryDreamCreatedEvent | null {
  const parsed = parseEventStart(event.start);
  if (!event.title?.trim() || !parsed.date || !parsed.startTime) return null;
  return { title: event.title.trim(), date: parsed.date, startTime: parsed.startTime };
}

function isSeedLiteCandidate(action: CalendarAction): action is Extract<CalendarAction, { type: "clarify" }> & { createDraft: { title: string } } {
  return (
    action.type === "clarify" &&
    Boolean(action.createDraft?.title?.trim()) &&
    action.missing.includes("date") &&
    action.missing.includes("startTime")
  );
}

function isCreatedActionType(actionType: string): boolean {
  return actionType === "create_event" || actionType === "create_recurring_event" || actionType === "create_events";
}

function shouldUseAutoScheduleStartTime(action: Extract<CalendarAction, { type: "propose_schedule" }>): boolean {
  return action.autoCreate === true || !action.date;
}

async function resolveExecutableAction(
  action: CalendarAction,
  state: ShortTermStateStore,
  calendar: CalendarAdapter,
): Promise<{ ok: true; action: CalendarAction } | { ok: false; message: string }> {
  if (action.type === "update_event" && action.target.kind === "event_query") {
    const matches = await findEventsByStructuredQuery(action.target, state, calendar);
    if (!matches.ok) return matches;
    if (matches.events.length === 0) return { ok: false, message: "没有找到匹配的日程。" };
    if (matches.events.length > 1) return { ok: false, message: `匹配到多个日程，请先查询后用第几个来修改。\n${formatPendingDeleteItemsForReply(matches.events.map(pendingDeleteItemFromCalendarEvent))}` };
    const parsed = parseEventStart(matches.events[0].start);
    if (changesTimeWithoutDate(action.patch, action.patch.date || parsed.date)) return { ok: false, message: "这个日程是哪一天？" };
    const patchWithDate = fillPatchDateFromLastEvent(action.patch, parsed.date);
    return {
      ok: true,
      action: {
        ...action,
        target: { kind: "last_event", eventId: matches.events[0].id },
        patch: fillUpdateEndTimeForMovedStart(patchWithDate, matches.events[0]),
      },
    };
  }

  const resolvedFromStateItem =
    action.type === "update_event" && (action.target.kind === "briefing_item" || action.target.kind === "recent_event_item");
  const resolved = resolveStateItemUpdate(action, state);
  if (!resolved.ok) return resolved;
  if (resolved.action.type !== "update_event" || resolved.action.target.kind !== "last_event") {
    return { ok: true, action: resolved.action };
  }

  const lastEvent = state.snapshot().last_event;
  const targetEventId = resolvedFromStateItem ? resolved.action.target.eventId : lastEvent?.eventId;
  if (!targetEventId) return { ok: false, message: "没有找到刚才那个日程。" };
  if (changesTimeWithoutDate(resolved.action.patch, lastEvent?.date)) return { ok: false, message: "这个日程是哪一天？" };

  const patch = await fillUpdateEndTimeFromCalendar({
    patch: fillPatchDateFromLastEvent(resolved.action.patch, lastEvent?.date),
    eventId: targetEventId,
    calendar,
  });

  return {
    ok: true,
    action: {
      ...resolved.action,
      target: { kind: "last_event", eventId: targetEventId },
      patch,
    },
  };
}

function updateState(state: ShortTermStateStore, action: CalendarAction, data: FeishuCalendarEvent | FeishuCalendarEvent[]) {
  if (Array.isArray(data)) {
    const fallbackDate = action.type === "list_events" ? action.date : undefined;
    const numberedItems = data.map((event, index) => briefingItemStateFromCalendarEvent(event, index + 1, fallbackDate));
    state.update({
      briefing_items: numberedItems,
      recent_event_items: numberedItems,
      ...(action.type === "create_events" && data.length > 0 ? { last_event: lastEventStateFromCalendarEvent(data[data.length - 1]) } : {}),
    });
    return;
  }
  if (action.type !== "create_event" && action.type !== "create_recurring_event" && action.type !== "update_event") return;
  state.update({ last_event: lastEventStateFromCalendarEvent(data) });
}

function verifyUpdateExecutionResult(
  action: CalendarAction,
  data: FeishuCalendarEvent | FeishuCalendarEvent[],
): { ok: true } | { ok: false; message: string } {
  if (action.type !== "update_event" || Array.isArray(data)) return { ok: true };
  const patch = action.patch;
  const parsedStart = parseEventStart(data.start);
  const parsedEnd = parseEventStart(data.end);

  if (patch.title && data.title.trim() !== patch.title.trim()) {
    return { ok: false, message: "飞书返回的日程没有体现修改后的标题。" };
  }
  if (patch.date && patch.startTime && (parsedStart.date !== patch.date || parsedStart.startTime !== patch.startTime)) {
    return { ok: false, message: "飞书返回的日程没有体现修改后的时间。" };
  }
  if (
    patch.date &&
    patch.endTime &&
    parsedEnd.date &&
    parsedEnd.startTime &&
    (parsedEnd.date !== patch.date || parsedEnd.startTime !== patch.endTime)
  ) {
    return { ok: false, message: "飞书返回的日程没有体现修改后的结束时间。" };
  }

  return { ok: true };
}

function resolveStateItemUpdate(action: CalendarAction, state: ShortTermStateStore): { ok: true; action: CalendarAction } | { ok: false; message: string } {
  if (action.type !== "update_event" || action.target.kind === "event_query" || action.target.kind === "last_event") {
    return { ok: true, action };
  }
  if (action.target.kind === "briefing_item") return resolveBriefingItemUpdate(action, state);
  if (action.target.kind !== "recent_event_item") return { ok: true, action };

  const itemNumber = action.target.itemNumber;
  const item = state.snapshot().recent_event_items?.find((candidate) => candidate.itemNumber === itemNumber);
  if (!item) return { ok: false, message: `没有找到刚才展示的日程里的第 ${itemNumber} 条。` };

  return {
    ok: true,
    action: {
      type: "update_event",
      target: { kind: "last_event", eventId: item.eventId },
      patch: fillPatchDateFromStateItem(action.patch, item),
    },
  };
}

function fillPatchDateFromStateItem<T extends UpdateEventPatch>(patch: T, item: BriefingItemState): T {
  if (!item.date || patch.date || (!patch.startTime && !patch.endTime)) return patch;
  return { ...patch, date: item.date };
}

async function registerWechatReminders(input: {
  action: CalendarAction;
  data: FeishuCalendarEvent | FeishuCalendarEvent[];
  store: WechatReminderStore | undefined;
  defaultLeads: number[];
}) {
  if (!input.store) return;
  if (input.action.type === "create_recurring_event") return;
  if (input.action.type === "create_event" && !Array.isArray(input.data)) {
    await input.store.addMany(
      buildWechatReminderJobs(
        input.data,
        normalizeLeadMinutes(input.action.event.reminderMinutes, input.defaultLeads),
        input.action.event.reminderAtStart
          ? { leadSource: "at_start" }
          : { leadSource: input.action.event.reminderMinutes !== undefined ? "explicit" : undefined },
      ),
    );
  } else if (input.action.type === "create_events" && Array.isArray(input.data)) {
    const eventDrafts = input.action.events;
    const jobs = input.data.flatMap((event, index) =>
      buildWechatReminderJobs(
        event,
        normalizeLeadMinutes(eventDrafts[index]?.reminderMinutes, input.defaultLeads),
        eventDrafts[index]?.reminderAtStart
          ? { leadSource: "at_start" }
          : { leadSource: eventDrafts[index]?.reminderMinutes !== undefined ? "explicit" : undefined },
      ),
    );
    await input.store.addMany(jobs);
  }
}

async function refreshWechatRemindersAfterUpdate(input: {
  action: CalendarAction;
  data: FeishuCalendarEvent | FeishuCalendarEvent[];
  store: WechatReminderStore | undefined;
  defaultLeads: number[];
}) {
  if (!input.store || input.action.type !== "update_event" || Array.isArray(input.data)) return;

  const updatedEvent = input.data;
  const existingJobs = (await input.store.list()).filter((job) => job.eventId === updatedEvent.id && job.status !== "sent");
  const explicitReminder = input.action.patch.reminderMinutes !== undefined || input.action.patch.reminderAtStart === true;
  if (!explicitReminder && existingJobs.length === 0) return;

  await input.store.cancelForEvents([updatedEvent.id]);
  const leadSource = resolveUpdatedReminderLeadSource(input.action.patch, existingJobs);
  const leads =
    leadSource === "at_start"
      ? [0]
      : explicitReminder
        ? normalizeLeadMinutes(input.action.patch.reminderMinutes, input.defaultLeads)
        : [...new Set(existingJobs.map((job) => job.leadMinutes))];

  if (leads.length === 0 && leadSource !== "at_start") return;
  await input.store.addMany(buildWechatReminderJobs(updatedEvent, leads, leadSource ? { leadSource } : {}));
}

function resolveUpdatedReminderLeadSource(
  patch: UpdateEventPatch,
  existingJobs: Awaited<ReturnType<WechatReminderStore["list"]>>,
): "explicit" | "at_start" | undefined {
  if (patch.reminderAtStart === true) return "at_start";
  if (patch.reminderMinutes !== undefined) return "explicit";
  if (existingJobs.some((job) => job.leadSource === "at_start")) return "at_start";
  if (existingJobs.some((job) => job.leadSource === "explicit" || !DEFAULT_WECHAT_REMINDER_LEAD_MINUTES.includes(job.leadMinutes))) return "explicit";
  return undefined;
}

async function completeCreatedSeedSources(action: CalendarAction, seedStore: SeedLiteStore | undefined, state: ShortTermStateStore) {
  if (action.type === "create_event" || action.type === "create_recurring_event") {
    await completeSeedLiteSources(action.event.sourceIds || [], seedStore, state);
  } else if (action.type === "create_events") {
    await completeSeedLiteSources(action.events.flatMap((event) => event.sourceIds || []), seedStore, state);
  }
}

function validateStateBackedReminderEvidence(action: CalendarAction, state: ShortTermStateStore): { ok: true } | { ok: false; message: string } {
  const events =
    action.type === "create_event"
      ? [action.event]
      : action.type === "create_recurring_event"
        ? [action.event]
        : action.type === "create_events"
          ? action.events
          : [];
  if (events.length === 0) return { ok: true };
  const seedItems = state.snapshot().seed_items || [];

  for (const event of events) {
    if (!event.reminderAtStart || !event.sourceIds || event.sourceIds.length === 0) continue;
    const source = seedItems.find((item) => event.sourceIds?.includes(item.seedId));
    if (!source) {
      return { ok: false, message: "没有找到对应的待推进提醒，先保留在收件箱里。" };
    }
    if (action.type === "create_recurring_event") continue;
    if (!source.reminderAt) {
      return { ok: false, message: "没有找到对应的待推进提醒，先保留在收件箱里。" };
    }
    const [date, startTime] = source.reminderAt.trim().split(" ");
    if (date !== event.date || startTime !== event.startTime) {
      return { ok: false, message: "待推进提醒时间和要创建的提醒不一致，先保留在收件箱里。" };
    }
  }

  return { ok: true };
}

function fillPatchDateFromLastEvent<T extends UpdateEventPatch>(patch: T, date: string | undefined): T {
  if (!date || patch.date || (!patch.startTime && !patch.endTime)) return patch;
  return { ...patch, date };
}

function changesTimeWithoutDate(patch: UpdateEventPatch, stateDate: string | undefined): boolean {
  return !patch.date && !stateDate && Boolean(patch.startTime || patch.endTime);
}

async function fillUpdateEndTimeFromCalendar(input: {
  patch: UpdateEventPatch;
  eventId: string;
  calendar: CalendarAdapter;
}): Promise<UpdateEventPatch> {
  if (!shouldFillEndTimeForMovedStart(input.patch)) return input.patch;
  const date = input.patch.date;
  if (!date) return input.patch;
  const result = await input.calendar.listEvents({ date });
  if (result.ok) {
    const event = result.data.find((candidate) => candidate.id === input.eventId);
    if (event) return fillUpdateEndTimeForMovedStart(input.patch, event);
  }

  return { ...input.patch, endTime: addMinutesToClockTime(date, input.patch.startTime, 60).time };
}

function fillUpdateEndTimeForMovedStart<T extends UpdateEventPatch>(patch: T, event: FeishuCalendarEvent): T {
  if (!shouldFillEndTimeForMovedStart(patch)) return patch;
  const date = patch.date;
  const startTime = patch.startTime;
  if (!date || !startTime) return patch;

  const currentStart = parseEventStart(event.start);
  const currentEnd = parseEventStart(event.end);
  const durationMinutes = readPositiveDurationMinutes(currentStart.date, currentStart.startTime, currentEnd.date, currentEnd.startTime) || 60;
  const nextEnd = addMinutesToClockTime(date, startTime, durationMinutes);

  return { ...patch, endTime: nextEnd.time };
}

function shouldFillEndTimeForMovedStart(patch: UpdateEventPatch): patch is UpdateEventPatch & { date: string; startTime: string } {
  return Boolean(patch.date && patch.startTime && !patch.endTime);
}

function readPositiveDurationMinutes(startDate?: string, startTime?: string, endDate?: string, endTime?: string): number | undefined {
  if (!startDate || !startTime || !endTime) return undefined;
  const startAt = Date.parse(`${startDate}T${normalizeClockTime(startTime)}+08:00`);
  const endAt = Date.parse(`${endDate || startDate}T${normalizeClockTime(endTime)}+08:00`);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return undefined;
  return Math.round((endAt - startAt) / 60_000);
}

function addMinutesToClockTime(date: string, time: string, minutes: number): { date: string; time: string } {
  const next = new Date(Date.parse(`${date}T${normalizeClockTime(time)}+08:00`) + minutes * 60_000);
  const dateText = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(next);
  const timeText = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(next);

  return { date: dateText, time: timeText };
}

function normalizeClockTime(time: string): string {
  return time.length === 5 ? `${time}:00` : time;
}

// 默认日期只作为兜底；测试和定时日报应显式注入 today。
function todayInShanghai(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function defaultAutoScheduleDate(now: string | undefined): string {
  const parts = shanghaiDateTimeParts(now ? new Date(now) : new Date());
  if (parts.hour * 60 + parts.minute >= 17 * 60) return addDays(parts.date, 1);
  return parts.date;
}

function defaultAutoScheduleStartTime(now: string | undefined): string | undefined {
  const parts = shanghaiDateTimeParts(now ? new Date(now) : new Date());
  if (defaultAutoScheduleDate(now) !== parts.date) return undefined;
  const nextMinute = Math.ceil((parts.hour * 60 + parts.minute + 30) / 30) * 30;
  if (nextMinute < 9 * 60) return "09:00";
  if (nextMinute >= 17 * 60) return undefined;
  return `${String(Math.floor(nextMinute / 60)).padStart(2, "0")}:${String(nextMinute % 60).padStart(2, "0")}`;
}

function shanghaiDateTimeParts(date: Date): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    hour: Number(read("hour") || 0),
    minute: Number(read("minute") || 0),
  };
}

function addDays(dateText: string, days: number): string {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}
