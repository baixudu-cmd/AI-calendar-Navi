// Calendar Agent API Bridge：未来给 OpenClaw 独立日程 Agent 调用的受控入口。

import { executeDailyBriefing, resolveBriefingItemUpdate } from "../briefing/index.js";
import { executeCalendarAction, type CalendarAdapter } from "../calendar/action-executor.js";
import { detectCreateConflicts } from "../calendar/conflict-guard.js";
import type { FeishuCalendarEvent } from "../calendar/feishu/types.js";
import { normalizeExplicitWeekdayCreateDates } from "../calendar/weekday-guard.js";
import type { ClarifyEventDraftRepairer } from "../clarify-repair/index.js";
import { deleteEvent, deleteManyEvents } from "../calendar-api/index.js";
import type { EnvSource } from "../config/index.js";
import type { CalendarAction, EventQuery, EventQueryReference } from "../contract/index.js";
import type { DecisionClient } from "../decision/index.js";
import { protectIncomingMessage } from "../entry/index.js";
import type { ImageDraftParser, ImageCalendarDraftParseResult } from "../image-capture/index.js";
import { runDecisionLoop } from "../loop/index.js";
import type { MemoryDreamCreatedEvent, MemoryDreamStore } from "../memory-dream/index.js";
import { formatCalendarDateLabel, formatCalendarEventDetail, formatCalendarEventLine } from "../reply/event-format.js";
import { buildActionReply } from "../reply/index.js";
import { buildSettingsSummary } from "../settings-summary/index.js";
import { buildStatusOverview } from "../status-overview/index.js";
import { briefingItemStateFromCalendarEvent, lastEventStateFromCalendarEvent } from "../state/calendar-event.js";
import type { BriefingItemState, PendingConflictState, PendingDeleteItemState, PendingDeleteState, ShortTermStateStore } from "../state/index.js";
import { expirePendingInteractionState } from "../state/lifecycle.js";
import type { SeedLiteStore } from "../seed-lite/index.js";
import { buildWechatReminderJobs, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES, normalizeLeadMinutes, type WechatReminderStore } from "../wechat-reminder/index.js";
import { executeScheduleProposal, resolveScheduleConfirmation } from "./schedule-flow.js";
import {
  captureSeedLite,
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
    input.state.update({ seed_items: await input.seedStore.list() });
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
    const confirmation = await executeDeleteConfirmation(loopResult.action.confirmed, input.state, input.calendar, loopResult.action.itemNumbers);
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
    const confirmation = resolveScheduleConfirmation({ action: loopResult.action, state: input.state });
    if (!confirmation.ok) return { ok: false, reply: `没有成功：${confirmation.message}`, actionType: "confirm_schedule", requestId };
    if ("canceled" in confirmation) return { ok: true, reply: "已取消安排。", actionType: "confirm_schedule_cancel", requestId };
    const result = await executeCalendarAgentAction({
      action: confirmation.action,
      input,
      requestId,
      sourceText: protectedInput.message.text,
    });
    if (isCreatedActionType(result.actionType)) await completeSeedLiteSources(confirmation.completedSourceIds || [], input.seedStore, input.state);
    return result;
  }

  if (loopResult.action.type === "daily_briefing") {
    const briefing = await executeDailyBriefing({
      briefingType: loopResult.action.briefingType,
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
    return {
      ok: true,
      reply: buildStatusOverview({
        state: input.state.snapshot(),
        seedItems: input.seedStore ? await input.seedStore.list() : undefined,
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
  input: CalendarAgentRequest;
  requestId: string;
  sourceText: string;
}): Promise<CalendarAgentResponse> {
  const proposal = await executeScheduleProposal({
    action: { type: "propose_schedule", date: input.date, items: [{ title: input.title, sourceIds: input.sourceIds }] },
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
    });
  } catch (error) {
    console.warn(`memory dream observation skipped: ${error instanceof Error ? error.message : "unknown error"}`);
  }
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
    updateState(input.input.state, normalizedAction, execution.data);
    if (normalizedAction.type === "create_event") input.input.state.clearPendingImageDraft();
    await registerWechatReminders({
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
  if (target.title && !normalizeMatchText(event.title).includes(normalizeMatchText(target.title))) return false;
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

async function executeDeleteConfirmation(
  confirmed: boolean,
  state: ShortTermStateStore,
  calendar: CalendarAdapter,
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
    if (!result.ok) return { ok: false, reply: `没有成功：${result.message}` };

    clearDeletedState(state, result.data.deletedEventIds);
    return { ok: true, reply: `已删除 ${result.data.deletedEventIds.length} 个日程：\n${formatPendingDeleteItemsForReply(selection.items)}` };
  }

  if (itemNumbers.length > 0 && (itemNumbers.length !== 1 || itemNumbers[0] !== 1)) {
    return { ok: false, reply: `没有成功：没有找到待删除列表里的第 ${itemNumbers[0]} 条。` };
  }

  const result = await deleteEvent(calendar, { eventId: pendingDelete.eventId });
  if (!result.ok) return { ok: false, reply: `没有成功：${result.message}` };

  clearDeletedState(state, [pendingDelete.eventId]);
  return { ok: true, reply: `已删除日程：\n${formatPendingDeleteForReply(pendingDelete)}` };
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

function isCreateAction(action: CalendarAction): action is Extract<CalendarAction, { type: "create_event" | "create_events" }> {
  return action.type === "create_event" || action.type === "create_events";
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
  return actionType === "create_event" || actionType === "create_events";
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
    return {
      ok: true,
      action: {
        ...action,
        target: { kind: "last_event", eventId: matches.events[0].id },
        patch: fillPatchDateFromLastEvent(action.patch, parsed.date),
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

  return {
    ok: true,
    action: {
      ...resolved.action,
      target: { kind: "last_event", eventId: targetEventId },
      patch: fillPatchDateFromLastEvent(resolved.action.patch, lastEvent?.date),
    },
  };
}

function updateState(state: ShortTermStateStore, action: CalendarAction, data: FeishuCalendarEvent | FeishuCalendarEvent[]) {
  if (Array.isArray(data)) {
    const numberedItems = data.map((event, index) => briefingItemStateFromCalendarEvent(event, index + 1));
    state.update({
      briefing_items: numberedItems,
      recent_event_items: numberedItems,
      ...(action.type === "create_events" && data.length > 0 ? { last_event: lastEventStateFromCalendarEvent(data[data.length - 1]) } : {}),
    });
    return;
  }
  if (action.type !== "create_event" && action.type !== "update_event") return;
  state.update({ last_event: lastEventStateFromCalendarEvent(data) });
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

async function completeCreatedSeedSources(action: CalendarAction, seedStore: SeedLiteStore | undefined, state: ShortTermStateStore) {
  if (action.type === "create_event") {
    await completeSeedLiteSources(action.event.sourceIds || [], seedStore, state);
  } else if (action.type === "create_events") {
    await completeSeedLiteSources(action.events.flatMap((event) => event.sourceIds || []), seedStore, state);
  }
}

function validateStateBackedReminderEvidence(action: CalendarAction, state: ShortTermStateStore): { ok: true } | { ok: false; message: string } {
  const events =
    action.type === "create_event"
      ? [action.event]
      : action.type === "create_events"
        ? action.events
        : [];
  if (events.length === 0) return { ok: true };
  const seedItems = state.snapshot().seed_items || [];

  for (const event of events) {
    if (!event.reminderAtStart || !event.sourceIds || event.sourceIds.length === 0) continue;
    const source = seedItems.find((item) => event.sourceIds?.includes(item.seedId));
    if (!source?.reminderAt) {
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
