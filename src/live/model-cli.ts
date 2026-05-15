// live 模型 smoke CLI；本地默认不内置真实 HTTP transport，避免误调用。

import "dotenv/config";
import { loadConfig } from "../config/index.js";
import { runLiveModelContractSmoke } from "./model-smoke.js";

const config = loadConfig();

const result = await runLiveModelContractSmoke({
  config,
  model: config.modelName || "",
  text: process.env.LIVE_MODEL_SMOKE_TEXT || "看看明天日程",
  transport: async () => {
    throw new Error("真实模型 transport 尚未接入；请在 Mac mini live 阶段显式配置。");
  },
});

console.log(`Live model smoke: ${result.ok ? "passed" : "failed"}`);
console.log(result.message);

if (!result.ok) {
  process.exitCode = 1;
}
