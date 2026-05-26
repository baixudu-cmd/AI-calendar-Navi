// 待推进收件箱执行模块：集中处理 Seed Lite、待推进目标解析和排程 target 展开。

import type { CalendarAction, ScheduleItemDraft, TodoPatch, TodoTarget } from "../contract/index.js";
import type { ScheduleProposalItemInput } from "../scheduler/index.js";
import { createSeedLiteItem, type SeedLiteItem, type SeedLitePatch, type SeedLiteStore } from "../seed-lite/index.js";
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
  const activeItems = filterActiveSeedItems(items);
  if (action.operation === "list") {
    const limit = action.limit && action.limit > 0 ? Math.min(action.limit, 20) : undefined;
    return { ok: true, reply: formatTodoInboxReply(limit ? activeItems.slice(0, limit) : activeItems, filterShelvedSeedItems(items).length) };
  }
  if (action.operation === "list_shelved") {
    const shelvedItems = filterShelvedSeedItems(items);
    const limit = action.limit && action.limit > 0 ? Math.min(action.limit, 20) : undefined;
    return { ok: true, reply: formatShelvedTodoInboxReply(limit ? shelvedItems.slice(0, limit) : shelvedItems, activeItems.length) };
  }

  const isRestore = action.operation === "restore";
  const targetItems = isRestore ? filterShelvedSeedItems(items) : activeItems;
  const resolved = resolveTodoTargets(targetItems, action.target, isRestore ? "搁置项" : "待推进");
  if (!resolved.ok) return { ok: false, reply: isRestore ? formatShelvedTodoInboxFailureReply(resolved.message, targetItems) : formatTodoInboxFailureReply(resolved.message, targetItems) };
  const seedIds = resolved.items.map((item) => item.seedId);

  if (action.operation === "update") {
    const nextItems = await updateSeedLiteItems(seedStore, state, seedIds, action.patch);
    const updated = resolved.items.map((item) => nextItems.find((candidate) => candidate.seedId === item.seedId) || { ...item, ...action.patch });
    if (action.patch.clearReminder && !action.patch.title && !action.patch.targetDate && !action.patch.reminderAt) {
      return { ok: true, reply: `已关闭提醒：${updated.map((item) => item.title).join("、")}\n事项还在待推进，可以说“看看待推进收件箱”继续处理。` };
    }
    const reply = `已更新待推进：${updated.map(formatTodoInboxItem).join("、")}`;
    if (action.patch.reminderAt) return { ok: true, reply: `${reply}\n之后可以说“待提醒里的第几个不用提醒”或“待提醒里的第几个提前 2 小时”。` };
    if (action.patch.targetDate) return { ok: true, reply: `${reply}\n之后可以说“待安排里的第几个安排一下”或“待安排的都给我推荐一下”。` };
    return { ok: true, reply };
  }

  if (action.operation === "shelve") {
    await updateSeedLiteItems(seedStore, state, seedIds, { status: "shelved" });
    return { ok: true, reply: `已搁置待推进：${resolved.items.map((item) => item.title).join("、")}\n之后可以说“看看搁置区”或“搁置区第几个恢复”。` };
  }

  if (action.operation === "restore") {
    await updateSeedLiteItems(seedStore, state, seedIds, { status: "active" });
    return { ok: true, reply: `已恢复待推进：${resolved.items.map((item) => item.title).join("、")}\n之后可以说“看看待推进收件箱”继续处理。` };
  }

  const nextItems = await removeSeedLiteItems(seedStore, state, seedIds);
  const verb = action.operation === "complete" ? "已完成待推进" : "已取消待推进";
  return { ok: true, reply: formatTodoRemovalSuccessReply(verb, resolved.items, nextItems) };
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
    syncSeedLiteState(input.state, await input.seedStore.list(), { pending_clarification: undefined });
    return item;
  }

  const current = readSeedItemsFromState(input.state);
  const existing = current.find((item) => item.title === input.title.trim());
  const item =
    existing ||
    createSeedLiteItem(
      { title: input.title, createdAt: input.createdAt, sourceText: input.sourceText },
      current.length + 1,
    );
  syncSeedLiteState(input.state, existing ? current : [...current, item].slice(-20), { pending_clarification: undefined });
  return item;
}

