// 进阶飞书 smoke CLI：默认失败关闭，显式开关后才创建真实飞书测试日历 adapter。

import "dotenv/config";
import type { DeterministicCalendarAdapter } from "../calendar-api/index.js";
import { createLiveFeishuCalendarAdapter } from "../calendar/feishu/live-adapter.js";
import { loadConfig } from "../config/index.js";
import {
  createCalendarToolCallRequestOptions,
  createModelDecisionClient,
  createOpenAICompatibleTransport,
} from "../decision/model/index.js";
import { formatAdvancedFeishuSmokeReport, runAdvancedFeishuSmoke } from "./advanced-feishu-smoke.js";
import { evaluateLiveConfigGate } from "./config-gate.js";

const config = loadConfig();
const gate = evaluateLiveConfigGate(config);
const perCaseTimeoutMs = Number(process.env.LIVE_ADVANCED_FEISHU_CASE_TIMEOUT_MS || "30000");

const decisionClient = createModelDecisionClient({
  model: config.modelName || "",
  transport: createOpenAICompatibleTransport({
    baseUrl: config.modelBaseUrl || "",
    apiKey: config.modelApiKey || "",
    timeoutMs: perCaseTimeoutMs,
    requestOptions: createCalendarToolCallRequestOptions(),
  }),
});

const adapter = await resolveAdapter(gate.ok);
const result = await runAdvancedFeishuSmoke({
  adapter,
  config,
  decisionClient,
  today: process.env.LIVE_ADVANCED_FEISHU_SMOKE_DATE,
  now: process.env.LIVE_ADVANCED_FEISHU_SMOKE_NOW,
});

console.log(formatAdvancedFeishuSmokeReport(result));
if (!result.ok) process.exitCode = 1;

// 只有专用开关打开后才组装真实飞书 adapter。
async function resolveAdapter(liveConfigGatePassed: boolean): Promise<DeterministicCalendarAdapter> {
  if (!liveConfigGatePassed) {
    return disabledAdapter("live config gate 未通过，真实飞书 adapter 不会启用。");
  }

  if (process.env.LIVE_ADVANCED_FEISHU_ENABLE_REAL_TRANSPORT !== "1") {
    return disabledAdapter("真实飞书 adapter 尚未启用；设置 LIVE_ADVANCED_FEISHU_ENABLE_REAL_TRANSPORT=1 后才会写测试日历。");
  }

  const adapterResult = await createLiveFeishuCalendarAdapter({
    config: {
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      calendarId: config.feishuCalendarId,
      timezone: config.timezone,
    },
  });

  if (adapterResult.ok) return adapterResult.data;
  return disabledAdapter(adapterResult.message);
}

function disabledAdapter(message: string): DeterministicCalendarAdapter {
  const failure = { ok: false as const, code: "missing_config" as const, message };
  return {
    async createEvent() {
      return failure;
    },
    async listEvents() {
      return failure;
    },
    async updateEvent() {
      return failure;
    },
    async deleteEvent() {
      return failure;
    },
  };
}
