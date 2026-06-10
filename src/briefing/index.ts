// 日报模块：生成早晚日报，并把日报序号映射回真实日程 ID。

import type { CalendarAdapter } from "../calendar/action-executor.js";
import { listEvents } from "../calendar-api/index.js";
import type { CalendarAction } from "../contract/index.js";
import { buildSeedLiteStatePatch } from "../agent-api/todo-inbox.js";
import { formatCalendarDateLabel, formatCalendarEventLine } from "../reply/event-format.js";
import type { SeedLiteStore } from "../seed-lite/index.js";
import { buildStatusOverview } from "../status-overview/index.js";
import { briefingItemStateFromCalendarEvent } from "../state/calendar-event.js";
import type { ShortTermState, ShortTermStateStore } from "../state/index.js";
import { advanceWatchlistPullback } from "../watchlist-pullback/index.js";

export type ExecuteDailyBriefingInput = {
  briefingType: "morning" | "evening";
  date?: string;
  today: string;
  state: ShortTermStateStore;
  calendar: CalendarAdapter;
  seedStore?: SeedLiteStore;
};

export type BriefingResult = { ok: true; reply: string } | { ok: false; reply: string };
export type BriefingResolveResult = { ok: true; action: CalendarAction } | { ok: false; message: string };

// 执行早报或晚报；日期由调用方注入，不从用户原文推断。
export async function executeDailyBriefing(input: ExecuteDailyBriefingInput): Promise<BriefingResult> {
  const targetDate = input.date || (input.briefingType === "morning" ? input.today : addDays(input.today, 1));
  const listResult = await listEvents(input.calendar, { date: targetDate });

  if (!listResult.ok) return { ok: false, reply: `没有成功：${listResult.message}` };
  const listedSeedItems = input.seedStore ? await input.seedStore.list() : [];
  const seedItems = await advanceWatchlistPullback({ seedStore: input.seedStore, seedItems: listedSeedItems, today: input.today });

  const numberedItems = listResult.data.map((event, index) => briefingItemStateFromCalendarEvent(event, index + 1, targetDate));
  input.state.update(buildSeedLiteStatePatch(seedItems, {
    briefing_items: numberedItems,
    recent_event_items: numberedItems,
  }));

  const title = `${input.briefingType === "morning" ? "早报" : "晚报"}｜${formatCalendarDateLabel(targetDate)}`;
  const watchlistSection = formatWatchlistSection(input.state.snapshot(), seedItems, input.today);
  if (listResult.data.length === 0 && !watchlistSection) {
    return { ok: true, reply: `${title}\n这一天没有日程。` };
  }

  const lines = listResult.data.map((event, index) => formatCalendarEventLine(event, index + 1, { fallbackDate: targetDate }));
  const sectionTitle = input.date ? "日程：" : input.briefingType === "morning" ? "今日日程：" : "明日日程：";
  const calendarSection = lines.length > 0 ? [sectionTitle, ...lines].join("\n") : "";
  return { ok: true, reply: [title, calendarSection, watchlistSection].filter(Boolean).join("\n") };
}

function formatWatchlistSection(state: ShortTermState, seedItems: Awaited<ReturnType<SeedLiteStore["list"]>>, today: string): string {
  const overview = buildStatusOverview({ state: { ...state, ...buildSeedLiteStatePatch(seedItems) }, seedItems, today });
  if (overview === "现在我这里没有挂起的待处理事项。") return "";
  return ["待处理工作台：", overview].join("\n");
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
