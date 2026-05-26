// 每日记忆整理：只处理日程助手自身记录，生成本地只读长期记忆。

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { SeedLiteStore } from "../seed-lite/index.js";

export type MemoryDreamEntryKind =
  | "pending_note"
  | "interaction_history"
  | "preference_candidate"
  | "correction_signal"
  | "recurring_pattern"
  | "schedule_candidate";
export type MemoryDreamEntryStatus = "candidate" | "stable" | "stale" | "rejected";
export type MemoryDreamPreferredWindow = "morning" | "afternoon" | "evening" | "later";

export type MemoryDreamEntryMetadata = {
  targetDate?: string;
  preferredStartTime?: string;
  preferredStartTimes?: string[];
  preferredReminderMinutes?: number[];
  preferredWindows?: MemoryDreamPreferredWindow[];
  durationMinutes?: number;
  reasonCodes?: string[];
};

export type MemoryDreamObservation = {
  id?: string;
  observedAt: string;
  requestId: string;
  messageId?: string;
  sourceText?: string;
  mediaType?: string;
  actionType: string;
  ok: boolean;
  reply: string;
  createdEvents?: MemoryDreamCreatedEvent[];
  scheduleFeedback?: MemoryDreamScheduleFeedback;
};

export type MemoryDreamCreatedEvent = {
  title: string;
  date: string;
  startTime: string;
};

export type MemoryDreamScheduleFeedback = {
  kind: "schedule_time_changed" | "schedule_option_selected" | "schedule_reminder_changed" | "schedule_canceled";
  targetDate?: string;
  preferredStartTimes?: string[];
  preferredReminderMinutes?: number[];
  preferredWindows?: MemoryDreamPreferredWindow[];
  reasonCodes?: string[];
};

export type StoredMemoryDreamObservation = Required<Pick<MemoryDreamObservation, "id">> &
  Omit<MemoryDreamObservation, "id">;

export type MemoryDreamEntry = {
  id: string;
  kind: MemoryDreamEntryKind;
  summary: string;
  sourceIds: string[];
  metadata?: MemoryDreamEntryMetadata;
  confidence: number;
  status: MemoryDreamEntryStatus;
  reinforcementCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
};

export type MemoryDreamRun = {
  runId: string;
  ranAt: string;
  since: string;
  observationCount: number;
  entryCount: number;
};

export type MemoryDreamSnapshot = {
  observations: StoredMemoryDreamObservation[];
  entries: MemoryDreamEntry[];
  dreamRuns: MemoryDreamRun[];
};

export type MemoryDreamStore = {
  load(): Promise<MemoryDreamSnapshot>;
  save(snapshot: MemoryDreamSnapshot): Promise<void>;
  addObservation(observation: MemoryDreamObservation): Promise<StoredMemoryDreamObservation>;
};

export type MemoryDreamConsolidationInput = {
  store: MemoryDreamStore;
  seedStore?: SeedLiteStore;
  now?: string;
  since?: string;
};

export type MemoryDreamConsolidationResult = {
  ok: true;
  now: string;
  since: string;
  observationCount: number;
  entries: MemoryDreamEntry[];
};

// 创建内存 store，供单元测试和本地 dry-run 使用。
export function createMemoryMemoryDreamStore(initialSnapshot?: Partial<MemoryDreamSnapshot>): MemoryDreamStore {
  let snapshot = normalizeSnapshot(initialSnapshot || {});
  return {
    async load() {
      return cloneSnapshot(snapshot);
    },
    async save(nextSnapshot) {
      snapshot = normalizeSnapshot(nextSnapshot);
    },
    async addObservation(observation) {
      const stored = normalizeObservation(observation);
      snapshot = normalizeSnapshot({
        ...snapshot,
        observations: [...snapshot.observations, stored].slice(-500),
      });
      return structuredClone(stored);
    },
  };
}

// 创建文件 store，供 shadow server 和每日定时任务共享。
export function createFileMemoryDreamStore(filePath: string): MemoryDreamStore {
  return {
    async load() {
      return readSnapshot(filePath);
    },
    async save(snapshot) {
      await withFileLock(filePath, async () => {
        await writeSnapshot(filePath, snapshot);
      });
    },
    async addObservation(observation) {
      return withFileLock(filePath, async () => {
        const snapshot = await readSnapshot(filePath);
        const stored = normalizeObservation(observation);
        const next = normalizeSnapshot({
          ...snapshot,
          observations: [...snapshot.observations, stored].slice(-500),
        });
        await writeSnapshot(filePath, next);
        return stored;
      });
    },
  };
}

