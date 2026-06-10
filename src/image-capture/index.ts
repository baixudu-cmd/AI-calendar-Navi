// 图片录入边界：把用户主动发送的图片解析成日程字段，不负责写日历。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EventDraft } from "../contract/index.js";

const execFileAsync = promisify(execFile);

export type ImageDraftParserInput = {
  path: string;
  type: string;
  text?: string;
};

export type ImageCalendarDraftParseResult =
  | { ok: true; draft: EventDraft; sourceText?: string }
  | { ok: false; message: string };

export type ImageDraftParser = (input: ImageDraftParserInput) => Promise<ImageCalendarDraftParseResult>;
export type ImageDraftModelMessage = { role: "system" | "user"; content: string };
export type ImageDraftModelTransport = (input: {
  model: string;
  messages: ImageDraftModelMessage[];
}) => Promise<{ content: string }>;

export type ImageDraftModelOptions = {
  model: string;
  transport: ImageDraftModelTransport;
};

// 根据环境创建真实图片草稿 parser；默认关闭，避免 P11.2 dry-run 行为被意外改变。
export function createImageDraftParserFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  modelOptions?: ImageDraftModelOptions,
): ImageDraftParser | undefined {
  if (env.IMAGE_CAPTURE_ENABLE_DRAFT !== "1") return undefined;

  if (env.IMAGE_CAPTURE_DRAFT_JSON) {
    return async () => parseJsonDraft(env.IMAGE_CAPTURE_DRAFT_JSON || "");
  }

  const command = env.IMAGE_CAPTURE_OCR_COMMAND || "scripts/ocr-image.swift";
  return async (input) => {
    const ocr = await runOcrCommand(command, input.path);
    if (env.IMAGE_CAPTURE_PARSE_WITH_MODEL === "1") {
      if (!modelOptions) return { ok: false, message: "图片解析模型未配置，本次不会写入日历。" };
      return parseOcrCalendarDraftWithModel(ocr, modelOptions);
    }
    return parseOcrCalendarDraft(ocr);
  };
}

// 校验图片解析输出，只允许进入现有 EventDraft 字段。
export function normalizeImageCalendarDraft(value: unknown): ImageCalendarDraftParseResult {
  if (!isRecord(value)) return { ok: false, message: "图片内容没有识别清楚，请换一张更清晰的截图。" };

  const title = readTrimmedString(value.title);
  const date = readTrimmedString(value.date);
  const startTime = readTrimmedString(value.startTime);
  if (!title || !isValidDate(date) || !isValidTime(startTime)) {
    return { ok: false, message: "图片内容没有识别清楚，请补充标题、日期和开始时间。" };
  }

  const endTime = readTrimmedString(value.endTime);
  if (endTime && !isValidTime(endTime)) return { ok: false, message: "图片里的结束时间没有识别清楚。" };

  const draft: EventDraft = {
    title,
    date,
    startTime,
    ...(endTime ? { endTime } : {}),
    ...optionalString(value, "location"),
    ...optionalString(value, "notes"),
    ...optionalReminderMinutes(value),
  };
  return { ok: true, draft };
}

// 从 OCR 文本中提取最小会议截图字段；识别不完整时失败关闭。
export function parseOcrCalendarDraft(text: string): ImageCalendarDraftParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const joined = lines.join("\n");
  const time = parseChineseDateTimeRange(joined) || parseIsoDateTimeRange(joined);
  if (!time) return { ok: false, message: "图片里的会议时间没有识别清楚。" };

  const meetingNumber = /会议号[:：]?\s*([0-9 ]{5,})/.exec(joined)?.[1]?.replace(/\s+/g, " ").trim();
  const title = findTitleLine(lines) || "图片日程";
  const result = normalizeImageCalendarDraft({
    title,
    date: time.date,
    startTime: time.startTime,
    endTime: time.endTime,
    ...(meetingNumber ? { location: `腾讯会议 ${meetingNumber}` } : {}),
    notes: "由图片截图识别生成。",
  });
  if (result.ok) return { ...result, sourceText: text };
  return result;
}

// 用模型理解 OCR 文本，只返回日程字段，不触发日历写入。
export async function parseOcrCalendarDraftWithModel(
  text: string,
  options: ImageDraftModelOptions,
): Promise<ImageCalendarDraftParseResult> {
  const response = await options.transport({
    model: options.model,
    messages: buildImageDraftMessages(text),
  });
  const parsed = parseModelJsonObject(response.content);
  if (!parsed.ok) return { ok: false, message: "图片内容没有识别清楚，请换一张更清晰的截图。" };
  if (readTrimmedString(parsed.value.error)) {
    return { ok: false, message: "图片内容没有识别清楚，请补充标题、日期和开始时间。" };
  }
  const result = normalizeImageCalendarDraft(parsed.value);
  if (result.ok) return { ...result, sourceText: text };
  return result;
}

