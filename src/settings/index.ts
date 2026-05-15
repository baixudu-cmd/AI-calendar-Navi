// 应用设置层：读取非密钥 JSON 设置；密钥仍只允许放在 .env 或系统环境变量里。

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { EnvSource } from "../config/index.js";

export type AppSettings = {
  timezone: string;
  reminders: {
    wechatLeadMinutes: number[];
    proactiveLeadMinutes: number;
  };
  stateFiles: {
    seedLite: string;
    memoryDream: string;
    wechatReminder: string;
  };
  briefing: {
    morningEnabled: boolean;
    eveningEnabled: boolean;
  };
  scheduling: {
    defaultOptionCount: number;
    defaultDurationMinutes: number;
  };
  features: {
    memoryDream: boolean;
    imageDraft: boolean;
  };
  sourcePath?: string;
};

export type LoadAppSettingsOptions = {
  cwd?: string;
  env?: EnvSource;
};

type JsonRecord = Record<string, unknown>;

const DEFAULT_SETTINGS: AppSettings = {
  timezone: "Asia/Shanghai",
  reminders: {
    wechatLeadMinutes: [40],
    proactiveLeadMinutes: 40,
  },
  stateFiles: {
    seedLite: "state/seed-lite.json",
    memoryDream: "state/memory-dream.json",
    wechatReminder: "state/wechat-reminders.json",
  },
  briefing: {
    morningEnabled: true,
    eveningEnabled: true,
  },
  scheduling: {
    defaultOptionCount: 3,
    defaultDurationMinutes: 60,
  },
  features: {
    memoryDream: true,
    imageDraft: false,
  },
};

const SECRET_SETTING_KEYS = new Set([
  "MODEL_API_KEY",
  "FEISHU_APP_SECRET",
  "WECHAT_ENTRY_SECRET",
  "FEISHU_DEFAULT_ATTENDEE_OPEN_ID",
]);

// 读取 JSON 设置。优先 NAVI_SETTINGS_FILE，其次 config/settings.local.json，最后 settings.example.json。
export function loadAppSettings(options: LoadAppSettingsOptions = {}): AppSettings {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const sourcePath = resolveSettingsPath(cwd, env);
  const raw = sourcePath ? readSettingsFile(sourcePath) : {};
  assertNoSecretKeys(raw);

  return {
    ...DEFAULT_SETTINGS,
    timezone: nonEmptyString(raw.timezone) || DEFAULT_SETTINGS.timezone,
    reminders: normalizeReminderSettings(raw.reminders),
    stateFiles: normalizeStateFiles(raw.stateFiles),
    briefing: normalizeBriefing(raw.briefing),
    scheduling: normalizeScheduling(raw.scheduling),
    features: normalizeFeatures(raw.features),
    ...(sourcePath ? { sourcePath } : {}),
  };
}

// 定位当前设置文件，避免调用方自己猜路径。
export function resolveSettingsPath(cwd: string, env: EnvSource = process.env): string | undefined {
  const configuredPath = nonEmptyString(env.NAVI_SETTINGS_FILE);
  if (configuredPath) return resolveMaybeRelative(cwd, configuredPath);

  const localPath = resolve(cwd, "config/settings.local.json");
  if (existsSync(localPath)) return localPath;

  const examplePath = resolve(cwd, "config/settings.example.json");
  if (existsSync(examplePath)) return examplePath;

  return undefined;
}

// 解析设置文件，失败时用清晰错误阻断启动。
function readSettingsFile(path: string): JsonRecord {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(parsed)) throw new Error("设置文件根节点必须是对象。");
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读取设置文件失败：${path}；${message}`);
  }
}

// JSON 设置只允许非密钥产品默认值。
function assertNoSecretKeys(value: unknown, path = ""): void {
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (SECRET_SETTING_KEYS.has(key)) {
      throw new Error(`设置文件不能包含密钥字段：${currentPath}`);
    }
    assertNoSecretKeys(child, currentPath);
  }
}

function normalizeReminderSettings(value: unknown): AppSettings["reminders"] {
  const record = isRecord(value) ? value : {};
  return {
    wechatLeadMinutes: normalizeLeadMinutes(record.wechatLeadMinutes, DEFAULT_SETTINGS.reminders.wechatLeadMinutes),
    proactiveLeadMinutes: positiveInteger(record.proactiveLeadMinutes) || DEFAULT_SETTINGS.reminders.proactiveLeadMinutes,
  };
}

function normalizeStateFiles(value: unknown): AppSettings["stateFiles"] {
  const record = isRecord(value) ? value : {};
  return {
    seedLite: nonEmptyString(record.seedLite) || DEFAULT_SETTINGS.stateFiles.seedLite,
    memoryDream: nonEmptyString(record.memoryDream) || DEFAULT_SETTINGS.stateFiles.memoryDream,
    wechatReminder: nonEmptyString(record.wechatReminder) || DEFAULT_SETTINGS.stateFiles.wechatReminder,
  };
}

function normalizeBriefing(value: unknown): AppSettings["briefing"] {
  const record = isRecord(value) ? value : {};
  return {
    morningEnabled: typeof record.morningEnabled === "boolean" ? record.morningEnabled : DEFAULT_SETTINGS.briefing.morningEnabled,
    eveningEnabled: typeof record.eveningEnabled === "boolean" ? record.eveningEnabled : DEFAULT_SETTINGS.briefing.eveningEnabled,
  };
}

function normalizeScheduling(value: unknown): AppSettings["scheduling"] {
  const record = isRecord(value) ? value : {};
  return {
    defaultOptionCount: positiveInteger(record.defaultOptionCount) || DEFAULT_SETTINGS.scheduling.defaultOptionCount,
    defaultDurationMinutes: positiveInteger(record.defaultDurationMinutes) || DEFAULT_SETTINGS.scheduling.defaultDurationMinutes,
  };
}

function normalizeFeatures(value: unknown): AppSettings["features"] {
  const record = isRecord(value) ? value : {};
  return {
    memoryDream: typeof record.memoryDream === "boolean" ? record.memoryDream : DEFAULT_SETTINGS.features.memoryDream,
    imageDraft: typeof record.imageDraft === "boolean" ? record.imageDraft : DEFAULT_SETTINGS.features.imageDraft,
  };
}

function normalizeLeadMinutes(value: unknown, fallback: number[]): number[] {
  const values = Array.isArray(value) ? value : typeof value === "number" ? [value] : [];
  const minutes = values.filter((item): item is number => Number.isInteger(item) && item > 0);
  return minutes.length > 0 ? minutes : fallback;
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function resolveMaybeRelative(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
