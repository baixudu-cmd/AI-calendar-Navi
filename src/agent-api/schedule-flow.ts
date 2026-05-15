// 排程流程：把推荐和确认从主入口拆出，保持只读候选、用户确认后才创建。

import type { CalendarAdapter } from "../calendar/action-executor.js";
import type { CalendarAction, ScheduleItemDraft, SchedulePreferredWindow } from "../contract/index.js";
import type { MemoryDreamStore } from "../memory-dream/index.js";
import {
  confirmSchedule,
  formatScheduleProposalReply,
  proposeSchedule,
  selectScheduleItemsFromMemoryDream,
  selectSchedulePreferencesFromMemoryDream,
  type ScheduleProposalItemInput,
  type SchedulePreferences,
} from "../scheduler/index.js";
import type { PendingScheduleState, ShortTermStateStore } from "../state/index.js";

export type ScheduleProposalFlowResult = {
  ok: boolean;
  reply: string;
  actionType: string;
};

export async function executeScheduleProposal(input: {
  action: Extract<CalendarAction, { type: "propose_schedule" }>;
  calendar: CalendarAdapter;
  state: ShortTermStateStore;
  memoryDreamStore?: MemoryDreamStore;
  fallbackItems?: ScheduleProposalItemInput[];
  defaultDate?: string;
  defaultStartTime?: string;
}): Promise<ScheduleProposalFlowResult> {
  const memoryDream = await loadScheduleMemory(input.memoryDreamStore);
  const pendingSchedule = input.state.snapshot().pending_schedule;
  const candidateItems = memoryDream.items || [];
  const fallbackItems = input.fallbackItems || [];
  const explicitItems = normalizeExecutableScheduleItems(input.action.items);
  if (!explicitItems.ok) return { ok: false, reply: `没有成功：${explicitItems.message}`, actionType: "propose_schedule" };
  const pendingItems = input.action.contextRef === "pending_schedule" ? scheduleItemsFromPendingSchedule(pendingSchedule) : [];
  const items = explicitItems.items.length > 0 ? explicitItems.items : pendingItems.length > 0 ? pendingItems : candidateItems.length > 0 ? candidateItems : fallbackItems;
  if (items.length === 0) return { ok: false, reply: "没有成功：没有可安排的待办候选。", actionType: "propose_schedule" };
  const date = input.action.date || pendingSchedule?.date || input.defaultDate;
  if (!date) return { ok: false, reply: "没有成功：排程需要明确日期。", actionType: "propose_schedule" };
  const proposal = await proposeSchedule({
    calendar: input.calendar,
    date,
    items,
    optionCount: input.action.optionCount,
    preferences: mergeSchedulePreferences({
      preferences: memoryDream.preferences,
      preferredStartTime: input.action.preferredStartTime,
      preferredWindow: input.action.preferredWindow,
      defaultStartTime: input.defaultStartTime,
      pendingSchedule,
    }),
  });
  if (!proposal.ok) return { ok: false, reply: `没有成功：${proposal.message}`, actionType: "propose_schedule" };

  input.state.update({ pending_schedule: proposal.pendingSchedule });
  return { ok: true, reply: formatScheduleProposalReply(proposal.pendingSchedule), actionType: "propose_schedule" };
}

function scheduleItemsFromPendingSchedule(pendingSchedule: PendingScheduleState | undefined): ScheduleProposalItemInput[] {
  const firstOption = pendingSchedule?.options[0];
  if (!firstOption) return [];
  return firstOption.items.map((item) => ({
    title: item.title,
    ...(item.sourceIds && item.sourceIds.length > 0 ? { sourceIds: item.sourceIds } : {}),
    ...(item.durationMinutes ? { durationMinutes: item.durationMinutes } : {}),
    ...(item.location ? { location: item.location } : {}),
    ...(item.reminderMinutes !== undefined ? { reminderMinutes: item.reminderMinutes } : {}),
    ...(item.notes ? { notes: item.notes } : {}),
  }));
}

function normalizeExecutableScheduleItems(items: ScheduleItemDraft[]): { ok: true; items: ScheduleProposalItemInput[] } | { ok: false; message: string } {
  const executableItems: ScheduleProposalItemInput[] = [];
  for (const item of items) {
    if (!item.title?.trim()) {
      return { ok: false, message: "排程事项需要先解析成明确标题。" };
    }
    executableItems.push({
      title: item.title.trim(),
      ...(item.sourceIds ? { sourceIds: item.sourceIds } : {}),
      ...(item.durationMinutes ? { durationMinutes: item.durationMinutes } : {}),
      ...(item.location ? { location: item.location } : {}),
      ...(item.reminderMinutes !== undefined ? { reminderMinutes: item.reminderMinutes } : {}),
      ...(item.notes ? { notes: item.notes } : {}),
    });
  }
  return { ok: true, items: executableItems };
}

export function resolveScheduleConfirmation(input: {
  action: Extract<CalendarAction, { type: "confirm_schedule" }>;
  state: ShortTermStateStore;
}) {
  const confirmation = confirmSchedule({
    pendingSchedule: input.state.snapshot().pending_schedule,
    confirmed: input.action.confirmed,
    optionNumber: input.action.optionNumber,
    itemChanges: input.action.itemChanges,
  });
  input.state.clearPendingSchedule();
  return confirmation;
}

function mergeSchedulePreferences(input: {
  preferences: SchedulePreferences | undefined;
  preferredStartTime: string | undefined;
  preferredWindow: SchedulePreferredWindow | undefined;
  defaultStartTime: string | undefined;
  pendingSchedule: PendingScheduleState | undefined;
}): SchedulePreferences {
  const preferredWindows = input.preferredWindow ? [input.preferredWindow] : [];
  const defaultStartTime = input.preferredWindow ? undefined : input.defaultStartTime;
  return {
    preferredStartTimes: [input.preferredStartTime, defaultStartTime, ...(input.preferences?.preferredStartTimes || [])].filter((time): time is string => Boolean(time)),
    preferredWindows: [...preferredWindows, ...(input.preferences?.preferredWindows || [])],
  };
}

async function loadScheduleMemory(memoryDreamStore: MemoryDreamStore | undefined) {
  if (!memoryDreamStore) return { items: [], preferences: undefined };
  try {
    const entries = (await memoryDreamStore.load()).entries;
    return {
      items: selectScheduleItemsFromMemoryDream(entries),
      preferences: selectSchedulePreferencesFromMemoryDream(entries),
    };
  } catch {
    return { items: [], preferences: undefined };
  }
}
