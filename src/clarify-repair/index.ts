// 无效追问修复层：只在模型已经卡成 clarify 时，补齐可执行日程草稿。

import { normalizeDecision, type CalendarAction, type EventDraft } from "../contract/index.js";

export type ClarifyEventDraftRepairInput = {
  sourceText: string;
  clarify: Extract<CalendarAction, { type: "clarify" }>;
  now?: string;
  timezone?: string;
};

export type ClarifyEventDraftRepairResult =
  | { ok: true; draft: EventDraft }
  | { ok: false; message: string; missing?: string[]; createDraft?: Partial<EventDraft> };
export type ClarifyEventDraftRepairer = (input: ClarifyEventDraftRepairInput) => Promise<ClarifyEventDraftRepairResult>;
export type ClarifyRepairModelMessage = { role: "system" | "user"; content: string };
export type ClarifyRepairModelTransport = (input: {
  model: string;
  messages: ClarifyRepairModelMessage[];
}) => Promise<{ content: string }>;

export type ClarifyRepairModelOptions = {
  model: string;
  transport: ClarifyRepairModelTransport;
};

// 创建模型补全器；它不选择工具，只把已有文本和草稿压成 title/date/startTime。
export function createClarifyEventDraftRepairer(options: ClarifyRepairModelOptions): ClarifyEventDraftRepairer {
  return async (input) => {
    const response = await options.transport({
      model: options.model,
      messages: buildClarifyRepairMessages(input),
    });
    return normalizeClarifyRepairResponse(response.content, input.clarify.createDraft);
  };
}

// 用现有合同校验模型补全结果，防止标题层绕过日程必填字段。
export function normalizeClarifyRepairResponse(content: string, fallbackDraft: Partial<EventDraft> | undefined = {}): ClarifyEventDraftRepairResult {
  const parsed = parseJsonObject(content);
  if (!parsed.ok) return { ok: false, message: "标题补全结果不是有效 JSON。" };

  if (parsed.value.status === "missing_time") {
    const missing = Array.isArray(parsed.value.missing) ? parsed.value.missing : [];
    const allowedMissing = missing.filter((item) => item === "date" || item === "startTime");
    const hasInvalidMissing = allowedMissing.length !== missing.length;
    if (allowedMissing.length === 0) return { ok: false, message: "这个日程缺少日期或开始时间。" };
    const createDraft = normalizePartialDraft({ ...fallbackDraft, ...(isRecord(parsed.value.draft) ? parsed.value.draft : {}) });
    return {
      ok: false,
      message: hasInvalidMissing ? buildMissingTimeQuestion(allowedMissing) : readTrimmedString(parsed.value.question) || buildMissingTimeQuestion(allowedMissing),
      missing: allowedMissing,
      ...(Object.keys(createDraft).length > 0 ? { createDraft } : {}),
    };
  }

  if (readTrimmedString(parsed.value.error)) return { ok: false, message: "标题补全层没有形成完整日程。" };

  const event = isRecord(parsed.value.event) ? parsed.value.event : parsed.value;
  const draft = { ...fallbackDraft, ...event };
  const normalized = normalizeDecision({ action: "create_event", event: draft });
  if (!normalized.ok || normalized.action.type !== "create_event") {
    return { ok: false, message: "标题补全层没有形成完整日程。" };
  }
  return { ok: true, draft: normalized.action.event };
}

// 结构化输出参数；真实安全边界仍由 normalizeDecision 兜底。
export function createClarifyRepairRequestOptions(): Record<string, unknown> {
  return {
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "clarify_event_draft_repair",
        schema: {
          type: "object",
          required: ["status"],
          additionalProperties: false,
          properties: {
            status: { type: "string", enum: ["complete", "missing_time"] },
            event: {
              type: "object",
              required: ["title", "date", "startTime"],
              additionalProperties: false,
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
              },
            },
            missing: { type: "array", items: { type: "string", enum: ["date", "startTime"] } },
            question: { type: "string" },
            draft: {
              type: "object",
              required: ["title"],
              additionalProperties: false,
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
              },
            },
          },
        },
      },
    },
  };
}

