// 结构化输出探针：只调用模型 provider，验证 response_format 能力，不触达日历或渠道。

import "dotenv/config";
import {
  createCalendarToolCallRequestOptions,
  createModelDecisionClient,
  createOpenAICompatibleTransport,
} from "../decision/model/index.js";
import { createShortTermStateStore } from "../state/index.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

try {
  const baseUrl = requireEnv("MODEL_BASE_URL");
  const apiKey = requireEnv("MODEL_API_KEY");
  const model = requireEnv("MODEL_NAME");
  const client = createModelDecisionClient({
    model,
    transport: createOpenAICompatibleTransport({
      baseUrl,
      apiKey,
      timeoutMs: Number(process.env.STRUCTURED_OUTPUT_PROBE_TIMEOUT_MS || "30000"),
      requestOptions: createCalendarToolCallRequestOptions(),
    }),
  });

  const decision = await client.decide({
    text: process.env.STRUCTURED_OUTPUT_PROBE_TEXT || "看看明天日程",
    state: createShortTermStateStore().snapshot(),
    now: process.env.STRUCTURED_OUTPUT_PROBE_NOW || "2026-05-09T09:00:00+08:00",
    timezone: process.env.TIMEZONE || "Asia/Shanghai",
  });

  if (typeof decision === "object" && decision !== null && "type" in decision) {
    console.log("Structured output probe: passed");
    console.log(`Action: ${String((decision as { type: unknown }).type)}`);
  } else {
    console.log("Structured output probe: failed");
    console.log("模型返回内容未通过工具 Schema。");
    process.exitCode = 1;
  }
} catch (error) {
  console.log("Structured output probe: failed");
  console.log(error instanceof Error ? error.message : "未知错误");
  process.exitCode = 1;
}
