// 工具调用校验器：在执行前校验 toolName 和 arguments，危险删除默认失败关闭。

import type {
  EventDraft,
  EventQueryReference,
  ScheduleContextRef,
  SchedulePreferredWindow,
  SettingsSummaryTopic,
  TodoPatch,
  TodoTarget,
} from "../contract/index.js";
import { TOOL_NAMES, type CalendarToolName } from "./schemas.js";

export type ToolTargetReference =
  | { kind: "last_event" }
  | { kind: "briefing_item"; itemNumber: number }
  | { kind: "recent_event_item"; itemNumber: number }
  | EventQueryReference;
export type ToolDeleteEventsQuery = { date: string } | { range: { startDate: string; endDate: string } };
export type ToolScheduleItem = {
  title?: string;
  target?: ToolTodoTarget;
  sourceIds?: string[];
  durationMinutes?: number;
  location?: string;
  reminderMinutes?: number | number[];
  notes?: string;
};
export type ToolScheduleItemChange = {
  itemNumber?: number;
  date?: string;
  startTime?: string;
  title?: string;
  location?: string;
  reminderMinutes?: number | number[];
  notes?: string;
};
export type ToolTodoTarget = TodoTarget;
export type ToolTodoPatch = TodoPatch;

export type CalendarToolCall =
  | { toolName: "calendar.create_event"; arguments: EventDraft }
  | { toolName: "calendar.create_reminder"; arguments: EventDraft & { reminderAtStart: true } }
  | { toolName: "calendar.create_events"; arguments: { events: EventDraft[] } }
  | {
      toolName: "calendar.create_and_propose_schedule";
      arguments: {
        events: EventDraft[];
        date?: string;
        items: ToolScheduleItem[];
        preferredStartTime?: string;
        preferredWindow?: SchedulePreferredWindow;
        optionCount?: number;
      };
    }
  | { toolName: "calendar.list_events"; arguments: { date?: string; range?: { startDate: string; endDate: string } } }
  | { toolName: "calendar.update_event"; arguments: { target: ToolTargetReference; patch: Partial<EventDraft> } }
  | {
      toolName: "calendar.propose_schedule";
      arguments: {
        date?: string;
        items: ToolScheduleItem[];
        autoCreate?: boolean;
        preferredStartTime?: string;
        preferredWindow?: SchedulePreferredWindow;
        optionCount?: number;
        contextRef?: ScheduleContextRef;
      };
    }
  | { toolName: "calendar.confirm_schedule"; arguments: { confirmed: boolean; optionNumber?: number; itemChanges?: ToolScheduleItemChange[] } }
  | { toolName: "assistant.remember_todo"; arguments: { title: string; autoSchedule?: boolean; date?: string } }
  | { toolName: "assistant.manage_todos"; arguments: { operation: "list"; limit?: number } }
  | { toolName: "assistant.manage_todos"; arguments: { operation: "complete" | "delete"; target: ToolTodoTarget } }
  | { toolName: "assistant.manage_todos"; arguments: { operation: "update"; target: ToolTodoTarget; patch: ToolTodoPatch } }
  | { toolName: "calendar.delete_event"; arguments: { target: ToolTargetReference } }
  | { toolName: "calendar.delete_events"; arguments: { query: ToolDeleteEventsQuery } }
  | { toolName: "calendar.confirm_delete"; arguments: { confirmed: boolean; itemNumbers?: number[] } }
  | { toolName: "calendar.confirm_create"; arguments: { confirmed: boolean } }
  | { toolName: "calendar.daily_briefing"; arguments: { briefingType: "morning" | "evening" } }
  | { toolName: "assistant.settings_summary"; arguments: { topic?: SettingsSummaryTopic } }
  | { toolName: "assistant.status_overview"; arguments: Record<string, never> }
  | { toolName: "assistant.dismiss_context"; arguments: Record<string, never> }
  | { toolName: "assistant.clarify"; arguments: { question: string; missing: string[]; createDraft?: Partial<EventDraft> } };

export type ToolValidationFailureReason =
  | "malformed_tool_call"
  | "unknown_tool"
  | "missing_arguments"
  | "invalid_arguments"
  | "guard_rejected";

export type ToolValidationResult =
  | { ok: true; call: CalendarToolCall }
  | { ok: false; reason: ToolValidationFailureReason; message: string };

export type ToolValidationOptions = {
  sourceText?: string;
};

