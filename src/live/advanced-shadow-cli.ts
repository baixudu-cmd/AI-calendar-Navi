// 进阶 shadow smoke CLI：默认只跑本机 fake 依赖，不读取真实飞书或微信配置。

import { formatAdvancedShadowSmokeReport, runAdvancedShadowSmoke } from "./advanced-shadow-smoke.js";

const today = process.env.LIVE_ADVANCED_SHADOW_SMOKE_DATE;
const now = process.env.LIVE_ADVANCED_SHADOW_SMOKE_NOW;

const result = await runAdvancedShadowSmoke({ today, now });
console.log(formatAdvancedShadowSmokeReport(result));
if (!result.ok) process.exitCode = 1;
