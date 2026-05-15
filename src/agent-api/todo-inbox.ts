// 待推进收件箱执行模块：集中处理 Seed Lite、待推进目标解析和排程 target 展开。

import type { CalendarAction, ScheduleItemDraft, TodoPatch, TodoTarget } from "../contract/index.js";
import type { ScheduleProposalItemInput } from "../scheduler/index.js";
import { createSeedLiteItem, type SeedLiteItem, type SeedLiteStore } from "../seed-lite/index.js";
import type { ShortTermStateStore } from "../state/index.js";

export type ScheduleTodoTargetResolution =
  | { ok: true; action: Extract<CalendarAction, { type: "propose_schedule" }>; defaultDate?: string; defaultStartTime?: string }
  | { ok: false; message: string; items: SeedLiteItem[] };

// 执行待推进收件箱管理动作；只读写 Seed Lite，不写日历。
export async function executeTodoInboxAction(
  action: Extract<CalendarAction, { type: "manage_todos" }>,
  seedStore: SeedLiteStore | undefined,
  state: ShortTermStateStore,
): Promise<{ ok: boolean; reply: string }> {
  const items = await readCurrentSeedLiteItems(seedStore, state);
  if (action.operation === "list") {
    const limit = action.limit && action.limit > 0 ? Math.min(action.limit, 20) : undefined;
    return { ok: true, reply: formatTodoInboxReply(limit ? items.slice(0, limit) : items) };
  }

  const resolved = resolveTodoTargets(items, action.target);
  if (!resolved.ok) return { ok: false, reply: formatTodoInboxFailureReply(resolved.message, items) };
  const seedIds = resolved.items.map((item) => item.seedId);

  if (action.operation === "update") {
    const nextItems = await updateSeedLiteItems(seedStore, state, seedIds, action.patch);
    const updated = resolved.items.map((item) => nextItems.find((candidate) => candidate.seedId === item.seedId) || { ...item, ...action.patch });
    if (action.patch.clearReminder && !action.patch.title && !action.patch.targetDate && !action.patch.reminderAt) {
      return { ok: true, reply: `已关闭提醒：${updated.map((item) => item.title).join("、")}` };
    }
    return { ok: true, reply: `已更新待推进：${updated.map(formatTodoInboxItem).join("、")}` };
  }

  await removeSeedLiteItems(seedStore, state, seedIds);
  const verb = action.operation === "complete" ? "已完成待推进" : "已取消待推进";
  return { ok: true, reply: `${verb}：${resolved.items.map((item) => item.title).join("、")}` };
}

// 把一条自然待办写入 Seed Lite，并同步短期状态。
export async function captureSeedLite(input: {
  title: string;
  sourceText: string;
  createdAt: string | undefined;
  state: ShortTermStateStore;
  seedStore: SeedLiteStore | undefined;
}) {
  if (input.seedStore) {
    const item = await input.seedStore.add({
      title: input.title,
      createdAt: input.createdAt,
      sourceText: input.sourceText,
    });
    input.state.update({ pending_clarification: undefined, seed_items: await input.seedStore.list() });
    return item;
  }

  const current = input.state.snapshot().seed_items || [];
  const existing = current.find((item) => item.title === input.title.trim());
  const item =
    existing ||
    createSeedLiteItem(
      { title: input.title, createdAt: input.createdAt, sourceText: input.sourceText },
      current.length + 1,
    );
  input.state.update({
    pending_clarification: undefined,
    seed_items: existing ? current : [...current, item].slice(-20),
  });
  return item;
}

// 把当前 Seed Lite 待推进转换成排程兜底候选。
export async function scheduleFallbackItemsFromSeedLite(
  seedStore: SeedLiteStore | undefined,
  state: ShortTermStateStore,
): Promise<ScheduleProposalItemInput[]> {
  return (await readCurrentSeedLiteItems(seedStore, state)).map((item) => ({
    title: item.title,
    sourceIds: [item.seedId],
  }));
}

