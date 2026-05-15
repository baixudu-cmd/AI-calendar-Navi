// live 配置门禁：进入真实环境前先阻断缺配置和主日历误用。

import { getConfigDiagnostics, type AppConfig, type ConfigDiagnostics } from "../config/index.js";

export type LiveConfigGateReport = {
  ok: boolean;
  failures: string[];
  diagnostics: ConfigDiagnostics;
};

// 检查 live bring-up 需要的配置，不访问外部服务。
export function evaluateLiveConfigGate(config: AppConfig): LiveConfigGateReport {
  const diagnostics = getConfigDiagnostics(config);
  const failures = diagnostics.missing.map((key) => `缺少 ${key}`);

  if (config.feishuCalendarId.trim() === "" || config.feishuCalendarId === "primary") {
    failures.push("live bring-up 不能使用 primary 日历，请配置专用测试日历 ID。");
  }

  if (!config.feishuTestCalendarId?.trim()) {
    failures.push("缺少 FEISHU_TEST_CALENDAR_ID");
  } else if (config.feishuCalendarId !== config.feishuTestCalendarId) {
    failures.push("live bring-up 只能使用 FEISHU_TEST_CALENDAR_ID 指定的专用测试日历。");
  }

  return { ok: failures.length === 0, failures, diagnostics };
}

// 把门禁结果格式化为短文本，密钥只显示是否已设置。
export function formatLiveConfigGateReport(report: LiveConfigGateReport): string {
  const status = report.ok ? "passed" : "failed";
  const lines = [`Live config gate: ${status}`];

  if (report.failures.length > 0) {
    lines.push("Failures:");
    for (const failure of report.failures) lines.push(`- ${failure}`);
  }

  lines.push("Config:");
  for (const [key, value] of Object.entries(report.diagnostics.values)) {
    lines.push(`- ${key}=${value}`);
  }

  return lines.join("\n");
}
