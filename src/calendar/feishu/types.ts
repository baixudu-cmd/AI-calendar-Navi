// 飞书日历 adapter 的类型定义。Phase 3 只支持注入式 transport，不直接写真实飞书。

import type { EventDraft } from "../../contract/index.js";

export type FeishuCalendarConfig = {
  appId?: string;
  appSecret?: string;
  calendarId: string;
  timezone: string;
  defaultAttendeeOpenId?: string;
};

export type FeishuTransportRequest = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  tenantAccessToken?: string;
};

export type FeishuTransportResponse = {
  status: number;
  body: unknown;
};

export type FeishuTransport = {
  request(request: FeishuTransportRequest): Promise<FeishuTransportResponse>;
};

export type FeishuCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  location?: string;
  notes?: string;
  recurrence?: string;
};

export type FeishuCalendarErrorCode = "missing_config" | "api_error" | "network_error" | "not_found" | "invalid_response";

export type FeishuResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: FeishuCalendarErrorCode; message: string };

export type FeishuTime = {
  timestamp: string;
  timezone: string;
};

export type FeishuCreatePayload = {
  summary: string;
  start_time: FeishuTime;
  end_time: FeishuTime;
  location?: { name: string };
  description?: string;
  reminders?: Array<{ minutes: number }>;
  recurrence?: string;
};

export type FeishuUpdatePayload = Partial<FeishuCreatePayload>;

export type ListEventsInput = { date?: string; range?: { startDate: string; endDate: string } };

export type UpdateEventInput = { eventId: string; patch: Partial<EventDraft> };

export type DeleteEventInput = { eventId: string };

export type DeleteEventResult = { eventId: string };

export type FeishuCalendarClient = {
  createEvent(event: EventDraft): Promise<FeishuResult<FeishuCalendarEvent>>;
  listEvents(input: ListEventsInput): Promise<FeishuResult<FeishuCalendarEvent[]>>;
  updateEvent(input: UpdateEventInput): Promise<FeishuResult<FeishuCalendarEvent>>;
  deleteEvent(input: DeleteEventInput): Promise<FeishuResult<DeleteEventResult>>;
};

export type CreateFeishuCalendarClientInput = {
  config: FeishuCalendarConfig;
  tenantAccessToken?: string;
  transport: FeishuTransport;
};