type ToolValidationFailure = Extract<ToolValidationResult, { ok: false }>;
type EventDraftValidationResult =
  | { ok: true; event: EventDraft }
  | ToolValidationFailure;
type EventDraftGuardOptions = {
  allowSourceIdsTimeEvidence?: boolean;
};

const TOOL_NAME_SET = new Set<string>(TOOL_NAMES);

// 校验模型工具调用；这里只处理参数合同，不执行任何日历动作。
export function validateToolCall(value: unknown, options: ToolValidationOptions = {}): ToolValidationResult {
  if (!isRecord(value) || typeof value.toolName !== "string" || !isRecord(value.arguments)) {
    return fail("malformed_tool_call", "工具调用需要包含 toolName 和 arguments。");
  }

  if (!TOOL_NAME_SET.has(value.toolName)) {
    return fail("unknown_tool", `不支持的工具：${value.toolName}`);
  }

  switch (value.toolName as CalendarToolName) {
    case "calendar.create_event":
      return validateCreateEvent(value.arguments, options);
    case "calendar.create_reminder":
      return validateCreateReminder(value.arguments, options);
    case "calendar.create_events":
      return validateCreateEvents(value.arguments, options);
    case "calendar.create_and_propose_schedule":
      return validateCreateAndProposeSchedule(value.arguments, options);
    case "calendar.list_events":
      return validateListEvents(value.arguments);
    case "calendar.update_event":
      return validateUpdateEvent(value.arguments);
    case "calendar.propose_schedule":
      return validateProposeSchedule(value.arguments);
    case "calendar.confirm_schedule":
      return validateConfirmSchedule(value.arguments);
    case "assistant.remember_todo":
      return validateRememberTodo(value.arguments);
    case "assistant.manage_todos":
      return validateManageTodos(value.arguments);
    case "calendar.delete_event":
      return validateDeleteEvent(value.arguments);
    case "calendar.delete_events":
      return validateDeleteEvents(value.arguments);
    case "calendar.confirm_delete":
      return validateConfirmDelete(value.arguments);
    case "calendar.confirm_create":
      return validateConfirmCreate(value.arguments);
    case "calendar.daily_briefing":
      return validateDailyBriefing(value.arguments);
    case "assistant.settings_summary":
      return validateSettingsSummary(value.arguments);
    case "assistant.status_overview":
      return { ok: true, call: { toolName: "assistant.status_overview", arguments: {} } };
    case "assistant.dismiss_context":
      return { ok: true, call: { toolName: "assistant.dismiss_context", arguments: {} } };
    case "assistant.clarify":
      return validateClarify(value.arguments);
  }

  return fail("unknown_tool", `不支持的工具：${value.toolName}`);
}

function validateManageTodos(value: Record<string, unknown>): ToolValidationResult {
  if (value.operation !== "list" && value.operation !== "complete" && value.operation !== "delete" && value.operation !== "update") {
    return fail("invalid_arguments", "待推进管理需要 operation。");
  }

  if (value.operation === "list") {
    return {
      ok: true,
      call: {
        toolName: "assistant.manage_todos",
        arguments: {
          operation: "list",
          ...(Number.isInteger(value.limit) && Number(value.limit) > 0 ? { limit: Number(value.limit) } : {}),
        },
      },
    };
  }

  if (!isRecord(value.target)) return fail("missing_arguments", "待推进管理需要 target。");
  const target = normalizeTodoTarget(value.target);
  if (!target) return fail("invalid_arguments", "target 需要 seedId、itemNumber 或 title。");

  if (value.operation === "update") {
    if (!isRecord(value.patch)) return fail("missing_arguments", "待推进修改需要 patch。");
    const patch = normalizeTodoPatch(value.patch);
    if (!patch) return fail("invalid_arguments", "patch 需要 title、合法 targetDate、reminderAt 或 clearReminder。");
    return { ok: true, call: { toolName: "assistant.manage_todos", arguments: { operation: "update", target, patch } } };
  }

  return { ok: true, call: { toolName: "assistant.manage_todos", arguments: { operation: value.operation, target } } };
}

function validateCreateEvent(value: Record<string, unknown>, options: ToolValidationOptions): ToolValidationResult {
  const draftResult = validateEventDraft(value, options);
  if (!draftResult.ok) return draftResult;

  return {
    ok: true,
    call: {
      toolName: "calendar.create_event",
      arguments: draftResult.event,
    },
  };
}