// 运行一次“做梦”整理；只生成本地记忆条目，不写日历、不发消息。
export async function consolidateMemoryDream(
  input: MemoryDreamConsolidationInput,
): Promise<MemoryDreamConsolidationResult> {
  const now = input.now || new Date().toISOString();
  const since = input.since || hoursBefore(now, 24);
  const snapshot = await input.store.load();
  const recentObservations = snapshot.observations.filter((observation) => isWithinWindow(observation.observedAt, since, now));
  const seedItems = input.seedStore ? await input.seedStore.list() : [];

  const candidates = [
    ...buildInteractionEntries(recentObservations, now),
    ...buildReflectionEntries(recentObservations, now),
    ...seedItems.map((item) => createEntry({
      kind: "pending_note",
      summary: `待推进：${item.title}`,
      sourceIds: [item.seedId],
      confidence: 0.9,
      status: "candidate",
      reinforcementCount: 1,
      firstSeenAt: item.createdAt || now,
      lastSeenAt: now,
      updatedAt: now,
    })),
    ...seedItems.map((item) => createEntry({
      kind: "schedule_candidate",
      summary: `排程候选：${item.title}`,
      sourceIds: [item.seedId],
      metadata: buildSeedScheduleMetadata(item),
      confidence: 0.72,
      status: "candidate",
      reinforcementCount: 1,
      firstSeenAt: item.createdAt || now,
      lastSeenAt: now,
      updatedAt: now,
    })),
  ];

  const entries = mergeEntries(snapshot.entries, candidates, now);
  const run: MemoryDreamRun = {
    runId: `dream_${compactTimestamp(now)}`,
    ranAt: now,
    since,
    observationCount: recentObservations.length,
    entryCount: entries.length,
  };

  await input.store.save({
    observations: snapshot.observations,
    entries,
    dreamRuns: [...snapshot.dreamRuns, run].slice(-30),
  });

  return { ok: true, now, since, observationCount: recentObservations.length, entries };
}

// 生成 CLI 汇报，保持定时日志短而可读。
export function formatMemoryDreamReport(result: MemoryDreamConsolidationResult): string {
  return [
    "Memory dream: passed",
    `Since: ${result.since}`,
    `Now: ${result.now}`,
    `Observations: ${result.observationCount}`,
    `Entries: ${result.entries.length}`,
  ].join("\n");
}

function buildInteractionEntries(observations: StoredMemoryDreamObservation[], now: string): MemoryDreamEntry[] {
  const groups = new Map<string, StoredMemoryDreamObservation[]>();
  for (const observation of observations) {
    if (!observation.ok) continue;
    if (!isUsefulActionType(observation.actionType)) continue;
    groups.set(observation.actionType, [...(groups.get(observation.actionType) || []), observation]);
  }

  return [...groups.entries()].map(([actionType, items]) => {
    const firstSeenAt = items.map((item) => item.observedAt).sort()[0] || now;
    const lastSeenAt = items.map((item) => item.observedAt).sort().at(-1) || now;
    return createEntry({
      kind: "interaction_history",
      summary: `最近成功处理：${actionType}`,
      sourceIds: items.map((item) => item.id),
      confidence: 0.75,
      status: items.length >= 2 ? "stable" : "candidate",
      reinforcementCount: items.length,
      firstSeenAt,
      lastSeenAt,
      updatedAt: now,
    });
  });
}

function buildReflectionEntries(observations: StoredMemoryDreamObservation[], now: string): MemoryDreamEntry[] {
  const successful = observations.filter((observation) => observation.ok && isUsefulActionType(observation.actionType));
  return [
    ...buildRecurringPatternEntries(successful, now),
    ...buildCorrectionSignalEntries(successful, now),
    ...buildSchedulePreferenceEntries(successful, now),
  ];
}

