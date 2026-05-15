// 确定性日历 API：所有不需要模型判断的日历能力都集中在这里。

import type { EventDraft } from "../contract/index.js";
import type {
  DeleteEventInput,
  DeleteEventResult,
  FeishuCalendarEvent,
  FeishuResult,
  ListEventsInput,
  UpdateEventInput,
} from "../calendar/feishu/types.js";

export type CalendarGuardFailureCode = "guard_rejected" | "confirmation_required";

export type CalendarGuardFailure = {
  ok: false;
  code: CalendarGuardFailureCode;
  message: string;
};

export type DeleteManyEventsInput = {
  eventIds: string[];
  confirmed: boolean;
};

export type DeleteManyEventsResult = {
  deletedEventIds: string[];
};

export type ClearCalendarInput = {
  confirmed: boolean;
};

export type DeterministicCalendarAdapter = {
  createEvent(event: EventDraft): Promise<FeishuResult<FeishuCalendarEvent>>;
  listEvents(input: ListEventsInput): Promise<FeishuResult<FeishuCalendarEvent[]>>;
  updateEvent(input: UpdateEventInput): Promise<FeishuResult<FeishuCalendarEvent>>;
  deleteEvent(input: DeleteEventInput): Promise<FeishuResult<DeleteEventResult>>;
};

export function createEvent(adapter: DeterministicCalendarAdapter, event: EventDraft) {
  return adapter.createEvent(event);
}

export async function listEvents(adapter: DeterministicCalendarAdapter, input: ListEventsInput) {
  const result = await adapter.listEvents(input);
  if (!result.ok) return result;
  return { ...result, data: sortEventsByStart(result.data, input.date) };
}

export function updateEvent(adapter: DeterministicCalendarAdapter, input: UpdateEventInput) {
  if (!input.eventId.trim()) return Promise.resolve(guardRejected("修改日程需要明确的事件 ID。"));
  return adapter.updateEvent(input);
}

export function deleteEvent(adapter: DeterministicCalendarAdapter, input: DeleteEventInput) {
  if (!input.eventId.trim()) return Promise.resolve(guardRejected("删除日程需要明确的事件 ID。"));
  return adapter.deleteEvent(input);
}

export async function deleteManyEvents(
  adapter: DeterministicCalendarAdapter,
  input: DeleteManyEventsInput,
): Promise<FeishuResult<DeleteManyEventsResult> | CalendarGuardFailure> {
  if (!input.confirmed) return { ok: false, code: "confirmation_required", message: "批量删除需要先确认。" };

  const eventIds = [...new Set(input.eventIds.map((eventId) => eventId.trim()).filter(Boolean))];
  if (eventIds.length === 0) return guardRejected("批量删除需要至少一个明确的事件 ID。");

  const deletedEventIds: string[] = [];
  for (const eventId of eventIds) {
    const result = await adapter.deleteEvent({ eventId });
    if (!result.ok) return result;
    deletedEventIds.push(result.data.eventId);
  }

  return { ok: true, data: { deletedEventIds } };
}

export function clearCalendar(
  _adapter: DeterministicCalendarAdapter,
  _input: ClearCalendarInput,
): Promise<CalendarGuardFailure> {
  return Promise.resolve({ ok: false, code: "guard_rejected", message: "全删日历没有开放给助手运行时。" });
}

function guardRejected(message: string): CalendarGuardFailure {
  return { ok: false, code: "guard_rejected", message };
}

// 日历查询统一按开始时间升序返回，避免上游返回顺序影响用户看到的当天安排。
function sortEventsByStart(events: FeishuCalendarEvent[], fallbackDate?: string): FeishuCalendarEvent[] {
  return events
    .map((event, index) => ({ event, index, sortValue: readEventSortValue(event, fallbackDate) }))
    .sort((left, right) => {
      if (left.sortValue !== right.sortValue) return left.sortValue - right.sortValue;
      return left.index - right.index;
    })
    .map((item) => item.event);
}

// 解析 adapter 返回的稳定开始时间；无法解析的事件保留在最后且保持原始相对顺序。
function readEventSortValue(event: FeishuCalendarEvent, fallbackDate?: string): number {
  const fullDateTime = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(event.start);
  if (fullDateTime) return Date.UTC(Number(fullDateTime[1]), Number(fullDateTime[2]) - 1, Number(fullDateTime[3]), Number(fullDateTime[4]), Number(fullDateTime[5]));

  const timeOnly = /^(\d{2}):(\d{2})$/.exec(event.start);
  const stableFallbackDate = fallbackDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(fallbackDate) : undefined;
  if (timeOnly && stableFallbackDate) {
    return Date.UTC(
      Number(stableFallbackDate[1]),
      Number(stableFallbackDate[2]) - 1,
      Number(stableFallbackDate[3]),
      Number(timeOnly[1]),
      Number(timeOnly[2]),
    );
  }

  return Number.MAX_SAFE_INTEGER;
}
