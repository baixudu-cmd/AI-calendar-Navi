// 日报模块：生成早晚日报，并把日报序号映射回真实日程 ID。

import type { CalendarAdapter } from "../calendar/action-executor.js";
import { listEvents } from "../calendar-api/index.js";
import type { CalendarAction } from "../contract/index.js";
import { formatCalendarDateLabel, formatCalendarEventLine } from "../reply/event-format.js";
import { formatSeedLiteSection, type SeedLiteStore } from "../seed-lite/index.js";
import { buildStatusOverview } from "../status-overview/index.js";
import { briefingItemStateFromCalendarEvent } from "../state/calendar-event.js";
import type { ShortTermState, ShortTermStateStore } from "../state/index.js";

export type ExecuteDailyBriefingInput = {
  briefingType: "morning" | "evening";
  today: string;
  state: ShortTermStateStore;
  calendar: CalendarAdapter;
  seedStore?: SeedLiteStore;
};

export type BriefingResult = { ok: true; reply: string } | { ok: false; reply: string };
export type BriefingResolveResult = { ok: true; action: CalendarAction } | { ok: false; message: string };

// 执行早报或晚报；日期由调用方注入，不从用户原文推断。
export async function executeDailyBriefing(input: ExecuteDailyBriefingInput): Promise<BriefingResult> {
  const targetDate = input.briefingType === "morning" ? input.today : addDays(input.today, 1);
  const listResult = await listEvents(input.calendar, { date: targetDate });

  if (!listResult.ok) return { ok: false, reply: `没有成功：${listResult.message}` };
  const seedItems = input.seedStore ? await input.seedStore.list() : [];

  input.state.update({
    briefing_items: listResult.data.map((event, index) => briefingItemStateFromCalendarEvent(event, index + 1)),
    seed_items: seedItems,
  });

  const title = `${input.briefingType === "morning" ? "早报" : "晚报"}｜${formatCalendarDateLabel(targetDate)}`;
  const seedSection = formatSeedLiteSection(seedItems);
  if (listResult.data.length === 0 && !seedSection) {
    return { ok: true, reply: `${title}\n这一天没有日程。` };
  }

  const lines = listResult.data.map((event, index) => formatCalendarEventLine(event, index + 1, { fallbackDate: targetDate }));
  const calendarSection = lines.length > 0 ? [input.briefingType === "morning" ? "今日日程：" : "明日日程：", ...lines].join("\n") : "";
  const pendingContextSection = formatPendingContextSection(input.state.snapshot());
  const actionHint = seedSection ? "可以直接说“第几个完成了”“第几个明天处理”“把第几个安排一下”或“这个先别提醒”。" : "";
  return { ok: true, reply: [title, calendarSection, pendingContextSection, seedSection, actionHint].filter(Boolean).join("\n") };
}

function formatPendingContextSection(state: ShortTermState): string {
  const overview = buildStatusOverview({ state: { ...state, seed_items: [] }, seedItems: [] });
  if (overview === "现在我这里没有挂起的待处理事项。") return "";
  return ["待处理上下文：", ...overview.split("\n").slice(1)].join("\n");
}

// 把日报第 N 条修改解析成真实事件修改。
export function resolveBriefingItemUpdate(action: CalendarAction, state: ShortTermStateStore): BriefingResolveResult {
  if (action.type !== "update_event" || action.target.kind !== "briefing_item") {
    return { ok: true, action };
  }

  const itemNumber = action.target.itemNumber;
  const item = state.snapshot().briefing_items?.find((candidate) => candidate.itemNumber === itemNumber);
  if (!item) return { ok: false, message: `没有找到日报里的第 ${itemNumber} 条。` };

  const patch = fillPatchDateFromBriefingItem(action.patch, item.date);

  return {
    ok: true,
    action: { type: "update_event", target: { kind: "last_event", eventId: item.eventId }, patch },
  };
}

function fillPatchDateFromBriefingItem<T extends Extract<CalendarAction, { type: "update_event" }>["patch"]>(
  patch: T,
  date: string | undefined,
): T {
  if (!date || patch.date || (!patch.startTime && !patch.endTime)) return patch;
  return { ...patch, date };
}

// 当前只需要 YYYY-MM-DD 加一天，避免引入日期库。
function addDays(dateText: string, days: number): string {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
