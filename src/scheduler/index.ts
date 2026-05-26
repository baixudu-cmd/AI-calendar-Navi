// 排程推荐模块：只生成短期候选时间，不自动写日历。

import type { CalendarAdapter } from "../calendar/action-executor.js";
import type { FeishuCalendarEvent } from "../calendar/feishu/types.js";
import type { SchedulePreferredWindow } from "../contract/index.js";
import type { EventDraft } from "../contract/index.js";
import type { MemoryDreamEntry, MemoryDreamEntryMetadata } from "../memory-dream/index.js";
import type { PendingScheduleItemState, PendingScheduleState } from "../state/index.js";

export type ScheduleProposalItemInput = {
  title: string;
  sourceIds?: string[];
  reasonCodes?: string[];
  confidence?: number;
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
  preferredReminderMinutes?: number[];
};

const WORKDAY_START_MINUTE = 9 * 60;
const WORKDAY_END_MINUTE = 18 * 60;
const SLOT_STEP_MINUTES = 30;
const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_OPTION_COUNT = 3;

// 基于当天已有日程生成可选择的推荐位；不执行任何写入。
export async function proposeSchedule(input: ScheduleProposalInput): Promise<{ ok: true; pendingSchedule: PendingScheduleState } | { ok: false; message: string }> {
  if (!isValidDate(input.date)) return { ok: false, message: "排程需要明确日期。" };
  const items = input.items.map((item) => normalizeProposalItem(item, input.preferences)).filter((item): item is RequiredScheduleProposalItem => Boolean(item));
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
    if (option.items.length === 1) {
      const item = option.items[0];
      return `${option.optionNumber}. ${item.date} ${item.startTime} ${item.title}\n   原因：${formatScheduleReason(item.reasonCodes)}${formatScheduleConfidenceLine([item])}`;
    }
    const lines = option.items.map((item) => `   - 事项 ${item.itemNumber}：${item.date} ${item.startTime} ${item.title}`);
    return `${option.optionNumber}. 推荐方案\n   原因：${formatScheduleReason(option.items.flatMap((item) => item.reasonCodes || []))}${formatScheduleConfidenceLine(option.items)}\n${lines.join("\n")}`;
  });
  return `我找到这些可选时间（共 ${pendingSchedule.options.length} 个候选，确认前不会写入日历）：\n${options.join("\n")}\n${formatScheduleSelectionHint(pendingSchedule.options.length)}`;
}

function formatScheduleConfidenceLine(items: PendingScheduleItemState[]): string {
  const confidences = items.map((item) => item.confidence).filter((item): item is number => typeof item === "number");
  if (confidences.length === 0) return "";
  const confidence = Math.min(...confidences);
  if (confidence >= 0.75) return "\n   把握：较高，可以直接选合适的候选";
  if (confidence >= 0.5) return "\n   把握：中等，可以从候选里选一个";
  return "\n   把握：偏低，我先给候选，确认前不会写入日历";
}

function formatScheduleReason(reasonCodes: string[] | undefined): string {
  const reasons = uniqueStrings((reasonCodes || []).map(formatReasonCode).filter((item): item is string => Boolean(item)));
  if (reasons.length === 0) return "这段时间没有冲突";
  return `来自${joinChineseList(reasons)}，且这段时间没有冲突`;
}

function formatReasonCode(code: string): string | undefined {
  if (code === "seed_target_date") return "待推进目标日期";
  if (code === "seed_reminder_date") return "待推进提醒日期";
  if (code === "seed_reminder_time") return "提醒时间";
  if (code === "schedule_feedback_changed_time") return "你之前调整过的时间";
  if (code === "schedule_feedback_selected_option") return "你之前选择过的推荐位";
  return undefined;
}