function validateCreateReminder(value: Record<string, unknown>, options: ToolValidationOptions): ToolValidationResult {
  const draftResult = validateEventDraft(value, options, { allowSourceIdsTimeEvidence: true });
  if (!draftResult.ok) return draftResult;

  return {
    ok: true,
    call: {
      toolName: "calendar.create_reminder",
      arguments: { ...draftResult.event, reminderAtStart: true },
    },
  };
}

function validateCreateEvents(value: Record<string, unknown>, options: ToolValidationOptions): ToolValidationResult {
  if (!Array.isArray(value.events)) return fail("missing_arguments", "批量创建需要 events。");
  if (value.events.length < 2 || value.events.length > 5) {
    return fail("invalid_arguments", "批量创建一次只支持 2 到 5 个日程。");
  }

  const events: EventDraft[] = [];
  for (const event of value.events) {
    if (!isRecord(event)) return fail("invalid_arguments", "events 里的每一项都必须是对象。");
    const draftResult = validateEventDraft(event, options);
    if (!draftResult.ok) return draftResult;
    events.push(draftResult.event);
  }

  return {
    ok: true,
    call: {
      toolName: "calendar.create_events",
      arguments: { events },
    },
  };
}

function validateCreateAndProposeSchedule(value: Record<string, unknown>, options: ToolValidationOptions): ToolValidationResult {
  if (!Array.isArray(value.events)) return fail("missing_arguments", "混合处理需要 events。");
  if (value.events.length < 1 || value.events.length > 5) {
    return fail("invalid_arguments", "混合处理一次只支持 1 到 5 个明确日程。");
  }

  const events: EventDraft[] = [];
  for (const event of value.events) {
    if (!isRecord(event)) return fail("invalid_arguments", "events 里的每一项都必须是对象。");
    const draftResult = validateEventDraft(event, options);
    if (!draftResult.ok) return draftResult;
    events.push(draftResult.event);
  }

  const schedule = validateProposeSchedule(value);
  if (!schedule.ok) return schedule;
  const scheduleArguments = schedule.call.toolName === "calendar.propose_schedule" ? schedule.call.arguments : undefined;
  if (!scheduleArguments || scheduleArguments.items.length === 0) return fail("missing_arguments", "混合处理需要至少一个待推荐事项。");

  return {
    ok: true,
    call: {
      toolName: "calendar.create_and_propose_schedule",
      arguments: {
        events,
        ...(scheduleArguments.date ? { date: scheduleArguments.date } : {}),
        items: scheduleArguments.items,
        ...(scheduleArguments.preferredStartTime ? { preferredStartTime: scheduleArguments.preferredStartTime } : {}),
        ...(scheduleArguments.preferredWindow ? { preferredWindow: scheduleArguments.preferredWindow } : {}),
        ...(scheduleArguments.optionCount ? { optionCount: scheduleArguments.optionCount } : {}),
      },
    },
  };
}

function validateEventDraft(
  value: Record<string, unknown>,
  options: ToolValidationOptions,
  guardOptions: EventDraftGuardOptions = {},
): EventDraftValidationResult {
  const missing = ["title", "date", "startTime"].filter((key) => !isNonEmptyString(value[key]));
  if (missing.length > 0) return fail("missing_arguments", `缺少参数：${missing.join(", ")}`);
  const invalid = invalidEventDateTime(value, ["date", "startTime", "endTime"]);
  if (invalid) return fail("invalid_arguments", `参数格式不合法：${invalid}`);
  if (
    options.sourceText !== undefined &&
    !hasStartTimeEvidence(value, options.sourceText) &&
    !(guardOptions.allowSourceIdsTimeEvidence && hasSourceIds(value))
  ) {
    return fail("guard_rejected", "创建日程需要原文里的开始时间证据；如果是系统推荐时间，请改用 calendar.propose_schedule。");
  }

  return {
    ok: true,
    event: normalizeEventDraft(value) as EventDraft,
  };
}

