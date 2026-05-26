// Seed Lite 极简待推进事项：只保存短标题和来源，不做长期记忆或自动排期。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type SeedLiteItem = {
  seedId: string;
  title: string;
  targetDate?: string;
  reminderAt?: string;
  status?: "shelved";
  pullbackCount?: number;
  lastPullbackAt?: string;
  createdAt?: string;
  sourceText?: string;
};

export type SeedLiteInput = {
  title: string;
  targetDate?: string;
  reminderAt?: string;
  createdAt?: string;
  sourceText?: string;
};

export type SeedLitePatch = {
  title?: string;
  targetDate?: string;
  reminderAt?: string;
  clearReminder?: boolean;
  status?: "active" | "shelved";
  pullbackCount?: number;
  lastPullbackAt?: string;
};

export type SeedLiteStore = {
  list(): Promise<SeedLiteItem[]>;
  add(input: SeedLiteInput): Promise<SeedLiteItem>;
  complete(seedIds: string[]): Promise<SeedLiteItem[]>;
  update(seedIds: string[], patch: SeedLitePatch): Promise<SeedLiteItem[]>;
};

// 创建内存 Seed store，供测试和无文件配置的本地链路使用。
export function createMemorySeedLiteStore(initialItems: SeedLiteItem[] = []): SeedLiteStore {
  let items = sanitizeSeedItems(initialItems);
  return {
    async list() {
      return structuredClone(items);
    },
    async add(input) {
      const item = createSeedLiteItem(input, items.length + 1);
      const existing = items.find((candidate) => candidate.title === item.title);
      if (existing) return structuredClone(existing);
      items = [...items, item].slice(-20);
      return structuredClone(item);
    },
    async complete(seedIds) {
      const completed = new Set(seedIds.map((seedId) => seedId.trim()).filter(Boolean));
      items = items.filter((item) => !completed.has(item.seedId));
      return structuredClone(items);
    },
    async update(seedIds, patch) {
      const targets = new Set(seedIds.map((seedId) => seedId.trim()).filter(Boolean));
      items = updateSeedLiteItems(items, targets, patch);
      return structuredClone(items);
    },
  };
}

// 创建文件 Seed store，供 Mac mini shadow server 和主动早晚报共享。
export function createFileSeedLiteStore(filePath: string): SeedLiteStore {
  return {
    async list() {
      return readSeedLiteItems(filePath);
    },
    async add(input) {
      const items = await readSeedLiteItems(filePath);
      const item = createSeedLiteItem(input, items.length + 1);
      const existing = items.find((candidate) => candidate.title === item.title);
      if (existing) return existing;
      const next = [...items, item].slice(-20);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify({ seedItems: next }, null, 2), "utf8");
      return item;
    },
    async complete(seedIds) {
      const completed = new Set(seedIds.map((seedId) => seedId.trim()).filter(Boolean));
      const next = (await readSeedLiteItems(filePath)).filter((item) => !completed.has(item.seedId));
      await writeSeedLiteItems(filePath, next);
      return next;
    },
    async update(seedIds, patch) {
      const targets = new Set(seedIds.map((seedId) => seedId.trim()).filter(Boolean));
      const next = updateSeedLiteItems(await readSeedLiteItems(filePath), targets, patch);
      await writeSeedLiteItems(filePath, next);
      return next;
    },
  };
}

// 按统一规则创建一条 Seed Lite 事项。
export function createSeedLiteItem(input: SeedLiteInput, index: number): SeedLiteItem {
  return {
    seedId: `seed_${index}`,
    title: input.title.trim(),
    ...(input.targetDate ? { targetDate: input.targetDate } : {}),
    ...(input.reminderAt ? { reminderAt: input.reminderAt } : {}),
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    ...(input.sourceText ? { sourceText: input.sourceText } : {}),
  };
}

// 生成早晚报里的待推进片段。
export function formatSeedLiteSection(items: SeedLiteItem[]): string {
  const sanitized = sanitizeSeedItems(items);
  if (sanitized.length === 0) return "";
  return ["待推进收件箱：", ...sanitized.map((item, index) => `${index + 1}. ${formatSeedLiteItem(item)}`)].join("\n");
}

async function readSeedLiteItems(filePath: string): Promise<SeedLiteItem[]> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as { seedItems?: unknown };
    return Array.isArray(parsed.seedItems) ? sanitizeSeedItems(parsed.seedItems) : [];
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return [];
    throw error;
  }
}

async function writeSeedLiteItems(filePath: string, items: SeedLiteItem[]) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({ seedItems: items }, null, 2), "utf8");
}

function updateSeedLiteItems(items: SeedLiteItem[], targets: Set<string>, patch: SeedLitePatch): SeedLiteItem[] {
  return items.map((item) => {
    if (!targets.has(item.seedId)) return item;
    const next = {
      ...item,
      ...(patch.title?.trim() ? { title: patch.title.trim() } : {}),
      ...(patch.targetDate ? { targetDate: patch.targetDate } : {}),
    };
    if (patch.clearReminder) delete next.reminderAt;
    if (!patch.clearReminder && patch.reminderAt) next.reminderAt = patch.reminderAt;
    if (patch.status === "shelved") next.status = "shelved";
    if (patch.status === "active") delete next.status;
    if (Number.isInteger(patch.pullbackCount) && Number(patch.pullbackCount) >= 0) next.pullbackCount = Number(patch.pullbackCount);
    if (isDateText(patch.lastPullbackAt)) next.lastPullbackAt = patch.lastPullbackAt;
    return next;
  });
}

function formatSeedLiteItem(item: SeedLiteItem): string {
  const meta = [item.targetDate, item.reminderAt ? `提醒：${item.reminderAt}` : ""].filter(Boolean);
  return meta.length > 0 ? `${item.title}（${meta.join("，")}）` : item.title;
}

function sanitizeSeedItems(value: unknown[]): SeedLiteItem[] {
  return value.map(normalizeSeedLiteItem).filter((item): item is SeedLiteItem => Boolean(item));
}

function normalizeSeedLiteItem(value: unknown): SeedLiteItem | null {
  if (!isRecord(value) || !isNonEmptyString(value.seedId) || !isNonEmptyString(value.title)) return null;
  return {
    seedId: value.seedId,
    title: value.title,
    ...(isNonEmptyString(value.targetDate) ? { targetDate: value.targetDate } : {}),
    ...(isNonEmptyString(value.reminderAt) ? { reminderAt: value.reminderAt } : {}),
    ...(value.status === "shelved" ? { status: "shelved" as const } : {}),
    ...(Number.isInteger(value.pullbackCount) && Number(value.pullbackCount) >= 0 ? { pullbackCount: Number(value.pullbackCount) } : {}),
    ...(isDateText(value.lastPullbackAt) ? { lastPullbackAt: value.lastPullbackAt } : {}),
    ...(isNonEmptyString(value.createdAt) ? { createdAt: value.createdAt } : {}),
    ...(isNonEmptyString(value.sourceText) ? { sourceText: value.sourceText } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isDateText(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const [yearText, monthText, dayText] = value.split("-");
  if (!yearText || !monthText || !dayText || yearText.length !== 4 || monthText.length !== 2 || dayText.length !== 2) return false;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