// 把当前 Seed Lite 待推进转换成排程兜底候选。
export async function scheduleFallbackItemsFromSeedLite(
  seedStore: SeedLiteStore | undefined,
  state: ShortTermStateStore,
): Promise<ScheduleProposalItemInput[]> {
  return filterActiveSeedItems(await readCurrentSeedLiteItems(seedStore, state)).map((item) => ({
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
  const items = filterActiveSeedItems(await readCurrentSeedLiteItems(seedStore, state));
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
  syncSeedLiteState(state, await seedStore.complete(seedIds));
}

// 构造短期状态里的活跃、搁置和 Watchlist 分组列表，给模型下一轮结构化续接使用。
export function buildSeedLiteStatePatch(items: SeedLiteItem[], extra: Record<string, unknown> = {}) {
  const activeItems = filterActiveSeedItems(items);
  return {
    ...extra,
    seed_items: activeItems,
    pending_reminder_seed_items: activeItems.filter((item) => item.reminderAt),
    pending_schedule_seed_items: activeItems.filter((item) => !item.reminderAt && item.targetDate),
    pending_todo_seed_items: activeItems.filter((item) => !item.reminderAt && !item.targetDate),
    shelved_seed_items: filterShelvedSeedItems(items),
  };
}

// 生成“先记下”的用户回执。
export function formatSeedCaptureReply(title: string): string {
  return `已先记下：${title}\n之后可以说“帮我安排这个”，也可以在早晚报里直接处理。`;
}

// 生成待推进失败回执，并附上当前可选项。
export function formatTodoInboxFailureReply(message: string, items: SeedLiteItem[]): string {
  if (items.length === 0) return `没有成功：${message}`;
  return [`没有成功：${message}`, "当前待推进收件箱：", ...items.map((item, index) => `${index + 1}. ${formatTodoInboxItem(item)}`), formatTodoInboxNextStep(items)].join("\n");
}

// 生成搁置区恢复失败回执，并附上当前搁置区可选项。
function formatShelvedTodoInboxFailureReply(message: string, items: SeedLiteItem[]): string {
  if (items.length === 0) return `没有成功：${message}`;
  return [`没有成功：${message}`, "当前搁置区：", ...items.map((item, index) => `${index + 1}. ${formatTodoInboxItem(item)}`), "可以直接说“搁置区第几个恢复”。"].join("\n");
}

function formatTodoRemovalSuccessReply(verb: string, removedItems: SeedLiteItem[], nextItems: SeedLiteItem[]): string {
  const base = `${verb}：${removedItems.map((item) => item.title).join("、")}`;
  const remaining = filterActiveSeedItems(nextItems).length;
  if (remaining === 0) return base;
  return `${base}\n还有 ${remaining} 件待推进，可以说“看看待推进收件箱”继续处理。`;
}

async function readCurrentSeedLiteItems(seedStore: SeedLiteStore | undefined, state: ShortTermStateStore): Promise<SeedLiteItem[]> {
  if (seedStore) {
    const items = await seedStore.list();
    syncSeedLiteState(state, items);
    return items;
  }
  return readSeedItemsFromState(state);
}

async function removeSeedLiteItems(seedStore: SeedLiteStore | undefined, state: ShortTermStateStore, seedIds: string[]): Promise<SeedLiteItem[]> {
  if (seedStore) {
    const next = await seedStore.complete(seedIds);
    syncSeedLiteState(state, next);
    return next;
  }
  const targets = new Set(seedIds);
  const next = readSeedItemsFromState(state).filter((item) => !targets.has(item.seedId));
  syncSeedLiteState(state, next);
  return next;
}

async function updateSeedLiteItems(seedStore: SeedLiteStore | undefined, state: ShortTermStateStore, seedIds: string[], patch: SeedLitePatch): Promise<SeedLiteItem[]> {
  if (seedStore) {
    const next = await seedStore.update(seedIds, patch);
    syncSeedLiteState(state, next);
    return next;
  }
  const targets = new Set(seedIds);
  const next = readSeedItemsFromState(state).map((item) =>
    targets.has(item.seedId) ? applySeedLitePatch(item, patch) : item,
  );
  syncSeedLiteState(state, next);
  return next;
}

function readSeedItemsFromState(state: ShortTermStateStore): SeedLiteItem[] {
  const snapshot = state.snapshot();
  return [...(snapshot.seed_items || []), ...(snapshot.shelved_seed_items || [])];
}

function syncSeedLiteState(state: ShortTermStateStore, items: SeedLiteItem[], extra: Record<string, unknown> = {}) {
  state.update(buildSeedLiteStatePatch(items, extra));
}

function applySeedLitePatch(item: SeedLiteItem, patch: SeedLitePatch): SeedLiteItem {
  const next: SeedLiteItem = {
    ...item,
    ...(patch.title?.trim() ? { title: patch.title.trim() } : {}),
    ...(patch.targetDate ? { targetDate: patch.targetDate } : {}),
  };
  if (patch.clearReminder) delete next.reminderAt;
  if (!patch.clearReminder && patch.reminderAt) next.reminderAt = patch.reminderAt;
  if (patch.status === "shelved") next.status = "shelved";
  if (patch.status === "active") delete next.status;
  if (Number.isInteger(patch.pullbackCount) && Number(patch.pullbackCount) >= 0) next.pullbackCount = Number(patch.pullbackCount);
  if (patch.lastPullbackAt) next.lastPullbackAt = patch.lastPullbackAt;
  return next;
}

function filterActiveSeedItems(items: SeedLiteItem[]): SeedLiteItem[] {
  return items.filter((item) => item.status !== "shelved");
}

function filterShelvedSeedItems(items: SeedLiteItem[]): SeedLiteItem[] {
  return items.filter((item) => item.status === "shelved");
}

function resolveTodoTargets(items: SeedLiteItem[], target: TodoTarget, itemLabel = "待推进"): { ok: true; items: SeedLiteItem[] } | { ok: false; message: string } {
  if (target.group) {
    const grouped = filterTodoTargetGroup(items, target.group);
    if (grouped.length === 0) return { ok: false, message: formatEmptyGroupMessage(target.group) };
    const scopedTarget = withoutTodoTargetGroup(target);
    if (hasConcreteTodoTarget(scopedTarget)) return resolveTodoTargets(grouped, scopedTarget, itemLabel);
    return { ok: true, items: grouped };
  }

  if (target.itemNumbers) {
    const resolved: SeedLiteItem[] = [];
    for (const itemNumber of target.itemNumbers) {
      const item = items[itemNumber - 1];
      if (!item) return { ok: false, message: `没有找到第 ${itemNumber} 个${itemLabel}。` };
      if (!resolved.some((candidate) => candidate.seedId === item.seedId)) resolved.push(item);
    }
    return resolved.length > 0 ? { ok: true, items: resolved } : { ok: false, message: `没有找到要处理的${itemLabel}。` };
  }

  const resolved = resolveTodoTarget(items, target, itemLabel);
  return resolved.ok ? { ok: true, items: [resolved.item] } : resolved;
}

function withoutTodoTargetGroup(target: TodoTarget): TodoTarget {
  const { group, ...rest } = target;
  return rest;
}

function hasConcreteTodoTarget(target: TodoTarget): boolean {
  return Boolean(target.seedId || target.itemNumber || target.itemNumbers?.length || target.title?.trim());
}

function filterTodoTargetGroup(items: SeedLiteItem[], group: NonNullable<TodoTarget["group"]>): SeedLiteItem[] {
  if (group === "all") return items;
  if (group === "pending_schedule") return items.filter((item) => Boolean(item.targetDate) && !item.reminderAt);
  if (group === "pending_reminder") return items.filter((item) => Boolean(item.reminderAt));
  return items.filter((item) => !item.targetDate && !item.reminderAt);
}

function formatEmptyGroupMessage(group: NonNullable<TodoTarget["group"]>): string {
  if (group === "pending_schedule") return "现在没有待安排事项。";
  if (group === "pending_reminder") return "现在没有待提醒事项。";
  if (group === "pending_todo") return "现在没有普通待推进事项。";
  return "现在没有待推进事项。";
}

function resolveTodoTarget(items: SeedLiteItem[], target: TodoTarget, itemLabel = "待推进"): { ok: true; item: SeedLiteItem } | { ok: false; message: string } {
  if (target.seedId) {
    const item = items.find((candidate) => candidate.seedId === target.seedId);
    return item ? { ok: true, item } : { ok: false, message: `没有找到这个${itemLabel}。` };
  }

  if (target.itemNumber) {
    const item = items[target.itemNumber - 1];
    return item ? { ok: true, item } : { ok: false, message: `没有找到第 ${target.itemNumber} 个${itemLabel}。` };
  }

  if (!target.title?.trim()) return { ok: false, message: `没有找到要处理的${itemLabel}。` };
  const query = target.title.trim();
  const exact = items.filter((item) => item.title === query);
  if (exact.length === 1) return { ok: true, item: exact[0] };
  if (exact.length > 1) return { ok: false, message: `找到多个${itemLabel}：${exact.map((item) => item.title).join("、")}。请说对应分组里的第几个。` };

  const fuzzy = items.filter((item) => item.title.includes(query) || query.includes(item.title));
  if (fuzzy.length === 1) return { ok: true, item: fuzzy[0] };
  if (fuzzy.length > 1) return { ok: false, message: `找到多个${itemLabel}：${fuzzy.map((item) => item.title).join("、")}。请说对应分组里的第几个。` };
  return { ok: false, message: `没有找到这个${itemLabel}。` };
}

function formatTodoInboxReply(items: SeedLiteItem[], shelvedCount = 0): string {
  if (items.length === 0) {
    if (shelvedCount > 0) return `现在没有待推进。\n${formatShelvedTodoHint(shelvedCount)}`;
    return "现在没有待推进。";
  }
  return ["待推进收件箱：", ...items.map((item, index) => `${index + 1}. ${formatTodoInboxItem(item)}`), formatTodoInboxNextStep(items)].join("\n");
}

function formatShelvedTodoHint(count: number): string {
  return `搁置区还有 ${count} 件，可以说“看看搁置区”或“搁置区第几个恢复”。`;
}

function formatTodoInboxNextStep(items: SeedLiteItem[]): string {
  const actions: string[] = [];
  if (items.some((item) => !item.reminderAt && !item.targetDate)) actions.push("待推进里的第几个完成了");
  if (items.some((item) => !item.reminderAt && item.targetDate)) actions.push("待安排里的第几个安排一下");
  if (items.some((item) => item.reminderAt)) actions.push("待提醒里的第几个不用提醒");
  return `可以直接说${formatQuotedList(actions)}。`;
}

function formatQuotedList(items: string[]): string {
  if (items.length === 1) return `“${items[0]}”`;
  const head = items.slice(0, -1).map((item) => `“${item}”`).join("");
  return `${head}或“${items[items.length - 1]}”`;
}

function formatShelvedTodoInboxReply(items: SeedLiteItem[], activeCount = 0): string {
  if (items.length === 0) {
    if (activeCount > 0) return `搁置区现在没有事项。\n${formatActiveTodoHint(activeCount)}`;
    return "搁置区现在没有事项。";
  }
  return ["搁置区：", ...items.map((item, index) => `${index + 1}. ${formatTodoInboxItem(item)}`), "可以直接说“搁置区第几个恢复”。"].join("\n");
}

function formatActiveTodoHint(count: number): string {
  return `还有 ${count} 件待推进，可以说“看看待推进收件箱”继续处理。`;
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
