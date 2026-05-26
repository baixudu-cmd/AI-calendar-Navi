// P5 主动消息 runner：只读日历事实并生成可发送文本，不判断自然语言、不写日历。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildSeedLiteStatePatch } from "../agent-api/todo-inbox.js";
import type { DeterministicCalendarAdapter } from "../calendar-api/index.js";
import type { FeishuCalendarEvent } from "../calendar/feishu/types.js";
import { formatCalendarDateLabel, formatCalendarEventLine } from "../reply/event-format.js";
import type { SeedLiteItem, SeedLiteStore } from "../seed-lite/index.js";
import { buildStatusOverview } from "../status-overview/index.js";
import type { ShortTermState } from "../state/index.js";
import { advanceWatchlistPullback } from "../watchlist-pullback/index.js";
import type { ProactiveDelivery, ProactiveDeliveryMode } from "./proactive-delivery.js";

export type ProactiveMode = "morning" | "evening" | "reminder";

export type ProactiveMessageStore = {
  hasSent(key: string): Promise<boolean>;
  markSent(key: string): Promise<void>;
};

export type ProactiveBriefingInput = {
  mode: ProactiveMode;
  today: string;
  now: string;
  calendar: DeterministicCalendarAdapter;
  store: ProactiveMessageStore;
  commit?: boolean;
  delivery?: ProactiveDelivery;
  seedStore?: SeedLiteStore;
  pendingState?: ShortTermState;
  reminderLeadMinutes?: number;
};

export type ProactiveBriefingResult =
  | {
      ok: true;
      mode: ProactiveMode;
      sent: true;
      key: string;
      message: string;
      deliveryMode?: ProactiveDeliveryMode;
    }
  | {
      ok: true;
      mode: ProactiveMode;
      sent: false;
      key?: string;
      skippedReason: "duplicate" | "no_events";
      message: string;
    }
  | {
      ok: false;
      mode: ProactiveMode;
      sent: false;
      message: string;
      deliveryMode?: ProactiveDeliveryMode;
    };

// 运行一次主动消息生成；commit=true 时才写入去重状态。
export async function runProactiveBriefing(input: ProactiveBriefingInput): Promise<ProactiveBriefingResult> {
  if (input.mode === "reminder") return runReminder(input);
  return runDailyBriefing(input);
}

// 创建内存去重 store，供测试和本地 smoke 使用。
export function createMemoryProactiveMessageStore(initialKeys: string[] = []): ProactiveMessageStore {
  const sent = new Set(initialKeys);
  return {
    async hasSent(key) {
      return sent.has(key);
    },
    async markSent(key) {
      sent.add(key);
    },
  };
}

// 创建文件去重 store，供 Mac mini 定时器复用。
export function createFileProactiveMessageStore(filePath: string): ProactiveMessageStore {
  return {
    async hasSent(key) {
      const keys = await readSentKeys(filePath);
      return keys.has(key);
    },
    async markSent(key) {
      const keys = await readSentKeys(filePath);
      keys.add(key);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify({ sentKeys: [...keys].sort() }, null, 2), "utf8");
    },
  };
}

// 生成简短报告，保持验证输出只含通过/失败和少量摘要。
export function formatProactiveBriefingReport(result: ProactiveBriefingResult): string {
  const lines = [
    `Proactive briefing: ${result.ok ? "passed" : "failed"}`,
    `Mode: ${result.mode}`,
    `Sent: ${result.sent ? "yes" : "no"}`,
  ];

  if ("skippedReason" in result) lines.push(`Skipped: ${result.skippedReason}`);
  if ("deliveryMode" in result && result.deliveryMode) lines.push(`Delivery: ${result.deliveryMode}`);
  if ("key" in result && result.key) lines.push(`Key: ${result.key}`);
  lines.push(result.message);
  return lines.join("\n");
}

