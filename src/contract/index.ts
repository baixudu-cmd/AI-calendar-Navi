// 动作合同层：只接受 Phase 2 允许的 5 个动作，并把缺槽转换为追问。

export type EventDraft = {
  title: string;
  date: string;
  startTime: string;
  endTime?: string;
  location?: string;
  reminderMinutes?: number | number[];
  reminderAtStart?: boolean;
  sourceIds?: string[];
  notes?: string;
};

export type EventReference =
  | { kind: "last_event"; eventId: string }
  | { kind: "briefing_item"; itemNumber: number }
  | { kind: "recent_event_item"; itemNumber: number }
  | EventQueryReference;

export type EventQuery = { date: string } | { range: { startDate: string; endDate: string } };
export type EventQueryReference = {
  kind: "event_query";
  date?: string;
  range?: { startDate: string; endDate: string };
  startTime?: string;
  timeWindow?: "morning" | "afternoon" | "evening";
  title?: string;
};
export type ScheduleItemDraft = {
  title?: string;
  target?: TodoTarget;
  sourceIds?: string[];
  durationMinutes?: number;
  location?: string;
  reminderMinutes?: number | number[];
  notes?: string;
};
export type ScheduleItemChange = {
  itemNumber?: number;
  date?: string;
  startTime?: string;
  title?: string;
  location?: string;
  reminderMinutes?: number | number[];
  notes?: string;
};
export type TodoTarget = {
  seedId?: string;
  itemNumber?: number;
  itemNumbers?: number[];
  title?: string;
  group?: TodoTargetGroup;
};
export type TodoTargetGroup = "pending_schedule" | "pending_reminder" | "pending_todo" | "all";
export type TodoPatch = {
  title?: string;
  targetDate?: string;
  reminderAt?: string;
  clearReminder?: boolean;
};
export type SchedulePreferredWindow = "morning" | "afternoon" | "evening" | "later";
export type ScheduleContextRef = "pending_schedule";
export type SettingsSummaryTopic = "all" | "reminder" | "calendar" | "model" | "memory" | "runtime";

export type CalendarAction =
  | { type: "create_event"; event: EventDraft }
  | { type: "create_events"; events: EventDraft[] }
  | {
      type: "create_and_propose_schedule";
      events: EventDraft[];
      date?: string;
      items: ScheduleItemDraft[];
      preferredStartTime?: string;
      preferredWindow?: SchedulePreferredWindow;
      optionCount?: number;
    }
  | { type: "list_events"; date?: string; range?: { startDate: string; endDate: string } }
  | { type: "update_event"; target: EventReference; patch: Partial<EventDraft> }
  | {
      type: "propose_schedule";
      date?: string;
      items: ScheduleItemDraft[];
      autoCreate?: boolean;
      preferredStartTime?: string;
      preferredWindow?: SchedulePreferredWindow;
      optionCount?: number;
      contextRef?: ScheduleContextRef;
    }
  | { type: "confirm_schedule"; confirmed: boolean; optionNumber?: number; itemChanges?: ScheduleItemChange[] }
  | { type: "remember_todo"; title: string; autoSchedule?: boolean; date?: string }
  | { type: "manage_todos"; operation: "list"; limit?: number }
  | { type: "manage_todos"; operation: "list_shelved"; limit?: number }
  | { type: "manage_todos"; operation: "complete" | "delete" | "shelve" | "restore"; target: TodoTarget }
  | { type: "manage_todos"; operation: "update"; target: TodoTarget; patch: TodoPatch }
  | { type: "request_delete_event"; target: EventReference }
  | { type: "request_delete_events"; query: EventQuery }
  | { type: "confirm_delete"; confirmed: boolean; itemNumbers?: number[] }
  | { type: "confirm_create"; confirmed: boolean }
  | { type: "daily_briefing"; briefingType: "morning" | "evening" }
  | { type: "settings_summary"; topic?: SettingsSummaryTopic }
  | { type: "status_overview" }
  | { type: "dismiss_context" }
  | { type: "clarify"; question: string; missing: string[]; createDraft?: Partial<EventDraft> };

export type ContractResult =
  | { ok: true; action: CalendarAction }
  | { ok: false; reason: "malformed_decision" | "unknown_action"; message: string };

const ALLOWED_ACTIONS = new Set([
  "create_event",
  "list_events",
  "update_event",
  "daily_briefing",
  "clarify",
]);

