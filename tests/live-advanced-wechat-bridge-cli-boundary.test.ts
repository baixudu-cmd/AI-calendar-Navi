// 进阶微信桥接 smoke CLI 边界测试：默认不触碰真实桥接脚本，显式开关后才执行。

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("advanced WeChat bridge smoke CLI boundary", () => {
  it("is exposed through package script and live exports", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const indexContent = readFileSync(join(process.cwd(), "src/live/index.ts"), "utf8");

    expect(pkg.scripts["live:advanced-wechat-bridge-smoke"]).toBe("tsx src/live/advanced-wechat-bridge-cli.ts");
    expect(indexContent).toContain('export * from "./advanced-wechat-bridge-smoke.js";');
  });

  it("fails closed without the dedicated real-dispatch switch and does not leak secrets", () => {
    const result = spawnSync("npm", ["run", "live:advanced-wechat-bridge-smoke"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        LIVE_ADVANCED_WECHAT_BRIDGE_DISPATCH_SCRIPT: "/tmp/must-not-run-dispatch-shadow.sh",
        OPENCLAW_SHADOW_SECRET: "secret-bridge-key",
        WECHAT_ENTRY_SECRET: "secret-wechat-key",
        MODEL_API_KEY: "secret-model-key",
        FEISHU_APP_SECRET: "secret-feishu-key",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Advanced WeChat bridge smoke: failed");
    expect(result.stdout).toContain("真实微信桥接 smoke 尚未启用");
    expect(result.stdout + result.stderr).not.toContain("secret-bridge-key");
    expect(result.stdout + result.stderr).not.toContain("secret-wechat-key");
    expect(result.stdout + result.stderr).not.toContain("secret-model-key");
    expect(result.stdout + result.stderr).not.toContain("secret-feishu-key");
  });

  it("keeps the CLI and runner out of server-owned dependencies", () => {
    const cliContent = readFileSync(join(process.cwd(), "src/live/advanced-wechat-bridge-cli.ts"), "utf8");
    const runnerContent = readFileSync(join(process.cwd(), "src/live/advanced-wechat-bridge-smoke.ts"), "utf8");
    const content = `${cliContent}\n${runnerContent}`;

    expect(content).toContain("LIVE_ADVANCED_WECHAT_BRIDGE_ENABLE_REAL_DISPATCH");
    expect(content).toContain("runAdvancedWechatBridgeSmoke");
    expect(content).not.toContain("../agent-api");
    expect(content).not.toContain("../calendar-api");
    expect(content).not.toContain("../decision");
    expect(content).not.toContain("../calendar/feishu");
    expect(content).not.toContain("../wechat");
    expect(content).not.toContain("@openclaw");
    expect(content).not.toContain("tracklog");
    expect(content).not.toContain("createModelDecisionClient");
    expect(content).not.toContain("createLiveFeishuCalendarAdapter");
  });
});