function buildRecurringPatternEntries(observations: StoredMemoryDreamObservation[], now: string): MemoryDreamEntry[] {
  const groups = new Map<string, StoredMemoryDreamObservation[]>();
  for (const observation of observations) {
    groups.set(observation.actionType, [...(groups.get(observation.actionType) || []), observation]);
  }

  return [...groups.entries()].flatMap(([actionType, items]) => {
    if (items.length < 2) return [];
    return [
      createEntry({
        kind: "recurring_pattern",
        summary: `重复模式：近期多次成功处理 ${actionType}`,
        sourceIds: items.map((item) => item.id),
        confidence: 0.8,
        status: "stable",
        reinforcementCount: items.length,
        firstSeenAt: items.map((item) => item.observedAt).sort()[0] || now,
        lastSeenAt: items.map((item) => item.observedAt).sort().at(-1) || now,
        updatedAt: now,
      }),
    ];
  });
}

function buildCorrectionSignalEntries(observations: StoredMemoryDreamObservation[], now: string): MemoryDreamEntry[] {
  const items = observations.filter((observation) => observation.actionType === "update_event");
  const scheduleItems = observations.filter((observation) => observation.scheduleFeedback);
  const entries: MemoryDreamEntry[] = [];

  if (items.length > 0) {
    entries.push(createEntry({
      kind: "correction_signal",
      summary: "纠错信号：用户近期修改过已锁定日程",
      sourceIds: items.map((item) => item.id),
      confidence: 0.65,
      status: items.length >= 2 ? "stable" : "candidate",
      reinforcementCount: items.length,
      firstSeenAt: items.map((item) => item.observedAt).sort()[0] || now,
      lastSeenAt: items.map((item) => item.observedAt).sort().at(-1) || now,
      updatedAt: now,
    }));
  }

  if (scheduleItems.length > 0) {
    entries.push(createEntry({
      kind: "correction_signal",
      summary: "纠错信号：用户调整过排程推荐",
      sourceIds: scheduleItems.map((item) => item.id),
      metadata: scheduleFeedbackMetadata(scheduleItems),
      confidence: 0.68,
      status: scheduleItems.length >= 2 ? "stable" : "candidate",
      reinforcementCount: scheduleItems.length,
      firstSeenAt: scheduleItems.map((item) => item.observedAt).sort()[0] || now,
      lastSeenAt: scheduleItems.map((item) => item.observedAt).sort().at(-1) || now,
      updatedAt: now,
    }));
  }

  return entries;
}

function scheduleFeedbackMetadata(observations: StoredMemoryDreamObservation[]): MemoryDreamEntryMetadata | undefined {
  const targetDates = uniqueStrings(observations.map((item) => item.scheduleFeedback?.targetDate).filter((date): date is string => Boolean(date)));
  return normalizeEntryMetadata({
    ...(targetDates.length === 1 ? { targetDate: targetDates[0] } : {}),
    preferredStartTimes: uniqueStrings(observations.flatMap((item) => item.scheduleFeedback?.preferredStartTimes || [])),
    preferredReminderMinutes: uniqueNumbers(observations.flatMap((item) => item.scheduleFeedback?.preferredReminderMinutes || [])),
    preferredWindows: uniqueWindows(observations.flatMap((item) => item.scheduleFeedback?.preferredWindows || [])),
    reasonCodes: uniqueReasonCodes(observations.flatMap((item) => item.scheduleFeedback?.reasonCodes || [])),
  });
}

function buildSchedulePreferenceEntries(observations: StoredMemoryDreamObservation[], now: string): MemoryDreamEntry[] {
  const groups = new Map<string, StoredMemoryDreamObservation[]>();
  for (const observation of observations) {
    if (observation.actionType !== "create_event" && observation.actionType !== "create_events") continue;
    for (const startTime of readObservationStartTimes(observation)) {
      groups.set(startTime, [...(groups.get(startTime) || []), observation]);
    }
  }

  return [...groups.entries()].flatMap(([startTime, items]) => {
    if (items.length < 2) return [];
    return [
      createEntry({
        kind: "preference_candidate",
        summary: `排程偏好：优先安排在 ${startTime}`,
        sourceIds: items.map((item) => item.id),
        confidence: 0.7,
        status: "stable",
        reinforcementCount: items.length,
        firstSeenAt: items.map((item) => item.observedAt).sort()[0] || now,
        lastSeenAt: items.map((item) => item.observedAt).sort().at(-1) || now,
        updatedAt: now,
      }),
    ];
  });
}