// 快速判断模型动作是否属于 v1 合同。
export function validateAction(value: unknown): { known: boolean; action?: string } {
  if (!isRecord(value) || typeof value.action !== "string") return { known: false };
  return { known: ALLOWED_ACTIONS.has(value.action), action: value.action };
}

// 归一化模型输出；这里只校验合同，不执行任何工具。
export function normalizeDecision(value: unknown): ContractResult {
  if (isRecord(value) && typeof value.type === "string") {
    const internalAction = normalizeInternalCalendarAction(value);
    if (internalAction) return internalAction;
  }

  if (!isRecord(value) || typeof value.action !== "string") {
    return {
      ok: false,
      reason: "malformed_decision",
      message: "模型输出不是可识别的动作。",
    };
  }

  if (!ALLOWED_ACTIONS.has(value.action)) {
    if (value.action === "__tool_schema_rejected__") {
      return {
        ok: false,
        reason: "unknown_action",
        message: `工具 Schema 未通过：${typeof value.reason === "string" ? value.reason : "unknown"}`,
      };
    }
    return {
      ok: false,
      reason: "unknown_action",
      message: `不支持的动作：${value.action}`,
    };
  }

  switch (value.action) {
    case "create_event":
      return normalizeCreateEvent(value);
    case "list_events":
      return normalizeListEvents(value);
    case "update_event":
      return normalizeUpdateEvent(value);
    case "daily_briefing":
      return normalizeDailyBriefing(value);
    case "clarify":
      return normalizeClarify(value);
    default:
      return {
        ok: false,
        reason: "unknown_action",
        message: "不支持的动作。",
      };
  }
}

function normalizeInternalCalendarAction(value: Record<string, unknown>): ContractResult | null {
  switch (value.type) {
    case "create_event":
      return normalizeCreateEvent({ action: "create_event", event: value.event });
    case "create_events":
      return normalizeCreateEvents(value);
    case "create_and_propose_schedule":
      return normalizeInternalCreateAndProposeSchedule(value);
    case "list_events":
      return normalizeListEvents({ action: "list_events", date: value.date, range: value.range });
    case "update_event":
      return normalizeInternalUpdateEvent(value);
    case "propose_schedule":
      return normalizeInternalProposeSchedule(value);
    case "confirm_schedule":
      return normalizeInternalScheduleConfirmation(value);
    case "remember_todo":
      return normalizeInternalRememberTodo(value);
    case "manage_todos":
      return normalizeInternalManageTodos(value);
    case "daily_briefing":
      return normalizeDailyBriefing({ action: "daily_briefing", briefingType: value.briefingType });
    case "settings_summary":
      return normalizeInternalSettingsSummary(value);
    case "status_overview":
      return { ok: true, action: { type: "status_overview" } };
    case "dismiss_context":
      return { ok: true, action: { type: "dismiss_context" } };
    case "request_delete_event":
      return normalizeInternalDeleteRequest(value);
    case "request_delete_events":
      return normalizeInternalDeleteEventsRequest(value);
    case "confirm_delete":
      return normalizeInternalDeleteConfirmation(value);
    case "confirm_create":
      return normalizeInternalCreateConfirmation(value);
    case "clarify":
      return normalizeClarify({ action: "clarify", question: value.question, missing: value.missing, createDraft: value.createDraft });
    default:
      return null;
  }
}

function normalizeInternalSettingsSummary(value: Record<string, unknown>): ContractResult {
  if (value.topic !== undefined && !isSettingsSummaryTopic(value.topic)) return clarify(["topic"]);
  return {
    ok: true,
    action: {
      type: "settings_summary",
      ...(isSettingsSummaryTopic(value.topic) && value.topic !== "all" ? { topic: value.topic } : {}),
    },
  };
}