function validateListEvents(value: Record<string, unknown>): ToolValidationResult {
  if (isNonEmptyString(value.date)) {
    if (!isValidDate(value.date)) return fail("invalid_arguments", "date 不是合法日期。");
    return { ok: true, call: { toolName: "calendar.list_events", arguments: { date: value.date } } };
  }

  if (isRecord(value.range)) {
    if (!isNonEmptyString(value.range.startDate) || !isNonEmptyString(value.range.endDate)) {
      return fail("missing_arguments", "range 需要 startDate 和 endDate。");
    }
    if (!isValidDate(value.range.startDate) || !isValidDate(value.range.endDate)) {
      return fail("invalid_arguments", "range 日期不合法。");
    }

    return {
      ok: true,
      call: {
        toolName: "calendar.list_events",
        arguments: { range: { startDate: value.range.startDate, endDate: value.range.endDate } },
      },
    };
  }

  return fail("missing_arguments", "查询日程需要 date 或 range。");
}

function validateUpdateEvent(value: Record<string, unknown>): ToolValidationResult {
  if (!isRecord(value.target) || !isRecord(value.patch)) {
    return fail("missing_arguments", "修改日程需要 target 和 patch。");
  }

  const target = normalizeTarget(value.target);
  if (!target) return fail("guard_rejected", "修改日程需要本地引用，或结构化的日期、时间段、标题查询。");
  if (Object.keys(value.patch).length === 0) return fail("missing_arguments", "修改日程需要 patch。");

  const invalid = invalidEventDateTime(value.patch, ["date", "startTime", "endTime"]);
  if (invalid) return fail("invalid_arguments", `参数格式不合法：${invalid}`);

  const patch = normalizeEventDraft(value.patch);
  if (!hasExecutablePatch(patch)) return fail("missing_arguments", "patch 没有可执行的修改内容。");

  return { ok: true, call: { toolName: "calendar.update_event", arguments: { target, patch } } };
}

function validateProposeSchedule(value: Record<string, unknown>): ToolValidationResult {
  if (value.date !== undefined && (!isNonEmptyString(value.date) || !isValidDate(value.date))) return fail("invalid_arguments", "排程推荐需要合法 date。");
  if (value.preferredStartTime !== undefined && (!isNonEmptyString(value.preferredStartTime) || !isValidTime(value.preferredStartTime))) {
    return fail("invalid_arguments", "排程偏好时间需要合法 preferredStartTime。");
  }
  if (value.preferredWindow !== undefined && !isSchedulePreferredWindow(value.preferredWindow)) {
    return fail("invalid_arguments", "排程偏好时段需要是 morning、afternoon、evening 或 later。");
  }
  if (value.optionCount !== undefined && (!Number.isInteger(value.optionCount) || Number(value.optionCount) < 1 || Number(value.optionCount) > 5)) {
    return fail("invalid_arguments", "排程推荐候选数量需要是 1 到 5。");
  }
  if (value.contextRef !== undefined && !isScheduleContextRef(value.contextRef)) {
    return fail("invalid_arguments", "排程续接引用只能是 pending_schedule。");
  }
  if (value.items !== undefined && (!Array.isArray(value.items) || value.items.length > 5)) {
    return fail("invalid_arguments", "排程推荐最多支持 5 个事项。");
  }

  const items: ToolScheduleItem[] = [];
  for (const item of Array.isArray(value.items) ? value.items : []) {
    if (!isRecord(item)) return fail("invalid_arguments", "排程事项必须是对象。");
    const target = isRecord(item.target) ? normalizeTodoTarget(item.target) : null;
    if (item.target !== undefined && !target) return fail("invalid_arguments", "排程事项 target 需要 seedId、itemNumber 或 title。");
    if (!isNonEmptyString(item.title) && !target) return fail("invalid_arguments", "排程事项需要 title 或 target。");
    items.push({
      ...(isNonEmptyString(item.title) ? { title: item.title } : {}),
      ...(target ? { target } : {}),
      ...(Array.isArray(item.sourceIds) ? { sourceIds: item.sourceIds.filter(isNonEmptyString) } : {}),
      ...(Number.isInteger(item.durationMinutes) && Number(item.durationMinutes) > 0 ? { durationMinutes: Number(item.durationMinutes) } : {}),
      ...(isNonEmptyString(item.location) ? { location: item.location } : {}),
      ...(normalizeReminderMinutes(item.reminderMinutes) !== undefined ? { reminderMinutes: normalizeReminderMinutes(item.reminderMinutes) } : {}),
      ...(isNonEmptyString(item.notes) ? { notes: item.notes } : {}),
    });
  }

  return {
    ok: true,
    call: {
      toolName: "calendar.propose_schedule",
      arguments: {
        ...(isNonEmptyString(value.date) ? { date: value.date } : {}),
        items,
        ...(typeof value.autoCreate === "boolean" ? { autoCreate: value.autoCreate } : {}),
        ...(isNonEmptyString(value.preferredStartTime) ? { preferredStartTime: value.preferredStartTime } : {}),
        ...(isSchedulePreferredWindow(value.preferredWindow) ? { preferredWindow: value.preferredWindow } : {}),
        ...(Number.isInteger(value.optionCount) ? { optionCount: Number(value.optionCount) } : {}),
        ...(isScheduleContextRef(value.contextRef) ? { contextRef: value.contextRef } : {}),
      },
    },
  };
}

