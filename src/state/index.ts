// 短期状态模块，只保存白名单上下文，避免发展成长期记忆。

import type { EventDraft } from "../contract/index.js";
import type { SeedLiteItem } from "../seed-lite/index.js";

export type LastEventState = {
  eventId: string;
  title: string;
  date?: string;
  startTime?: string;
};

export type PendingClarificationState = {
  question: string;
  missing: string[];
  createDraft?: PendingCreateDraftState;
};

export type PendingCreateDraftState = {
  title?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  reminderMinutes?: number;
  notes?: string;
};

export type BriefingItemState = {
  itemNumber: number;
  eventId: string;
  title: string;
  date?: string;
  startTime?: string;
};

export type PendingDeleteItemState = {
  eventId: string;
  title: string;
  date?: string;
  startTime?: string;
};

export type PendingSingleDeleteState = PendingDeleteItemState & {
  source: "last_event" | "briefing_item" | "recent_event_item" | "event_query";
  itemNumber?: number;
};

export type PendingBatchDeleteState = {
  source: "date_query" | "event_query";
  title: string;
  eventIds: string[];
  items: PendingDeleteItemState[];
  requireSelection?: boolean;
  date?: string;
  range?: { startDate: string; endDate: string };
};

export type PendingDeleteState = PendingSingleDeleteState | PendingBatchDeleteState;

export type PendingConflictState = {
  action: { type: "create_event"; event: EventDraft } | { type: "create_events"; events: EventDraft[] };
  conflicts: PendingConflictItemState[];
};

export type PendingConflictItemState = {
  existingEventId?: string;
  title: string;
  start: string;
};

export type PendingScheduleItemState = {
  itemNumber: number;
  title: string;
  sourceIds?: string[];
  reasonCodes?: string[];
  confidence?: number;
  date: string;
  startTime: string;
  endTime?: string;
  durationMinutes: number;
  location?: string;
  reminderMinutes?: number | number[];
  notes?: string;
};

export type PendingScheduleOptionState = {
  optionNumber: number;
  items: PendingScheduleItemState[];
};

export type PendingScheduleState = {
  date: string;
  options: PendingScheduleOptionState[];
};

export type ShortTermState = {
  last_event?: LastEventState;
  pending_clarification?: PendingClarificationState;
  briefing_items?: BriefingItemState[];
  recent_event_items?: BriefingItemState[];
  pending_delete?: PendingDeleteState;
  pending_conflict?: PendingConflictState;
  pending_schedule?: PendingScheduleState;
  pending_image_draft?: EventDraft;
  seed_items?: SeedLiteItem[];
  pending_reminder_seed_items?: SeedLiteItem[];
  pending_schedule_seed_items?: SeedLiteItem[];
  pending_todo_seed_items?: SeedLiteItem[];
  shelved_seed_items?: SeedLiteItem[];
};

export type ShortTermStateStore = {
  snapshot(): ShortTermState;
  update(next: Record<string, unknown>): void;
  clearPendingClarification(): void;
  clearPendingDelete(): void;
  clearPendingConflict(): void;
  clearPendingSchedule(): void;
  clearPendingImageDraft(): void;
};

// 创建内存状态容器；只接受白名单字段。
export function createShortTermStateStore(initial: ShortTermState = {}): ShortTermStateStore {
  let state: ShortTermState = sanitizeState(initial);

  return {
    snapshot() {
      return structuredClone(state);
    },
    update(next) {
      state = sanitizeState({ ...state, ...next });
    },
    clearPendingClarification() {
      const { pending_clarification: _pending, ...rest } = state;
      state = rest;
    },
    clearPendingDelete() {
      const { pending_delete: _pending, ...rest } = state;
      state = rest;
    },
    clearPendingConflict() {
      const { pending_conflict: _pending, ...rest } = state;
      state = rest;
    },
    clearPendingSchedule() {
      const { pending_schedule: _pending, ...rest } = state;
      state = rest;
    },
    clearPendingImageDraft() {
      const { pending_image_draft: _pending, ...rest } = state;
      state = rest;
    },
  };
}