function mergeEntries(existing: MemoryDreamEntry[], candidates: MemoryDreamEntry[], now: string): MemoryDreamEntry[] {
  const byId = new Map(existing.map((entry) => [entry.id, markStaleIfUnused(entry, now)]));
  for (const candidate of candidates) {
    const current = byId.get(candidate.id);
    if (!current) {
      byId.set(candidate.id, candidate);
      continue;
    }
    const reinforcementCount = Math.max(current.reinforcementCount, 0) + Math.max(candidate.reinforcementCount, 1);
    byId.set(candidate.id, {
      ...current,
      sourceIds: uniqueStrings([...current.sourceIds, ...candidate.sourceIds]),
      metadata: mergeEntryMetadata(current.metadata, candidate.metadata),
      confidence: Math.max(current.confidence, candidate.confidence),
      status: mergeEntryStatus(current.status, candidate.status, reinforcementCount),
      reinforcementCount,
      firstSeenAt: minDateText(current.firstSeenAt, candidate.firstSeenAt),
      lastSeenAt: maxDateText(current.lastSeenAt, candidate.lastSeenAt),
      updatedAt: now,
    });
  }
  return [...byId.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.summary.localeCompare(b.summary));
}

function createEntry(input: Omit<MemoryDreamEntry, "id">): MemoryDreamEntry {
  const { metadata: rawMetadata, ...entry } = input;
  const metadata = normalizeEntryMetadata(rawMetadata);
  return {
    id: `mem_${entry.kind}_${stableHash(entry.summary)}`,
    ...entry,
    sourceIds: uniqueStrings(entry.sourceIds),
    ...(metadata ? { metadata } : {}),
  };
}

function markStaleIfUnused(entry: MemoryDreamEntry, now: string): MemoryDreamEntry {
  if (entry.status === "rejected") return entry;
  const lastSeen = Date.parse(entry.lastSeenAt);
  const current = Date.parse(now);
  if (!Number.isFinite(lastSeen) || !Number.isFinite(current)) return entry;
  const daysSinceLastSeen = (current - lastSeen) / (24 * 60 * 60 * 1000);
  if (daysSinceLastSeen < 30) return entry;
  return { ...entry, status: "stale", updatedAt: now };
}

function mergeEntryStatus(
  currentStatus: MemoryDreamEntryStatus,
  candidateStatus: MemoryDreamEntryStatus,
  reinforcementCount: number,
): MemoryDreamEntryStatus {
  if (currentStatus === "rejected") return "rejected";
  if (candidateStatus === "stable" || reinforcementCount >= 2) return "stable";
  return candidateStatus === "stale" ? "candidate" : candidateStatus;
}

async function readSnapshot(filePath: string): Promise<MemoryDreamSnapshot> {
  try {
    return normalizeSnapshot(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return emptySnapshot();
    throw error;
  }
}

async function writeSnapshot(filePath: string, snapshot: MemoryDreamSnapshot) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(tempPath, JSON.stringify(normalizeSnapshot(snapshot), null, 2), "utf8");
  await rename(tempPath, filePath);
}

