// 真实模型到 Calendar Agent API 的 smoke：只使用 fake 日历，不写飞书。

import "dotenv/config";
import { type CalendarAdapter } from "../calendar/action-executor.js";
import {
  createCalendarToolCallRequestOptions,
  createModelDecisionClient,
  createOpenAICompatibleTransport,
} from "../decision/model/index.js";
import { createShortTermStateStore } from "../state/index.js";
import { handleCalendarAgentRequest } from "./index.js";

// 读取必填环境变量；缺失时直接失败关闭。
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

// 创建内存日历 adapter；用于验证模型合同，不触达真实日历。
function createFakeCalendar(): CalendarAdapter {
  return {
    async createEvent(event) {
      return {
        ok: true,
        data: { id: "evt_model_smoke", title: event.title, start: `${event.date} ${event.startTime}` },
      };
    },
    async listEvents() {
      return { ok: true, data: [] };
    },
    async updateEvent(input) {
      return { ok: true, data: { id: input.eventId, title: input.patch.title || "已修改日程", start: "" } };
    },
    async deleteEvent(input) {
      return { ok: true, data: { eventId: input.eventId } };
    },
  };
}

try {
  const baseUrl = requireEnv("MODEL_BASE_URL");
  const apiKey = requireEnv("MODEL_API_KEY");
  const model = requireEnv("MODEL_NAME");
  const text = process.env.AGENT_MODEL_SMOKE_TEXT || "明天下午三点见张总";

  const decisionClient = createModelDecisionClient({
    model,
    transport: createOpenAICompatibleTransport({
      baseUrl,
      apiKey,
      requestOptions: createCalendarToolCallRequestOptions(),
    }),
  });

  const result = await handleCalendarAgentRequest({
    text,
    requestId: "agent_model_smoke",
    state: createShortTermStateStore(),
    decisionClient,
    calendar: createFakeCalendar(),
  });

  console.log(`Agent model smoke: ${result.ok ? "passed" : "failed"}`);
  console.log(`Action: ${result.actionType}`);
  console.log(result.reply);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.log("Agent model smoke: failed");
  console.log(error instanceof Error ? error.message : "未知错误");
  process.exitCode = 1;
}
