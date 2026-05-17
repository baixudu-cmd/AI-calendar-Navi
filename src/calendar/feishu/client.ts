// 飞书日历客户端。这里只通过注入式 transport 执行请求，方便 fake 测试和后续替换真实 HTTP。

import { mapCreateEventPayload, mapListEventsQuery, mapUpdateEventPayload } from "./mapper.js";
import type {
  CreateFeishuCalendarClientInput,
  DeleteEventResult,
  FeishuCalendarClient,
  FeishuCalendarEvent,
  FeishuResult,
  FeishuTransportRequest,
} from "./types.js";

const DELETE_RATE_LIMIT_RETRY_DELAY_MS = 250;

// 创建飞书日历 client，调用方决定传 fake transport 还是真实 transport。
export function createFeishuCalendarClient(input: CreateFeishuCalendarClientInput): FeishuCalendarClient {
  const basePath = `/open-apis/calendar/v4/calendars/${input.config.calendarId}/events`;

  return {
    async createEvent(event) {
      const configError = validateConfig(input);
      if (configError) return configError;

      const created = await requestFeishu(input, {
        method: "POST",
        path: basePath,
        tenantAccessToken: input.tenantAccessToken,
        body: mapCreateEventPayload(event, input.config.timezone),
      });
      if (!created.ok) return created;

      const attendeeResult = await addDefaultAttendee(input, basePath, created.data.id);
      if (!attendeeResult.ok) return attendeeResult;

      return created;
    },

    async listEvents(listInput) {
      const configError = validateConfig(input);
      if (configError) return configError;

      return requestFeishuList(input, {
        method: "GET",
        path: basePath,
        query: mapListEventsQuery(listInput),
        tenantAccessToken: input.tenantAccessToken,
      });
    },

    async updateEvent(updateInput) {
      const configError = validateConfig(input);
      if (configError) return configError;

      return requestFeishu(input, {
        method: "PATCH",
        path: `${basePath}/${updateInput.eventId}`,
        tenantAccessToken: input.tenantAccessToken,
        body: mapUpdateEventPayload(updateInput.patch, input.config.timezone),
      });
    },

    async deleteEvent(deleteInput) {
      const configError = validateConfig(input);
      if (configError) return configError;

      return requestFeishuDelete(input, {
        method: "DELETE",
        path: `${basePath}/${deleteInput.eventId}`,
        tenantAccessToken: input.tenantAccessToken,
      }, deleteInput.eventId);
    },
  };
}

// 创建后把默认个人身份加入参与人，避免应用日历写入后用户手机端不可见。
async function addDefaultAttendee(
  input: CreateFeishuCalendarClientInput,
  basePath: string,
  eventId: string,
): Promise<FeishuResult<void>> {
  const attendeeOpenId = input.config.defaultAttendeeOpenId?.trim();
  if (!attendeeOpenId) return { ok: true, data: undefined };

  const response = await send(input, {
    method: "POST",
    path: `${basePath}/${eventId}/attendees`,
    query: { user_id_type: "open_id" },
    tenantAccessToken: input.tenantAccessToken,
    body: {
      attendees: [{ type: "user", user_id: attendeeOpenId, is_optional: false }],
      need_notification: false,
    },
  });
  if (!response.ok) return response;

  const apiError = normalizeApiError(response.data.status, response.data.body);
  if (apiError && !apiError.ok) {
    return {
      ok: false,
      code: apiError.code,
      message: `飞书日历已创建，但同步到个人日历失败：${apiError.message}`,
    };
  }

  return { ok: true, data: undefined };
}

async function requestFeishu(
  input: CreateFeishuCalendarClientInput,
  request: FeishuTransportRequest,
): Promise<FeishuResult<FeishuCalendarEvent>> {
  const response = await send(input, request);
  if (!response.ok) return response;

  const apiError = normalizeApiError(response.data.status, response.data.body);
  if (apiError) return apiError;

  const event = normalizeEvent(readEvent(response.data.body));
  if (!event.id || !event.title) {
    return { ok: false, code: "invalid_response", message: "飞书日历返回结果缺少事件 ID 或标题。" };
  }

  return { ok: true, data: event };
}

// 执行列表请求，并把飞书列表结果转成统一事件数组。
async function requestFeishuList(
  input: CreateFeishuCalendarClientInput,
  request: FeishuTransportRequest,
): Promise<FeishuResult<FeishuCalendarEvent[]>> {
  const response = await send(input, request);
  if (!response.ok) return response;

  const apiError = normalizeApiError(response.data.status, response.data.body);
  if (apiError) return apiError;

  return { ok: true, data: readEvents(response.data.body).filter(isActiveEvent).map(normalizeEvent) };
}

