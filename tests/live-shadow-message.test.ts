import { describe, expect, it } from "vitest";
import { runShadowMessageSmoke, type ShadowMessageHandler } from "../src/live/index.js";

const config = {
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
  wechatEntrySecret: "secret-shadow",
};

describe("live shadow message smoke", () => {
  it("rejects wrong secret before calling handler", async () => {
    let called = false;
    const result = await runShadowMessageSmoke({
      config,
      requestId: "req_1",
      messageId: "msg_1",
      secret: "wrong",
      text: "看看明天日程",
      seenMessageIds: new Set(),
      handler: async () => {
        called = true;
        return { ok: true, reply: "should not call" };
      },
    });

    expect(result).toEqual({
      ok: false,
      requestId: "req_1",
      messageId: "msg_1",
      status: "rejected",
      reason: "wrong_secret",
      reply: "入口密钥不正确。",
    });
    expect(called).toBe(false);
  });

  it("rejects empty text before calling handler", async () => {
    let called = false;
    const result = await runShadowMessageSmoke({
      config,
      requestId: "req_2",
      messageId: "msg_2",
      secret: "secret-shadow",
      text: "   ",
      seenMessageIds: new Set(),
      handler: async () => {
        called = true;
        return { ok: true, reply: "should not call" };
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("rejected");
      expect(result.reason).toBe("empty_input");
    }
    expect(called).toBe(false);
  });

  it("rejects duplicate message id before calling handler", async () => {
    let called = false;
    const result = await runShadowMessageSmoke({
      config,
      requestId: "req_3",
      messageId: "msg_3",
      secret: "secret-shadow",
      text: "看看明天日程",
      seenMessageIds: new Set(["msg_3"]),
      handler: async () => {
        called = true;
        return { ok: true, reply: "should not call" };
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("rejected");
      expect(result.reason).toBe("duplicate_message");
    }
    expect(called).toBe(false);
  });

  it("calls injected handler and returns observable ids", async () => {
    const calls: unknown[] = [];
    const handler: ShadowMessageHandler = async (message) => {
      calls.push(message);
      return { ok: true, reply: "shadow reply" };
    };

    const result = await runShadowMessageSmoke({
      config,
      requestId: "req_4",
      messageId: "msg_4",
      secret: "secret-shadow",
      text: "看看明天日程",
      seenMessageIds: new Set(),
      handler,
    });

    expect(result).toEqual({
      ok: true,
      requestId: "req_4",
      messageId: "msg_4",
      status: "handled",
      reply: "shadow reply",
    });
    expect(calls).toEqual([{ id: "msg_4", kind: "text", text: "看看明天日程" }]);
  });
});
