// 微信提醒任务队列：只基于已知日程登记本地任务，不扫描飞书日历。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FeishuCalendarEvent } from "../calendar/feishu/types.js";
import { formatCalendarEventLine } from "../reply/event-format.js";
import type { ProactiveDelivery } from "../live/proactive-delivery.js";

export type WechatReminderJobStatus = "pending" | "sent" | "failed";

export type WechatReminderJob = {
  jobId: string;
  eventId: string;
  title: string;
  start: string;
  leadMinutes: number;
  leadSource?: "explicit" | "at_start";
  dueAt: string;
  status: WechatReminderJobStatus;
  lastError?: string;
  lastAttemptAt?: string;
};

export type WechatReminderStore = {
  list(): Promise<WechatReminderJob[]>;
  addMany(jobs: WechatReminderJob[]): Promise<void>;
  markSent(jobId: string): Promise<void>;
  markFailed(jobId: string, error: string, attemptedAt: string): Promise<void>;
};

export type DispatchWechatRemindersInput = {
  store: WechatReminderStore;
  delivery: ProactiveDelivery;
  now: string;
};

export type WechatReminderStatusSummary = {
  ok: boolean;
  total: number;
  pending: number;
  due: number;
  sent: number;
  failed: number;
  nextDueAt?: string;
  failedJobs: Array<{
    jobId: string;
    title: string;
    dueAt: string;
    lastError?: string;
    lastAttemptAt?: string;
  }>;
};

export const DEFAULT_WECHAT_REMINDER_LEAD_MINUTES = [40];

// 创建内存提醒任务队列，供测试和本地 smoke 使用。
export function createMemoryWechatReminderStore(initialJobs: WechatReminderJob[] = []): WechatReminderStore {
  let jobs = sanitizeJobs(initialJobs);
  return {
    async list() {
      return structuredClone(jobs);
    },
    async addMany(nextJobs) {
      jobs = mergeJobs(jobs, nextJobs);
    },
    async markSent(jobId) {
      jobs = jobs.map((job) => (job.jobId === jobId ? markJobSent(job) : job));
    },
    async markFailed(jobId, error, attemptedAt) {
      jobs = jobs.map((job) => (job.jobId === jobId ? markJobFailed(job, error, attemptedAt) : job));
    },
  };
}

// 创建文件提醒任务队列，供 Mac mini 真实入口和 dispatcher 共享。
export function createFileWechatReminderStore(filePath: string): WechatReminderStore {
  return {
    async list() {
      return readJobs(filePath);
    },
    async addMany(nextJobs) {
      const jobs = mergeJobs(await readJobs(filePath), nextJobs);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify({ jobs }, null, 2), "utf8");
    },
    async markSent(jobId) {
      const jobs = (await readJobs(filePath)).map((job) => (job.jobId === jobId ? markJobSent(job) : job));
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify({ jobs }, null, 2), "utf8");
    },
    async markFailed(jobId, error, attemptedAt) {
      const jobs = (await readJobs(filePath)).map((job) => (job.jobId === jobId ? markJobFailed(job, error, attemptedAt) : job));
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify({ jobs }, null, 2), "utf8");
    },
  };
}

// 根据已创建的日程和提前量创建微信提醒任务。
export function buildWechatReminderJobs(event: FeishuCalendarEvent, leadMinutes: number[], options: { leadSource?: "explicit" | "at_start" } = {}): WechatReminderJob[] {
  const leads = options.leadSource === "at_start" ? [0] : normalizeLeadMinutes(leadMinutes);
  const startAt = parseCalendarStart(event.start);
  if (!Number.isFinite(startAt)) return [];

  return leads.map((lead) => ({
    jobId: `wechat-reminder:${event.id}:${event.start}:${lead}`,
    eventId: event.id,
    title: event.title,
    start: event.start,
    leadMinutes: lead,
    ...formatLeadSource(lead, options.leadSource),
    dueAt: new Date(startAt - lead * 60_000).toISOString(),
    status: "pending",
  }));
}

// 归一化提醒提前量；默认只用 40 分钟，用户显式指定时才覆盖。
export function normalizeLeadMinutes(value: number | number[] | undefined, fallback: number[] = DEFAULT_WECHAT_REMINDER_LEAD_MINUTES): number[] {
  if (value === undefined) return normalizeLeadList(fallback);
  if (typeof value === "number") return value <= 0 ? [] : normalizeLeadList([value]);
  return normalizeLeadList(value);
}

// 发送所有到点且未发送的微信提醒；只有发送成功后才标记 sent。
export async function dispatchDueWechatReminders(input: DispatchWechatRemindersInput): Promise<{ ok: boolean; sent: number; failed: number }> {
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) return { ok: false, sent: 0, failed: 0 };

  const due = (await input.store.list()).filter((job) => job.status !== "sent" && Date.parse(job.dueAt) <= now);
  let sent = 0;
  let failed = 0;
  for (const job of due) {
    const result = await input.delivery.deliver({
      key: job.jobId,
      mode: "wechat-reminder",
      message: formatWechatReminderMessage(job),
    });
    if (result.ok) {
      await input.store.markSent(job.jobId);
      sent += 1;
    } else {
      await input.store.markFailed(job.jobId, result.message, input.now);
      failed += 1;
    }
  }

  return { ok: failed === 0, sent, failed };
}

