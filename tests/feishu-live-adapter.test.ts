import { describe, expect, it } from "vitest";
import { fetchTenantAccessToken } from "../src/calendar/feishu/auth.js";
import { createFeishuHttpTransport } from "../src/calendar/feishu/http-transport.js";
import { createLiveFeishuCalendarAdapter } from "../src/calendar/feishu/live-adapter.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Feishu live auth and transport", () => {
  it("fetches tenant access token without exposing app secret", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return jsonResponse({ code: 0, tenant_access_token: "tenant-token" });
    };

    const result = await fetchTenantAccessToken({
      appId: "cli_test",
      appSecret: "secret-feishu-key",
      fetch: fetchImpl,
    });

    expect(result).toEqual({ ok: true, data: "tenant-token" });
    expect(calls[0].url).toContain("/open-apis/auth/v3/tenant_access_token/internal");
    expect(calls[0].body).toContain("secret-feishu-key");
    expect(JSON.stringify(result)).not.toContain("secret-feishu-key");
  });

  it("normalizes token errors without leaking app secret", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ code: 999, msg: "bad app secret" });

    const result = await fetchTenantAccessToken({
      appId: "cli_test",
      appSecret: "secret-feishu-key",
      fetch: fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret-feishu-key");
    if (!result.ok) expect(result.message).toContain("飞书 tenant token 获取失败");
  });

  it("sends Feishu OpenAPI requests with bearer token and query", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization") || undefined,
      });
      return jsonResponse({ code: 0, data: { items: [] } });
    };
    const transport = createFeishuHttpTransport({ fetch: fetchImpl });

    const response = await transport.request({
      method: "GET",
      path: "/open-apis/calendar/v4/calendars/cal_1/events",
      query: { start_time: "1", end_time: "2" },
      tenantAccessToken: "tenant-token",
    });

    expect(response).toEqual({ status: 200, body: { code: 0, data: { items: [] } } });
    expect(calls[0].url).toBe("https://open.feishu.cn/open-apis/calendar/v4/calendars/cal_1/events?start_time=1&end_time=2");
    expect(calls[0].authorization).toBe("Bearer tenant-token");
  });
});

describe("Feishu live calendar adapter", () => {
  it("creates a calendar adapter backed by tenant token and HTTP transport", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      urls.push(String(url));
      if (String(url).includes("/tenant_access_token/internal")) {
        return jsonResponse({ code: 0, tenant_access_token: "tenant-token" });
      }
      return jsonResponse({
        code: 0,
        data: {
          event: {
            event_id: "evt_live",
            summary: "Live bring-up smoke",
            start_time: { timestamp: "1778259600", timezone: "Asia/Shanghai" },
          },
        },
      });
    };

    const result = await createLiveFeishuCalendarAdapter({
      config: {
        appId: "cli_test",
        appSecret: "secret-feishu-key",
        calendarId: "cal_test",
        timezone: "Asia/Shanghai",
      },
      fetch: fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const created = await result.data.createEvent({ title: "Live bring-up smoke", date: "2026-05-09", startTime: "09:00" });
    expect(created).toEqual({
      ok: true,
      data: { id: "evt_live", title: "Live bring-up smoke", start: "2026-05-09 01:00", end: undefined },
    });
    expect(urls.some((url) => url.includes("/tenant_access_token/internal"))).toBe(true);
    expect(urls.some((url) => url.includes("/open-apis/calendar/v4/calendars/cal_test/events"))).toBe(true);
  });

  it("refreshes tenant token for each calendar operation so long-running servers do not reuse stale tokens", async () => {
    const authorizations: string[] = [];
    let tokenCount = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      if (String(url).includes("/tenant_access_token/internal")) {
        tokenCount += 1;
        return jsonResponse({ code: 0, tenant_access_token: `tenant-token-${tokenCount}` });
      }

      authorizations.push(new Headers(init?.headers).get("authorization") || "");
      return jsonResponse({
        code: 0,
        data: {
          event: {
            event_id: `evt_${authorizations.length}`,
            summary: "Token refresh smoke",
            start_time: { timestamp: "1778259600", timezone: "Asia/Shanghai" },
          },
        },
      });
    };

    const result = await createLiveFeishuCalendarAdapter({
      config: {
        appId: "cli_test",
        appSecret: "secret-feishu-key",
        calendarId: "cal_test",
        timezone: "Asia/Shanghai",
      },
      fetch: fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    await result.data.createEvent({ title: "Token refresh smoke", date: "2026-05-09", startTime: "09:00" });
    await result.data.createEvent({ title: "Token refresh smoke", date: "2026-05-09", startTime: "10:00" });

    expect(authorizations).toEqual(["Bearer tenant-token-2", "Bearer tenant-token-3"]);
  });

  it("uses the injected fetch for both auth and calendar requests", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      urls.push(String(url));
      if (String(url).includes("/tenant_access_token/internal")) {
        return jsonResponse({ code: 0, tenant_access_token: "tenant-token" });
      }
      return jsonResponse({ code: 0, data: { items: [] } });
    };

    const result = await createLiveFeishuCalendarAdapter({
      config: {
        appId: "cli_test",
        appSecret: "secret-feishu-key",
        calendarId: "cal_test",
        timezone: "Asia/Shanghai",
      },
      fetch: fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    await result.data.listEvents({ date: "2026-05-09" });

    expect(urls.filter((url) => url.includes("/tenant_access_token/internal")).length).toBe(2);
    expect(urls.some((url) => url.includes("/open-apis/calendar/v4/calendars/cal_test/events"))).toBe(true);
  });
});
