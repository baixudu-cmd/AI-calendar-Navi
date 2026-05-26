// 状态总览：把当前挂起上下文整理成用户可读回复，不写日历、不写状态。

import type { SeedLiteItem } from "../seed-lite/index.js";
import type { PendingDeleteState, PendingScheduleState, ShortTermState } from "../state/index.js";

export type StatusOverviewInput = {
  state: ShortTermState;
  seedItems?: SeedLiteItem[];
  today?: string;
};

const EMPTY_STATUS_REPLY = "现在我这里没有挂起的待处理事项。";

// 生成“我现在记着什么”的只读说明，帮助用户理解当前待处理上下文。
export function buildStatusOverview(input: StatusOverviewInput): string {
  const allSeedItems = input.seedItems || input.state.seed_items || [];
  const seedItems = filterActiveSeedItems(allSeedItems);
  const seedSections = formatSeedWatchlist(seedItems);
  const sections = [
    formatGentlePullback(seedItems, input.today),
    formatPendingClarification(input.state),
    formatConfirmations(input.state),
    ...seedSections,
  ].filter((section): section is string => Boolean(section));
  const shelvedHint = formatShelvedHint(allSeedItems);

  if (sections.length === 0) return shelvedHint ? `现在我这里没有活跃的待处理事项。\n${shelvedHint}` : EMPTY_STATUS_REPLY;
  return [formatActiveSummary(input.state, seedItems), ...sections, shelvedHint, formatNextStepHint(input.state, seedItems)]
    .filter(Boolean)
    .join("\n");
}

function filterActiveSeedItems(items: SeedLiteItem[]): SeedLiteItem[] {
  return items.filter((item) => item.status !== "shelved");
}

function formatShelvedHint(items: SeedLiteItem[]): string {
  const count = items.filter((item) => item.status === "shelved").length;
  return count > 0 ? `搁置区还有 ${count} 件，可以说“看看搁置区”或“搁置区第几个恢复”。` : "";
}

function formatGentlePullback(items: SeedLiteItem[], today: string | undefined): string {
  if (!isDateText(today)) return "";
  const overdue = items.filter((item) => isSeedItemOverdue(item, today)).slice(0, 3);
  if (overdue.length === 0) return "";
  return `- 温和拉回：${overdue.map((item) => item.title).join("、")} 已过原定时间。${formatPullbackNextStep(overdue)}`;
}

function formatPullbackNextStep(items: SeedLiteItem[]): string {
  const actions: string[] = [];
  if (items.some((item) => !item.reminderAt && item.targetDate)) actions.push("待安排里的第几个今天下午");
  if (items.some((item) => item.reminderAt)) actions.push("待提醒里的第几个提前 2 小时");
  if (items.some((item) => !item.reminderAt && !item.targetDate)) actions.push("待推进里的第几个完成了");
  if (actions.length === 0) return "可以按下面对应分组继续处理。";
  return `可以在对应分组里说${formatQuotedList(actions)}。`;
}

function formatQuotedList(items: string[]): string {
  if (items.length === 1) return `“${items[0]}”`;
  const head = items.slice(0, -1).map((item) => `“${item}”`).join("");
  return `${head}或“${items[items.length - 1]}”`;
}

function formatPendingClarification(state: ShortTermState): string {
  const pending = state.pending_clarification;
  if (!pending) return "";
  const draft = pending.createDraft;
  const title = draft?.title || "未命名事项";
  const meta = [draft?.date, draft?.startTime].filter(Boolean).join(" ");
  return `- 待补信息：${title}${meta ? `（${meta}）` : ""}；${pending.question}`;
}

function formatConfirmations(state: ShortTermState): string {
  const lines = [
    formatPendingSchedule(state.pending_schedule),
    formatPendingDelete(state.pending_delete),
    formatPendingConflict(state),
  ].filter(Boolean);
  if (lines.length === 0) return "";
  return ["- 待确认：", ...lines.map((line) => `  ${line}`)].join("\n");
}

function formatPendingSchedule(pending: PendingScheduleState | undefined): string {
  const firstOption = pending?.options[0];
  if (!pending || !firstOption) return "";
  const items = firstOption.items.map((item) => `${item.title}（${item.date} ${item.startTime}）`).join("、");
  return `排程推荐：${items}`;
}

function formatPendingDelete(pending: PendingDeleteState | undefined): string {
  if (!pending) return "";
  if ("items" in pending) return `删除确认：${pending.title}（${pending.items.length} 个日程）`;
  const meta = [pending.date, pending.startTime].filter(Boolean).join(" ");
  return `删除确认：${pending.title}${meta ? `（${meta}）` : ""}`;
}

