// 进阶飞书 smoke CLI 边界测试：默认失败关闭，真实写入必须显式打开。

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("advanced Feishu smoke CLI boundary", () => {
  it("is exposed through a package script", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

    expect(pkg.scripts["live:advanced-feishu-smoke"]).toBe("tsx src/live/advanced-feishu-cli.ts");
  });

  it("keeps real Feishu transport behind the dedicated switch and uses the model path", () => {
    const content = readFileSync(join(process.cwd(), "src/live/advanced-feishu-cli.ts"), "utf8");

    expect(content).toContain("LIVE_ADVANCED_FEISHU_ENABLE_REAL_TRANSPORT");
    expect(content).toContain("createOpenAICompatibleTransport");
    expect(content).toContain("createModelDecisionClient");
    expect(content).toContain("createCalendarToolCallRequestOptions");
    expect(content).toContain("createLiveFeishuCalendarAdapter");
    expect(content).not.toContain("createFeishuCalendarClient");
    expect(content).not.toContain("calendar/feishu/client");
    expect(content).not.toContain("../openclaw");
    expect(content).not.toContain("../wechat");
  });

  it("evaluates the live config gate before creating the real Feishu adapter", () => {
    const content = readFileSync(join(process.cwd(), "src/live/advanced-feishu-cli.ts"), "utf8");
    const gateIndex = content.indexOf("const gate = evaluateLiveConfigGate(config)");
    const adapterIndex = content.indexOf("const adapter = await resolveAdapter(gate.ok)");

    expect(gateIndex).toBeGreaterThan(-1);
    expect(adapterIndex).toBeGreaterThan(gateIndex);
  });

  it("fails closed without the real transport switch and does not leak secrets", () => {
    const result = spawnSync("npm", ["run", "live:advanced-feishu-smoke"], {
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
    expect(result.stdout).toContain("真实飞书 adapter 尚未启用");
    expect(result.stdout + result.stderr).not.toContain("secret-model-key");
    expect(result.stdout + result.stderr).not.toContain("secret-feishu-key");
    expect(result.stdout + result.stderr).not.toContain("secret-wechat-key");
  });
});