function sanitizeState(value: Record<string, unknown>): ShortTermState {
  const next: ShortTermState = {};

  const lastEvent = normalizeLastEvent(value.last_event);
  if (lastEvent) next.last_event = lastEvent;
  const pendingClarification = normalizePendingClarification(value.pending_clarification);
  if (pendingClarification) next.pending_clarification = pendingClarification;
  if (Array.isArray(value.briefing_items)) {
    const items = value.briefing_items.map(normalizeBriefingItem).filter((item): item is BriefingItemState => Boolean(item));
    if (items.length > 0) next.briefing_items = items;
  }
  if (Array.isArray(value.recent_event_items)) {
    const items = value.recent_event_items.map(normalizeBriefingItem).filter((item): item is BriefingItemState => Boolean(item));
    if (items.length > 0) next.recent_event_items = items;
  }
  const pendingDelete = normalizePendingDelete(value.pending_delete);
  if (pendingDelete) next.pending_delete = pendingDelete;
  const pendingConflict = normalizePendingConflict(value.pending_conflict);
  if (pendingConflict) next.pending_conflict = pendingConflict;
  const pendingSchedule = normalizePendingSchedule(value.pending_schedule);
  if (pendingSchedule) next.pending_schedule = pendingSchedule;
  const pendingImageDraft = normalizeRequiredEventDraft(value.pending_image_draft);
  if (pendingImageDraft) next.pending_image_draft = pendingImageDraft;
  if (Array.isArray(value.seed_items)) {
    const seedItems = value.seed_items.map(normalizeSeedItem).filter((item): item is SeedLiteItem => Boolean(item));
    if (seedItems.length > 0) next.seed_items = seedItems;
  }
  if (Array.isArray(value.pending_reminder_seed_items)) {
    const seedItems = value.pending_reminder_seed_items.map(normalizeSeedItem).filter((item): item is SeedLiteItem => Boolean(item));
    if (seedItems.length > 0) next.pending_reminder_seed_items = seedItems;
  }
  if (Array.isArray(value.pending_schedule_seed_items)) {
    const seedItems = value.pending_schedule_seed_items.map(normalizeSeedItem).filter((item): item is SeedLiteItem => Boolean(item));
    if (seedItems.length > 0) next.pending_schedule_seed_items = seedItems;
  }
  if (Array.isArray(value.pending_todo_seed_items)) {
    const seedItems = value.pending_todo_seed_items.map(normalizeSeedItem).filter((item): item is SeedLiteItem => Boolean(item));
    if (seedItems.length > 0) next.pending_todo_seed_items = seedItems;
  }
  if (Array.isArray(value.shelved_seed_items)) {
    const shelvedSeedItems = value.shelved_seed_items.map(normalizeSeedItem).filter((item): item is SeedLiteItem => Boolean(item));
    if (shelvedSeedItems.length > 0) next.shelved_seed_items = shelvedSeedItems;
  }

  return next;
}

function normalizeLastEvent(value: unknown): LastEventState | null {
  if (!isRecord(value) || !isNonEmptyString(value.eventId) || !isNonEmptyString(value.title)) return null;

  return {
    eventId: value.eventId,
    title: value.title as string,
    ...(isNonEmptyString(value.date) ? { date: value.date } : {}),
    ...(isNonEmptyString(value.startTime) ? { startTime: value.startTime } : {}),
  };
}

function isPendingClarification(value: unknown): value is PendingClarificationState {
  if (!isRecord(value) || !isNonEmptyString(value.question) || !Array.isArray(value.missing)) return false;
  if (!value.missing.every(isNonEmptyString)) return false;
  return true;
}

function normalizePendingClarification(value: unknown): PendingClarificationState | null {
  if (!isPendingClarification(value)) return null;
  const createDraft = normalizeCreateDraft(value.createDraft);
  return {
    question: value.question,
    missing: value.missing,
    ...(createDraft ? { createDraft } : {}),
  };
}

function normalizeBriefingItem(value: unknown): BriefingItemState | null {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.itemNumber) ||
    Number(value.itemNumber) <= 0 ||
    !isNonEmptyString(value.eventId) ||
    !isNonEmptyString(value.title)
  ) {
    return null;
  }

  return {
    itemNumber: Number(value.itemNumber),
    eventId: value.eventId,
    title: String(value.title),
    ...(isNonEmptyString(value.date) ? { date: value.date } : {}),
    ...(isNonEmptyString(value.startTime) ? { startTime: value.startTime } : {}),
  };
}

