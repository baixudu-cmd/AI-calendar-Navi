// OpenClaw shadow HTTP server：只暴露本机最小 POST 入口，不绑定微信 SDK。

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { CalendarAgentResponse } from "./index.js";
import type { ControlledShadowRouteRequest } from "./controlled-shadow-route.js";

export type ShadowHttpRoute = (request: ControlledShadowRouteRequest) => Promise<CalendarAgentResponse>;

export type CreateShadowHttpServerInput = {
  route: ShadowHttpRoute;
  path?: string;
};

export type StartShadowHttpServerInput = CreateShadowHttpServerInput & {
  host?: string;
  port?: number;
};

// 创建本机 shadow HTTP server，默认只接受 POST /calendar-agent/shadow。
export function createShadowHttpServer(input: CreateShadowHttpServerInput): Server {
  const routePath = input.path || "/calendar-agent/shadow";

  return createServer(async (request, response) => {
    if (request.url?.split("?")[0] !== routePath) {
      writeJson(response, 404, { ok: false, error: "not_found" });
      return;
    }

    if (request.method !== "POST") {
      writeJson(response, 405, { ok: false, error: "method_not_allowed" });
      return;
    }

    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      writeJson(response, 400, { ok: false, error: "invalid_json" });
      return;
    }

    const routeResponse = await input.route(normalizeRequest(parsed.data));
    writeJson(response, 200, routeResponse);
  });
}

// 启动 shadow HTTP server，默认绑定 127.0.0.1，避免直接暴露到局域网。
export async function startShadowHttpServer(input: StartShadowHttpServerInput): Promise<Server> {
  const server = createShadowHttpServer(input);
  const host = input.host || "127.0.0.1";
  const port = input.port || 37891;
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  return server;
}

async function readJsonBody(request: IncomingMessage): Promise<{ ok: true; data: unknown } | { ok: false }> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  try {
    return { ok: true, data: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") };
  } catch {
    return { ok: false };
  }
}

function normalizeRequest(value: unknown): ControlledShadowRouteRequest {
  const record = isRecord(value) ? value : {};
  const media = normalizeMedia(record.media);
  return {
    text: readString(record.text),
    secret: readString(record.secret),
    ...(readString(record.requestId) ? { requestId: readString(record.requestId) } : {}),
    ...(readString(record.messageId) ? { messageId: readString(record.messageId) } : {}),
    ...(media ? { media } : {}),
  };
}

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeMedia(value: unknown): ControlledShadowRouteRequest["media"] | undefined {
  if (!isRecord(value)) return undefined;
  const mediaPath = readString(value.path);
  const mediaType = readString(value.type);
  if (!mediaPath || !mediaType) return undefined;
  return { path: mediaPath, type: mediaType };
}
