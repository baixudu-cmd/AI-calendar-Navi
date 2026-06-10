// P38 微信轻量 bridge 测试：验证 ClawBot 协议封装、入站归一化和双租户隔离。

import { describe, expect, it } from "vitest";
import type { CalendarAdapter } from "../src/calendar/action-executor.js";
import type { EventDraft } from "../src/contract/index.js";
import type { DecisionClient } from "../src/decision/index.js";
import { createClawBotApi } from "../src/wechat-bridge/clawbot-api.js";
import { createMemoryContextTokenStore } from "../src/wechat-bridge/context-token-store.js";
import { createNaviWeChatBridgeHandler } from "../src/wechat-bridge/handler.js";
import { normalizeClawBotMessage } from "../src/wechat-bridge/inbound.js";
import { createMemoryTenantStore } from "../src/wechat-bridge/tenant-store.js";
import { createMemoryTenantRuntimeRegistry } from "../src/tenant-runtime/index.js";
import type { ClawBotMessage } from "../src/wechat-bridge/types.js";

describe("clawbot api", () => {
  it("posts getUpdates with the per-account cursor", async () => {
    const calls: unknown[] = [];
    const api = createClawBotApi({
      fetch: async (_url, init) => {
        calls.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ret: 0, msgs: [], get_updates_buf: "next", longpolling_timeout_ms: 35000 }));
      },
    });

    const result = await api.getUpdates({
      accountId: "account-a",
      baseUrl: "https://ilinkai.weixin.qq.com",
      token: "token-a",
      cursor: "cursor-a",
    });

    expect(result).toMatchObject({ ok: true, cursor: "next" });
    expect(calls).toEqual([{ get_updates_buf: "cursor-a" }]);
  });

  it("sends text with target and context token", async () => {
    const bodies: unknown[] = [];
    const api = createClawBotApi({
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ret: 0 }));
      },
    });

    const result = await api.sendText({
      accountId: "account-a",
      baseUrl: "https://ilinkai.weixin.qq.com",
      token: "token-a",
      toUserId: "user-a@im.wechat",
      contextToken: "ctx-a",
      text: "收到",
    });

    expect(result.ok).toBe(true);
    expect(bodies[0]).toMatchObject({
      msg: {
        to_user_id: "user-a@im.wechat",
        context_token: "ctx-a",
        item_list: [{ type: 1, text_item: { text: "收到" } }],
      },
    });
  });
});

describe("tenant and context stores", () => {
  it("resolves tenant by account and wechat user", async () => {
    const store = createMemoryTenantStore([
      { tenantId: "tenant-a", accountId: "account-a", wechatUserId: "user-a@im.wechat" },
      { tenantId: "tenant-b", accountId: "account-b", wechatUserId: "user-a@im.wechat" },
    ]);

    await expect(store.resolve({ accountId: "account-a", wechatUserId: "user-a@im.wechat" })).resolves.toEqual({ ok: true, tenantId: "tenant-a" });
    await expect(store.resolve({ accountId: "account-b", wechatUserId: "user-a@im.wechat" })).resolves.toEqual({ ok: true, tenantId: "tenant-b" });
  });

  it("stores context tokens per account and user", async () => {
    const store = createMemoryContextTokenStore();
    await store.set({ accountId: "account-a", wechatUserId: "user-a@im.wechat", contextToken: "ctx-a" });
    await store.set({ accountId: "account-b", wechatUserId: "user-a@im.wechat", contextToken: "ctx-b" });

    await expect(store.get({ accountId: "account-a", wechatUserId: "user-a@im.wechat" })).resolves.toBe("ctx-a");
    await expect(store.get({ accountId: "account-b", wechatUserId: "user-a@im.wechat" })).resolves.toBe("ctx-b");
  });
});

describe("inbound normalization", () => {
  it("normalizes text message into Navi bridge input", () => {
    const result = normalizeClawBotMessage({
      accountId: "account-a",
      message: textMessage(123, "user-a@im.wechat", "ctx-a", "明天上午 10 点开会"),
    });

    expect(result).toEqual({
      ok: true,
      message: {
        accountId: "account-a",
        wechatUserId: "user-a@im.wechat",
        messageId: "account-a:123",
        contextToken: "ctx-a",
        text: "明天上午 10 点开会",
      },
    });
  });

  it("uses voice transcription text when present", () => {
    const result = normalizeClawBotMessage({
      accountId: "account-a",
      message: {
        message_id: 124,
        from_user_id: "user-a@im.wechat",
        item_list: [{ type: 3, voice_item: { text: "下午提醒我写材料" } }],
      },
    });

    expect(result.ok && result.message.text).toBe("下午提醒我写材料");
  });
});

