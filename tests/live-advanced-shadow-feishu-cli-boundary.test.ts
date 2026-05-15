// 进阶 shadow 飞书 smoke CLI 边界测试：真实写入必须显式打开，且调用必须走 shadow route。

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("advanced shadow Feishu smoke CLI boundary", () => {
  it("is exposed through a package script", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

    expect(pkg.scripts["live:advanced-shadow-feishu-smoke"]).toBe("tsx src/live/advanced-shadow-feishu-cli.ts");
  });

  it("uses the shadow route mode and a dedicated real transport switch", () => {
    const content = readFileSync(join(process.cwd(), "src/live/advanced-shadow-feishu-cli.ts"), "utf8");

    expect(content).toContain("LIVE_ADVANCED_SHADOW_FEISHU_ENABLE_REAL_TRANSPORT");
    expect(content).toContain("useShadowRoute: true");
    expect(content).toContain("createOpenAICompatibleTransport");
    expect(content).toContain("createCalendarToolCallRequestOptions");
    expect(content).toContain("createLiveFeishuCalendarAdapter");
    expect(content).not.toContain("../wechat");
    expect(content).not.toContain("tracklog");
  });

  it("fails closed without the dedicated switch and does not leak secrets", () => {
    const result = spawnSync("npm", ["run", "live:advanced-shadow-feishu-smoke"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        MODEL_PROVIDER: "openai-compatible",
        MODEL_BASE_URL: "https://example.test/v1",
        MODEL_API_KEY: "secret-model-key",
        MODEL_NAME: "fake-model",
        FEISHU_APP_ID: "fake-app-id",
        FEISHU_APP_SECRET: "secret-feishu-key",
        FEISHU_CALENDAR_ID: "test-calendar-id",
        FEISHU_TEST_CALENDAR_ID: "test-calendar-id",
        OPENCLAW_WORKSPACE: "/home/example/.openclaw",
        WECHAT_ENTRY_SECRET: "secret-wechat-key",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Advanced Feishu smoke: failed");
    expect(result.stdout).toContain("真实 shadow 飞书 adapter 尚未启用");
    expect(result.stdout + result.stderr).not.toContain("secret-model-key");
    expect(result.stdout + result.stderr).not.toContain("secret-feishu-key");
    expect(result.stdout + result.stderr).not.toContain("secret-wechat-key");
  });
});