async function withFileLock<T>(filePath: string, action: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.lock`;
  await mkdir(dirname(filePath), { recursive: true });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await mkdir(lockPath, { recursive: false });
      try {
        return await action();
      } finally {
        await rm(lockPath, { recursive: true, force: true });
      }
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code !== "EEXIST") throw error;
      await sleep(20);
    }
  }
  throw new Error("memory dream file lock timeout");
}

function normalizeSnapshot(value: Partial<MemoryDreamSnapshot> | unknown): MemoryDreamSnapshot {
  if (!isRecord(value)) return emptySnapshot();
  return {
    observations: Array.isArray(value.observations)
      ? value.observations.map(normalizeObservation).filter(Boolean)
      : [],
    entries: Array.isArray(value.entries) ? value.entries.map(normalizeEntry).filter((entry): entry is MemoryDreamEntry => Boolean(entry)) : [],
    dreamRuns: Array.isArray(value.dreamRuns) ? value.dreamRuns.map(normalizeRun).filter((run): run is MemoryDreamRun => Boolean(run)) : [],
  };
}

function normalizeObservation(value: MemoryDreamObservation | unknown): StoredMemoryDreamObservation {
  const record = isRecord(value) ? value : {};
  const observedAt = readString(record.observedAt) || new Date().toISOString();
  const requestId = readString(record.requestId) || `req_${stableHash(JSON.stringify(record))}`;
  const sourceText = readString(record.sourceText);
  const reply = readString(record.reply) || "";
  const scheduleFeedback = readScheduleFeedback(record.scheduleFeedback);
  return {
    id: readString(record.id) || `obs_${compactTimestamp(observedAt)}_${stableHash(`${requestId}:${sourceText || reply}`)}`,
    observedAt,
    requestId,
    ...(readString(record.messageId) ? { messageId: readString(record.messageId) } : {}),
    ...(sourceText ? { sourceText: limitText(sourceText, 1000) } : {}),
    ...(readString(record.mediaType) ? { mediaType: readString(record.mediaType) } : {}),
    actionType: readString(record.actionType) || "unknown",
    ok: Boolean(record.ok),
    reply: limitText(reply, 1000),
    ...(readCreatedEvents(record.createdEvents).length > 0 ? { createdEvents: readCreatedEvents(record.createdEvents) } : {}),
    ...(scheduleFeedback ? { scheduleFeedback } : {}),
  };
}

function readScheduleFeedback(value: unknown): MemoryDreamScheduleFeedback | undefined {
  if (!isRecord(value)) return undefined;
  const kind = readScheduleFeedbackKind(value.kind);
  if (!kind) return undefined;
  const targetDate = readString(value.targetDate);
  const preferredStartTimes = Array.isArray(value.preferredStartTimes)
    ? value.preferredStartTimes.filter((item): item is string => typeof item === "string" && isValidTimeText(item))
    : [];
  const preferredWindows = Array.isArray(value.preferredWindows)
    ? value.preferredWindows.map(readPreferredWindow).filter((item): item is MemoryDreamPreferredWindow => Boolean(item))
    : [];
  const preferredReminderMinutes = Array.isArray(value.preferredReminderMinutes)
    ? value.preferredReminderMinutes.filter(isValidReminderMinutes)
    : [];
  const reasonCodes = Array.isArray(value.reasonCodes)
    ? uniqueReasonCodes(value.reasonCodes.filter((item): item is string => typeof item === "string"))
    : [];
  return {
    kind,
    ...(isValidDateText(targetDate) ? { targetDate } : {}),
    ...(preferredStartTimes.length > 0 ? { preferredStartTimes: uniqueStrings(preferredStartTimes) } : {}),
    ...(preferredReminderMinutes.length > 0 ? { preferredReminderMinutes: uniqueNumbers(preferredReminderMinutes) } : {}),
    ...(preferredWindows.length > 0 ? { preferredWindows: uniqueWindows(preferredWindows) } : {}),
    ...(reasonCodes.length > 0 ? { reasonCodes } : {}),
  };
}

function readScheduleFeedbackKind(value: unknown): MemoryDreamScheduleFeedback["kind"] | undefined {
  if (value === "schedule_time_changed" || value === "schedule_option_selected" || value === "schedule_reminder_changed" || value === "schedule_canceled") return value;
  return undefined;
}

function normalizeEntry(value: unknown): MemoryDreamEntry | null {
  if (!isRecord(value)) return null;
  const kind = readEntryKind(value.kind);
  const summary = readString(value.summary);
  const metadata = normalizeEntryMetadata(value.metadata);
  if (!kind || !summary) return null;
  return {
    id: readString(value.id) || `mem_${kind}_${stableHash(summary)}`,
    kind,
    summary,
    sourceIds: Array.isArray(value.sourceIds) ? uniqueStrings(value.sourceIds.filter((item): item is string => typeof item === "string")) : [],
    ...(metadata ? { metadata } : {}),
    confidence: readNumber(value.confidence) ?? 0.5,
    status: readEntryStatus(value.status) || "candidate",
    reinforcementCount: readNumber(value.reinforcementCount) ?? 1,
    firstSeenAt: readString(value.firstSeenAt) || new Date().toISOString(),
    lastSeenAt: readString(value.lastSeenAt) || new Date().toISOString(),
    updatedAt: readString(value.updatedAt) || new Date().toISOString(),
  };
}

function normalizeRun(value: unknown): MemoryDreamRun | null {
  if (!isRecord(value)) return null;
  const runId = readString(value.runId);
  const ranAt = readString(value.ranAt);
  const since = readString(value.since);
  if (!runId || !ranAt || !since) return null;
  return {
    runId,
    ranAt,
    since,
    observationCount: readNumber(value.observationCount) ?? 0,
    entryCount: readNumber(value.entryCount) ?? 0,
  };
}

function emptySnapshot(): MemoryDreamSnapshot {
  return { observations: [], entries: [], dreamRuns: [] };
}

function cloneSnapshot(snapshot: MemoryDreamSnapshot): MemoryDreamSnapshot {
  return structuredClone(snapshot);
}

function isUsefulActionType(actionType: string): boolean {
  return ["create_event", "create_events", "update_event", "confirm_delete", "daily_briefing", "seed_lite", "create_conflict"].includes(actionType);
}

function readEntryKind(value: unknown): MemoryDreamEntryKind | undefined {
  if (
    value === "pending_note" ||
    value === "interaction_history" ||
    value === "preference_candidate" ||
    value === "correction_signal" ||
    value === "recurring_pattern" ||
    value === "schedule_candidate"
  ) {
    return value;
  }
  return undefined;
}

function readEntryStatus(value: unknown): MemoryDreamEntryStatus | undefined {
  if (value === "candidate" || value === "stable" || value === "stale" || value === "rejected") return value;
  return undefined;
}

function buildSeedScheduleMetadata(item: { targetDate?: string; reminderAt?: string }): MemoryDreamEntryMetadata | undefined {
  const reminder = readReminderDateTime(item.reminderAt);
  const targetDate = isValidDateText(item.targetDate) ? item.targetDate : reminder?.date;
  const preferredStartTime = reminder?.time;
  const reasonCodes = [
    targetDate && (item.targetDate === targetDate ? "seed_target_date" : "seed_reminder_date"),
    preferredStartTime ? "seed_reminder_time" : undefined,
  ].filter((code): code is string => Boolean(code));

  return normalizeEntryMetadata({
    ...(targetDate ? { targetDate } : {}),
    ...(preferredStartTime ? { preferredStartTime, preferredStartTimes: [preferredStartTime] } : {}),
    ...(reasonCodes.length > 0 ? { reasonCodes } : {}),
  });
}

function mergeEntryMetadata(
  current: MemoryDreamEntryMetadata | undefined,
  candidate: MemoryDreamEntryMetadata | undefined,
): MemoryDreamEntryMetadata | undefined {
  const normalizedCurrent = normalizeEntryMetadata(current);
  const normalizedCandidate = normalizeEntryMetadata(candidate);
  if (!normalizedCurrent) return normalizedCandidate;
  if (!normalizedCandidate) return normalizedCurrent;
  return normalizeEntryMetadata({
    ...normalizedCurrent,
    ...normalizedCandidate,
    preferredStartTimes: uniqueStrings([
      ...(normalizedCandidate.preferredStartTimes || []),
      ...(normalizedCurrent.preferredStartTimes || []),
    ]),
    preferredWindows: uniqueWindows([
      ...(normalizedCandidate.preferredWindows || []),
      ...(normalizedCurrent.preferredWindows || []),
    ]),
    preferredReminderMinutes: uniqueNumbers([
      ...(normalizedCandidate.preferredReminderMinutes || []),
      ...(normalizedCurrent.preferredReminderMinutes || []),
    ]),
    reasonCodes: uniqueReasonCodes([...(normalizedCurrent.reasonCodes || []), ...(normalizedCandidate.reasonCodes || [])]),
  });
}

function normalizeEntryMetadata(value: unknown): MemoryDreamEntryMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const targetDate = readString(value.targetDate);
  const preferredStartTime = readString(value.preferredStartTime);
  const preferredStartTimes = Array.isArray(value.preferredStartTimes)
    ? value.preferredStartTimes.filter((item): item is string => typeof item === "string" && isValidTimeText(item))
    : [];
  const preferredWindows = Array.isArray(value.preferredWindows) ? value.preferredWindows.map(readPreferredWindow).filter((item): item is MemoryDreamPreferredWindow => Boolean(item)) : [];
  const preferredReminderMinutes = Array.isArray(value.preferredReminderMinutes)
    ? value.preferredReminderMinutes.filter(isValidReminderMinutes)
    : [];
  const durationMinutes = readNumber(value.durationMinutes);
  const reasonCodes = Array.isArray(value.reasonCodes)
    ? uniqueReasonCodes(value.reasonCodes.filter((item): item is string => typeof item === "string"))
    : [];
  const normalizedStartTimes = uniqueStrings([
    ...(isValidTimeText(preferredStartTime) ? [preferredStartTime] : []),
    ...preferredStartTimes,
  ]);
  const normalized: MemoryDreamEntryMetadata = {
    ...(isValidDateText(targetDate) ? { targetDate } : {}),
    ...(normalizedStartTimes[0] ? { preferredStartTime: normalizedStartTimes[0], preferredStartTimes: normalizedStartTimes } : {}),
    ...(preferredReminderMinutes.length > 0 ? { preferredReminderMinutes: uniqueNumbers(preferredReminderMinutes) } : {}),
    ...(preferredWindows.length > 0 ? { preferredWindows: uniqueWindows(preferredWindows) } : {}),
    ...(isValidDurationMinutes(durationMinutes) ? { durationMinutes } : {}),
    ...(reasonCodes.length > 0 ? { reasonCodes } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function readReminderDateTime(value: string | undefined): { date: string; time: string } | undefined {
  const normalized = value?.trim().replace("T", " ");
  if (!normalized) return undefined;
  const [date, timeWithZone] = normalized.split(" ");
  const time = timeWithZone?.slice(0, 5);
  if (!isValidDateText(date) || !isValidTimeText(time)) return undefined;
  return { date, time };
}

function readPreferredWindow(value: unknown): MemoryDreamPreferredWindow | undefined {
  if (value === "morning" || value === "afternoon" || value === "evening" || value === "later") return value;
  return undefined;
}

function uniqueWindows(values: MemoryDreamPreferredWindow[]): MemoryDreamPreferredWindow[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function uniqueReasonCodes(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

function isWithinWindow(value: string, since: string, now: string): boolean {
  const time = Date.parse(value);
  const start = Date.parse(since);
  const end = Date.parse(now);
  return Number.isFinite(time) && Number.isFinite(start) && Number.isFinite(end) && time >= start && time <= end;
}

function hoursBefore(now: string, hours: number): string {
  const time = Date.parse(now);
  const base = Number.isFinite(time) ? time : Date.now();
  return new Date(base - hours * 60 * 60 * 1000).toISOString();
}

function compactTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || String(Date.now());
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 33) ^ value.charCodeAt(index);
  return (hash >>> 0).toString(36);
}

function limitText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function readReplyStartTime(reply: string): string | null {
  const match = /(?:^|\D)(\d{2}):(\d{2})(?=$|\D)/.exec(reply);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${match[1]}:${match[2]}`;
}

