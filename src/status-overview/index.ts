// 状态总览：把当前挂起上下文整理成用户可读回复，不写日历、不写状态。

import type { SeedLiteItem } from "../seed-lite/index.js";
import type { PendingDeleteState, PendingScheduleState, ShortTermState } from "../state/index.js";

export type StatusOverviewInput = {
  state: ShortTermState;
  seedItems?: SeedLiteItem[];
};

// 生成“我现在记着什么”的只读说明，帮助用户理解当前待处理上下文。
export function buildStatusOverview(input: StatusOverviewInput): string {
  const sections = [
    formatPendingClarification(input.state),
    formatPendingSchedule(input.state.pending_schedule),
    formatPendingDelete(input.state.pending_delete),
    formatPendingConflict(input.state),
    formatSeedItems(input.seedItems || input.state.seed_items || []),
  ].filter((section): section is string => Boolean(section));

  if (sections.length === 0) return "现在我这里没有挂起的待处理事项。";
  return ["现在我这里还挂着这些事：", ...sections].join("\n");
}

function formatPendingClarification(state: ShortTermState): string {
  const pending = state.pending_clarification;
  if (!pending) return "";
  const draft = pending.createDraft;
  const title = draft?.title || "未命名事项";
  const meta = [draft?.date, draft?.startTime].filter(Boolean).join(" ");
  return `- 待补时间：${title}${meta ? `（${meta}）` : ""}；${pending.question}`;
}

function formatPendingSchedule(pending: PendingScheduleState | undefined): string {
  const firstOption = pending?.options[0];
  if (!pending || !firstOption) return "";
  const items = firstOption.items.map((item) => `${item.title}（${item.date} ${item.startTime}）`).join("、");
  return `- 待确认推荐：${items}`;
}

function formatPendingDelete(pending: PendingDeleteState | undefined): string {
  if (!pending) return "";
  if ("items" in pending) return `- 待确认删除：${pending.title}（${pending.items.length} 个日程）`;
  const meta = [pending.date, pending.startTime].filter(Boolean).join(" ");
  return `- 待确认删除：${pending.title}${meta ? `（${meta}）` : ""}`;
}

function formatPendingConflict(state: ShortTermState): string {
  const conflict = state.pending_conflict;
  if (!conflict) return "";
  const titles = conflict.conflicts.map((item) => item.title).join("、");
  return `- 待确认冲突：${titles || "有日程冲突"}，需要确认是否继续创建`;
}

function formatSeedItems(items: SeedLiteItem[]): string {
  if (items.length === 0) return "";
  const lines = items.slice(0, 10).map((item, index) => `  ${index + 1}. ${formatSeedItem(item)}`);
  return ["- 待推进：", ...lines].join("\n");
}

function formatSeedItem(item: SeedLiteItem): string {
  const meta = [item.targetDate, item.reminderAt ? `提醒：${item.reminderAt}` : ""].filter(Boolean);
  return meta.length > 0 ? `${item.title}（${meta.join("，")}）` : item.title;
}