function normalizeInternalManageTodos(value: Record<string, unknown>): ContractResult {
  if (value.operation !== "list" && value.operation !== "list_shelved" && value.operation !== "complete" && value.operation !== "delete" && value.operation !== "shelve" && value.operation !== "restore" && value.operation !== "update") {
    return clarify(["operation"]);
  }
  if (value.operation === "list" || value.operation === "list_shelved") {
    return {
      ok: true,
      action: {
        type: "manage_todos",
        operation: value.operation,
        ...(Number.isInteger(value.limit) && Number(value.limit) > 0 ? { limit: Number(value.limit) } : {}),
      },
    };
  }

  if (!isRecord(value.target)) return clarify(["target"]);
  const target = normalizeTodoTarget(value.target);
  if (!target) return clarify(["target"]);
  if (value.operation === "update") {
    if (!isRecord(value.patch)) return clarify(["patch"]);
    const patch = normalizeTodoPatch(value.patch);
    if (!patch) return clarify(["patch"]);
    return { ok: true, action: { type: "manage_todos", operation: "update", target, patch } };
  }

  return { ok: true, action: { type: "manage_todos", operation: value.operation, target } };
}

function normalizeCreateEvents(value: Record<string, unknown>): ContractResult {
  if (!Array.isArray(value.events) || value.events.length < 2 || value.events.length > 5) {
    return clarify(["events"]);
  }

  const events: EventDraft[] = [];
  for (const event of value.events) {
    const normalized = normalizeCreateEvent({ action: "create_event", event });
    if (!normalized.ok) return normalized;
    if (normalized.action.type !== "create_event") {
      if (normalized.action.type === "clarify") {
        return { ok: true, action: { type: "clarify", question: normalized.action.question, missing: normalized.action.missing } };
      }
      return clarify(["events"]);
    }
    events.push(normalized.action.event);
  }

  return { ok: true, action: { type: "create_events", events } };
}

function normalizeInternalCreateAndProposeSchedule(value: Record<string, unknown>): ContractResult {
  if (!Array.isArray(value.events) || value.events.length < 1 || value.events.length > 5) {
    return clarify(["events"]);
  }

  const events: EventDraft[] = [];
  for (const event of value.events) {
    const normalized = normalizeCreateEvent({ action: "create_event", event });
    if (!normalized.ok) return normalized;
    if (normalized.action.type !== "create_event") return clarify(["events"]);
    events.push(normalized.action.event);
  }

  const schedule = normalizeInternalProposeSchedule(value);
  if (!schedule.ok) return schedule;
  if (schedule.action.type !== "propose_schedule" || schedule.action.items.length === 0) return clarify(["items"]);

  return {
    ok: true,
    action: {
      type: "create_and_propose_schedule",
      events,
      ...(schedule.action.date ? { date: schedule.action.date } : {}),
      items: schedule.action.items,
      ...(schedule.action.preferredStartTime ? { preferredStartTime: schedule.action.preferredStartTime } : {}),
      ...(schedule.action.preferredWindow ? { preferredWindow: schedule.action.preferredWindow } : {}),
      ...(schedule.action.optionCount ? { optionCount: schedule.action.optionCount } : {}),
    },
  };
}

function normalizeInternalUpdateEvent(value: Record<string, unknown>): ContractResult {
  if (!isRecord(value.target)) return clarify(["target"]);
  const target = normalizeInternalTarget(value.target);
  if (!target) return clarify(["target"]);
  if (!isRecord(value.patch) || Object.keys(value.patch).length === 0) return clarify(["patch"]);
  const invalid = invalidEventDateTime(value.patch, ["date", "startTime", "endTime"]);
  if (invalid) return clarify([invalid]);
  const patch = normalizePatch(value.patch);
  if (!hasExecutablePatch(patch)) return clarify(["patch"]);

  return { ok: true, action: { type: "update_event", target, patch } };
}

