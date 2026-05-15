import { describe, expect, it } from "vitest";
import { getConfigDiagnostics, loadConfig } from "../src/config/index.js";

describe("loadConfig", () => {
  it("uses safe defaults and reports missing required values", () => {
    const config = loadConfig({});
    const diagnostics = getConfigDiagnostics(config);

    expect(config.appName).toBe("minical-agent");
    expect(config.timezone).toBe("Asia/Shanghai");
    expect(diagnostics.missing).toEqual([
      "MODEL_PROVIDER",
      "MODEL_BASE_URL",
      "MODEL_API_KEY",
      "MODEL_NAME",
      "FEISHU_APP_ID",
      "FEISHU_APP_SECRET",
      "OPENCLAW_WORKSPACE",
      "WECHAT_ENTRY_SECRET",
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("secret-value");
  });

  it("redacts secret values when diagnostics are generated", () => {
    const config = loadConfig({
      MODEL_PROVIDER: "openai-compatible",
      MODEL_BASE_URL: "https://example.test/v1",
      MODEL_API_KEY: "secret-value",
      MODEL_NAME: "gpt-test",
      FEISHU_APP_ID: "app-id",
      FEISHU_APP_SECRET: "feishu-secret",
      FEISHU_CALENDAR_ID: "primary",
      OPENCLAW_WORKSPACE: "/tmp/openclaw",
      WECHAT_ENTRY_SECRET: "wechat-secret",
      TIMEZONE: "Asia/Shanghai",
    });

    const diagnostics = getConfigDiagnostics(config);

    expect(diagnostics.missing).toEqual([]);
    expect(diagnostics.values.MODEL_API_KEY).toBe("[set]");
    expect(diagnostics.values.FEISHU_APP_SECRET).toBe("[set]");
    expect(diagnostics.values.WECHAT_ENTRY_SECRET).toBe("[set]");
    expect(JSON.stringify(diagnostics)).not.toContain("secret-value");
    expect(JSON.stringify(diagnostics)).not.toContain("feishu-secret");
    expect(JSON.stringify(diagnostics)).not.toContain("wechat-secret");
  });
});
