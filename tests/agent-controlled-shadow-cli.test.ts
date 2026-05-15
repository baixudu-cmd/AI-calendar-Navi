import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("controlled shadow route CLI", () => {
  it("runs local fake shadow route flow without external services", () => {
    const result = spawnSync("npm", ["run", "agent:shadow-smoke"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Controlled shadow route smoke: passed");
    expect(result.stdout).toContain("create_event");
    expect(result.stdout).toContain("list_events");
    expect(result.stdout).toContain("update_event");
  });

  it("does not import real Feishu, WeChat, or OpenClaw route modules", () => {
    const content = readFileSync(join(process.cwd(), "src/agent-api/controlled-shadow-cli.ts"), "utf8");

    expect(content).not.toContain("calendar/feishu");
    expect(content).not.toContain("wechat");
    expect(content).not.toContain("openclaw");
    expect(content).not.toContain("live/feishu");
  });
});