function normalizeInternalProposeSchedule(value: Record<string, unknown>): ContractResult {
  if (value.date !== undefined && (!isNonEmptyString(value.date) || !isValidDate(value.date))) return clarify(["date"]);
  if (value.preferredStartTime !== undefined && (!isNonEmptyString(value.preferredStartTime) || !isValidTime(value.preferredStartTime))) {
    return clarify(["preferredStartTime"]);
  }
  if (value.preferredWindow !== undefined && !isSchedulePreferredWindow(value.preferredWindow)) return clarify(["preferredWindow"]);
  if (value.optionCount !== undefined && (!Number.isInteger(value.optionCount) || Number(value.optionCount) < 1 || Number(value.optionCount) > 5)) {
    return clarify(["optionCount"]);
  }
  if (value.contextRef !== undefined && !isScheduleContextRef(value.contextRef)) return clarify(["contextRef"]);
  if (value.items !== undefined && (!Array.isArray(value.items) || value.items.length > 5)) return clarify(["items"]);
  const items: ScheduleItemDraft[] = [];
  for (const item of Array.isArray(value.items) ? value.items : []) {
    if (!isRecord(item)) return clarify(["items"]);
    const target = isRecord(item.target) ? normalizeTodoTarget(item.target) : null;
    if (item.target !== undefined && !target) return clarify(["items"]);
    if (!isNonEmptyString(item.title) && !target) return clarify(["items"]);
    items.push({
      ...(isNonEmptyString(item.title) ? { title: item.title } : {}),
      ...(target ? { target } : {}),
      ...(Array.isArray(item.sourceIds) ? { sourceIds: item.sourceIds.filter(isNonEmptyString) } : {}),
      ...(Number.isInteger(item.durationMinutes) && Number(item.durationMinutes) > 0 ? { durationMinutes: Number(item.durationMinutes) } : {}),
      ...optionalString(item, "location"),
      ...optionalString(item, "notes"),
      ...optionalReminderMinutes(item),
    });
  }
  return {
    ok: true,
    action: {
      type: "propose_schedule",
      ...(isNonEmptyString(value.date) ? { date: value.date } : {}),
      items,
      ...(typeof value.autoCreate === "boolean" ? { autoCreate: value.autoCreate } : {}),
      ...(isNonEmptyString(value.preferredStartTime) ? { preferredStartTime: value.preferredStartTime } : {}),
      ...(isSchedulePreferredWindow(value.preferredWindow) ? { preferredWindow: value.preferredWindow } : {}),
      ...(Number.isInteger(value.optionCount) ? { optionCount: Number(value.optionCount) } : {}),
      ...(isScheduleContextRef(value.contextRef) ? { contextRef: value.contextRef } : {}),
    },
  };
}

function isSchedulePreferredWindow(value: unknown): value is SchedulePreferredWindow {
  return value === "morning" || value === "afternoon" || value === "evening" || value === "later";
}

function isScheduleContextRef(value: unknown): value is ScheduleContextRef {
  return value === "pending_schedule";
}

function normalizeInternalRememberTodo(value: Record<string, unknown>): ContractResult {
  if (!isNonEmptyString(value.title)) return clarify(["title"]);
  if (value.date !== undefined && (!isNonEmptyString(value.date) || !isValidDate(value.date))) return clarify(["date"]);
  return {
    ok: true,
    action: {
      type: "remember_todo",
      title: value.title.trim(),
      autoSchedule: typeof value.autoSchedule === "boolean" ? value.autoSchedule : true,
      ...(isNonEmptyString(value.date) ? { date: value.date } : {}),
    },
  };
}

function normalizeInternalScheduleConfirmation(value: Record<string, unknown>): ContractResult {
  if (typeof value.confirmed !== "boolean") return clarify(["confirmed"]);
  const itemChanges = normalizeScheduleItemChanges(value.itemChanges);
  if (value.itemChanges !== undefined && itemChanges.length === 0) return clarify(["itemChanges"]);
  if (!value.confirmed && (value.optionNumber !== undefined || value.itemChanges !== undefined)) return clarify(["confirmed"]);
  return {
    ok: true,
    action: {
      type: "confirm_schedule",
      confirmed: value.confirmed,
      ...(Number.isInteger(value.optionNumber) && Number(value.optionNumber) > 0 ? { optionNumber: Number(value.optionNumber) } : {}),
      ...(itemChanges.length > 0 ? { itemChanges } : {}),
    },
  };
}

function normalizeInternalDeleteRequest(value: Record<string, unknown>): ContractResult {
  if (!isRecord(value.target)) return clarify(["target"]);
  const target = normalizeInternalTarget(value.target);
  if (!target) return clarify(["target"]);
  return { ok: true, action: { type: "request_delete_event", target } };
}

function normalizeInternalDeleteEventsRequest(value: Record<string, unknown>): ContractResult {
  if (!isRecord(value.query)) return clarify(["query"]);
  const query = normalizeQuery(value.query);
  if (!query) return clarify(["query"]);
  return { ok: true, action: { type: "request_delete_events", query } };
}

function normalizeInternalDeleteConfirmation(value: Record<string, unknown>): ContractResult {
  if (typeof value.confirmed !== "boolean") return clarify(["confirmed"]);
  const itemNumbers = normalizeItemNumbers(value.itemNumbers);
  if (value.itemNumbers !== undefined && itemNumbers.length === 0) return clarify(["itemNumbers"]);
  return {
    ok: true,
    action: {
      type: "confirm_delete",
      confirmed: value.confirmed,
      ...(itemNumbers.length > 0 ? { itemNumbers } : {}),
    },
  };
}

