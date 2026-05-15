// 排程推荐模块：只生成短期候选时间，不自动写日历。

import type { CalendarAdapter } from "../calendar/action-executor.js";
import type { FeishuCalendarEvent } from "../calendar/feishu/types.js";
import type { SchedulePreferredWindow } from "../contract/index.js";
import type { EventDraft } from "../contract/index.js";
import type { MemoryDreamEntry } from "../memory-dream/index.js";
import type { PendingScheduleItemState, PendingScheduleState } from "../state/index.js";

export type ScheduleProposalItemInput = {
  title: string;
  sourceIds?: string[];
  date?: string;
  durationMinutes?: number;
  location?: string;
  reminderMinutes?: number | number[];
  notes?: string;
};

export type ScheduleProposalInput = {
  calendar: CalendarAdapter;
  date: string;
  items: ScheduleProposalItemInput[];
  optionCount?: number;
  preferences?: SchedulePreferences;
};

export type ScheduleConfirmationInput = {
  pendingSchedule: PendingScheduleState | undefined;
  confirmed: boolean;
  optionNumber?: number;
  itemChanges?: ScheduleConfirmationItemChange[];
};

export type ScheduleConfirmationItemChange = {
  itemNumber?: number;
  date?: string;
  startTime?: string;
  title?: string;
  location?: string;
  reminderMinutes?: number | number[];
  notes?: string;
};

export type ScheduleConfirmationResult =
  | { ok: true; action: { type: "create_event"; event: EventDraft } | { type: "create_events"; events: EventDraft[] }; completedSourceIds?: string[] }
  | { ok: true; canceled: true }
  | { ok: false; message: string };

export type SelectScheduleItemsFromMemoryDreamOptions = {
  limit?: number;
};

export type SchedulePreferences = {
  preferredStartTimes?: string[];
  preferredWindows?: SchedulePreferredWindow[];
};

const WORKDAY_START_MINUTE = 9 * 60;
const WORKDAY_END_MINUTE = 18 * 60;
const SLOT_STEP_MINUTES = 30;
const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_OPTION_COUNT = 3;

// 基于当天已有日程生成可选择的推荐位；不执行任何写入。
export async function proposeSchedule(input: ScheduleProposalInput): Promise<{ ok: true; pendingSchedule: PendingScheduleState } | { ok: false; message: string }> {
  if (!isValidDate(input.date)) return { ok: false, message: "排程需要明确日期。" };
  const items = input.items.map(normalizeProposalItem).filter((item): item is RequiredScheduleProposalItem => Boolean(item));
  if (items.length === 0) return { ok: false, message: "排程需要至少一个事项。" };
  if (items.length > 5) return { ok: false, message: "一次最多安排 5 个事项。" };

  const listed = await input.calendar.listEvents({ date: input.date });
  if (!listed.ok) return { ok: false, message: listed.message };

  const busy = listed.data.map(readBusyBlock).filter((block): block is TimeBlock => Boolean(block));
  const options: PendingScheduleState["options"] = [];
  const seen = new Set<string>();
  const optionCount = input.optionCount || DEFAULT_OPTION_COUNT;

  for (const offset of buildStartOffsets(input.preferences)) {
    if (options.length >= optionCount) break;
    const optionItems = buildOptionItems({
      date: input.date,
      items,
      busy,
      startOffset: offset,
    });
    if (!optionItems) continue;

    const key = optionItems.map((item) => `${item.itemNumber}:${item.date}:${item.startTime}`).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ optionNumber: options.length + 1, items: optionItems });
  }

  if (options.length === 0) return { ok: false, message: "没有找到合适的空档。" };
  return { ok: true, pendingSchedule: { date: input.date, options } };
}

// 把用户对推荐位的选择或修改转换成现有创建动作。
export function confirmSchedule(input: ScheduleConfirmationInput): ScheduleConfirmationResult {
  if (!input.pendingSchedule) return { ok: false, message: "没有待确认的排程推荐。" };
  if (!input.confirmed) return { ok: true, canceled: true };

  const optionNumber = input.optionNumber || 1;
  const option = input.pendingSchedule.options.find((candidate) => candidate.optionNumber === optionNumber);
  if (!option) return { ok: false, message: `没有找到第 ${optionNumber} 个推荐位。` };

  const changes = normalizeItemChanges(input.itemChanges || [], option.items.length);
  if (!changes.ok) return changes;

  const events: EventDraft[] = [];
  const completedSourceIds: string[] = [];
  for (const item of option.items) {
    const change = changes.byItemNumber.get(item.itemNumber);
    const draft = applyScheduleChange(item, change);
    if (!draft.ok) return draft;
    events.push(draft.event);
    completedSourceIds.push(...(item.sourceIds || []));
  }

  const sourceIds = uniqueStrings(completedSourceIds);
  const completed = sourceIds.length > 0 ? { completedSourceIds: sourceIds } : {};
  if (events.length === 1) return { ok: true, action: { type: "create_event", event: events[0] }, ...completed };
  return { ok: true, action: { type: "create_events", events }, ...completed };
}

