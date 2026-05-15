import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  runLiveModelContractSmoke,
  runLiveModelContractSmokeWithGate,
  type LiveModelSmokeTransport,
} from "../src/live/index.js";

describe("live model contract smoke", () => {
  it("fails before model call when live config gate failed", async () => {
    let called = false;
    const result = await runLiveModelContractSmoke({
      config: {
        appName: "minical-agent",
        timezone: "Asia/Shanghai",
        feishuCalendarId: "test-calendar-id",
      },
      model: "fake-model",
      text: "明天下午三点见张总",
      transport: async () => {
        called = true;
        return { content: "{}" };
      },
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: "config_failed" });
    expect(result.message).toContain("缺少 MODEL_API_KEY");
    expect(called).toBe(false);
  });

  it("accepts valid model JSON when it normalizes to a supported action", async () => {
    const transport: LiveModelSmokeTransport = async () => ({
      content: JSON.stringify({
        toolName: "calendar.list_events",
        arguments: { date: "2026-05-09" },
      }),
    });

    const result = await runLiveModelContractSmoke({
      config: {
        appName: "minical-agent",
        timezone: "Asia/Shanghai",
        modelProvider: "openai-compatible",
        modelBaseUrl: "https://example.test/v1",
        modelApiKey: "secret-model-key",
        modelName: "fake-model",
        feishuAppId: "app-id",
        feishuAppSecret: "secret-feishu-key",
        feishuCalendarId: "test-calendar-id",
        feishuTestCalendarId: "test-calendar-id",
        openclawWorkspace: "/home/example/.openclaw",
        wechatEntrySecret: "secret-wechat-key",
      },
      model: "fake-model",
      text: "看看明天日程",
      transport,
    });

    expect(result).toEqual({
      ok: true,
      actionType: "list_events",
      message: "model contract accepted",
    });
  });

  it("fails closed when model output is not JSON", async () => {
    const result = await runLiveModelContractSmokeWithGate({
      gate: {
        ok: true,
        failures: [],
        diagnostics: { missing: [], values: { MODEL_NAME: "fake-model" } },
      },
      model: "fake-model",
      text: "看看明天日程",
      transport: async () => ({ content: "not json" }),
    });

    expect(result).toEqual({
      ok: false,
      reason: "contract_rejected",
      message: "不支持的动作：__malformed_model_output__",
    });
  });

  it("fails closed when model returns an unknown tool", async () => {
    const result = await runLiveModelContractSmokeWithGate({
      gate: {
        ok: true,
        failures: [],
        diagnostics: { missing: [], values: { MODEL_NAME: "fake-model" } },
      },
      model: "fake-model",
      text: "删除所有日程",
      transport: async () => ({ content: JSON.stringify({ toolName: "calendar.delete_all", arguments: {} }) }),
    });

    expect(result).toEqual({
      ok: false,
      reason: "contract_rejected",
      message: "工具 Schema 未通过：unknown_tool",
    });
  });

  it("does not import calendar write modules", () => {
    const content = readFileSync(join(process.cwd(), "src/live/model-smoke.ts"), "utf8");

    expect(content).not.toContain("calendar-api");
    expect(content).not.toContain("calendar/feishu");
    expect(content).not.toContain("action-executor");
  });
});