function normalizeInternalCreateConfirmation(value: Record<string, unknown>): ContractResult {
  if (typeof value.confirmed !== "boolean") return clarify(["confirmed"]);
  return { ok: true, action: { type: "confirm_create", confirmed: value.confirmed } };
}

function normalizeInternalTarget(value: Record<string, unknown>): EventReference | null {
  if (value.kind === "last_event") return { kind: "last_event", eventId: isNonEmptyString(value.eventId) ? value.eventId : "" };
  if (value.kind === "briefing_item" && Number.isInteger(value.itemNumber) && Number(value.itemNumber) > 0) {
    return { kind: "briefing_item", itemNumber: Number(value.itemNumber) };
  }
  if (value.kind === "recent_event_item" && Number.isInteger(value.itemNumber) && Number(value.itemNumber) > 0) {
    return { kind: "recent_event_item", itemNumber: Number(value.itemNumber) };
  }
  if (value.kind === "event_query") return normalizeEventQueryReference(value);
  return null;
}

function normalizeEventQueryReference(value: Record<string, unknown>): EventQueryReference | null {
  const query: EventQueryReference = { kind: "event_query" };
  if (isNonEmptyString(value.date) && isValidDate(value.date)) query.date = value.date;
  if (
    isRecord(value.range) &&
    isNonEmptyString(value.range.startDate) &&
    isNonEmptyString(value.range.endDate) &&
    isValidDate(value.range.startDate) &&
    isValidDate(value.range.endDate)
  ) {
    query.range = { startDate: value.range.startDate, endDate: value.range.endDate };
  }
  if (isNonEmptyString(value.startTime) && isValidTime(value.startTime)) query.startTime = value.startTime;
  if (value.timeWindow === "morning" || value.timeWindow === "afternoon" || value.timeWindow === "evening") {
    query.timeWindow = value.timeWindow;
  }
  if (isNonEmptyString(value.title)) query.title = value.title.trim();

  const hasDateScope = Boolean(query.date || query.range);
  const hasTargetSignal = Boolean(query.title || query.startTime || query.timeWindow);
  if (!hasTargetSignal) return null;
  if (!hasDateScope && !query.title) return null;
  return query;
}

function normalizeTodoTarget(value: Record<string, unknown>): TodoTarget | null {
  const target: TodoTarget = {
    ...(isNonEmptyString(value.seedId) ? { seedId: value.seedId } : {}),
    ...(Number.isInteger(value.itemNumber) && Number(value.itemNumber) > 0 ? { itemNumber: Number(value.itemNumber) } : {}),
    ...normalizeItemNumbersField(value.itemNumbers),
    ...(isNonEmptyString(value.title) ? { title: value.title.trim() } : {}),
    ...(isTodoTargetGroup(value.group) ? { group: value.group } : {}),
  };
  return Object.keys(target).length > 0 ? target : null;
}

function isTodoTargetGroup(value: unknown): value is TodoTargetGroup {
  return value === "pending_schedule" || value === "pending_reminder" || value === "pending_todo" || value === "all";
}

function normalizeItemNumbersField(value: unknown): { itemNumbers?: number[] } {
  if (!Array.isArray(value)) return {};
  const itemNumbers = [...new Set(value.filter((item): item is number => Number.isInteger(item) && item > 0))];
  return itemNumbers.length > 0 ? { itemNumbers } : {};
}

function normalizeTodoPatch(value: Record<string, unknown>): TodoPatch | null {
  const patch: TodoPatch = {
    ...(isNonEmptyString(value.title) ? { title: value.title.trim() } : {}),
    ...(isNonEmptyString(value.targetDate) && isValidDate(value.targetDate) ? { targetDate: value.targetDate } : {}),
    ...(isNonEmptyString(value.reminderAt) ? { reminderAt: value.reminderAt.trim() } : {}),
    ...(value.clearReminder === true ? { clearReminder: true } : {}),
  };
  return Object.keys(patch).length > 0 ? patch : null;
}

