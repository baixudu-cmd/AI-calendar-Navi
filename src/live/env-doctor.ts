// live env doctor：只检查真实环境配置形状和测试日历护栏，不输出密钥。

import type { AppConfig } from "../config/index.js";
import { evaluateLiveConfigGate, formatLiveConfigGateReport } from "./config-gate.js";

export type LiveEnvDoctorResult = {
  ok: boolean;
  summary: string;
  details: string[];
  redactedConfig: string[];
};

// 运行 live env doctor；不访问任何外部服务。
export function runLiveEnvDoctor(config: AppConfig): LiveEnvDoctorResult {
  const gate = evaluateLiveConfigGate(config);
  const reportLines = formatLiveConfigGateReport(gate).split("\n");
  const configStart = reportLines.indexOf("Config:");
  const redactedConfig = reportLines.slice(configStart + 1).filter((line) => line.startsWith("- "));

  if (!gate.ok) {
    return {
      ok: false,
      summary: "Live env doctor: failed",
      details: gate.failures,
      redactedConfig,
    };
  }

  return {
    ok: true,
    summary: "Live env doctor: passed",
    details: ["必需配置已设置。", "测试日历门禁通过。"],
    redactedConfig,
  };
}