function formatPendingConflict(state: ShortTermState): string {
  const conflict = state.pending_conflict;
  if (!conflict) return "";
  const titles = conflict.conflicts.map((item) => item.title).join("、");
  return `冲突确认：${titles || "有日程冲突"}，需要确认是否继续创建`;
}

function formatSeedWatchlist(items: SeedLiteItem[]): string[] {
  const pendingReminder = items.filter((item) => item.reminderAt).slice(0, 10);
  const pendingSchedule = items.filter((item) => !item.reminderAt && item.targetDate).slice(0, 10);
  const pendingTodo = items.filter((item) => !item.reminderAt && !item.targetDate).slice(0, 10);
  return [
    formatSeedGroup("待提醒", pendingReminder, formatReminderSeedItem),
    formatSeedGroup("待安排", pendingSchedule, formatSeedItem),
    formatSeedGroup("待推进", pendingTodo, formatSeedItem),
  ].filter((section): section is string => Boolean(section));
}

function formatSeedGroup(title: string, items: SeedLiteItem[], formatter: (item: SeedLiteItem) => string): string {
  if (items.length === 0) return "";
  const lines = items.map((item, index) => `  ${index + 1}. ${formatter(item)}`);
  return [`- ${title}：`, ...lines].join("\n");
}

function formatReminderSeedItem(item: SeedLiteItem): string {
  return `${item.title}（${item.reminderAt}）`;
}

function formatSeedItem(item: SeedLiteItem): string {
  const meta = [item.targetDate, item.reminderAt ? `提醒：${item.reminderAt}` : ""].filter(Boolean);
  return meta.length > 0 ? `${item.title}（${meta.join("，")}）` : item.title;
}

function isSeedItemOverdue(item: SeedLiteItem, today: string): boolean {
  const targetDate = item.targetDate || parseReminderDate(item.reminderAt);
  return Boolean(targetDate && targetDate < today);
}

function parseReminderDate(value: string | undefined): string | undefined {
  const [date] = (value || "").trim().split(" ");
  return isDateText(date) ? date : undefined;
}

function formatActiveSummary(state: ShortTermState, seedItems: SeedLiteItem[]): string {
  const counts = buildWatchlistCounts(state, seedItems);
  const total = counts.pendingInfo + counts.pendingConfirm + counts.pendingSchedule + counts.pendingReminder + counts.pendingTodo;
  const parts = [
    formatCount("待补信息", counts.pendingInfo),
    formatCount("待确认", counts.pendingConfirm),
    formatCount("待安排", counts.pendingSchedule),
    formatCount("待提醒", counts.pendingReminder),
    formatCount("待推进", counts.pendingTodo),
  ].filter((item): item is string => Boolean(item));
  return `我现在帮你盯着 ${total} 件事：${parts.join("、")}。`;
}

function buildWatchlistCounts(state: ShortTermState, seedItems: SeedLiteItem[]) {
  return {
    pendingInfo: state.pending_clarification ? 1 : 0,
    pendingConfirm: [state.pending_schedule, state.pending_delete, state.pending_conflict].filter(Boolean).length,
    pendingReminder: seedItems.filter((item) => item.reminderAt).length,
    pendingSchedule: seedItems.filter((item) => !item.reminderAt && item.targetDate).length,
    pendingTodo: seedItems.filter((item) => !item.reminderAt && !item.targetDate).length,
  };
}

function formatCount(label: string, count: number): string {
  return count > 0 ? `${label} ${count} 件` : "";
}

function formatNextStepHint(state: ShortTermState, seedItems: SeedLiteItem[]): string {
  const hints: string[] = [];
  if (state.pending_schedule) hints.push("待确认里的排程推荐可以说“确认第 1 个推荐位”，也可以说“换晚点”或“取消排程推荐”。");
  if (state.pending_delete) hints.push("待确认里的删除确认可以说“确认删除”或“取消删除”。");
  if (seedItems.some((item) => !item.reminderAt && item.targetDate)) hints.push("待安排可以说“待安排里的第几个今天下午”或“待安排的都给我推荐一下”。");
  if (seedItems.some((item) => item.reminderAt)) hints.push("待提醒可以说“待提醒里的第几个不用提醒”或“待提醒里的第几个提前 2 小时”。");
  if (seedItems.some((item) => !item.reminderAt && !item.targetDate)) hints.push("待推进可以说“待推进里的第几个完成了”或“待推进里的第几个先不管”。");
  if (hints.length === 0) return "";
  return `下一步：${hints.join("；")}`;
}

function isDateText(value: string | undefined): value is string {
  if (!value) return false;
  const [yearText, monthText, dayText] = value.split("-");
  if (!yearText || !monthText || !dayText || yearText.length !== 4 || monthText.length !== 2 || dayText.length !== 2) return false;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