function normalizeQuery(value: Record<string, unknown>): EventQuery | null {
  if (isNonEmptyString(value.date) && isValidDate(value.date)) return { date: value.date };
  if (
    isRecord(value.range) &&
    isNonEmptyString(value.range.startDate) &&
    isNonEmptyString(value.range.endDate) &&
    isValidDate(value.range.startDate) &&
    isValidDate(value.range.endDate)
  ) {
    return { range: { startDate: value.range.startDate, endDate: value.range.endDate } };
  }

  return null;
}

function normalizeItemNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is number => Number.isInteger(item) && item > 0))];
}

function normalizeScheduleItemChanges(value: unknown): ScheduleItemChange[] {
  if (!Array.isArray(value)) return [];
  const changes: ScheduleItemChange[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const invalid = invalidEventDateTime(item, ["date", "startTime"]);
    if (invalid) return [];
    const change: ScheduleItemChange = {
      ...(Number.isInteger(item.itemNumber) && Number(item.itemNumber) > 0 ? { itemNumber: Number(item.itemNumber) } : {}),
      ...optionalString(item, "date"),
      ...optionalString(item, "startTime"),
      ...optionalString(item, "title"),
      ...optionalString(item, "location"),
      ...optionalString(item, "notes"),
      ...optionalReminderMinutes(item),
    };
    if (Object.keys(change).length > 0) changes.push(change);
  }
  return changes;
}

function normalizeCreateEvent(value: Record<string, unknown>): ContractResult {
  const event = value.event;
  if (!isRecord(event)) {
    return clarify(["title", "date", "startTime"]);
  }

  const missing = ["title", "date", "startTime"].filter((key) => !isNonEmptyString(event[key]));
  if (missing.length > 0) return clarify(missing, normalizePatch(event));
  const invalid = invalidEventDateTime(event, ["date", "startTime", "endTime"]);
  if (invalid) return clarify([invalid]);

  return {
    ok: true,
    action: {
      type: "create_event",
      event: {
        title: event.title as string,
        date: event.date as string,
        startTime: event.startTime as string,
        ...optionalString(event, "endTime"),
        ...optionalString(event, "location"),
        ...optionalString(event, "notes"),
        ...optionalReminderMinutes(event),
        ...(event.reminderAtStart === true ? { reminderAtStart: true } : {}),
        ...(Array.isArray(event.sourceIds) ? { sourceIds: event.sourceIds.filter(isNonEmptyString) } : {}),
      },
    },
  };
}

function normalizeListEvents(value: Record<string, unknown>): ContractResult {
  if (isNonEmptyString(value.date)) {
    if (!isValidDate(value.date)) return clarify(["date"]);
    return { ok: true, action: { type: "list_events", date: value.date } };
  }

  if (isRecord(value.range) && isNonEmptyString(value.range.startDate) && isNonEmptyString(value.range.endDate)) {
    if (!isValidDate(value.range.startDate)) return clarify(["startDate"]);
    if (!isValidDate(value.range.endDate)) return clarify(["endDate"]);
    return {
      ok: true,
      action: {
        type: "list_events",
        range: {
          startDate: value.range.startDate,
          endDate: value.range.endDate,
        },
      },
    };
  }

  return clarify(["date"]);
}

function normalizeUpdateEvent(value: Record<string, unknown>): ContractResult {
  if (!isRecord(value.target)) return clarify(["target"]);
  const target = normalizeTarget(value.target);
  if (!target) return clarify(["target"]);
  if (!isRecord(value.patch) || Object.keys(value.patch).length === 0) return clarify(["patch"]);
  const invalid = invalidEventDateTime(value.patch, ["date", "startTime", "endTime"]);
  if (invalid) return clarify([invalid]);
  const patch = normalizePatch(value.patch);
  if (!hasExecutablePatch(patch)) return clarify(["patch"]);

  return {
    ok: true,
    action: {
      type: "update_event",
      target,
      patch,
    },
  };
}

function normalizeDailyBriefing(value: Record<string, unknown>): ContractResult {
  if (value.briefingType !== "morning" && value.briefingType !== "evening") {
    return clarify(["briefingType"]);
  }

  return { ok: true, action: { type: "daily_briefing", briefingType: value.briefingType } };
}

