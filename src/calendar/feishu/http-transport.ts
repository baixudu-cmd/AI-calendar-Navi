// 飞书 HTTP transport：把项目内部请求对象转成真实 OpenAPI 请求。

import type { FeishuTransport, FeishuTransportRequest, FeishuTransportResponse } from "./types.js";

export type CreateFeishuHttpTransportInput = {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
};

// 创建真实飞书 OpenAPI transport。
export function createFeishuHttpTransport(input: CreateFeishuHttpTransportInput = {}): FeishuTransport {
  const baseUrl = (input.baseUrl || "https://open.feishu.cn").replace(/\/+$/, "");
  const fetchImpl = input.fetch ?? globalThis.fetch;

  return {
    async request(request: FeishuTransportRequest): Promise<FeishuTransportResponse> {
      const url = buildUrl(baseUrl, request);
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (request.tenantAccessToken) headers.authorization = `Bearer ${request.tenantAccessToken}`;

      const response = await fetchImpl(url, {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = {};
      }

      return { status: response.status, body };
    },
  };
}

// 拼接路径和查询参数。
function buildUrl(baseUrl: string, request: FeishuTransportRequest): string {
  const url = new URL(request.path, baseUrl);
  for (const [key, value] of Object.entries(request.query || {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
