import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("advanced shadow smoke CLI boundary", () => {
  it("is exposed through package script", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const indexContent = readFileSync(join(process.cwd(), "src/live/index.ts"), "utf8");

    expect(pkg.scripts["live:advanced-shadow-smoke"]).toBe("tsx src/live/advanced-shadow-cli.ts");
    expect(indexContent).toContain('export * from "./advanced-shadow-smoke.js";');
  });

  it("runs with fake dependencies by default", () => {
    const result = spawnSync("npm", ["run", "live:advanced-shadow-smoke"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        MODEL_API_KEY: "must-not-be-used",
        FEISHU_APP_SECRET: "must-not-be-used",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Advanced shadow smoke: passed");
    expect(result.stdout).toContain("Passed: 3");
    expect(result.stdout + result.stderr).not.toContain("must-not-be-used");
  });

  it("does not import real Feishu, WeChat, OpenClaw SDK, or old tracklog code", () => {
    const cliContent = readFileSync(join(process.cwd(), "src/live/advanced-shadow-cli.ts"), "utf8");
    const runnerContent = readFileSync(join(process.cwd(), "src/live/advanced-shadow-smoke.ts"), "utf8");
    const content = `${cliContent}\n${runnerContent}`;

    expect(content).toContain("runAdvancedShadowSmoke");
    expect(content).not.toContain("createLiveFeishuCalendarAdapter");
    expect(content).not.toContain("../calendar/feishu");
    expect(content).not.toContain("../wechat");
    expect(content).not.toContain("@openclaw");
    expect(content).not.toContain("tracklog");
  });
});
