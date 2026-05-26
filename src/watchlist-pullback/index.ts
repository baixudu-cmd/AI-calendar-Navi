// Watchlist 温和拉回生命周期：只由早晚报入口推进，状态总览保持只读。

import type { SeedLiteItem, SeedLiteStore } from "../seed-lite/index.js";

export type AdvanceWatchlistPullbackInput = {
  seedStore?: SeedLiteStore;
  seedItems: SeedLiteItem[];
  today: string;
};

// 推进过期待安排/待提醒事项的拉回状态：当天最多记一次，两次后自动进入搁置区。
export async function advanceWatchlistPullback(input: AdvanceWatchlistPullbackInput): Promise<SeedLiteItem[]> {
  if (!input.seedStore || !isDateText(input.today)) return input.seedItems;

  let currentItems = input.seedItems;
  for (const item of input.seedItems) {
    if (!shouldAdvancePullback(item, input.today)) continue;
    if ((item.pullbackCount || 0) >= 2) {
      currentItems = await input.seedStore.update([item.seedId], { status: "shelved" });
      continue;
    }
    currentItems = await input.seedStore.update([item.seedId], {
      pullbackCount: (item.pullbackCount || 0) + 1,
      lastPullbackAt: input.today,
    });
  }

  return currentItems;
}

function shouldAdvancePullback(item: SeedLiteItem, today: string): boolean {
  if (item.status === "shelved") return false;
  if (item.lastPullbackAt === today) return false;
  const targetDate = item.targetDate || parseReminderDate(item.reminderAt);
  return Boolean(targetDate && targetDate < today);
}

function parseReminderDate(value: string | undefined): string | undefined {
  const [date] = (value || "").trim().split(" ");
  return isDateText(date) ? date : undefined;
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
