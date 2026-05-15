// 基础真实压测 CLI：默认只跑真实模型合同，显式开关才写飞书测试日历。

import "dotenv/config";
import { createLiveFeishuCalendarAdapter } from "../calendar/feishu/live-adapter.js";
import type { CalendarAdapter } from "../calendar/action-executor.js";
import { loadConfig } from "../config/index.js";
import {
  createCalendarToolCallRequestOptions,
  createModelDecisionClient,
  createOpenAICompatibleTransport,
} from "../decision/model/index.js";
import { BASIC_REGRESSION_NOW, selectBasicRegressionCases, type BasicRegressionStage } from "./basic-regression-cases.js";
import { formatBasicRegressionReport, runBasicRegression } from "./basic-regression.js";
import { evaluateLiveConfigGate, formatLiveConfigGateReport } from "./config-gate.js";

const config = loadConfig();
const gate = evaluateLiveConfigGate(config);
const perCaseTimeoutMs = Number(process.env.LIVE_BASIC_REGRESSION_CASE_TIMEOUT_MS || "30000");
const regressionCases = limitCases(
  selectBasicRegressionCases({
    stage: parseRegressionStage(process.env.LIVE_BASIC_REGRESSION_STAGE),
    seed: process.env.LIVE_BASIC_REGRESSION_VARIANT_SEED,
  }),
  process.env.LIVE_BASIC_REGRESSION_LIMIT,
);

if (!gate.ok) {
  console.log(formatLiveConfigGateReport(gate));
  process.exitCode = 1;
} else {
  const decisionClient = createModelDecisionClient({
    model: config.modelName || "",
    transport: createOpenAICompatibleTransport({
      baseUrl: config.modelBaseUrl || "",
      apiKey: config.modelApiKey || "",
      timeoutMs: perCaseTimeoutMs,
      requestOptions: createCalendarToolCallRequestOptions(),
    }),
  });

  const calendarResult = await resolveCalendar();
  if (!calendarResult.ok) {
    console.log("Basic regression: failed");
    console.log(calendarResult.message);
    process.exitCode = 1;
  } else {
    const result = await runBasicRegression({
      cases: regressionCases,
      decisionClient,
      calendar: calendarResult.calendar,
      executeCalendar: process.env.LIVE_BASIC_REGRESSION_ENABLE_FEISHU === "1",
      perCaseTimeoutMs,
      now: process.env.LIVE_BASIC_REGRESSION_NOW || BASIC_REGRESSION_NOW,
      timezone: config.timezone,
      onProgress: (progress) => {
        const family = progress.family ? ` ${progress.family}` : "";
        console.log(`[case ${progress.index}/${progress.total}] ${progress.caseId} ${progress.status}${family}`);
      },
    });

    console.log(formatBasicRegressionReport(result));
    if (result.summary.failed > 0) process.exitCode = 1;
  }
}

function limitCases<T>(cases: T[], rawLimit: string | undefined): T[] {
  const limit = Number(rawLimit || "0");
  if (!Number.isInteger(limit) || limit <= 0) return cases;
  return cases.slice(0, limit);
}

function parseRegressionStage(value: string | undefined): BasicRegressionStage {
  if (value === "advanced") return "advanced";
  return "basic";
}

async function resolveCalendar(): Promise<{ ok: true; calendar: CalendarAdapter } | { ok: false; message: string }> {
  if (process.env.LIVE_BASIC_REGRESSION_ENABLE_FEISHU !== "1") return { ok: true, calendar: createNoopCalendar() };

  const adapter = await createLiveFeishuCalendarAdapter({
    config: {
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      calendarId: config.feishuCalendarId,
      timezone: config.timezone,
    },
  });

  if (!adapter.ok) return { ok: false, message: adapter.message };
  return { ok: true, calendar: adapter.data };
}

function createNoopCalendar(): CalendarAdapter {
  return {
    async createEvent() {
      return { ok: false, code: "missing_config", message: "model-only 模式不写飞书测试日历。" };
    },
    async listEvents() {
      return { ok: false, code: "missing_config", message: "model-only 模式不读飞书测试日历。" };
    },
    async updateEvent() {
      return { ok: false, code: "missing_config", message: "model-only 模式不写飞书测试日历。" };
    },
    async deleteEvent() {
      return { ok: false, code: "missing_config", message: "model-only 模式不删飞书测试日历。" };
    },
  };
}
