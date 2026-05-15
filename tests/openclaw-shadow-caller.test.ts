// OpenClaw shadow caller 测试：验证薄调用器只发最小字段，并对失败结果关闭处理。

import { once } from "node:events";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildOpenClawShadowPayload,
  callOpenClawShadowRoute,
  formatOpenClawShadowCallerOutput,
} from "../src/openclaw/shadow-caller.js";

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  server.close();
  await once(server, "close");
  server = undefined;
});

type TestServerReply = {
  status?: number;
  body: string;
  contentType?: string;
};

type CapturedRequest = {
  method?: string;
  url?: string;
  contentType?: string | string[];
  body: Record<string, unknown>;
};

// 启动本地临时 HTTP 服务，用来观察 caller 发出的真实请求。
async function startServer(reply: TestServerReply, captured: CapturedRequest[]) {
  server = createServer(async (request, response) => {
    captured.push({
      method: request.method,
      url: request.url,
      contentType: request.headers["content-type"],
      body: parseJsonBody(await readBody(request)),
    });
    response.writeHead(reply.status || 200, { "content-type": reply.contentType || "application/json; charset=utf-8" });
    response.end(reply.body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing server address");
  return `http://127.0.0.1:${address.port}/calendar-agent/shadow`;
}

// 读取请求体，保持测试对真实 HTTP 行为的覆盖。
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

// 测试服务只接收 caller 发送的 JSON；解析失败时直接暴露测试问题。
function parseJsonBody(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

describe("OpenClaw shadow caller", () => {
  it("builds a four-field payload and drops caller-only fields", () => {
    const payload = buildOpenClawShadowPayload({
      url: "http://127.0.0.1:1/calendar-agent/shadow",
      text: "明天下午三点见张总",
      messageId: "msg_1",
      requestId: "req_1",
      secret: "shadow-secret",
      decisionClient: "must-not-leak",
      calendar: "must-not-leak",
      state: "must-not-leak",
    });

    expect(Object.keys(payload).sort()).toEqual(["messageId", "requestId", "secret", "text"]);
    expect(payload).toEqual({
      text: "明天下午三点见张总",
      messageId: "msg_1",
      requestId: "req_1",
      secret: "shadow-secret",
    });
  });

  it("allows only the explicit media bridge fields when an image is present", () => {
    const payload = buildOpenClawShadowPayload({
      url: "http://127.0.0.1:1/calendar-agent/shadow",
      text: "",
      messageId: "msg_image",
      requestId: "req_image",
      secret: "shadow-secret",
      media: {
        path: "/tmp/openclaw-weixin/inbound/image.png",
        type: "image/png",
        url: "must-not-leak",
        bytes: "must-not-leak",
      },
      mediaPath: "/tmp/legacy-field-must-not-leak.png",
      decisionClient: "must-not-leak",
    });

    expect(Object.keys(payload).sort()).toEqual(["media", "messageId", "requestId", "secret", "text"]);
    expect(payload.media).toEqual({ path: "/tmp/openclaw-weixin/inbound/image.png", type: "image/png" });
    expect(JSON.stringify(payload)).not.toContain("legacy-field-must-not-leak");
    expect(JSON.stringify(payload)).not.toContain("must-not-leak");
  });

  it("posts JSON to the configured url and parses a successful CalendarAgentResponse", async () => {
    const captured: CapturedRequest[] = [];
    const url = await startServer(
      {
        body: JSON.stringify({
          ok: true,
          reply: "已创建：见张总",
          actionType: "create_event",
          requestId: "req_1",
        }),
      },
      captured,
    );

    const result = await callOpenClawShadowRoute({
      url,
      text: "明天下午三点见张总",
      messageId: "msg_1",
      requestId: "req_1",
      secret: "shadow-secret",
      calendar: "must-not-leak",
    });

    expect(result).toEqual({
      ok: true,
      reply: "已创建：见张总",
      actionType: "create_event",
      requestId: "req_1",
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ method: "POST", url: "/calendar-agent/shadow" });
    expect(String(captured[0].contentType)).toContain("application/json");
    expect(captured[0].body).toEqual({
      text: "明天下午三点见张总",
      messageId: "msg_1",
      requestId: "req_1",
      secret: "shadow-secret",
    });
  });

  it("posts the controlled media payload when provided", async () => {
    const captured: CapturedRequest[] = [];
    const url = await startServer(
      {
        body: JSON.stringify({
          ok: true,
          reply: "已收到图片。",
          actionType: "image_capture_dry_run",
          requestId: "req_media",
        }),
      },
      captured,
    );

    const result = await callOpenClawShadowRoute({
      url,
      text: "",
      messageId: "msg_media",
      requestId: "req_media",
      secret: "shadow-secret",
      media: { path: "/tmp/openclaw-weixin/inbound/image.png", type: "image/png" },
    });

    expect(result.actionType).toBe("image_capture_dry_run");
    expect(captured[0].body).toEqual({
      text: "",
      messageId: "msg_media",
      requestId: "req_media",
      secret: "shadow-secret",
      media: { path: "/tmp/openclaw-weixin/inbound/image.png", type: "image/png" },
    });
  });

  it("can format only the user-facing reply for Weixin forwarding", () => {
    const output = formatOpenClawShadowCallerOutput(
      {
        ok: true,
        reply: "没有找到日程。",
        actionType: "list_events",
        requestId: "req_1",
      },
      { replyOnly: true },
    );

    expect(output).toBe("没有找到日程。");
  });

  it("keeps diagnostic output for smoke runs by default", () => {
    const output = formatOpenClawShadowCallerOutput({
      ok: true,
      reply: "没有找到日程。",
      actionType: "list_events",
      requestId: "req_1",
    });

    expect(output).toContain("OpenClaw shadow caller smoke: passed");
    expect(output).toContain("requestId=req_1");
    expect(output).toContain("actionType=list_events");
    expect(output).toContain("没有找到日程。");
  });

  it("fails closed on non-2xx responses without leaking the secret", async () => {
    const captured: CapturedRequest[] = [];
    const url = await startServer({ status: 503, body: "shadow-secret upstream down" }, captured);

    await expect(
      callOpenClawShadowRoute({
        url,
        text: "查一下明天日程",
        messageId: "msg_2",
        requestId: "req_2",
        secret: "shadow-secret",
      }),
    ).rejects.toThrow(/OpenClaw shadow route failed/);

    await expect(
      callOpenClawShadowRoute({
        url,
        text: "查一下明天日程",
        messageId: "msg_3",
        requestId: "req_3",
        secret: "shadow-secret",
      }),
    ).rejects.not.toThrow(/shadow-secret/);
  });

  it("fails closed on malformed JSON without leaking the secret", async () => {
    const captured: CapturedRequest[] = [];
    const url = await startServer({ body: "{shadow-secret" }, captured);

    await expect(
      callOpenClawShadowRoute({
        url,
        text: "查一下明天日程",
        messageId: "msg_bad_json",
        requestId: "req_bad_json",
        secret: "shadow-secret",
      }),
    ).rejects.toThrow(/invalid JSON/);

    await expect(
      callOpenClawShadowRoute({
        url,
        text: "查一下明天日程",
        messageId: "msg_bad_json_2",
        requestId: "req_bad_json_2",
        secret: "shadow-secret",
      }),
    ).rejects.not.toThrow(/shadow-secret/);
  });

  it("returns business failure replies without throwing or leaking the secret", async () => {
    const captured: CapturedRequest[] = [];
    const url = await startServer(
      {
        body: JSON.stringify({
          ok: false,
          reply: "secret 校验失败：shadow-secret",
          actionType: "rejected",
          requestId: "req_business_failed",
        }),
      },
      captured,
    );

    const result = await callOpenClawShadowRoute({
      url,
      text: "查一下明天日程",
      messageId: "msg_business_failed",
      requestId: "req_business_failed",
      secret: "shadow-secret",
    });

    expect(result).toEqual({
      ok: false,
      reply: "secret 校验失败：[redacted]",
      actionType: "rejected",
      requestId: "req_business_failed",
    });
  });

  it("keeps forbidden modules out of the caller import boundary", () => {
    const content = readFileSync(join(process.cwd(), "src/openclaw/shadow-caller.ts"), "utf8");
    const importLines = content
      .split("\n")
      .filter((line) => line.trim().startsWith("import "))
      .join("\n");

    for (const forbidden of ["agent-api", "calendar-api", "decision", "feishu", "wechat", "openclaw"]) {
      expect(importLines.toLowerCase()).not.toContain(forbidden);
    }
  });
});