// 将排程工具里的待推进 target 解析成明确标题和 Seed 来源。
export async function resolveScheduleTodoTargets(
  action: Extract<CalendarAction, { type: "propose_schedule" }>,
  seedStore: SeedLiteStore | undefined,
  state: ShortTermStateStore,
): Promise<ScheduleTodoTargetResolution> {
  if (!action.items.some((item) => item.target)) return { ok: true, action };
  const items = await readCurrentSeedLiteItems(seedStore, state);
  const targetDates: string[] = [];
  const reminderStartTimes: string[] = [];
  const resolvedItems: ScheduleItemDraft[] = [];

  for (const item of action.items) {
    if (!item.target) {
      resolvedItems.push(item);
      continue;
    }

    const resolved = resolveTodoTargets(items, item.target);
    if (!resolved.ok) return { ok: false, message: resolved.message, items };
    const { target, ...rest } = item;
    for (const resolvedItem of resolved.items) {
      const reminder = parseReminderAt(resolvedItem.reminderAt);
      if (resolvedItem.targetDate) targetDates.push(resolvedItem.targetDate);
      else if (reminder.date) targetDates.push(reminder.date);
      if (reminder.startTime) reminderStartTimes.push(reminder.startTime);
      resolvedItems.push({
        ...rest,
        title: resolved.items.length === 1 ? item.title?.trim() || resolvedItem.title : resolvedItem.title,
        sourceIds: uniqueStrings([...(item.sourceIds || []), resolvedItem.seedId]),
      });
    }
  }

  const uniqueDates = uniqueStrings(targetDates);
  const uniqueReminderStartTimes = uniqueStrings(reminderStartTimes);
  return {
    ok: true,
    action: { ...action, items: resolvedItems },
    ...(!action.date && uniqueDates.length === 1 ? { defaultDate: uniqueDates[0] } : {}),
    ...(!action.preferredStartTime && uniqueReminderStartTimes.length === 1 ? { defaultStartTime: uniqueReminderStartTimes[0] } : {}),
  };
}

// 排程创建成功后完成对应 Seed Lite 来源。
export async function completeSeedLiteSources(sourceIds: string[], seedStore: SeedLiteStore | undefined, state: ShortTermStateStore) {
  if (!seedStore) return;
  const seedIds = sourceIds.filter((sourceId) => sourceId.startsWith("seed_"));
  if (seedIds.length === 0) return;
  state.update({ seed_items: await seedStore.complete(seedIds) });
}

// 生成“先记下”的用户回执。
export function formatSeedCaptureReply(title: string): string {
  return `已先记下：${title}\n之后可以说“帮我安排这个”，也可以在早晚报里直接处理。`;
}

// 生成待推进失败回执，并附上当前可选项。
export function formatTodoInboxFailureReply(message: string, items: SeedLiteItem[]): string {
  if (items.length === 0) return `没有成功：${message}`;
  return [`没有成功：${message}`, "当前待推进收件箱：", ...items.map((item, index) => `${index + 1}. ${formatTodoInboxItem(item)}`)].join("\n");
}

async function readCurrentSeedLiteItems(seedStore: SeedLiteStore | undefined, state: ShortTermStateStore): Promise<SeedLiteItem[]> {
  if (seedStore) {
    const items = await seedStore.list();
    state.update({ seed_items: items });
    return items;
  }
  return state.snapshot().seed_items || [];
}

async function removeSeedLiteItems(seedStore: SeedLiteStore | undefined, state: ShortTermStateStore, seedIds: string[]): Promise<SeedLiteItem[]> {
  if (seedStore) {
    const next = await seedStore.complete(seedIds);
    state.update({ seed_items: next });
    return next;
  }
  const targets = new Set(seedIds);
  const next = (state.snapshot().seed_items || []).filter((item) => !targets.has(item.seedId));
  state.update({ seed_items: next });
  return next;
}