function isSchedulePreferredWindow(value: unknown): value is SchedulePreferredWindow {
  return value === "morning" || value === "afternoon" || value === "evening" || value === "later";
}

function isScheduleContextRef(value: unknown): value is ScheduleContextRef {
  return value === "pending_schedule";
}

function validateRememberTodo(value: Record<string, unknown>): ToolValidationResult {
  if (!isNonEmptyString(value.title)) return fail("missing_arguments", "待推进事项需要 title。");
  if (value.date !== undefined && (!isNonEmptyString(value.date) || !isValidDate(value.date))) {
    return fail("invalid_arguments", "待推进事项的 date 不合法。");
  }
  return {
    ok: true,
    call: {
      toolName: "assistant.remember_todo",
      arguments: {
        title: value.title.trim(),
        autoSchedule: typeof value.autoSchedule === "boolean" ? value.autoSchedule : true,
        ...(isNonEmptyString(value.date) ? { date: value.date } : {}),
      },
    },
  };
}

function validateConfirmSchedule(value: Record<string, unknown>): ToolValidationResult {
  const allowedKeys = new Set(["confirmed", "optionNumber", "itemChanges"]);
  const unexpectedKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unexpectedKey) return fail("guard_rejected", "排程确认只能选择或修改当前推荐位，不能指定事件 ID。");
  if (typeof value.confirmed !== "boolean") return fail("invalid_arguments", "排程确认需要 confirmed 布尔值。");
  if (value.optionNumber !== undefined && (!Number.isInteger(value.optionNumber) || Number(value.optionNumber) <= 0)) {
    return fail("invalid_arguments", "optionNumber 只能是从 1 开始的整数。");
  }
  if (!value.confirmed && (value.optionNumber !== undefined || value.itemChanges !== undefined)) {
    return fail("invalid_arguments", "取消排程时不能指定推荐位或修改项。");
  }

  const itemChanges = normalizeScheduleItemChanges(value.itemChanges);
  if (!itemChanges.ok) return itemChanges;

  return {
    ok: true,
    call: {
      toolName: "calendar.confirm_schedule",
      arguments: {
        confirmed: value.confirmed,
        ...(value.optionNumber !== undefined ? { optionNumber: Number(value.optionNumber) } : {}),
        ...(itemChanges.data.length > 0 ? { itemChanges: itemChanges.data } : {}),
      },
    },
  };
}

function validateDeleteEvent(value: Record<string, unknown>): ToolValidationResult {
  if (!isRecord(value.target)) return fail("missing_arguments", "删除日程需要 target。");

  const target = normalizeTarget(value.target);
  if (!target) return fail("guard_rejected", "删除日程需要本地引用，或结构化的日期、时间段、标题查询，不能全删或按自由文本删除。");

  return { ok: true, call: { toolName: "calendar.delete_event", arguments: { target } } };
}

function validateDeleteEvents(value: Record<string, unknown>): ToolValidationResult {
  if (!isRecord(value.query)) return fail("missing_arguments", "批量删除需要 query。");
  const query = normalizeDateQuery(value.query);
  if (!query) return fail("missing_arguments", "批量删除需要明确 date 或 range，不能按自由文本删除。");

  return { ok: true, call: { toolName: "calendar.delete_events", arguments: { query } } };
}

