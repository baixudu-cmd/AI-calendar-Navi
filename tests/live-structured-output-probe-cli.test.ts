// 结构化输出探针 CLI 测试：只验证模型 provider 能力，不触达日历或渠道。

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("live structured output probe CLI", () => {
  it("fails closed without model env and does not leak secrets", () => {
    const result = spawnSync("npm", ["run", "live:structured-output-probe"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        MODEL_BASE_URL: "",
        MODEL_API_KEY: "secret-live-key",
        MODEL_NAME: "",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Structured output probe: failed");
    expect(result.stdout + result.stderr).not.toContain("secret-live-key");
  });

  it("does not import Feishu, WeChat, OpenClaw, or calendar execution modules", () => {
    const content = readFileSync(join(process.cwd(), "src/live/structured-output-probe-cli.ts"), "utf8");

    expect(content).not.toContain("calendar/feishu");
    expect(content).not.toContain("calendar-api");
    expect(content).not.toContain("action-executor");
    expect(content).not.toContain("wechat");
    expect(content).not.toContain("openclaw");
    expect(content).not.toContain("agent-api");
  });

  it("reuses the shared calendar tool call request options", () => {
    const content = readFileSync(join(process.cwd(), "src/live/structured-output-probe-cli.ts"), "utf8");

    expect(content).toContain("createCalendarToolCallRequestOptions");
    expect(content).toContain("requestOptions: createCalendarToolCallRequestOptions()");
    expect(content).not.toContain("const calendarToolCallSchema");
  });

  it("is exposed through package script", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

    expect(pkg.scripts["live:structured-output-probe"]).toBe("tsx src/live/structured-output-probe-cli.ts");
  });
});
