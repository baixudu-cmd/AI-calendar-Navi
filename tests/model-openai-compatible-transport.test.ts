// OpenAI-compatible transport 测试：验证请求格式、地址处理和安全错误。

import { describe, expect, it } from "vitest";
import { createOpenAICompatibleTransport } from "../src/decision/model/index.js";

describe("openai compatible model transport", () => {
  it("posts chat completion request and returns message content", async () => {
    const calls: unknown[] = [];
    const transport = createOpenAICompatibleTransport({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-api-key",
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "{\"action\":\"list_events\",\"date\":\"2026-05-09\"}" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const result = await transport({ model: "mimo-v2.5-pro", messages: [{ role: "user", content: "hello" }] });

    expect(result.content).toContain("list_events");
    expect(calls[0]).toMatchObject({
      url: "https://example.test/v1/chat/completions",
      init: {
        method: "POST",
        headers: {
          authorization: "Bearer secret-api-key",
          "content-type": "application/json",
        },
      },
    });
    expect(JSON.parse(String((calls[0] as { init: RequestInit }).init.body))).toMatchObject({
      model: "mimo-v2.5-pro",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0,
    });
  });

  it("trims trailing slash from base url", async () => {
    let requestedUrl = "";
    const transport = createOpenAICompatibleTransport({
      baseUrl: "https://example.test/v1/",
      apiKey: "secret-api-key",
      fetch: async (url) => {
        requestedUrl = String(url);
        return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
      },
    });

    await transport({ model: "mimo-v2.5-pro", messages: [] });

    expect(requestedUrl).toBe("https://example.test/v1/chat/completions");
  });

  it("can include optional structured output request parameters", async () => {
    const calls: unknown[] = [];
    const transport = createOpenAICompatibleTransport({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-api-key",
      requestOptions: {
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "calendar_tool_call",
            schema: {
              type: "object",
              required: ["toolName", "arguments"],
              properties: {
                toolName: { type: "string" },
                arguments: { type: "object" },
              },
            },
          },
        },
      },
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    toolName: "calendar.list_events",
                    arguments: { date: "2026-05-09" },
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await transport({ model: "mimo-v2.5-pro", messages: [{ role: "user", content: "hello" }] });

    expect(JSON.parse(String((calls[0] as { init: RequestInit }).init.body))).toMatchObject({
      model: "mimo-v2.5-pro",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "calendar_tool_call",
        },
      },
    });
  });

  it("does not let request options override core chat completion fields", async () => {
    const calls: unknown[] = [];
    const transport = createOpenAICompatibleTransport({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-api-key",
      requestOptions: {
        model: "wrong-model",
        messages: [{ role: "user", content: "wrong" }],
        temperature: 1,
        response_format: { type: "json_object" },
      },
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
      },
    });

    await transport({ model: "mimo-v2.5-pro", messages: [{ role: "user", content: "hello" }] });

    expect(JSON.parse(String((calls[0] as { init: RequestInit }).init.body))).toMatchObject({
      model: "mimo-v2.5-pro",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0,
      response_format: { type: "json_object" },
    });
  });

  it("throws safe error without leaking api key when provider fails", async () => {
    const transport = createOpenAICompatibleTransport({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-api-key",
      fetch: async () => new Response(JSON.stringify({ error: { message: "bad secret-api-key" } }), { status: 401 }),
    });

    await expect(transport({ model: "mimo-v2.5-pro", messages: [] })).rejects.toThrow("模型服务返回 401");
    await expect(transport({ model: "mimo-v2.5-pro", messages: [] })).rejects.not.toThrow("secret-api-key");
  });

  it("throws safe error without leaking api key when network throws", async () => {
    const transport = createOpenAICompatibleTransport({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-api-key",
      fetch: async () => {
        throw new Error("network failed with secret-api-key");
      },
    });

    await expect(transport({ model: "mimo-v2.5-pro", messages: [] })).rejects.toThrow("模型服务调用失败");
    await expect(transport({ model: "mimo-v2.5-pro", messages: [] })).rejects.not.toThrow("secret-api-key");
  });

  it("aborts slow provider requests at the configured timeout", async () => {
    let signal: AbortSignal | undefined;
    const transport = createOpenAICompatibleTransport({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-api-key",
      timeoutMs: 5,
      fetch: async (_url, init) => {
        signal = init?.signal ?? undefined;
        return new Promise(() => {});
      },
    });

    await expect(transport({ model: "mimo-v2.5-pro", messages: [] })).rejects.toThrow("模型服务调用超时");
    expect(signal?.aborted).toBe(true);
  });
});
