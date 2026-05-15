// live 配置门禁 CLI；只检查本地配置，不调用外部服务。

import "dotenv/config";
import { loadConfig } from "../config/index.js";
import { evaluateLiveConfigGate, formatLiveConfigGateReport } from "./index.js";

const report = evaluateLiveConfigGate(loadConfig());
console.log(formatLiveConfigGateReport(report));

if (!report.ok) {
  process.exitCode = 1;
}