describe("navi wechat bridge handler", () => {
  it("routes two users to isolated calendars and replies through original account", async () => {
    const sent: Array<{ accountId: string; toUserId: string; text: string; contextToken?: string }> = [];
    const calendarWrites: Record<string, string[]> = { "tenant-a": [], "tenant-b": [] };

    const handler = createNaviWeChatBridgeHandler({
      tenantStore: createMemoryTenantStore([
        { tenantId: "tenant-a", accountId: "account-a", wechatUserId: "user-a@im.wechat" },
        { tenantId: "tenant-b", accountId: "account-b", wechatUserId: "user-b@im.wechat" },
      ]),
      contextTokenStore: createMemoryContextTokenStore(),
      runtimeRegistry: createMemoryTenantRuntimeRegistry({
        createCalendar: (tenantId) => createRecordingCalendar(calendarWrites[tenantId] || []),
      }),
      decisionClient: decisionClient({
        type: "create_event",
        event: { title: "开会", date: "2026-06-01", startTime: "10:00" },
      }),
      clawbotApi: {
        sendText: async (input) => {
          sent.push(input);
          return { ok: true, messageId: "sent" };
        },
      },
    });

    await handler.handleIncoming({ accountId: "account-a", message: textMessage(1, "user-a@im.wechat", "ctx-a", "明天 10 点开会") });
    await handler.handleIncoming({ accountId: "account-b", message: textMessage(1, "user-b@im.wechat", "ctx-b", "明天 10 点开会") });

    expect(calendarWrites["tenant-a"]).toEqual(["开会"]);
    expect(calendarWrites["tenant-b"]).toEqual(["开会"]);
    expect(sent.map((item) => [item.accountId, item.toUserId, item.contextToken])).toEqual([
      ["account-a", "user-a@im.wechat", "ctx-a"],
      ["account-b", "user-b@im.wechat", "ctx-b"],
    ]);
  });

  it("fails closed for unknown tenant without calling model or calendar", async () => {
    let modelCalled = false;
    const handler = createNaviWeChatBridgeHandler({
      tenantStore: createMemoryTenantStore([]),
      contextTokenStore: createMemoryContextTokenStore(),
      runtimeRegistry: createMemoryTenantRuntimeRegistry({ createCalendar: () => createRecordingCalendar([]) }),
      decisionClient: {
        async decide() {
          modelCalled = true;
          return { type: "status_overview" };
        },
      },
      clawbotApi: {
        async sendText() {
          throw new Error("should not reply through ClawBot for unknown tenant");
        },
      },
    });

    const result = await handler.handleIncoming({ accountId: "unknown", message: textMessage(9, "user-x@im.wechat", "ctx-x", "明天开会") });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unknown tenant should fail closed");
    expect(result.message).toContain("未绑定");
    expect(modelCalled).toBe(false);
  });

  it("ignores duplicate message id inside the same account", async () => {
    const calendarWrites: string[] = [];
    const handler = createNaviWeChatBridgeHandler({
      tenantStore: createMemoryTenantStore([{ tenantId: "tenant-a", accountId: "account-a", wechatUserId: "user-a@im.wechat" }]),
      contextTokenStore: createMemoryContextTokenStore(),
      runtimeRegistry: createMemoryTenantRuntimeRegistry({ createCalendar: () => createRecordingCalendar(calendarWrites) }),
      decisionClient: decisionClient({
        type: "create_event",
        event: { title: "开会", date: "2026-06-01", startTime: "10:00" },
      }),
      clawbotApi: {
        sendText: async () => ({ ok: true }),
      },
    });

    const first = await handler.handleIncoming({ accountId: "account-a", message: textMessage(7, "user-a@im.wechat", "ctx-a", "明天 10 点开会") });
    const second = await handler.handleIncoming({ accountId: "account-a", message: textMessage(7, "user-a@im.wechat", "ctx-a", "明天 10 点开会") });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(calendarWrites).toEqual(["开会"]);
  });
});

function textMessage(messageId: number, fromUserId: string, contextToken: string, text: string): ClawBotMessage {
  return {
    message_id: messageId,
    from_user_id: fromUserId,
    context_token: contextToken,
    item_list: [{ type: 1, text_item: { text } }],
  };
}

function decisionClient(decision: unknown): DecisionClient {
  return {
    async decide() {
      return decision;
    },
  };
}

function createRecordingCalendar(writes: string[]): CalendarAdapter {
  const events: Array<{ id: string; title: string; start: string; end: string }> = [];
  return {
    async createEvent(event: EventDraft) {
      writes.push(event.title);
      const created = {
        id: `evt_${writes.length}`,
        title: event.title,
        start: `${event.date} ${event.startTime}`,
        end: `${event.date} ${event.endTime || "11:00"}`,
      };
      events.push(created);
      return { ok: true, data: created };
    },
    async listEvents() {
      return { ok: true, data: structuredClone(events) };
    },
    async updateEvent() {
      return { ok: false, code: "api_error", message: "not implemented" };
    },
    async deleteEvent() {
      return { ok: false, code: "api_error", message: "not implemented" };
    },
  };
}