async function runDailyBriefing(input: ProactiveBriefingInput): Promise<ProactiveBriefingResult> {
  const targetDate = input.mode === "morning" ? input.today : addDays(input.today, 1);
  const key = `briefing:${input.mode}:${targetDate}`;

  if (await input.store.hasSent(key)) {
    return { ok: true, mode: input.mode, sent: false, skippedReason: "duplicate", key, message: "这条主动消息已经发送过。" };
  }

  const listed = await input.calendar.listEvents({ date: targetDate });
  if (!listed.ok) return { ok: false, mode: input.mode, sent: false, message: `没有发送成功：${listed.message}` };
  const events = sortEventsByStart(listed.data);
  const listedSeedItems = input.seedStore ? await input.seedStore.list() : [];
  const seedItems = await advanceWatchlistPullback({ seedStore: input.seedStore, seedItems: listedSeedItems, today: input.today });
  const watchlistSection = formatWatchlistSection(input.pendingState, seedItems, input.today);
  if (events.length === 0 && seedItems.length === 0 && !watchlistSection) {
    if (input.mode === "evening") {
      const message = `晚报｜${formatCalendarDateLabel(targetDate)}\n明天没有安排日程。`;
      const delivery = await deliverProactiveMessage(input, { key, message, mode: input.mode });
      if (!delivery.ok) return { ok: false, mode: input.mode, sent: false, deliveryMode: delivery.mode, message: `没有发送成功：${delivery.message}` };

      if (input.commit) await input.store.markSent(key);
      return { ok: true, mode: input.mode, sent: true, key, message, deliveryMode: delivery.mode };
    }

    return { ok: true, mode: input.mode, sent: false, skippedReason: "no_events", message: "没有需要主动发送的日程。" };
  }

  const title = `${input.mode === "morning" ? "早报" : "晚报"}｜${formatCalendarDateLabel(targetDate)}`;
  const eventLines = events.map((event, index) => formatCalendarEventLine(event, index + 1, { fallbackDate: targetDate }));
  const message = [title, ...eventLines, watchlistSection].filter(Boolean).join("\n");
  const delivery = await deliverProactiveMessage(input, { key, message, mode: input.mode });
  if (!delivery.ok) return { ok: false, mode: input.mode, sent: false, deliveryMode: delivery.mode, message: `没有发送成功：${delivery.message}` };

  if (input.commit) await input.store.markSent(key);
  return { ok: true, mode: input.mode, sent: true, key, message, deliveryMode: delivery.mode };
}

function formatWatchlistSection(state: ShortTermState | undefined, seedItems: SeedLiteItem[], today: string): string {
  const overview = buildStatusOverview({ state: { ...(state || {}), ...buildSeedLiteStatePatch(seedItems) }, seedItems, today });
  if (overview === "现在我这里没有挂起的待处理事项。") return "";
  return ["待处理工作台：", overview].join("\n");
}

async function runReminder(input: ProactiveBriefingInput): Promise<ProactiveBriefingResult> {
  void input;
  return {
    ok: true,
    mode: "reminder",
    sent: false,
    skippedReason: "no_events",
    message: "微信提醒由提醒队列 dispatcher 处理，旧主动提醒入口不发送。",
  };
}

async function deliverProactiveMessage(
  input: ProactiveBriefingInput,
  message: { key: string; message: string; mode: ProactiveMode },
) {
  if (!input.delivery) return { ok: true as const, mode: undefined, message: "delivery not configured" };
  return input.delivery.deliver(message);
}

async function readSentKeys(filePath: string): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as { sentKeys?: unknown };
    if (!Array.isArray(parsed.sentKeys)) return new Set();
    return new Set(parsed.sentKeys.filter((key): key is string => typeof key === "string" && key.trim().length > 0));
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return new Set();
    throw error;
  }
}

function parseCalendarStart(startText: string | undefined): number {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(startText || "");
  if (!match) return Number.POSITIVE_INFINITY;
  const [, year, month, day, hour, minute] = match;
  return Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`);
}

function sortEventsByStart(events: FeishuCalendarEvent[]): FeishuCalendarEvent[] {
  return [...events].sort((left, right) => parseCalendarStart(left.start) - parseCalendarStart(right.start));
}

function addDays(dateText: string, days: number): string {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
