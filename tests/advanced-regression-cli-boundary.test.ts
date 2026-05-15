import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("advanced regression CLI boundary", () => {
  it("is exposed through package script", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

    expect(pkg.scripts["live:advanced-regression"]).toBe("tsx src/live/advanced-regression-cli.ts");
  });

  it("uses the real model path but never imports the Feishu live adapter", () => {
    const content = readFileSync(join(process.cwd(), "src/live/advanced-regression-cli.ts"), "utf8");

    expect(content).toContain("createOpenAICompatibleTransport");
    expect(content).toContain("createModelDecisionClient");
    expect(content).toContain("createCalendarToolCallRequestOptions");
    expect(content).toContain("LIVE_ADVANCED_REGRESSION_VARIANT_SEED");
    expect(content).toContain("selectAdvancedRegressionScenarios");
    expect(content).not.toContain("createLiveFeishuCalendarAdapter");
    expect(content).not.toContain("LIVE_BASIC_REGRESSION_ENABLE_FEISHU");
    expect(content).not.toContain("../wechat");
    expect(content).not.toContain("@openclaw");
  });

  it("fails closed without complete live config and does not leak secrets", () => {
    const result = spawnSync("npm", ["run", "live:advanced-regression"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        MODEL_PROVIDER: "openai-compatible",
        MODEL_BASE_URL: "http://127.0.0.1:1/v1",
        MODEL_API_KEY: "secret-model-key",
        MODEL_NAME: "fake-model",
        FEISHU_APP_ID: "fake-app-id",
        FEISHU_APP_SECRET: "secret-feishu-key",
        FEISHU_CALENDAR_ID: "primary",
        FEISHU_TEST_CALENDAR_ID: "test-calendar-id",
        OPENCLAW_WORKSPACE: "/home/example/.openclaw",
        WECHAT_ENTRY_SECRET: "secret-wechat-key",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Live config gate: failed");
    expect(result.stdout + result.stderr).not.toContain("secret-model-key");
    expect(result.stdout + result.stderr).not.toContain("secret-feishu-key");
    expect(result.stdout + result.stderr).not.toContain("secret-wechat-key");
  });
});
