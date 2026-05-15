// live env doctor CLI：只输出脱敏配置状态，不访问外部服务。

import "dotenv/config";
import { loadConfig } from "../config/index.js";
import { runLiveEnvDoctor } from "./env-doctor.js";

const result = runLiveEnvDoctor(loadConfig());

console.log(result.summary);
for (const detail of result.details) {
  console.log(`- ${detail}`);
}
console.log("Config:");
for (const line of result.redactedConfig) {
  console.log(line);
}

if (!result.ok) {
  process.exitCode = 1;
}