function readObservationStartTimes(observation: StoredMemoryDreamObservation): string[] {
  const structured = (observation.createdEvents || []).map((event) => event.startTime).filter(isValidTimeText);
  if (structured.length > 0) return [...new Set(structured)];

  const fallback = readReplyStartTime(observation.reply);
  return fallback ? [fallback] : [];
}

function readCreatedEvents(value: unknown): MemoryDreamCreatedEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const title = readString(item.title);
      const date = readString(item.date);
      const startTime = readString(item.startTime);
      if (!title || !date || !isValidTimeText(startTime)) return null;
      return { title: limitText(title, 200), date, startTime };
    })
    .filter((item): item is MemoryDreamCreatedEvent => Boolean(item));
}

function isValidTimeText(value: string | undefined): value is string {
  if (!value) return false;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function isValidDateText(value: string | undefined): value is string {
  if (!value) return false;
  const [yearText, monthText, dayText] = value.split("-");
  if (!yearText || !monthText || !dayText || yearText.length !== 4 || monthText.length !== 2 || dayText.length !== 2) return false;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidDurationMinutes(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 15 && value <= 240;
}

function isValidReminderMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1440;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}

function uniqueNumbers(values: number[]): number[] {
  const positives = [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => b - a).slice(0, 3);
  if (positives.length > 0) return positives;
  return values.some((value) => value === 0) ? [0] : [];
}

function minDateText(a: string, b: string): string {
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function maxDateText(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
