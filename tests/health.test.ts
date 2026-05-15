import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/index.js";
import {
  formatHealthReport,
  runHealthChecks,
  scanForForbiddenLegacyReferences,
} from "../src/health/index.js";

const tempDirs: string[] = [];
const OLD_RUNTIME_NAME = `${"tracklog"}-${"agent"}`;
const OLD_PACKAGE_NAME = `${"navi"}-${"core"}`;
const OLD_STATE_LABEL = `${"state"} ${"restore"}`;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempProject() {
  const dir = mkdtempSync(join(tmpdir(), "minical-health-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "tests"), { recursive: true });
  return dir;
}

describe("scanForForbiddenLegacyReferences", () => {
  it("finds old Navi references in source files", () => {
    const projectRoot = makeTempProject();
    writeFileSync(join(projectRoot, "src", "bad.ts"), `import '${OLD_PACKAGE_NAME}';`, "utf8");

    const result = scanForForbiddenLegacyReferences(projectRoot, ["src"]);

    expect(result).toEqual([
      {
        file: join(projectRoot, "src", "bad.ts"),
        pattern: OLD_PACKAGE_NAME,
      },
    ]);
  });

  it("finds old harness references in test files", () => {
    const projectRoot = makeTempProject();
    writeFileSync(join(projectRoot, "tests", "bad.test.ts"), `const oldHarness = "${OLD_STATE_LABEL}";`, "utf8");

    const result = scanForForbiddenLegacyReferences(projectRoot, ["tests"]);

    expect(result).toEqual([
      {
        file: join(projectRoot, "tests", "bad.test.ts"),
        pattern: OLD_STATE_LABEL,
      },
    ]);
  });
});

describe("runHealthChecks", () => {
  it("reports config and legacy boundary status", () => {
    const projectRoot = makeTempProject();
    const config = loadConfig({
      MODEL_PROVIDER: "openai-compatible",
      MODEL_BASE_URL: "https://example.test/v1",
      MODEL_API_KEY: "secret-value",
      MODEL_NAME: "gpt-test",
      FEISHU_APP_ID: "app-id",
      FEISHU_APP_SECRET: "feishu-secret",
      OPENCLAW_WORKSPACE: "/tmp/openclaw",
      WECHAT_ENTRY_SECRET: "wechat-secret",
    });

    const report = runHealthChecks({ projectRoot, config, scanDirs: ["src"] });

    expect(report.passed).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.checks.map((check) => check.name)).toEqual([
      "required_config",
      "not_legacy_runtime",
      "no_forbidden_legacy_references",
    ]);
    expect(JSON.stringify(report)).not.toContain("secret-value");
  });

  it("fails when running from the old runtime path", () => {
    const projectRoot = join(homedir(), "projects", "codex-workspaces", OLD_RUNTIME_NAME);
    const report = runHealthChecks({ projectRoot, config: loadConfig({}), scanDirs: [] });

    expect(report.failed).toBeGreaterThan(0);
    expect(report.checks.some((check) => check.name === "not_legacy_runtime" && !check.ok)).toBe(true);
  });

  it("fails when running from a child directory of the old runtime", () => {
    const projectRoot = join(homedir(), "projects", "codex-workspaces", OLD_RUNTIME_NAME, "subdir");
    const report = runHealthChecks({ projectRoot, config: loadConfig({}), scanDirs: [] });

    expect(report.checks.some((check) => check.name === "not_legacy_runtime" && !check.ok)).toBe(true);
  });

  it("does not expose absolute paths in formatted failures", () => {
    const projectRoot = makeTempProject();
    writeFileSync(join(projectRoot, "src", "bad.ts"), `import '${OLD_PACKAGE_NAME}';`, "utf8");

    const report = runHealthChecks({
      projectRoot,
      config: loadConfig({
        MODEL_PROVIDER: "openai-compatible",
        MODEL_BASE_URL: "https://example.test/v1",
        MODEL_API_KEY: "secret-value",
        MODEL_NAME: "gpt-test",
        FEISHU_APP_ID: "app-id",
        FEISHU_APP_SECRET: "feishu-secret",
        OPENCLAW_WORKSPACE: "/tmp/openclaw",
        WECHAT_ENTRY_SECRET: "wechat-secret",
      }),
      scanDirs: ["src"],
    });
    const output = formatHealthReport(report);

    expect(output).not.toContain(projectRoot);
    expect(output).not.toContain(tmpdir());
    expect(output).not.toContain("secret-value");
  });
});
