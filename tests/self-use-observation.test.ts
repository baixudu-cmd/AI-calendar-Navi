// P4 自用观察模拟测试：不写真实飞书，只验证微信入口形状下的确定性链路。

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatSelfUseObservationReport, runSelfUseObservation } from "../src/live/self-use-observation.js";

describe("self-use observation simulation", () => {
  it("runs the P4 self-use flows without external services", async () => {
    const result = await runSelfUseObservation();

    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({ total: 7, passed: 7, failed: 0 });
    expect(result.failures).toEqual([]);
    expect(result.steps.map((step) => step.id)).toEqual([
      "create_visible_event",
      "batch_create",
      "batch_context_update",
      "empty_list_reply",
      "empty_morning_briefing",
      "delete_confirmation",
      "duplicate_message_guard",
    ]);
  });

  it("prints a concise report", async () => {
    const report = formatSelfUseObservationReport(await runSelfUseObservation());

    expect(report).toContain("Self-use observation: passed");
    expect(report).toContain("Passed: 7");
    expect(report).toContain("Failed: 0");
    expect(report).not.toContain("secret");
  });

  it("is exposed through package script", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

    expect(pkg.scripts["live:self-use-observation"]).toBe("tsx src/live/self-use-observation-cli.ts");
  });

  it("runs from the CLI", () => {
    const result = spawnSync("npm", ["run", "live:self-use-observation"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Self-use observation: passed");
    expect(result.stdout).toContain("Passed: 7");
    expect(result.stdout + result.stderr).not.toContain("FEISHU_APP_SECRET");
    expect(result.stdout + result.stderr).not.toContain("MODEL_API_KEY");
  });
});