// 汇总提醒队列状态，供 Mac mini 巡检和 runbook 使用。
export async function inspectWechatReminderStatus(input: { store: WechatReminderStore; now: string }): Promise<WechatReminderStatusSummary> {
  const now = Date.parse(input.now);
  const jobs = await input.store.list();
  const unsent = jobs.filter((job) => job.status !== "sent");
  const due = Number.isFinite(now) ? unsent.filter((job) => Date.parse(job.dueAt) <= now).length : 0;
  const nextDueAt = unsent
    .map((job) => job.dueAt)
    .filter((dueAt) => Number.isFinite(Date.parse(dueAt)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];

  return {
    ok: Number.isFinite(now),
    total: jobs.length,
    pending: jobs.filter((job) => job.status === "pending").length,
    due,
    sent: jobs.filter((job) => job.status === "sent").length,
    failed: jobs.filter((job) => job.status === "failed").length,
    ...(nextDueAt ? { nextDueAt } : {}),
    failedJobs: jobs
      .filter((job) => job.status === "failed")
      .map((job) => ({
        jobId: job.jobId,
        title: job.title,
        dueAt: job.dueAt,
        ...(job.lastError ? { lastError: job.lastError } : {}),
        ...(job.lastAttemptAt ? { lastAttemptAt: job.lastAttemptAt } : {}),
      })),
  };
}

export function formatWechatReminderMessage(job: WechatReminderJob): string {
  const eventLine = formatCalendarEventLine({ id: job.eventId, title: job.title, start: job.start }, 0).replace(/^0\. /, "");
  if (job.leadMinutes === 0) return `微信提醒｜到时间了\n${eventLine}`;
  return `微信提醒｜还有 ${job.leadMinutes} 分钟\n${eventLine}`;
}

async function readJobs(filePath: string): Promise<WechatReminderJob[]> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as { jobs?: unknown };
    return Array.isArray(parsed.jobs) ? sanitizeJobs(parsed.jobs) : [];
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return [];
    throw error;
  }
}

function mergeJobs(current: WechatReminderJob[], nextJobs: WechatReminderJob[]): WechatReminderJob[] {
  const byId = new Map(current.map((job) => [job.jobId, job]));
  for (const job of sanitizeJobs(nextJobs)) {
    if (!byId.has(job.jobId)) byId.set(job.jobId, job);
  }
  return [...byId.values()].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

function sanitizeJobs(value: unknown[]): WechatReminderJob[] {
  return value.map(normalizeJob).filter((job): job is WechatReminderJob => Boolean(job));
}

function normalizeJob(value: unknown): WechatReminderJob | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.jobId) || !isNonEmptyString(value.eventId) || !isNonEmptyString(value.title)) return null;
  if (!isNonEmptyString(value.start) || !isNonEmptyString(value.dueAt) || !isValidStoredLeadMinute(value.leadMinutes, value.leadSource)) return null;
  if (Number(value.leadMinutes) !== DEFAULT_WECHAT_REMINDER_LEAD_MINUTES[0] && value.leadSource !== "explicit" && value.leadSource !== "at_start") return null;
  return {
    jobId: value.jobId,
    eventId: value.eventId,
    title: value.title,
    start: value.start,
    leadMinutes: Number(value.leadMinutes),
    ...(value.leadSource === "explicit" || value.leadSource === "at_start" ? { leadSource: value.leadSource as "explicit" | "at_start" } : {}),
    dueAt: value.dueAt,
    status: value.status === "sent" || value.status === "failed" ? value.status : "pending",
    ...(isNonEmptyString(value.lastError) ? { lastError: value.lastError } : {}),
    ...(isNonEmptyString(value.lastAttemptAt) ? { lastAttemptAt: value.lastAttemptAt } : {}),
  };
}

function normalizeLeadList(values: number[]): number[] {
  return [...new Set(values.filter(isValidLeadMinute))].sort((a, b) => b - a).slice(0, 3);
}

function isValidLeadMinute(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 24 * 60;
}

function isValidStoredLeadMinute(value: unknown, leadSource: unknown): value is number {
  if (Number(value) === 0 && leadSource === "at_start") return true;
  return isValidLeadMinute(value);
}

function formatLeadSource(lead: number, leadSource: "explicit" | "at_start" | undefined): { leadSource?: "explicit" | "at_start" } {
  if (leadSource === "at_start") return { leadSource: "at_start" };
  if (leadSource === "explicit" && lead !== DEFAULT_WECHAT_REMINDER_LEAD_MINUTES[0]) return { leadSource: "explicit" };
  return {};
}

function markJobSent(job: WechatReminderJob): WechatReminderJob {
  const { lastError, lastAttemptAt, ...rest } = job;
  void lastError;
  void lastAttemptAt;
  return { ...rest, status: "sent" };
}

function markJobFailed(job: WechatReminderJob, error: string, attemptedAt: string): WechatReminderJob {
  return {
    ...job,
    status: "failed",
    lastError: error || "微信发送失败",
    lastAttemptAt: attemptedAt,
  };
}

function parseCalendarStart(startText: string | undefined): number {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(startText || "");
  if (!match) return Number.POSITIVE_INFINITY;
  const [, year, month, day, hour, minute] = match;
  return Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
