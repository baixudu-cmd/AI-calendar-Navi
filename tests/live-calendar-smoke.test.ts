import { describe, expect, it } from "vitest";
import type { DeterministicCalendarAdapter } from "../src/calendar-api/index.js";
import {
  runCalendarApiDryRunSmoke,
  runCalendarApiDryRunSmokeWithGate,
  type LiveCalendarApi,
  type LiveConfigGateReport,
} from "../src/live/index.js";

const passedGate: LiveConfigGateReport = {
  ok: true,
  failures: [],
  diagnostics: { missing: [], values: { FEISHU_CALENDAR_ID: "test-calendar-id" } },
};

const passedConfig = {
  appName: "minical-agent",
  timezone: "Asia/Shanghai",
  modelProvider: "openai-compatible",
  modelBaseUrl: "https://example.test/v1",
  modelApiKey: "secret-model-key",
  modelName: "fake-model",
  feishuAppId: "app-id",
  feishuAppSecret: "secret-feishu-key",
  feishuCalendarId: "test-calendar-id",
  feishuTestCalendarId: "test-calendar-id",
  openclawWorkspace: "/home/example/.openclaw",
  wechatEntrySecret: "secret-wechat-key",
};

function createAdapter(): DeterministicCalendarAdapter & { directCalls: string[] } {
  const directCalls: string[] = [];
  return {
    directCalls,
    async createEvent(event) {
      directCalls.push(`direct-create:${event.title}`);
      return { ok: true, data: { id: "evt_1", title: event.title, start: `${event.date} ${event.startTime}` } };
    },
    async listEvents(input) {
      directCalls.push(`direct-list:${input.date}`);
      return { ok: true, data: [{ id: "evt_1", title: "测试日程", start: `${input.date} 09:00` }] };
    },
    async updateEvent(input) {
      directCalls.push(`direct-update:${input.eventId}`);
      return { ok: true, data: { id: input.eventId, title: input.patch.title || "测试日程", start: "" } };
    },
    async deleteEvent(input) {
      directCalls.push(`direct-delete:${input.eventId}`);
      return { ok: true, data: { eventId: input.eventId } };
    },
  };
}

describe("live calendar smoke scaffold", () => {
  it("uses injected calendar API wrappers for create/list/update/delete", async () => {
    const adapter = createAdapter();
    const apiCalls: string[] = [];
    const api: LiveCalendarApi = {
      async createEvent(innerAdapter, event) {
        apiCalls.push(`api-create:${event.title}`);
        return innerAdapter.createEvent(event);
      },
      async listEvents(innerAdapter, input) {
        apiCalls.push(`api-list:${input.date}`);
        return innerAdapter.listEvents(input);
      },
      async updateEvent(innerAdapter, input) {
        apiCalls.push(`api-update:${input.eventId}`);
        return innerAdapter.updateEvent(input);
      },
      async deleteEvent(innerAdapter, input) {
        apiCalls.push(`api-delete:${input.eventId}`);
        return innerAdapter.deleteEvent(input);
      },
    };

    const result = await runCalendarApiDryRunSmokeWithGate({
      adapter,
      api,
      gate: passedGate,
      date: "2026-05-09",
      startTime: "09:00",
    });

    expect(result.ok).toBe(true);
    expect(result.steps.map((step) => step.name)).toEqual(["create", "list", "update", "delete"]);
    expect(apiCalls).toEqual([
      "api-create:Live bring-up smoke",
      "api-list:2026-05-09",
      "api-update:evt_1",
      "api-delete:evt_1",
    ]);
    expect(adapter.directCalls).toEqual([
      "direct-create:Live bring-up smoke",
      "direct-list:2026-05-09",
      "direct-update:evt_1",
      "direct-delete:evt_1",
    ]);
  });

  it("stops before delete when create does not return an event id", async () => {
    const adapter = createAdapter();
    const api: LiveCalendarApi = {
      async createEvent() {
        return { ok: true, data: { id: "", title: "bad", start: "" } };
      },
      async listEvents(innerAdapter, input) {
        return innerAdapter.listEvents(input);
      },
      async updateEvent(innerAdapter, input) {
        return innerAdapter.updateEvent(input);
      },
      async deleteEvent(innerAdapter, input) {
        return innerAdapter.deleteEvent(input);
      },
    };

    const result = await runCalendarApiDryRunSmokeWithGate({
      adapter,
      api,
      gate: passedGate,
      date: "2026-05-09",
      startTime: "09:00",
    });

    expect(result.ok).toBe(false);
    expect(result.steps.map((step) => step.name)).toEqual(["create"]);
    expect(adapter.directCalls).toEqual([]);
  });

  it("does not run calendar actions when live config gate failed", async () => {
    const adapter = createAdapter();
    const result = await runCalendarApiDryRunSmokeWithGate({
      adapter,
      gate: {
        ok: false,
        failures: ["live bring-up 不能使用 primary 日历，请配置专用测试日历 ID。"],
        diagnostics: { missing: [], values: { FEISHU_CALENDAR_ID: "primary" } },
      },
      date: "2026-05-09",
      startTime: "09:00",
    });

    expect(result).toEqual({
      ok: false,
      steps: [
        {
          name: "config",
          ok: false,
          message: "live bring-up 不能使用 primary 日历，请配置专用测试日历 ID。",
        },
      ],
    });
    expect(adapter.directCalls).toEqual([]);
  });

  it("official entry runs config gate internally before calendar actions", async () => {
    const adapter = createAdapter();

    const result = await runCalendarApiDryRunSmoke({
      adapter,
      config: {
        appName: "minical-agent",
        timezone: "Asia/Shanghai",
        feishuCalendarId: "primary",
      },
      date: "2026-05-09",
      startTime: "09:00",
    });

    expect(result.ok).toBe(false);
    expect(result.steps).toEqual([
      {
        name: "config",
        ok: false,
        message: expect.stringContaining("live bring-up 不能使用 primary 日历"),
      },
    ]);
    expect(adapter.directCalls).toEqual([]);
  });

  it("official entry uses the default calendar API wrappers and does not accept custom api injection", async () => {
    const adapter = createAdapter();

    const result = await runCalendarApiDryRunSmoke({
      adapter,
      config: passedConfig,
      date: "2026-05-09",
      startTime: "09:00",
    });

    expect(result.ok).toBe(true);
    expect(adapter.directCalls).toEqual([
      "direct-create:Live bring-up smoke",
      "direct-list:2026-05-09",
      "direct-update:evt_1",
      "direct-delete:evt_1",
    ]);
  });
});
