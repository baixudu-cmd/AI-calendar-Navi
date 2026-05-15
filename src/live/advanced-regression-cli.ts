// 进阶真实压测 CLI：默认只调用真实模型和 fake calendar，不写飞书。

import "dotenv/config";
import { loadConfig } from "../config/index.js";
import {
  createCalendarToolCallRequestOptions,
  createModelDecisionClient,
  createOpenAICompatibleTransport,
} from "../decision/model/index.js";
import {
  ADVANCED_REGRESSION_NOW,
} from "./advanced-regression-cases.js";
import { formatAdvancedRegressionReport, runAdvancedRegression } from "./advanced-regression.js";
import { selectAdvancedRegressionScenarios } from "./advanced-regression-variants.js";
import { evaluateLiveConfigGate, formatLiveConfigGateReport } from "./config-gate.js";

const config = loadConfig();
const gate = evaluateLiveConfigGate(config);
const perCaseTimeoutMs = Number(process.env.LIVE_ADVANCED_REGRESSION_CASE_TIMEOUT_MS || "30000");

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

  const result = await runAdvancedRegression({
    scenarios: selectAdvancedRegressionScenarios({ seed: process.env.LIVE_ADVANCED_REGRESSION_VARIANT_SEED }),
    decisionClient,
    now: process.env.LIVE_ADVANCED_REGRESSION_NOW || ADVANCED_REGRESSION_NOW,
    timezone: config.timezone,
    onProgress: (progress) => {
      const family = progress.family ? ` ${progress.family}` : "";
      console.log(`[scenario ${progress.index}/${progress.total}] ${progress.scenarioId} ${progress.status}${family}`);
    },
  });

  console.log(formatAdvancedRegressionReport(result));
  if (result.summary.failed > 0) process.exitCode = 1;
}