function normalizeClarify(value: Record<string, unknown>): ContractResult {
  if (!isNonEmptyString(value.question)) return clarify(["question"]);
  const missing = Array.isArray(value.missing)
    ? value.missing.filter((item): item is string => typeof item === "string" && item.length > 0)
    : ["unknown"];
  const createDraft = isRecord(value.createDraft) ? normalizePatch(value.createDraft) : {};
  return {
    ok: true,
    action: {
      type: "clarify",
      question: value.question,
      missing,
      ...(Object.keys(createDraft).length > 0 ? { createDraft } : {}),
    },
  };
}

function normalizeTarget(value: Record<string, unknown>): EventReference | null {
  if (value.kind === "last_event" && isNonEmptyString(value.eventId)) {
    return { kind: "last_event", eventId: value.eventId };
  }

  if (value.kind === "briefing_item" && Number.isInteger(value.itemNumber) && Number(value.itemNumber) > 0) {
    return { kind: "briefing_item", itemNumber: Number(value.itemNumber) };
  }

  if (value.kind === "recent_event_item" && Number.isInteger(value.itemNumber) && Number(value.itemNumber) > 0) {
    return { kind: "recent_event_item", itemNumber: Number(value.itemNumber) };
  }

  if (value.kind === "event_query") return normalizeEventQueryReference(value);

  return null;
}

function normalizePatch(value: Record<string, unknown>): Partial<EventDraft> {
  return {
    ...optionalString(value, "title"),
    ...optionalString(value, "date"),
    ...optionalString(value, "startTime"),
    ...optionalString(value, "endTime"),
    ...optionalString(value, "location"),
    ...optionalString(value, "notes"),
    ...optionalReminderMinutes(value),
    ...(value.reminderAtStart === true ? { reminderAtStart: true } : {}),
    ...(Array.isArray(value.sourceIds) ? { sourceIds: value.sourceIds.filter(isNonEmptyString) } : {}),
  };
}

// 判断修改是否能真正生成飞书 patch，避免空修改被当成成功。
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

// 校验合同层的日期时间，避免 mapper 生成 NaN timestamp。
function invalidEventDateTime(value: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (key.toLowerCase().includes("date") && isNonEmptyString(value[key]) && !isValidDate(value[key])) return key;
    if (key.toLowerCase().includes("time") && isNonEmptyString(value[key]) && !isValidTime(value[key])) return key;
  }

  return null;
}

function clarify(missing: string[], createDraft: Partial<EventDraft> = {}): ContractResult {
  return {
    ok: true,
    action: {
      type: "clarify",
      question: questionForMissing(missing),
      missing,
      ...(Object.keys(createDraft).length > 0 ? { createDraft } : {}),
    },
  };
}

function questionForMissing(fields: string[]): string {
  if (fields.includes("date") && fields.includes("startTime")) return "这个日程是哪天几点？";
  if (fields.includes("date")) return "这个日程是哪一天？";
  if (fields.includes("startTime")) return "这个日程几点开始？";
  if (fields.includes("title")) return "我会根据内容整理标题；请再发一次要记录的原文。";

  const field = fields[0] || "unknown";
  const questions: Record<string, string> = {
    date: "这个日程是哪一天？",
    startTime: "这个日程几点开始？",
    target: "你想改哪一个日程？",
    patch: "你想把这个日程改成什么？",
    briefingType: "你想看早报还是晚报？",
    question: "还需要补充哪个信息？",
  };
  return questions[field] || "请补充这个日程的关键信息。";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSettingsSummaryTopic(value: unknown): value is SettingsSummaryTopic {
  return value === "all" || value === "reminder" || value === "calendar" || value === "model" || value === "memory" || value === "runtime";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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

function optionalString(value: Record<string, unknown>, key: string): Record<string, string> {
  return isNonEmptyString(value[key]) ? { [key]: value[key] } : {};
}

function optionalNumber(value: Record<string, unknown>, key: string): Record<string, number> {
  return typeof value[key] === "number" ? { [key]: value[key] } : {};
}

function optionalReminderMinutes(value: Record<string, unknown>): Record<string, number | number[]> {
  if (typeof value.reminderMinutes === "number") return { reminderMinutes: value.reminderMinutes };
  if (Array.isArray(value.reminderMinutes)) {
    const minutes = [...new Set(value.reminderMinutes.filter((item): item is number => Number.isInteger(item) && item > 0))].sort((a, b) => b - a).slice(0, 3);
    if (minutes.length > 0) return { reminderMinutes: minutes };
    return value.reminderMinutes.some((item) => item === 0) ? { reminderMinutes: 0 } : {};
  }
  return {};
}
