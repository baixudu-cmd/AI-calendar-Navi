// 进阶微信桥接 smoke CLI：显式开关后才调用真实 Mac mini dispatch 脚本。

import {
  formatAdvancedWechatBridgeSmokeReport,
  runAdvancedWechatBridgeSmoke,
  type AdvancedWechatBridgeSmokeResult,
} from "./advanced-wechat-bridge-smoke.js";

const enabled = process.env.LIVE_ADVANCED_WECHAT_BRIDGE_ENABLE_REAL_DISPATCH === "1";

if (!enabled) {
  const result = createDisabledResult("真实微信桥接 smoke 尚未启用；设置 LIVE_ADVANCED_WECHAT_BRIDGE_ENABLE_REAL_DISPATCH=1 后才会调用 dispatch 脚本。");
  console.log(formatAdvancedWechatBridgeSmokeReport(result));
  console.log("真实微信桥接 smoke 尚未启用");
  process.exitCode = 1;
} else {
  const result = await runAdvancedWechatBridgeSmoke({
    dispatchScript: process.env.LIVE_ADVANCED_WECHAT_BRIDGE_DISPATCH_SCRIPT,
  });
  console.log(formatAdvancedWechatBridgeSmokeReport(result));
  if (!result.ok) process.exitCode = 1;
}

function createDisabledResult(message: string): AdvancedWechatBridgeSmokeResult {
  return {
    ok: false,
    summary: { total: 4, passed: 0, failed: 4 },
    steps: [],
    failures: [{ family: "bridge_dispatch", message }],
  };
}