function validateConfirmDelete(value: Record<string, unknown>): ToolValidationResult {
  const allowedKeys = new Set(["confirmed", "itemNumbers"]);
  const unexpectedKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unexpectedKey) {
    return fail("guard_rejected", "删除确认只能引用当前待删除列表，不能指定新的事件 ID。");
  }
  if (typeof value.confirmed !== "boolean") {
    return fail("invalid_arguments", "删除确认需要 confirmed 布尔值。");
  }
  if (value.itemNumbers !== undefined) {
    if (!value.confirmed) return fail("invalid_arguments", "取消删除时不能指定条目序号。");
    if (!Array.isArray(value.itemNumbers) || value.itemNumbers.length === 0) {
      return fail("invalid_arguments", "删除条目选择需要 itemNumbers 数组。");
    }
    const itemNumbers = [...new Set(value.itemNumbers)];
    if (!itemNumbers.every((item) => Number.isInteger(item) && Number(item) > 0)) {
      return fail("invalid_arguments", "itemNumbers 只能包含从 1 开始的整数。");
    }
    return { ok: true, call: { toolName: "calendar.confirm_delete", arguments: { confirmed: true, itemNumbers: itemNumbers.map(Number) } } };
  }

  return { ok: true, call: { toolName: "calendar.confirm_delete", arguments: { confirmed: value.confirmed } } };
}

function validateConfirmCreate(value: Record<string, unknown>): ToolValidationResult {
  const allowedKeys = new Set(["confirmed"]);
  const unexpectedKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unexpectedKey) {
    return fail("guard_rejected", "创建确认只能使用当前待创建状态，不能指定新的事件。");
  }
  if (typeof value.confirmed !== "boolean") {
    return fail("invalid_arguments", "创建确认需要 confirmed 布尔值。");
  }

  return { ok: true, call: { toolName: "calendar.confirm_create", arguments: { confirmed: value.confirmed } } };
}

function validateDailyBriefing(value: Record<string, unknown>): ToolValidationResult {
  if (value.briefingType !== "morning" && value.briefingType !== "evening") {
    return fail("invalid_arguments", "briefingType 只能是 morning 或 evening。");
  }

  return { ok: true, call: { toolName: "calendar.daily_briefing", arguments: { briefingType: value.briefingType } } };
}

function validateSettingsSummary(value: Record<string, unknown>): ToolValidationResult {
  if (value.topic !== undefined && !isSettingsSummaryTopic(value.topic)) {
    return fail("invalid_arguments", "设置总结 topic 只能是 all、reminder、calendar、model、memory 或 runtime。");
  }

  return {
    ok: true,
    call: {
      toolName: "assistant.settings_summary",
      arguments: {
        ...(isSettingsSummaryTopic(value.topic) && value.topic !== "all" ? { topic: value.topic } : {}),
      },
    },
  };
}

function validateClarify(value: Record<string, unknown>): ToolValidationResult {
  if (!isNonEmptyString(value.question)) return fail("missing_arguments", "追问需要 question。");
  if (!Array.isArray(value.missing)) return fail("missing_arguments", "追问需要 missing。");

  const missing = value.missing.filter((item): item is string => isNonEmptyString(item));
  if (missing.length === 0) return fail("missing_arguments", "missing 至少包含一个字段。");

  const createDraft = isRecord(value.createDraft) ? normalizeEventDraft(value.createDraft) : {};
  return {
    ok: true,
    call: {
      toolName: "assistant.clarify",
      arguments: {
        question: value.question,
        missing,
        ...(Object.keys(createDraft).length > 0 ? { createDraft } : {}),
      },
    },
  };
}

function normalizeTarget(value: Record<string, unknown>): ToolTargetReference | null {
  if (value.kind === "last_event") return { kind: "last_event" };
  if (value.kind === "briefing_item" && Number.isInteger(value.itemNumber) && Number(value.itemNumber) > 0) {
    return { kind: "briefing_item", itemNumber: Number(value.itemNumber) };
  }
  if (value.kind === "recent_event_item" && Number.isInteger(value.itemNumber) && Number(value.itemNumber) > 0) {
    return { kind: "recent_event_item", itemNumber: Number(value.itemNumber) };
  }
  if (value.kind === "event_query") return normalizeEventQueryTarget(value);

  return null;
}

function normalizeEventQueryTarget(value: Record<string, unknown>): EventQueryReference | null {
  const target: EventQueryReference = { kind: "event_query" };
  if (isNonEmptyString(value.date)) {
    if (!isValidDate(value.date)) return null;
    target.date = value.date;
  }
  if (isRecord(value.range)) {
    if (!isNonEmptyString(value.range.startDate) || !isNonEmptyString(value.range.endDate)) return null;
    if (!isValidDate(value.range.startDate) || !isValidDate(value.range.endDate)) return null;
    target.range = { startDate: value.range.startDate, endDate: value.range.endDate };
  }
  if (isNonEmptyString(value.startTime)) {
    if (!isValidTime(value.startTime)) return null;
    target.startTime = value.startTime;
  }
  if (value.timeWindow === "morning" || value.timeWindow === "afternoon" || value.timeWindow === "evening") {
    target.timeWindow = value.timeWindow;
  }
  if (isNonEmptyString(value.title)) target.title = value.title.trim();

  const hasDateScope = Boolean(target.date || target.range);
  const hasTargetSignal = Boolean(target.title || target.startTime || target.timeWindow);
  if (!hasTargetSignal) return null;
  if (!hasDateScope && !target.title) return null;
  return target;
}

