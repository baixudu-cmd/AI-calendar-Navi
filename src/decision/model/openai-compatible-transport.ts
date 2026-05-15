// OpenAI-compatible 模型 transport：只负责 HTTP 调用和安全错误，不解析日程语义。

import { type ModelDecisionTransport } from "./client.js";

export type OpenAICompatibleTransportOptions = {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  requestOptions?: Record<string, unknown>;
};

// 创建 OpenAI-compatible chat completions transport。
export function createOpenAICompatibleTransport(options: OpenAICompatibleTransportOptions): ModelDecisionTransport {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  return async ({ model, messages }) => {
    let response: Response;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...(options.requestOptions || {}), model, messages, temperature: 0 }),
        signal: controller.signal,
      });

      response = options.timeoutMs
        ? await Promise.race([
            request,
            new Promise<Response>((_resolve, reject) => {
              timeout = setTimeout(() => {
                controller.abort();
                reject(new Error("model_timeout"));
              }, options.timeoutMs);
            }),
          ])
        : await request;
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.message === "model_timeout")) {
        throw new Error("模型服务调用超时，请检查 provider 响应速度。");
      }
      throw new Error("模型服务调用失败，请检查网络或 provider 配置。");
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`模型服务返回 ${response.status}，请检查 provider 配置。`);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new Error("模型服务返回格式不可解析。");
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error("模型服务没有返回可用文本。");
    }

    return { content };
  };
}
