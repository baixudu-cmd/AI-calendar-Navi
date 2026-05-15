import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("agent model smoke CLI", () => {
  it("fails closed without model env and does not leak secrets", () => {
    const result = spawnSync("npm", ["run", "agent:model-smoke"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, MODEL_API_KEY: "", MODEL_BASE_URL: "", MODEL_NAME: "" },
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Agent model smoke: failed");
    expect(result.stdout + result.stderr).not.toContain("secret");
  });

  it("does not leak model key when the model endpoint is unreachable", () => {
    const result = spawnSync("npm", ["run", "agent:model-smoke"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        MODEL_BASE_URL: "http://127.0.0.1:1/v1",
        MODEL_API_KEY: "secret-live-key",
        MODEL_NAME: "mimo-v2.5-pro",
        AGENT_MODEL_SMOKE_TEXT: "明天下午三点见张总",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Agent model smoke: failed");
    expect(result.stdout + result.stderr).not.toContain("secret-live-key");
  });

  it("does not import Feishu, WeChat, or OpenClaw route modules", () => {
    const content = readFileSync(join(process.cwd(), "src/agent-api/model-smoke-cli.ts"), "utf8");

    expect(content).not.toContain("calendar/feishu");
    expect(content).not.toContain("wechat");
    expect(content).not.toContain("openclaw");
    expect(content).not.toContain("live/feishu");
  });

  it("enables shared structured output options on the real model path", () => {
    const content = readFileSync(join(process.cwd(), "src/agent-api/model-smoke-cli.ts"), "utf8");

    expect(content).toContain("createModelDecisionClient");
    expect(content).not.toContain("createRoutedModelDecisionClient");
    expect(content).toContain("createCalendarToolCallRequestOptions");
    expect(content).toContain("requestOptions: createCalendarToolCallRequestOptions()");
  });
});