async function updateSeedLiteItems(seedStore: SeedLiteStore | undefined, state: ShortTermStateStore, seedIds: string[], patch: TodoPatch): Promise<SeedLiteItem[]> {
  if (seedStore) {
    const next = await seedStore.update(seedIds, patch);
    state.update({ seed_items: next });
    return next;
  }
  const targets = new Set(seedIds);
  const next = (state.snapshot().seed_items || []).map((item) =>
    targets.has(item.seedId) ? applySeedLitePatch(item, patch) : item,
  );
  state.update({ seed_items: next });
  return next;
}

function applySeedLitePatch(item: SeedLiteItem, patch: TodoPatch): SeedLiteItem {
  const next: SeedLiteItem = {
    ...item,
    ...(patch.title?.trim() ? { title: patch.title.trim() } : {}),
    ...(patch.targetDate ? { targetDate: patch.targetDate } : {}),
  };
  if (patch.clearReminder) delete next.reminderAt;
  if (!patch.clearReminder && patch.reminderAt) next.reminderAt = patch.reminderAt;
  return next;
}

function resolveTodoTargets(items: SeedLiteItem[], target: TodoTarget): { ok: true; items: SeedLiteItem[] } | { ok: false; message: string } {
  if (target.itemNumbers) {
    const resolved: SeedLiteItem[] = [];
    for (const itemNumber of target.itemNumbers) {
      const item = items[itemNumber - 1];
      if (!item) return { ok: false, message: `没有找到第 ${itemNumber} 个待推进。` };
      if (!resolved.some((candidate) => candidate.seedId === item.seedId)) resolved.push(item);
    }
    return resolved.length > 0 ? { ok: true, items: resolved } : { ok: false, message: "没有找到要处理的待推进。" };
  }

  const resolved = resolveTodoTarget(items, target);
  return resolved.ok ? { ok: true, items: [resolved.item] } : resolved;
}

function resolveTodoTarget(items: SeedLiteItem[], target: TodoTarget): { ok: true; item: SeedLiteItem } | { ok: false; message: string } {
  if (target.seedId) {
    const item = items.find((candidate) => candidate.seedId === target.seedId);
    return item ? { ok: true, item } : { ok: false, message: "没有找到这个待推进。" };
  }

  if (target.itemNumber) {
    const item = items[target.itemNumber - 1];
    return item ? { ok: true, item } : { ok: false, message: `没有找到第 ${target.itemNumber} 个待推进。` };
  }

  if (!target.title?.trim()) return { ok: false, message: "没有找到要处理的待推进。" };
  const query = target.title.trim();
  const exact = items.filter((item) => item.title === query);
  if (exact.length === 1) return { ok: true, item: exact[0] };
  if (exact.length > 1) return { ok: false, message: `找到多个待推进：${exact.map((item) => item.title).join("、")}。请说第几个。` };

  const fuzzy = items.filter((item) => item.title.includes(query) || query.includes(item.title));
  if (fuzzy.length === 1) return { ok: true, item: fuzzy[0] };
  if (fuzzy.length > 1) return { ok: false, message: `找到多个待推进：${fuzzy.map((item) => item.title).join("、")}。请说第几个。` };
  return { ok: false, message: "没有找到这个待推进。" };
}

function formatTodoInboxReply(items: SeedLiteItem[]): string {
  if (items.length === 0) return "现在没有待推进。";
  return ["待推进收件箱：", ...items.map((item, index) => `${index + 1}. ${formatTodoInboxItem(item)}`), "可以直接说“第几个完成了”“第几个明天处理”“把第几个安排一下”或“这个先别提醒”。"].join("\n");
}

function formatTodoInboxItem(item: SeedLiteItem): string {
  const meta = [item.targetDate, item.reminderAt ? `提醒：${item.reminderAt}` : ""].filter(Boolean);
  return meta.length > 0 ? `${item.title}（${meta.join("，")}）` : item.title;
}

function uniqueStrings(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

function parseReminderAt(value: string | undefined): { date?: string; startTime?: string } {
  if (!value) return {};
  const [date, time] = value.trim().split(" ");
  return {
    ...(isDateText(date) ? { date } : {}),
    ...(isTimeText(time) ? { startTime: time } : {}),
  };
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