function normalizePendingDelete(value: unknown): PendingDeleteState | null {
  if (!isRecord(value) || !isNonEmptyString(value.title)) return null;
  if (value.source === "date_query" || value.source === "event_query") {
    if (Array.isArray(value.eventIds)) return normalizePendingBatchDelete(value);
  }
  if (!isNonEmptyString(value.eventId)) return null;
  if (value.source !== "last_event" && value.source !== "briefing_item" && value.source !== "recent_event_item" && value.source !== "event_query") {
    return null;
  }

  return {
    eventId: value.eventId,
    title: value.title,
    source: value.source,
    ...((value.source === "briefing_item" || value.source === "recent_event_item") &&
    Number.isInteger(value.itemNumber) &&
    Number(value.itemNumber) > 0
      ? { itemNumber: Number(value.itemNumber) }
      : {}),
    ...(isNonEmptyString(value.date) ? { date: value.date } : {}),
    ...(isNonEmptyString(value.startTime) ? { startTime: value.startTime } : {}),
  };
}

function normalizePendingBatchDelete(value: Record<string, unknown>): PendingBatchDeleteState | null {
  if (!Array.isArray(value.eventIds)) return null;
  const source = value.source === "event_query" ? "event_query" : "date_query";
  const eventIds = uniqueNonEmptyStrings(value.eventIds);
  if (eventIds.length === 0) return null;

  const items = Array.isArray(value.items)
    ? value.items.map(normalizePendingDeleteItem).filter((item): item is PendingDeleteItemState => Boolean(item))
    : [];
  const safeItems = items.filter((item) => eventIds.includes(item.eventId));

  return {
    source,
    title: String(value.title),
    eventIds,
    items: safeItems.length > 0 ? safeItems : eventIds.map((eventId) => ({ eventId, title: eventId })),
    ...(value.requireSelection === true ? { requireSelection: true } : {}),
    ...(isNonEmptyString(value.date) && isValidDate(value.date) ? { date: value.date } : {}),
    ...(isRecord(value.range) && isValidDateRange(value.range)
      ? { range: { startDate: value.range.startDate, endDate: value.range.endDate } }
      : {}),
  };
}

function normalizePendingDeleteItem(value: unknown): PendingDeleteItemState | null {
  if (!isRecord(value) || !isNonEmptyString(value.eventId) || !isNonEmptyString(value.title)) return null;
  return {
    eventId: value.eventId,
    title: value.title,
    ...(isNonEmptyString(value.date) && isValidDate(value.date) ? { date: value.date } : {}),
    ...(isNonEmptyString(value.startTime) ? { startTime: value.startTime } : {}),
  };
}

function normalizeCreateDraft(value: unknown): PendingCreateDraftState | null {
  if (!isRecord(value)) return null;
  const draft: PendingCreateDraftState = {
    ...(isNonEmptyString(value.title) ? { title: value.title } : {}),
    ...(isNonEmptyString(value.date) ? { date: value.date } : {}),
    ...(isNonEmptyString(value.startTime) ? { startTime: value.startTime } : {}),
    ...(isNonEmptyString(value.endTime) ? { endTime: value.endTime } : {}),
    ...(isNonEmptyString(value.location) ? { location: value.location } : {}),
    ...(typeof value.reminderMinutes === "number" ? { reminderMinutes: value.reminderMinutes } : {}),
    ...(isNonEmptyString(value.notes) ? { notes: value.notes } : {}),
  };
  return Object.keys(draft).length > 0 ? draft : null;
}

function normalizePendingConflict(value: unknown): PendingConflictState | null {
  if (!isRecord(value) || !Array.isArray(value.conflicts)) return null;
  const action = normalizePendingConflictAction(value.action);
  if (!action) return null;
  const conflicts = value.conflicts.map(normalizePendingConflictItem).filter((item): item is PendingConflictItemState => Boolean(item));
  if (conflicts.length === 0) return null;

  return { action, conflicts };
}

function normalizePendingSchedule(value: unknown): PendingScheduleState | null {
  if (!isRecord(value) || !isNonEmptyString(value.date) || !isValidDate(value.date) || !Array.isArray(value.options)) return null;
  const options = value.options.map(normalizePendingScheduleOption).filter((option): option is PendingScheduleOptionState => Boolean(option));
  if (options.length === 0) return null;
  return { date: value.date, options };
}

function normalizePendingScheduleOption(value: unknown): PendingScheduleOptionState | null {
  if (!isRecord(value) || !Number.isInteger(value.optionNumber) || Number(value.optionNumber) <= 0 || !Array.isArray(value.items)) return null;
  const items = value.items.map(normalizePendingScheduleItem).filter((item): item is PendingScheduleItemState => Boolean(item));
  if (items.length === 0) return null;
  return { optionNumber: Number(value.optionNumber), items };
}