// 执行删除请求；飞书删除成功不返回完整事件，所以用调用方传入的事件 ID 作为结果。
async function requestFeishuDelete(
  input: CreateFeishuCalendarClientInput,
  request: FeishuTransportRequest,
  eventId: string,
): Promise<FeishuResult<DeleteEventResult>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await send(input, request);
    if (!response.ok) return response;

    if (isAlreadyDeletedError(response.data.body)) return { ok: true, data: { eventId } };

    const apiError = normalizeApiError(response.data.status, response.data.body);
    if (apiError) {
      if (attempt === 0 && isRateLimitResponse(response.data.status, response.data.body)) {
        await sleep(DELETE_RATE_LIMIT_RETRY_DELAY_MS);
        continue;
      }
      return apiError;
    }

    return { ok: true, data: { eventId } };
  }

  return { ok: false, code: "api_error", message: "飞书日历 API 返回错误：current operation rate limited" };
}

// 调用注入式 transport，并把抛出的异常转成稳定错误。
async function send(
  input: CreateFeishuCalendarClientInput,
  request: FeishuTransportRequest,
): Promise<FeishuResult<{ status: number; body: unknown }>> {
  try {
    return { ok: true, data: await input.transport.request(request) };
  } catch (error) {
    return {
      ok: false,
      code: "network_error",
      message: `飞书日历请求失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// 校验最小运行配置；Phase 3 不在这里获取真实 token。
function validateConfig(input: CreateFeishuCalendarClientInput): FeishuResult<never> | null {
  if (!input.config.calendarId || !input.config.timezone || !input.tenantAccessToken) {
    return { ok: false, code: "missing_config", message: "飞书日历配置不完整。" };
  }

  return null;
}

// 把飞书 HTTP 状态和业务 code 归一成 adapter 错误。
function normalizeApiError(status: number, body: unknown): FeishuResult<never> | null {
  const code = readApiCode(body);

  if (status === 404) {
    return { ok: false, code: "not_found", message: "飞书日历事件不存在。" };
  }

  if (status < 200 || status >= 300 || (typeof code === "number" && code !== 0)) {
    return { ok: false, code: "api_error", message: readApiMessage(body) };
  }

  return null;
}

// 把飞书事件对象压成项目内部使用的最小事件对象。
function normalizeEvent(value: unknown): FeishuCalendarEvent {
  const event = isRecord(value) ? value : {};
  return {
    id: readString(event.event_id) || readString(event.id),
    title: readString(event.summary) || readString(event.title),
    start: readEventTime(event.start_time),
    end: readEventTime(event.end_time) || undefined,
    ...(isRecord(event.location) && readString(event.location.name) ? { location: readString(event.location.name) } : {}),
    ...(readString(event.description) ? { notes: readString(event.description) } : {}),
  };
}

// 从飞书创建/修改响应中读取事件对象。
function readEvent(body: unknown): unknown {
  if (!isRecord(body) || !isRecord(body.data)) return {};
  return body.data.event;
}

// 从飞书查询响应中读取事件列表。
function readEvents(body: unknown): unknown[] {
  if (!isRecord(body) || !isRecord(body.data) || !Array.isArray(body.data.items)) return [];
  return body.data.items;
}

// 飞书列表里可能短暂返回已删除事件，业务层不应再把它当成可操作日程。
function isActiveEvent(value: unknown): boolean {
  if (!isRecord(value)) return true;
  const status = readString(value.status).toLowerCase();
  return !["deleted", "cancelled"].includes(status);
}

// 清理流程里重复删除已删事件应视为幂等成功。
function isAlreadyDeletedError(body: unknown): boolean {
  return readApiMessage(body).toLowerCase().includes("event is deleted");
}

// 飞书偶发操作限流是外部瞬时状态，删除请求可以短暂重试一次。
function isRateLimitResponse(status: number, body: unknown): boolean {
  return status === 429 || readApiMessage(body).toLowerCase().includes("rate limited");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 读取飞书业务 code。
function readApiCode(body: unknown): number | undefined {
  if (!isRecord(body) || typeof body.code !== "number") return undefined;
  return body.code;
}

// 读取飞书错误信息，并保证用户侧提示稳定。
function readApiMessage(body: unknown): string {
  if (isRecord(body) && typeof body.msg === "string" && body.msg.length > 0) {
    return `飞书日历 API 返回错误：${body.msg}`;
  }

  return "飞书日历 API 返回错误。";
}

// 把飞书时间字段压成可读字符串。
function readEventTime(value: unknown): string {
  if (!isRecord(value)) return "";
  const timestamp = readString(value.timestamp);
  const date = readString(value.date);
  const time = readString(value.time);

  if (timestamp) return formatTimestamp(timestamp, readString(value.timezone) || "Asia/Shanghai");
  if (date && time) return `${date} ${time}`;
  return date || time;
}

// 把秒级 timestamp 转成状态层可继续使用的日期时间。
function formatTimestamp(value: string, timeZone: string): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return value;
  const date = new Date(seconds * 1000);
  const dateText = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const timeText = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  return `${dateText} ${timeText}`;
}

// 安全读取字符串字段。
function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// 判断 unknown 是否为普通对象。
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