function joinChineseList(items: string[]): string {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]}和${items[1]}`;
  return `${items.slice(0, -1).join("、")}和${items.at(-1)}`;
}

function formatScheduleSelectionHint(optionCount: number): string {
  if (optionCount <= 1) return "回复“选 1”确认。";
  const options = Array.from({ length: optionCount }, (_, index) => index + 1).join("/");
  return `回复“选 ${options}”确认。`;
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
    .map((item) => {
      const metadata = readScheduleMetadata(item.entry.metadata);
      return {
        title: item.title,
        sourceIds: item.entry.sourceIds,
        confidence: item.entry.confidence,
        ...(metadata.reasonCodes && metadata.reasonCodes.length > 0 ? { reasonCodes: metadata.reasonCodes } : {}),
        ...(metadata.targetDate ? { date: metadata.targetDate } : {}),
        ...(metadata.durationMinutes ? { durationMinutes: metadata.durationMinutes } : {}),
        ...(metadata.preferredReminderMinutes && metadata.preferredReminderMinutes.length > 0
          ? { reminderMinutes: metadata.preferredReminderMinutes.length === 1 ? metadata.preferredReminderMinutes[0] : metadata.preferredReminderMinutes }
          : {}),
      };
    });
}

// 从个人习惯记忆中提取排程偏好；只影响推荐顺序，不创建日程。
export function selectSchedulePreferencesFromMemoryDream(entries: MemoryDreamEntry[]): SchedulePreferences {
  const activeEntries = entries
    .filter((entry) => entry.status === "candidate" || entry.status === "stable");
  const structuredStartTimes = activeEntries
    .flatMap((entry) => {
      const metadata = readScheduleMetadata(entry.metadata);
      return [metadata.preferredStartTime, ...(metadata.preferredStartTimes || [])];
    })
    .filter((time): time is string => Boolean(time))
    .filter(isWorkdayTime);
  const legacyStartTimes = activeEntries
    .filter((entry) => entry.kind === "preference_candidate")
    .map((entry) => readPreferredStartTime(entry.summary))
    .filter((time): time is string => Boolean(time))
    .filter(isWorkdayTime);
  const preferredWindows = activeEntries
    .flatMap((entry) => readScheduleMetadata(entry.metadata).preferredWindows || [])
    .filter((window, index, values) => values.indexOf(window) === index);
  const preferredReminderMinutes = normalizeReminderPreference(activeEntries.flatMap((entry) => readScheduleMetadata(entry.metadata).preferredReminderMinutes || []));

  return {
    preferredStartTimes: [...new Set([...structuredStartTimes, ...legacyStartTimes])],
    ...(preferredWindows.length > 0 ? { preferredWindows } : {}),
    ...(preferredReminderMinutes.length > 0 ? { preferredReminderMinutes } : {}),
  };
}

type RequiredScheduleProposalItem = ScheduleProposalItemInput & {
  title: string;
  durationMinutes: number;
};

type TimeBlock = {
  startMinute: number;
  endMinute: number;
};

function normalizeProposalItem(value: ScheduleProposalItemInput, preferences?: SchedulePreferences): RequiredScheduleProposalItem | null {
  if (!value.title?.trim()) return null;
  const durationMinutes = normalizeDuration(value.durationMinutes);
  const confidence = normalizeConfidence(value.confidence);
  const preferredReminderMinutes = normalizeReminderPreference(preferences?.preferredReminderMinutes || []);
  const reminderMinutes = value.reminderMinutes !== undefined
    ? value.reminderMinutes
    : preferredReminderMinutes.length === 1
      ? preferredReminderMinutes[0]
      : preferredReminderMinutes.length > 1
        ? preferredReminderMinutes
        : undefined;
  return {
    ...value,
    title: value.title.trim(),
    ...(value.reasonCodes && value.reasonCodes.length > 0 ? { reasonCodes: uniqueStrings(value.reasonCodes) } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(reminderMinutes !== undefined ? { reminderMinutes } : {}),
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

function readScheduleMetadata(value: MemoryDreamEntryMetadata | undefined): MemoryDreamEntryMetadata {
  if (!value) return {};
  const preferredStartTimes = [
    ...(isValidTime(value.preferredStartTime) ? [value.preferredStartTime] : []),
    ...((value.preferredStartTimes || []).filter(isValidTime)),
  ].filter(isWorkdayTime);
  const preferredWindows = (value.preferredWindows || []).filter(isPreferredWindow);
  const preferredReminderMinutes = normalizeReminderPreference(value.preferredReminderMinutes || []);
  return {
    ...(isValidDate(value.targetDate) ? { targetDate: value.targetDate } : {}),
    ...(preferredStartTimes[0] ? { preferredStartTime: preferredStartTimes[0], preferredStartTimes: [...new Set(preferredStartTimes)] } : {}),
    ...(preferredWindows.length > 0 ? { preferredWindows: [...new Set(preferredWindows)] } : {}),
    ...(preferredReminderMinutes.length > 0 ? { preferredReminderMinutes } : {}),
    ...(Array.isArray(value.reasonCodes) ? { reasonCodes: uniqueStrings(value.reasonCodes.filter((item): item is string => typeof item === "string")) } : {}),
    ...(typeof value.durationMinutes === "number" && Number.isInteger(value.durationMinutes) && value.durationMinutes >= 15 && value.durationMinutes <= 240
      ? { durationMinutes: value.durationMinutes }
      : {}),
  };
}

function isPreferredWindow(value: unknown): value is SchedulePreferredWindow {
  return value === "morning" || value === "afternoon" || value === "evening" || value === "later";
}

function isReminderMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1440;
}

function normalizeReminderPreference(values: number[]): number[] {
  const positives = [...new Set(values.filter((value) => isReminderMinutes(value) && value > 0))].sort((a, b) => b - a).slice(0, 3);
  if (positives.length > 0) return positives;
  return values.some((value) => value === 0) ? [0] : [];
}

function buildStartOffsets(preferences: SchedulePreferences | undefined): number[] {
  const preferredWindows = preferences?.preferredWindows || [];
  const allowedStartTimes = preferredWindows.length > 0 ? new Set(preferredWindows.flatMap(preferredWindowToTimes).filter(isWorkdayTime)) : null;
  const windowOffsets = (preferences?.preferredWindows || [])
    .flatMap(preferredWindowToTimes)
    .filter(isWorkdayTime)
    .map((time) => Math.floor((timeToMinutes(time) - WORKDAY_START_MINUTE) / SLOT_STEP_MINUTES));
  const preferredOffsets = (preferences?.preferredStartTimes || [])
    .filter(isWorkdayTime)
    .filter((time) => !allowedStartTimes || allowedStartTimes.has(time))
    .map((time) => Math.floor((timeToMinutes(time) - WORKDAY_START_MINUTE) / SLOT_STEP_MINUTES));
  const allOffsets = Array.from({ length: 32 }, (_, index) => index).filter((offset) => {
    if (!allowedStartTimes) return true;
    return allowedStartTimes.has(minutesToTime(WORKDAY_START_MINUTE + offset * SLOT_STEP_MINUTES));
  });
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
      ...(item.reasonCodes && item.reasonCodes.length > 0 ? { reasonCodes: item.reasonCodes } : {}),
      ...(item.confidence !== undefined ? { confidence: item.confidence } : {}),
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

function normalizeConfidence(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return undefined;
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