export function formatScheduleProposalReply(pendingSchedule: PendingScheduleState): string {
  const options = pendingSchedule.options.map((option) => {
    const lines = option.items.map((item) => `${item.itemNumber}. ${item.date} ${item.startTime} ${item.title}`);
    return `推荐 ${option.optionNumber}：因为这段时间没有冲突。\n${lines.join("\n")}`;
  });
  return `我找到这些可选时间（共 ${pendingSchedule.options.length} 个候选，确认前不会写入日历）：\n${options.join("\n")}\n可以回复“选第几个”，也可以说“第一个改到 11 点”。`;
}

// 从做梦候选中挑出可交给排程推荐的事项；只读转换，不查日历、不写日历。
export function selectScheduleItemsFromMemoryDream(
  entries: MemoryDreamEntry[],
  options: SelectScheduleItemsFromMemoryDreamOptions = {},
): ScheduleProposalItemInput[] {
  const limit = options.limit || 5;
  return entries
    .filter((entry) => entry.kind === "schedule_candidate")
    .filter((entry) => entry.status === "candidate" || entry.status === "stable")
    .map((entry) => ({ entry, title: readScheduleCandidateTitle(entry.summary) }))
    .filter((item): item is { entry: MemoryDreamEntry; title: string } => Boolean(item.title))
    .sort((a, b) => b.entry.confidence - a.entry.confidence || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map((item) => ({ title: item.title, sourceIds: item.entry.sourceIds }));
}

// 从个人习惯记忆中提取排程偏好；只影响推荐顺序，不创建日程。
export function selectSchedulePreferencesFromMemoryDream(entries: MemoryDreamEntry[]): SchedulePreferences {
  const preferredStartTimes = entries
    .filter((entry) => entry.kind === "preference_candidate")
    .filter((entry) => entry.status === "candidate" || entry.status === "stable")
    .map((entry) => readPreferredStartTime(entry.summary))
    .filter((time): time is string => Boolean(time))
    .filter(isWorkdayTime);

  return { preferredStartTimes: [...new Set(preferredStartTimes)] };
}

type RequiredScheduleProposalItem = ScheduleProposalItemInput & {
  title: string;
  durationMinutes: number;
};

type TimeBlock = {
  startMinute: number;
  endMinute: number;
};

function normalizeProposalItem(value: ScheduleProposalItemInput): RequiredScheduleProposalItem | null {
  if (!value.title?.trim()) return null;
  const durationMinutes = normalizeDuration(value.durationMinutes);
  return {
    ...value,
    title: value.title.trim(),
    durationMinutes,
  };
}

function readScheduleCandidateTitle(summary: string): string | null {
  const prefix = "排程候选：";
  if (!summary.startsWith(prefix)) return null;
  const title = summary.slice(prefix.length).trim();
  return title.length > 0 ? title : null;
}

function readPreferredStartTime(summary: string): string | null {
  const match = /(?:排程偏好：优先安排在|偏好候选：排程优先)\s*(\d{2}):(\d{2})/.exec(summary);
  if (!match) return null;
  const time = `${match[1]}:${match[2]}`;
  return isValidTime(time) ? time : null;
}

function buildStartOffsets(preferences: SchedulePreferences | undefined): number[] {
  const windowOffsets = (preferences?.preferredWindows || [])
    .flatMap(preferredWindowToTimes)
    .filter(isWorkdayTime)
    .map((time) => Math.floor((timeToMinutes(time) - WORKDAY_START_MINUTE) / SLOT_STEP_MINUTES));
  const preferredOffsets = (preferences?.preferredStartTimes || [])
    .filter(isWorkdayTime)
    .map((time) => Math.floor((timeToMinutes(time) - WORKDAY_START_MINUTE) / SLOT_STEP_MINUTES));
  const allOffsets = Array.from({ length: 32 }, (_, index) => index);
  return [...new Set([...preferredOffsets, ...windowOffsets, ...allOffsets])];
}

function preferredWindowToTimes(window: SchedulePreferredWindow): string[] {
  if (window === "morning") return ["09:00", "09:30", "10:00", "10:30", "11:00"];
  if (window === "afternoon") return ["14:00", "14:30", "15:00", "15:30", "16:00"];
  if (window === "evening") return ["17:00"];
  if (window === "later") return ["15:00", "15:30", "16:00", "16:30", "17:00"];
  return [];
}

function buildOptionItems(input: {
  date: string;
  items: RequiredScheduleProposalItem[];
  busy: TimeBlock[];
  startOffset: number;
}): PendingScheduleItemState[] | null {
  const scheduled: TimeBlock[] = [];
  const optionItems: PendingScheduleItemState[] = [];
  let searchOffset = input.startOffset;

  for (const [index, item] of input.items.entries()) {
    const slot = findAvailableSlot({
      busy: [...input.busy, ...scheduled],
      durationMinutes: item.durationMinutes,
      startOffset: searchOffset,
    });
    if (!slot) return null;

    scheduled.push(slot);
    searchOffset = Math.floor((slot.endMinute - WORKDAY_START_MINUTE) / SLOT_STEP_MINUTES);
    optionItems.push({
      itemNumber: index + 1,
      title: item.title,
      ...(item.sourceIds && item.sourceIds.length > 0 ? { sourceIds: item.sourceIds } : {}),
      date: item.date || input.date,
      startTime: minutesToTime(slot.startMinute),
      endTime: minutesToTime(slot.endMinute),
      durationMinutes: item.durationMinutes,
      ...(item.location ? { location: item.location } : {}),
      ...(item.reminderMinutes !== undefined ? { reminderMinutes: item.reminderMinutes } : {}),
      ...(item.notes ? { notes: item.notes } : {}),
    });
  }

  return optionItems;
}

function uniqueStrings(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

function findAvailableSlot(input: {
  busy: TimeBlock[];
  durationMinutes: number;
  startOffset: number;
}): TimeBlock | null {
  const maxStart = WORKDAY_END_MINUTE - input.durationMinutes;
  for (let start = WORKDAY_START_MINUTE + input.startOffset * SLOT_STEP_MINUTES; start <= maxStart; start += SLOT_STEP_MINUTES) {
    const candidate = { startMinute: start, endMinute: start + input.durationMinutes };
    if (!input.busy.some((block) => overlaps(candidate, block))) return candidate;
  }
  return null;
}

function normalizeItemChanges(
  itemChanges: ScheduleConfirmationItemChange[],
  itemCount: number,
): { ok: true; byItemNumber: Map<number, ScheduleConfirmationItemChange> } | { ok: false; message: string } {
  const byItemNumber = new Map<number, ScheduleConfirmationItemChange>();
  for (const change of itemChanges) {
    const itemNumber = change.itemNumber || (itemCount === 1 ? 1 : undefined);
    if (!itemNumber) return { ok: false, message: "多事项排程修改需要说明第几个事项。" };
    if (!Number.isInteger(itemNumber) || itemNumber <= 0 || itemNumber > itemCount) {
      return { ok: false, message: `没有找到第 ${itemNumber} 个事项。` };
    }
    byItemNumber.set(itemNumber, { ...byItemNumber.get(itemNumber), ...change, itemNumber });
  }
  return { ok: true, byItemNumber };
}

function applyScheduleChange(
  item: PendingScheduleItemState,
  change: ScheduleConfirmationItemChange | undefined,
): { ok: true; event: EventDraft } | { ok: false; message: string } {
  const date = change?.date || item.date;
  const startTime = change?.startTime || item.startTime;
  if (!isValidDate(date)) return { ok: false, message: "排程日期不合法。" };
  if (!isValidTime(startTime)) return { ok: false, message: "排程时间不合法。" };

  const endTime = change?.startTime ? addMinutesToTime(startTime, item.durationMinutes) : item.endTime;
  if (!endTime) return { ok: false, message: "排程结束时间不合法。" };

  return {
    ok: true,
    event: {
      title: change?.title?.trim() || item.title,
      date,
      startTime,
      endTime,
      ...(change?.location || item.location ? { location: change?.location || item.location } : {}),
      ...(change?.reminderMinutes !== undefined || item.reminderMinutes !== undefined
        ? { reminderMinutes: change?.reminderMinutes !== undefined ? change.reminderMinutes : item.reminderMinutes }
        : {}),
      ...(change?.notes || item.notes ? { notes: change?.notes || item.notes } : {}),
    },
  };
}

function readBusyBlock(event: FeishuCalendarEvent): TimeBlock | null {
  const startMinute = readEventMinute(event.start);
  if (startMinute === null) return null;
  const endMinute = event.end ? readEventMinute(event.end) : null;
  return {
    startMinute,
    endMinute: endMinute && endMinute > startMinute ? endMinute : startMinute + DEFAULT_DURATION_MINUTES,
  };
}

function readEventMinute(value: string | undefined): number | null {
  const match = /(?:\d{4}-\d{2}-\d{2} )?(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute >= 0 && minute < 24 * 60 ? minute : null;
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function normalizeDuration(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 15 || value > 240) return DEFAULT_DURATION_MINUTES;
  return value;
}

function overlaps(left: TimeBlock, right: TimeBlock): boolean {
  return left.startMinute < right.endMinute && right.startMinute < left.endMinute;
}

function minutesToTime(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addMinutesToTime(time: string, minutes: number): string | null {
  const base = readEventMinute(time);
  if (base === null) return null;
  const next = base + minutes;
  if (next >= 24 * 60) return null;
  return minutesToTime(next);
}

function isValidDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidTime(value: string | undefined): value is string {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function isWorkdayTime(value: string): boolean {
  if (!isValidTime(value)) return false;
  const minute = timeToMinutes(value);
  return minute >= WORKDAY_START_MINUTE && minute < WORKDAY_END_MINUTE && (minute - WORKDAY_START_MINUTE) % SLOT_STEP_MINUTES === 0;
}
