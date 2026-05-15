import { once } from "node:events";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createShadowHttpServer, type ShadowHttpRoute } from "../src/agent-api/shadow-http-server.js";

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  server.close();
  await once(server, "close");
  server = undefined;
});

async function start(route: ShadowHttpRoute) {
  server = createShadowHttpServer({ route });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing server address");
  return `http://127.0.0.1:${address.port}`;
}

describe("shadow HTTP server", () => {
  it("rejects non-POST requests without invoking route", async () => {
    let calls = 0;
    const baseUrl = await start(async () => {
      calls += 1;
      return { ok: true, reply: "bad", actionType: "bad", requestId: "bad" };
    });

    const response = await fetch(`${baseUrl}/calendar-agent/shadow`);
    const body = await response.json();

    expect(response.status).toBe(405);
    expect(body).toEqual({ ok: false, error: "method_not_allowed" });
    expect(calls).toBe(0);
  });

  it("rejects unknown paths without invoking route", async () => {
    let calls = 0;
    const baseUrl = await start(async () => {
      calls += 1;
      return { ok: true, reply: "bad", actionType: "bad", requestId: "bad" };
    });

    const response = await fetch(`${baseUrl}/wrong`, { method: "POST", body: "{}" });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ ok: false, error: "not_found" });
    expect(calls).toBe(0);
  });

  it("rejects malformed JSON without invoking route", async () => {
    let calls = 0;
    const baseUrl = await start(async () => {
      calls += 1;
      return { ok: true, reply: "bad", actionType: "bad", requestId: "bad" };
    });

    const response = await fetch(`${baseUrl}/calendar-agent/shadow`, { method: "POST", body: "{bad" });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ ok: false, error: "invalid_json" });
    expect(calls).toBe(0);
  });

  it("returns controlled route response without leaking secret", async () => {
    const baseUrl = await start(async (request) => ({
      ok: request.secret === "shadow-secret",
      reply: request.secret === "shadow-secret" ? "已创建：见张总" : "secret 校验失败。",
      actionType: request.secret === "shadow-secret" ? "create_event" : "rejected",
      requestId: request.requestId || "generated",
    }));

    const response = await fetch(`${baseUrl}/calendar-agent/shadow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "2026年5月9日下午3点见张总",
        messageId: "msg_1",
        requestId: "req_1",
        secret: "shadow-secret",
      }),
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      ok: true,
      reply: "已创建：见张总",
      actionType: "create_event",
      requestId: "req_1",
    });
    expect(text).not.toContain("shadow-secret");
  });

  it("normalizes optional media fields and drops unapproved media data", async () => {
    let captured: unknown;
    const baseUrl = await start(async (request) => {
      captured = request;
      return {
        ok: true,
        reply: "已收到图片。",
        actionType: "image_capture_dry_run",
        requestId: request.requestId || "generated",
      };
    });

    const response = await fetch(`${baseUrl}/calendar-agent/shadow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "",
        messageId: "msg_media",
        requestId: "req_media",
        secret: "shadow-secret",
        media: {
          path: "/tmp/openclaw-weixin/inbound/image.png",
          type: "image/png",
          fullUrl: "must-not-pass",
          bytes: "must-not-pass",
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(captured).toEqual({
      text: "",
      messageId: "msg_media",
      requestId: "req_media",
      secret: "shadow-secret",
      media: { path: "/tmp/openclaw-weixin/inbound/image.png", type: "image/png" },
    });
  });

  it("passes wrong secret to controlled route and still redacts response", async () => {
    const baseUrl = await start(async (request) => ({
      ok: false,
      reply: request.secret === "shadow-secret" ? "ok" : "secret 校验失败。",
      actionType: "rejected",
      requestId: request.requestId || "generated",
    }));

    const response = await fetch(`${baseUrl}/calendar-agent/shadow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "x", requestId: "req_bad", secret: "bad-secret" }),
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      ok: false,
      reply: "secret 校验失败。",
      actionType: "rejected",
      requestId: "req_bad",
    });
    expect(text).not.toContain("bad-secret");
  });
});
