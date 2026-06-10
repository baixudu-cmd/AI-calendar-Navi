// OpenClaw shadow caller：只负责把最小消息载荷 POST 到本机 shadow route，不承载日历业务逻辑。

import { createLocalAddressFetch } from "../net/local-address-fetch.js";

export type OpenClawShadowPayload = {
  text: string;
  messageId: string;
  requestId: string;
  secret: string;
  media?: OpenClawShadowMedia;
};

export type OpenClawShadowMedia = {
  path: string;
  type: string;
};

export type BuildOpenClawShadowPayloadInput = {
  text: string;
  messageId: string;
  requestId: string;
  secret: string;
  media?: unknown;
  [key: string]: unknown;
};

export type CallOpenClawShadowRouteInput = BuildOpenClawShadowPayloadInput & {
  url: string;
};

export type CalendarAgentResponse = {
  ok: boolean;
  reply: string;
  actionType: string;
  requestId: string;
};

export type FormatOpenClawShadowCallerOutputOptions = {
  replyOnly?: boolean;
};

// 构造 OpenClaw 调用 shadow route 的白名单载荷，只保留公开字段。
export function buildOpenClawShadowPayload(input: BuildOpenClawShadowPayloadInput): OpenClawShadowPayload {
  const media = normalizeMedia(input.media);
  return {
    text: input.text,
    messageId: input.messageId,
    requestId: input.requestId,
    secret: input.secret,
    ...(media ? { media } : {}),
  };
}

// 调用受控 shadow HTTP route；任何非成功响应都按失败关闭处理。
export async function callOpenClawShadowRoute(input: CallOpenClawShadowRouteInput): Promise<CalendarAgentResponse> {
  const fetchImpl = createLocalAddressFetch(process.env.OPENCLAW_SHADOW_LOCAL_ADDRESS);
  const response = await fetchImpl(input.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildOpenClawShadowPayload(input)),
  });

  if (!response.ok) {
    throw new Error(redactSecret(`OpenClaw shadow route failed: HTTP ${response.status}`, input.secret));
  }

  const parsed = await parseJsonResponse(response, input.secret);
  const result = parseCalendarAgentResponse(parsed);
  if (!result.ok) {
    throw new Error(redactSecret("OpenClaw shadow route returned an invalid response", input.secret));
  }

  return redactCalendarAgentResponse(result.response, input.secret);
}

// 格式化 caller 输出；微信直连只需要用户回执，smoke 默认保留诊断信息。
export function formatOpenClawShadowCallerOutput(
  result: CalendarAgentResponse,
  options: FormatOpenClawShadowCallerOutputOptions = {},
): string {
  if (options.replyOnly) return result.reply;

  return [
    `OpenClaw shadow caller smoke: ${result.ok ? "passed" : "failed"}`,
    `requestId=${result.requestId}`,
    `actionType=${result.actionType}`,
    result.reply,
  ].join("\n");
}

// 解析 JSON 响应，错误信息不带原始响应体，避免泄露 secret。
async function parseJsonResponse(response: Response, secret: string): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(redactSecret("OpenClaw shadow route returned invalid JSON", secret));
  }
}

// 校验 CalendarAgentResponse 的最小形状，拒绝不完整响应。
function parseCalendarAgentResponse(value: unknown): { ok: true; response: CalendarAgentResponse } | { ok: false } {
  if (!isRecord(value)) return { ok: false };
  if (
    typeof value.ok !== "boolean" ||
    typeof value.reply !== "string" ||
    typeof value.actionType !== "string" ||
    typeof value.requestId !== "string"
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    response: {
      ok: value.ok,
      reply: value.reply,
      actionType: value.actionType,
      requestId: value.requestId,
    },
  };
}

// 隐去错误文本中的入口密钥。
function redactSecret(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join("[redacted]");
}

// Calendar Agent 的业务失败也可能是用户可读回执，只做脱敏后返回，不把它升级成系统异常。
function redactCalendarAgentResponse(response: CalendarAgentResponse, secret: string): CalendarAgentResponse {
  return {
    ...response,
    reply: redactSecret(response.reply, secret),
  };
}

// 只允许媒体桥传本地路径和类型，其他来源字段全部丢弃。
function normalizeMedia(value: unknown): OpenClawShadowMedia | undefined {
  if (!isRecord(value)) return undefined;
  const mediaPath = readString(value.path);
  const mediaType = readString(value.type);
  if (!mediaPath || !mediaType) return undefined;
  return { path: mediaPath, type: mediaType };
}

// 判断值是否为普通对象。
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