function buildClarifyRepairMessages(input: ClarifyEventDraftRepairInput): ClarifyRepairModelMessage[] {
  return [
    {
      role: "system",
      content: [
        "你只负责把用户当前消息整理成一个日程草稿，不负责选择工具、不负责判断是否删除或修改。",
        "如果用户已经给出明确日期和开始时间，输出 status=complete，并从原文总结一个简短 title；title 不能作为缺失字段。",
        "如果已有 createDraft，优先保留其中的 date、startTime、endTime、location、reminderMinutes。",
        "不要追问类型、会议类型、提醒类型或题型；类型不影响执行。",
        "如果用户说“今天3点”这类中文裸小时，结合 now 选择今天接下来最自然的时间；例如当前已过上午 3 点时，今天3点应理解为 15:00。",
        "date 必须是 YYYY-MM-DD，时间必须是 HH:mm。今天、明天等相对日期按 currentDate 和 timezone 转换。",
        "只有缺日期或开始时间时，才输出 status=missing_time、missing、一个最短追问，以及已经能确定的 draft；missing 只能包含 date 或 startTime，draft 必须包含你从原文总结的 title。",
        "输出外形：完整日程为 {\"status\":\"complete\",\"event\":{\"title\":\"...\",\"date\":\"YYYY-MM-DD\",\"startTime\":\"HH:mm\"}}；缺时间为 {\"status\":\"missing_time\",\"missing\":[\"startTime\"],\"question\":\"这个日程几点开始？\",\"draft\":{\"title\":\"...\",\"date\":\"YYYY-MM-DD\"}}。",
        "只输出一个符合 clarify_event_draft_repair schema 的结构化结果，不要解释、Markdown、代码块或多余文字。",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        text: input.sourceText,
        clarify: input.clarify,
        currentDate: dateInTimezone(input.now || new Date().toISOString(), input.timezone || "Asia/Shanghai"),
        timezone: input.timezone || "Asia/Shanghai",
        now: input.now || new Date().toISOString(),
      }),
    },
  ];
}

function parseJsonObject(content: string): { ok: true; value: Record<string, unknown> } | { ok: false } {
  const trimmed = content.trim();
  const fenced = trimmed.startsWith("```") ? trimFence(trimmed) : trimmed;
  try {
    const parsed = JSON.parse(fenced);
    return isRecord(parsed) ? { ok: true, value: parsed } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function trimFence(value: string): string {
  const lines = value.split("\n");
  if (lines.length >= 3 && lines[0].startsWith("```") && lines[lines.length - 1].trim() === "```") {
    return lines.slice(1, -1).join("\n").trim();
  }
  return value;
}

function buildMissingTimeQuestion(missing: unknown[]): string {
  if (missing.includes("date") && missing.includes("startTime")) return "这个日程是哪天几点？";
  if (missing.includes("date")) return "这个日程是哪天？";
  return "这个日程几点开始？";
}

function normalizePartialDraft(value: Record<string, unknown>): Partial<EventDraft> {
  const draft: Partial<EventDraft> = {};
  const title = readTrimmedString(value.title);
  const date = readTrimmedString(value.date);
  const startTime = readTrimmedString(value.startTime);
  const endTime = readTrimmedString(value.endTime);
  const location = readTrimmedString(value.location);
  const notes = readTrimmedString(value.notes);
  if (title) draft.title = title;
  if (date) draft.date = date;
  if (startTime) draft.startTime = startTime;
  if (endTime) draft.endTime = endTime;
  if (location) draft.location = location;
  if (notes) draft.notes = notes;
  if (typeof value.reminderMinutes === "number" || Array.isArray(value.reminderMinutes)) {
    draft.reminderMinutes = value.reminderMinutes as EventDraft["reminderMinutes"];
  }
  return draft;
}

function dateInTimezone(now: string, timezone: string): string {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) return now.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date);
}

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