function normalizeTodoTarget(value: Record<string, unknown>): ToolTodoTarget | null {
  const target: ToolTodoTarget = {
    ...(isNonEmptyString(value.seedId) ? { seedId: value.seedId } : {}),
    ...(Number.isInteger(value.itemNumber) && Number(value.itemNumber) > 0 ? { itemNumber: Number(value.itemNumber) } : {}),
    ...normalizeItemNumbersField(value.itemNumbers),
    ...(isNonEmptyString(value.title) ? { title: value.title.trim() } : {}),
  };
  return Object.keys(target).length > 0 ? target : null;
}

function normalizeItemNumbersField(value: unknown): { itemNumbers?: number[] } {
  if (!Array.isArray(value)) return {};
  const itemNumbers = [...new Set(value.filter((item): item is number => Number.isInteger(item) && item > 0))];
  return itemNumbers.length > 0 ? { itemNumbers } : {};
}

function normalizeTodoPatch(value: Record<string, unknown>): ToolTodoPatch | null {
  if (value.targetDate !== undefined && (!isNonEmptyString(value.targetDate) || !isValidDate(value.targetDate))) {
    return null;
  }
  const patch: ToolTodoPatch = {
    ...(isNonEmptyString(value.title) ? { title: value.title.trim() } : {}),
    ...(isNonEmptyString(value.targetDate) ? { targetDate: value.targetDate } : {}),
    ...(isNonEmptyString(value.reminderAt) ? { reminderAt: value.reminderAt.trim() } : {}),
    ...(value.clearReminder === true ? { clearReminder: true } : {}),
  };
  return Object.keys(patch).length > 0 ? patch : null;
}

function isSettingsSummaryTopic(value: unknown): value is SettingsSummaryTopic {
  return value === "all" || value === "reminder" || value === "calendar" || value === "model" || value === "memory" || value === "runtime";
}

function normalizeDateQuery(value: Record<string, unknown>): ToolDeleteEventsQuery | null {
  if (isNonEmptyString(value.date)) {
    if (!isValidDate(value.date)) return null;
    return { date: value.date };
  }

  if (isRecord(value.range)) {
    if (!isNonEmptyString(value.range.startDate) || !isNonEmptyString(value.range.endDate)) return null;
    if (!isValidDate(value.range.startDate) || !isValidDate(value.range.endDate)) return null;
    return { range: { startDate: value.range.startDate, endDate: value.range.endDate } };
  }

  return null;
}

function normalizeEventDraft(value: Record<string, unknown>): Partial<EventDraft> {
  const draft: Partial<EventDraft> = {};
  if (isNonEmptyString(value.title)) draft.title = value.title;
  if (isNonEmptyString(value.date)) draft.date = value.date;
  if (isNonEmptyString(value.startTime)) draft.startTime = value.startTime;
  if (isNonEmptyString(value.endTime)) draft.endTime = value.endTime;
  if (isNonEmptyString(value.location)) draft.location = value.location;
  if (isNonEmptyString(value.notes)) draft.notes = value.notes;
  if (typeof value.reminderMinutes === "number") draft.reminderMinutes = value.reminderMinutes;
  if (Array.isArray(value.reminderMinutes)) {
    const minutes = value.reminderMinutes.filter((item): item is number => typeof item === "number");
    if (minutes.length > 0) draft.reminderMinutes = minutes;
  }
  if (value.reminderAtStart === true) draft.reminderAtStart = true;
  if (Array.isArray(value.sourceIds)) draft.sourceIds = value.sourceIds.filter(isNonEmptyString);
  return draft;
}