function normalizePendingScheduleItem(value: unknown): PendingScheduleItemState | null {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.itemNumber) ||
    Number(value.itemNumber) <= 0 ||
    !isNonEmptyString(value.title) ||
    !isNonEmptyString(value.date) ||
    !isValidDate(value.date) ||
    !isNonEmptyString(value.startTime) ||
    !Number.isInteger(value.durationMinutes) ||
    Number(value.durationMinutes) <= 0
  ) {
    return null;
  }

  const confidence = normalizeConfidence(value.confidence);
  const item: PendingScheduleItemState = {
    itemNumber: Number(value.itemNumber),
    title: value.title,
    ...(Array.isArray(value.sourceIds) ? { sourceIds: uniqueNonEmptyStrings(value.sourceIds) } : {}),
    ...(Array.isArray(value.reasonCodes) ? { reasonCodes: uniqueNonEmptyStrings(value.reasonCodes) } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    date: value.date,
    startTime: value.startTime,
    durationMinutes: Number(value.durationMinutes),
    ...(isNonEmptyString(value.endTime) ? { endTime: value.endTime } : {}),
    ...(isNonEmptyString(value.location) ? { location: value.location } : {}),
    ...(typeof value.reminderMinutes === "number" || Array.isArray(value.reminderMinutes)
      ? { reminderMinutes: value.reminderMinutes as number | number[] }
      : {}),
    ...(isNonEmptyString(value.notes) ? { notes: value.notes } : {}),
  };
  return item;
}

function normalizeConfidence(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return undefined;
  return value;
}

function normalizePendingConflictAction(
  value: unknown,
): PendingConflictState["action"] | null {
  if (!isRecord(value)) return null;
  if (value.type === "create_event") {
    const event = normalizeRequiredEventDraft(value.event);
    return event ? { type: "create_event", event } : null;
  }
  if (value.type === "create_events" && Array.isArray(value.events)) {
    const events = value.events.map(normalizeRequiredEventDraft);
    if (events.length === 0 || events.some((event) => !event)) return null;
    return { type: "create_events", events: events as EventDraft[] };
  }
  return null;
}

function normalizeRequiredEventDraft(value: unknown): EventDraft | null {
  if (!isRecord(value) || !isNonEmptyString(value.title) || !isNonEmptyString(value.date) || !isNonEmptyString(value.startTime)) {
    return null;
  }

  return {
    title: value.title,
    date: value.date,
    startTime: value.startTime,
    ...(isNonEmptyString(value.endTime) ? { endTime: value.endTime } : {}),
    ...(isNonEmptyString(value.location) ? { location: value.location } : {}),
    ...(typeof value.reminderMinutes === "number" || isNumberArray(value.reminderMinutes)
      ? { reminderMinutes: value.reminderMinutes }
      : {}),
    ...(isNonEmptyString(value.notes) ? { notes: value.notes } : {}),
  };
}

function normalizePendingConflictItem(value: unknown): PendingConflictItemState | null {
  if (!isRecord(value) || !isNonEmptyString(value.title) || !isNonEmptyString(value.start)) return null;
  return {
    ...(isNonEmptyString(value.existingEventId) ? { existingEventId: value.existingEventId } : {}),
    title: value.title,
    start: value.start,
  };
}

function normalizeSeedItem(value: unknown): SeedLiteItem | null {
  if (!isRecord(value) || !isNonEmptyString(value.seedId) || !isNonEmptyString(value.title)) return null;
  return {
    seedId: value.seedId,
    title: value.title,
    ...(isNonEmptyString(value.targetDate) && isValidDate(value.targetDate) ? { targetDate: value.targetDate } : {}),
    ...(isNonEmptyString(value.reminderAt) ? { reminderAt: value.reminderAt } : {}),
    ...(value.status === "shelved" ? { status: "shelved" as const } : {}),
    ...(Number.isInteger(value.pullbackCount) && Number(value.pullbackCount) >= 0 ? { pullbackCount: Number(value.pullbackCount) } : {}),
    ...(isNonEmptyString(value.lastPullbackAt) && isValidDate(value.lastPullbackAt) ? { lastPullbackAt: value.lastPullbackAt } : {}),
    ...(isNonEmptyString(value.createdAt) ? { createdAt: value.createdAt } : {}),
    ...(isNonEmptyString(value.sourceText) ? { sourceText: value.sourceText } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function uniqueNonEmptyStrings(values: unknown[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (!isNonEmptyString(value)) continue;
    const trimmed = value.trim();
    if (!result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidDateRange(value: Record<string, unknown>): value is { startDate: string; endDate: string } {
  return isNonEmptyString(value.startDate) && isNonEmptyString(value.endDate) && isValidDate(value.startDate) && isValidDate(value.endDate);
}