// 图片日程模型的结构化输出参数，真实校验仍由 normalizeImageCalendarDraft 完成。
export function createImageDraftRequestOptions(): Record<string, unknown> {
  return {
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "image_calendar_draft",
        schema: {
          type: "object",
          additionalProperties: false,
          anyOf: [{ required: ["title", "date", "startTime"] }, { required: ["error"] }],
          properties: {
            title: { type: "string" },
            date: { type: "string" },
            startTime: { type: "string" },
            endTime: { type: "string" },
            location: { type: "string" },
            notes: { type: "string" },
            reminderMinutes: {
              anyOf: [
                { type: "number" },
                { type: "array", items: { type: "number" } },
              ],
            },
            error: { type: "string" },
          },
        },
      },
    },
  };
}

async function runOcrCommand(command: string, imagePath: string): Promise<string> {
  const [file, ...args] = command.split(" ").filter(Boolean);
  const result = await execFileAsync(file, [...args, imagePath], { timeout: 30000, maxBuffer: 1024 * 1024 });
  return result.stdout;
}

function parseJsonDraft(value: string): ImageCalendarDraftParseResult {
  try {
    return normalizeImageCalendarDraft(JSON.parse(value));
  } catch {
    return { ok: false, message: "图片解析配置不是有效 JSON。" };
  }
}

function buildImageDraftMessages(text: string): ImageDraftModelMessage[] {
  return [
    {
      role: "system",
      content: [
        "你把用户主动发送的会议或日程截图 OCR 文本解析成日程字段。",
        "只输出一个符合 image_calendar_draft schema 的结构化结果，不要解释、Markdown、代码块或多余文字。",
        "字段只允许 title、date、startTime、endTime、location、notes、reminderMinutes、error。",
        "date 必须是 YYYY-MM-DD，时间必须是 HH:mm。",
        "如果标题、日期或开始时间无法判断，输出 {\"error\":\"missing_required_fields\"}。",
        "不要写日历，不要生成长期记忆。",
      ].join("\n"),
    },
    {
      role: "user",
      content: `OCR 文本：\n${text}`,
    },
  ];
}

function parseModelJsonObject(content: string): { ok: true; value: Record<string, unknown> } | { ok: false } {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)?.[1] || trimmed;
  try {
    const parsed = JSON.parse(fenced);
    return isRecord(parsed) ? { ok: true, value: parsed } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function parseChineseDateTimeRange(value: string): { date: string; startTime: string; endTime?: string } | null {
  const match = /(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*[-~至]\s*(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  return {
    date: `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`,
    startTime: `${pad2(match[4])}:${match[5]}`,
    endTime: `${pad2(match[6])}:${match[7]}`,
  };
}

function parseIsoDateTimeRange(value: string): { date: string; startTime: string; endTime?: string } | null {
  const match = /(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})(?:\s*[-~至]\s*(\d{1,2}):(\d{2}))?/.exec(value);
  if (!match) return null;
  return {
    date: match[1],
    startTime: `${pad2(match[2])}:${match[3]}`,
    ...(match[4] && match[5] ? { endTime: `${pad2(match[4])}:${match[5]}` } : {}),
  };
}

function findTitleLine(lines: string[]): string | undefined {
  return lines.find((line) => {
    if (/腾讯会议|会议号|会议链接|入会|复制|Leap Capital/.test(line)) return false;
    if (/\d{4}年\d{1,2}月\d{1,2}日/.test(line)) return false;
    return line.length >= 2 && line.length <= 40;
  });
}

function optionalString(value: Record<string, unknown>, key: keyof EventDraft): Record<string, string> {
  const text = readTrimmedString(value[key]);
  return text ? { [key]: text } : {};
}

function optionalReminderMinutes(value: Record<string, unknown>): Record<string, number | number[]> {
  if (typeof value.reminderMinutes === "number") return { reminderMinutes: value.reminderMinutes };
  if (Array.isArray(value.reminderMinutes)) {
    const minutes = value.reminderMinutes.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
    return minutes.length > 0 ? { reminderMinutes: minutes } : {};
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

function pad2(value: string): string {
  return value.padStart(2, "0");
}
