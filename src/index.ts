// CLI 入口，目前只运行本地健康检查。

import "dotenv/config";
import { loadConfig } from "./config/index.js";
import { formatHealthReport, runHealthChecks } from "./health/index.js";

const report = runHealthChecks({
  projectRoot: process.cwd(),
  config: loadConfig(),
});

console.log(formatHealthReport(report));

if (report.failed > 0) {
  process.exitCode = 1;
}
