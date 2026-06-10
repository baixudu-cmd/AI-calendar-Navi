// 飞书 client 测试，使用注入式 fake transport 验证请求和错误归一化。

import { describe, expect, it } from "vitest";
import { createFeishuCalendarClient } from "../src/calendar/feishu/client.js";
import type { FeishuTransportRequest } from "../src/calendar/feishu/types.js";

describe("Feishu calendar client", () => {
  it("creates events through injected transport", async () => {
    const requests: FeishuTransportRequest[] = [];
    const client = createFeishuCalendarClient({
      config: { appId: "app", appSecret: "secret", calendarId: "primary", timezone: "Asia/Shanghai" },
      tenantAccessToken: "token",
      transport: {
        request: async (request) => {
          requests.push(request);
          return {
            status: 200,
            body: {
              code: 0,
              data: {
                event: {
                  event_id: "evt_1",
                  summary: "见张总",
                  start_time: { timestamp: "1778310000", timezone: "Asia/Shanghai" },
                  end_time: { timestamp: "1778313600", timezone: "Asia/Shanghai" },
                },
              },
            },
          };
        },
      },
    });

    const result = await client.createEvent({ title: "见张总", date: "2026-05-09", startTime: "15:00" });

    expect(result).toEqual({
      ok: true,
      data: { id: "evt_1", title: "见张总", start: "2026-05-09 15:00", end: "2026-05-09 16:00" },
    });
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/open-apis/calendar/v4/calendars/primary/events",
      tenantAccessToken: "token",
    });
  });

  it("sends recurrence when creating recurring events", async () => {
    const requests: FeishuTransportRequest[] = [];
    const client = createFeishuCalendarClient({
      config: { appId: "app", appSecret: "secret", calendarId: "primary", timezone: "Asia/Shanghai" },
      tenantAccessToken: "token",
      transport: {
        request: async (request) => {
          requests.push(request);
          return {
            status: 200,
            body: {
              code: 0,
              data: {
                event: {
                  event_id: "evt_recurring",
                  summary: "站会",
                  start_time: { timestamp: "1780275600", timezone: "Asia/Shanghai" },
                  end_time: { timestamp: "1780279200", timezone: "Asia/Shanghai" },
                  recurrence: "FREQ=DAILY;INTERVAL=1",
                },
              },
            },
          };
        },
      },
    });

    const result = await client.createEvent({
      title: "站会",
      date: "2026-06-01",
      startTime: "09:00",
      recurrence: { frequency: "daily", interval: 1 },
    });

    expect(result).toEqual({
      ok: true,
      data: {
        id: "evt_recurring",
        title: "站会",
        start: "2026-06-01 09:00",
        end: "2026-06-01 10:00",
        recurrence: "FREQ=DAILY;INTERVAL=1",
      },
    });
    expect(requests[0]?.body).toMatchObject({
      recurrence: "FREQ=DAILY;INTERVAL=1",
    });
  });

  it("adds the configured personal attendee after creating an event", async () => {
    const requests: FeishuTransportRequest[] = [];
    const client = createFeishuCalendarClient({
      config: {
        appId: "app",
        appSecret: "secret",
        calendarId: "main-calendar",
        timezone: "Asia/Shanghai",
        defaultAttendeeOpenId: "ou_user",
      },
      tenantAccessToken: "token",
      transport: {
        request: async (request) => {
          requests.push(request);
          if (request.path.endsWith("/attendees")) return { status: 200, body: { code: 0, data: { attendees: [{}] } } };
          return {
            status: 200,
            body: {
              code: 0,
              data: {
                event: {
                  event_id: "evt_visible",
                  summary: "手机可见会议",
                  start_time: { timestamp: "1778310000", timezone: "Asia/Shanghai" },
                  end_time: { timestamp: "1778313600", timezone: "Asia/Shanghai" },
                },
              },
            },
          };
        },
      },
    });

    const result = await client.createEvent({ title: "手机可见会议", date: "2026-05-09", startTime: "15:00" });

    expect(result).toMatchObject({ ok: true, data: { id: "evt_visible", title: "手机可见会议" } });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      method: "POST",
      path: "/open-apis/calendar/v4/calendars/main-calendar/events/evt_visible/attendees",
      query: { user_id_type: "open_id" },
      body: {
        attendees: [{ type: "user", user_id: "ou_user", is_optional: false }],
        need_notification: false,
      },
    });
  });

  it("does not report create success when attendee sync fails", async () => {
    const client = createFeishuCalendarClient({
      config: {
        appId: "app",
        appSecret: "secret",
        calendarId: "main-calendar",
        timezone: "Asia/Shanghai",
        defaultAttendeeOpenId: "ou_user",
      },
      tenantAccessToken: "token",
      transport: {
        request: async (request) => {
          if (request.path.endsWith("/attendees")) return { status: 404, body: { code: 193001, msg: "event not found" } };
          return {
            status: 200,
            body: {
              code: 0,
              data: {
                event: {
                  event_id: "evt_orphan",
                  summary: "未同步会议",
                  start_time: { timestamp: "1778310000", timezone: "Asia/Shanghai" },
                },
              },
            },
          };
        },
      },
    });

    await expect(client.createEvent({ title: "未同步会议", date: "2026-05-09", startTime: "15:00" })).resolves.toEqual({
      ok: false,
      code: "not_found",
      message: "飞书日历已创建，但同步到个人日历失败：飞书日历事件不存在。",
    });
  });

  it("lists events through injected transport", async () => {
    const requests: FeishuTransportRequest[] = [];
    const client = createFeishuCalendarClient({
      config: { appId: "app", appSecret: "secret", calendarId: "primary", timezone: "Asia/Shanghai" },
      tenantAccessToken: "token",
      transport: {
        request: async (request) => {
          requests.push(request);
          return {
            status: 200,
            body: {
              code: 0,
              data: {
                items: [
                  {
                    event_id: "evt_1",
                    summary: "见张总",
                    start_time: { timestamp: "1778310000", timezone: "Asia/Shanghai" },
                  },
                ],
              },
            },
          };
        },
      },
    });

    const result = await client.listEvents({ date: "2026-05-09" });

    expect(result).toEqual({ ok: true, data: [{ id: "evt_1", title: "见张总", start: "2026-05-09 15:00", end: undefined }] });
    expect(requests[0]).toMatchObject({
      method: "GET",
      path: "/open-apis/calendar/v4/calendars/primary/events",
      query: { start_time: "1778256000", end_time: "1778342399" },
    });
  });

  it("filters deleted events from list responses", async () => {
    const client = createFeishuCalendarClient({
      config: { appId: "app", appSecret: "secret", calendarId: "primary", timezone: "Asia/Shanghai" },
      tenantAccessToken: "token",
      transport: {
        request: async () => ({
          status: 200,
          body: {
            code: 0,
            data: {
              items: [
                {
                  event_id: "evt_active",
                  summary: "有效日程",
                  start_time: { timestamp: "1778310000", timezone: "Asia/Shanghai" },
                },
                {
                  event_id: "evt_deleted",
                  summary: "已删除日程",
                  status: "deleted",
                  start_time: { timestamp: "1778310000", timezone: "Asia/Shanghai" },
                },
                {
                  event_id: "evt_cancelled",
                  summary: "已取消日程",
                  status: "cancelled",
                  start_time: { timestamp: "1778310000", timezone: "Asia/Shanghai" },
                },
              ],
            },
          },
        }),
      },
    });

    await expect(client.listEvents({ date: "2026-05-09" })).resolves.toEqual({
      ok: true,
      data: [{ id: "evt_active", title: "有效日程", start: "2026-05-09 15:00", end: undefined }],
    });
  });

  it("updates events through injected transport", async () => {
    const requests: FeishuTransportRequest[] = [];
    const client = createFeishuCalendarClient({
      config: { appId: "app", appSecret: "secret", calendarId: "primary", timezone: "Asia/Shanghai" },
      tenantAccessToken: "token",
      transport: {
        request: async (request) => {
          requests.push(request);
          return {
            status: 200,
            body: {
              code: 0,
              data: {
                event: {
                  event_id: "evt_1",
                  summary: "改后",
                  start_time: { timestamp: "1778315400", timezone: "Asia/Shanghai" },
                },
              },
            },
          };
        },
      },
    });

    const result = await client.updateEvent({ eventId: "evt_1", patch: { title: "改后" } });

    expect(result).toEqual({ ok: true, data: { id: "evt_1", title: "改后", start: "2026-05-09 16:30", end: undefined } });
    expect(requests[0]).toMatchObject({
      method: "PATCH",
      path: "/open-apis/calendar/v4/calendars/primary/events/evt_1",
    });
  });

  it("deletes events through injected transport", async () => {
    const requests: FeishuTransportRequest[] = [];
    const client = createFeishuCalendarClient({
      config: { appId: "app", appSecret: "secret", calendarId: "primary", timezone: "Asia/Shanghai" },
      tenantAccessToken: "token",
      transport: {
        request: async (request) => {
          requests.push(request);
          return { status: 200, body: { code: 0 } };
        },
      },
    });

    const result = await client.deleteEvent({ eventId: "evt_1" });

    expect(result).toEqual({ ok: true, data: { eventId: "evt_1" } });
    expect(requests[0]).toMatchObject({
      method: "DELETE",
      path: "/open-apis/calendar/v4/calendars/primary/events/evt_1",
      tenantAccessToken: "token",
    });
  });

  it("retries delete once when Feishu reports operation rate limit", async () => {
    const requests: FeishuTransportRequest[] = [];
    const client = createFeishuCalendarClient({
      config: { appId: "app", appSecret: "secret", calendarId: "primary", timezone: "Asia/Shanghai" },
      tenantAccessToken: "token",
      transport: {
        request: async (request) => {
          requests.push(request);
          if (requests.length === 1) {
            return { status: 429, body: { code: 999, msg: "current operation rate limited" } };
          }
          return { status: 200, body: { code: 0 } };
        },
      },
    });

    await expect(client.deleteEvent({ eventId: "evt_rate_limited" })).resolves.toEqual({
      ok: true,
      data: { eventId: "evt_rate_limited" },
    });
    expect(requests).toHaveLength(2);
  });

  it("treats already deleted events as successful delete cleanup", async () => {
    const client = createFeishuCalendarClient({
      config: { appId: "app", appSecret: "secret", calendarId: "primary", timezone: "Asia/Shanghai" },
      tenantAccessToken: "token",
      transport: {
        request: async () => ({ status: 400, body: { code: 999, msg: "event is deleted" } }),
      },
    });

    await expect(client.deleteEvent({ eventId: "evt_deleted" })).resolves.toEqual({
      ok: true,
      data: { eventId: "evt_deleted" },
    });
  });

  it("normalizes missing config and transport failures", async () => {
    const missingConfigClient = createFeishuCalendarClient({
      config: { calendarId: "", timezone: "Asia/Shanghai" },
      tenantAccessToken: "",
      transport: { request: async () => ({ status: 200, body: { code: 0 } }) },
    });

    await expect(missingConfigClient.createEvent({ title: "会", date: "2026-05-09", startTime: "15:00" })).resolves.toEqual({
      ok: false,
      code: "missing_config",
      message: "飞书日历配置不完整。",
    });

    const networkClient = createFeishuCalendarClient({
      config: { appId: "app", appSecret: "secret", calendarId: "primary", timezone: "Asia/Shanghai" },
      tenantAccessToken: "token",
      transport: {
        request: async () => {
          throw new Error("socket closed");
        },
      },
    });

    await expect(networkClient.listEvents({ date: "2026-05-09" })).resolves.toEqual({
      ok: false,
      code: "network_error",
      message: "飞书日历请求失败：socket closed",
    });
  });

  it("normalizes Feishu API errors", async () => {
    const client = createFeishuCalendarClient({
      config: { appId: "app", appSecret: "secret", calendarId: "primary", timezone: "Asia/Shanghai" },
      tenantAccessToken: "token",
      transport: {
        request: async () => ({ status: 200, body: { code: 999, msg: "invalid calendar" } }),
      },
    });

    await expect(client.listEvents({ date: "2026-05-09" })).resolves.toEqual({
      ok: false,
      code: "api_error",
      message: "飞书日历 API 返回错误：invalid calendar",
    });
  });

  it("rejects successful Feishu write responses without event id or title", async () => {
    const client = createFeishuCalendarClient({
      config: { appId: "app", appSecret: "secret", calendarId: "primary", timezone: "Asia/Shanghai" },
      tenantAccessToken: "token",
      transport: {
        request: async () => ({
          status: 200,
          body: {
            code: 0,
            data: {
              event: {
                start_time: { timestamp: "1778310000", timezone: "Asia/Shanghai" },
              },
            },
          },
        }),
      },
    });

    await expect(client.createEvent({ title: "见张总", date: "2026-05-09", startTime: "15:00" })).resolves.toEqual({
      ok: false,
      code: "invalid_response",
      message: "飞书日历返回结果缺少事件 ID 或标题。",
    });
  });
});
