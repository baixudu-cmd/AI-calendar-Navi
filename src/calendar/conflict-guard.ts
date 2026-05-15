// P7 写入冲突保护：只基于日历事实判断创建是否会撞时间。

import type { CalendarAdapter } from "./action-executor.js";
import type { FeishuCalendarEvent, FeishuResult } from "./feishu/types.js";
import type { CalendarAction } from "../contract/index.js";
import type { PendingConflictItemState } from "../state/index.js";

export type CreateConflictCheckResult =
  | { ok: true; conflicts: PendingConflictItemState[] }
  | { ok: false; message: string };

// 检查创建动作是否和已有日程时间冲突；非创建动作直接放行。
export async function detectCreateConflicts(action: CalendarAction, calendar: CalendarAdapter): Promise<CreateConflictCheckResult> {
  const eventsToCreate = getCreateEvents(action);
  if (eventsToCreate.length === 0) return { ok: true, conflicts: [] };

  const eventsByDate = new Map<string, FeishuCalendarEvent[]>();
  for (const date of [...new Set(eventsToCreate.map((event) => event.date))]) {
    const listed = await calendar.listEvents({ date });
    if (!listed.ok) return { ok: false, message: listed.message };
    eventsByDate.set(date, listed.data);
  }

  const conflicts: PendingConflictItemState[] = [];
  for (const draft of eventsToCreate) {
    for (const existing of eventsByDate.get(draft.date) || []) {
      if (eventsOverlap({ start: `${draft.date} ${draft.startTime}`, end: draft.endTime ? `${draft.date} ${draft.endTime}` : undefined }, existing)) {
        conflicts.push({ existingEventId: existing.id, title: existing.title, start: existing.start });
      }
    }
  }

  return { ok: true, conflicts: dedupeConflicts(conflicts) };
}

function getCreateEvents(action: CalendarAction) {
  if (action.type === "create_event") return [action.event];
  if (action.type === "create_events") return action.events;
  return [];
}

function eventsOverlap(draft: { start: string; end?: string }, existing: FeishuCalendarEvent): boolean {
  const draftStart = parseDateMinute(draft.start);
  const existingStart = parseDateMinute(existing.start);
  if (draftStart === null || existingStart === null) return false;
  const draftEnd = draft.end ? parseDateMinute(draft.end) : null;
  const existingEnd = existing.end ? parseDateMinute(existing.end) : null;

  if (draftEnd === null && existingEnd === null) return draftStart === existingStart;
  const normalizedDraftEnd = draftEnd ?? draftStart + 1;
  const normalizedExistingEnd = existingEnd ?? existingStart + 1;
  return draftStart < normalizedExistingEnd && existingStart < normalizedDraftEnd;
}

function parseDateMinute(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)) / 60000;
}

function dedupeConflicts(conflicts: PendingConflictItemState[]): PendingConflictItemState[] {
  const seen = new Set<string>();
  const result: PendingConflictItemState[] = [];
  for (const conflict of conflicts) {
    const key = `${conflict.existingEventId || ""}:${conflict.title}:${conflict.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(conflict);
  }
  return result;
}