function hasStartTimeEvidence(value: Record<string, unknown>, sourceText: string): boolean {
  if (!isNonEmptyString(value.startTimeEvidence)) return false;
  const normalizedSource = normalizeEvidenceText(sourceText);
  const normalizedEvidence = normalizeEvidenceText(value.startTimeEvidence);
  if (normalizedEvidence.length > 0 && normalizedSource.includes(normalizedEvidence)) return true;
  return canonicalTimeEvidenceVariants(value.startTimeEvidence).some((variant) => normalizedSource.includes(normalizeEvidenceText(variant)));
}

function hasSourceIds(value: Record<string, unknown>): boolean {
  return Array.isArray(value.sourceIds) && value.sourceIds.some(isNonEmptyString);
}

function normalizeEvidenceText(value: string): string {
  return Array.from(value.normalize("NFKC"))
    .filter((char) => char.trim().length > 0)
    .join("");
}

function canonicalTimeEvidenceVariants(value: string): string[] {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.normalize("NFKC").trim());
  if (!match || match[2] !== "00") return [];
  const hour = Number(match[1]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return [];

  const variants = [`${hour}:00`, `${String(hour).padStart(2, "0")}:00`, `${hour}点`, `${String(hour).padStart(2, "0")}点`];
  if (hour >= 5 && hour < 12) variants.push(`上午${hour}点`, `早上${hour}点`);
  if (hour >= 12 && hour < 18) {
    const twelveHour = hour === 12 ? 12 : hour - 12;
    variants.push(`下午${twelveHour}点`, `下午${String(twelveHour).padStart(2, "0")}点`);
  }
  if (hour >= 18 && hour <= 23) {
    const twelveHour = hour - 12;
    variants.push(`晚上${twelveHour}点`, `晚${twelveHour}点`, `晚上${String(twelveHour).padStart(2, "0")}点`);
  }
  return variants;
}

function normalizeScheduleItemChanges(value: unknown): { ok: true; data: ToolScheduleItemChange[] } | ToolValidationFailure {
  if (value === undefined) return { ok: true, data: [] };
  if (!Array.isArray(value)) return fail("invalid_arguments", "itemChanges 需要数组。");
  const changes: ToolScheduleItemChange[] = [];
  for (const item of value) {
    if (!isRecord(item)) return fail("invalid_arguments", "itemChanges 每一项都必须是对象。");
    const invalid = invalidEventDateTime(item, ["date", "startTime"]);
    if (invalid) return fail("invalid_arguments", `参数格式不合法：${invalid}`);
    const reminderMinutes = normalizeReminderMinutes(item.reminderMinutes);
    const change: ToolScheduleItemChange = {
      ...(Number.isInteger(item.itemNumber) && Number(item.itemNumber) > 0 ? { itemNumber: Number(item.itemNumber) } : {}),
      ...(isNonEmptyString(item.date) ? { date: item.date } : {}),
      ...(isNonEmptyString(item.startTime) ? { startTime: item.startTime } : {}),
      ...(isNonEmptyString(item.title) ? { title: item.title } : {}),
      ...(isNonEmptyString(item.location) ? { location: item.location } : {}),
      ...(reminderMinutes !== undefined ? { reminderMinutes } : {}),
      ...(isNonEmptyString(item.notes) ? { notes: item.notes } : {}),
    };
    if (Object.keys(change).length === 0) return fail("invalid_arguments", "itemChanges 没有可执行的修改内容。");
    changes.push(change);
  }
  return { ok: true, data: changes };
}

function normalizeReminderMinutes(value: unknown): number | number[] | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (!Array.isArray(value)) return undefined;
  const minutes = [...new Set(value.filter((item): item is number => Number.isInteger(item) && item >= 0))];
  return minutes.length > 0 ? minutes : undefined;
}

function hasExecutablePatch(value: Partial<EventDraft>): boolean {
  return (
    isNonEmptyString(value.title) ||
    isNonEmptyString(value.startTime) ||
    isNonEmptyString(value.endTime) ||
    isNonEmptyString(value.location) ||
    isNonEmptyString(value.notes) ||
    typeof value.reminderMinutes === "number" ||
    (Array.isArray(value.reminderMinutes) && value.reminderMinutes.some((item) => typeof item === "number"))
  );
}

function invalidEventDateTime(value: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (key.toLowerCase().includes("date") && isNonEmptyString(value[key]) && !isValidDate(value[key])) return key;
    if (key.toLowerCase().includes("time") && isNonEmptyString(value[key]) && !isValidTime(value[key])) return key;
  }

  return null;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);

  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(reason: ToolValidationFailureReason, message: string): ToolValidationFailure {
  return { ok: false, reason, message };
}
