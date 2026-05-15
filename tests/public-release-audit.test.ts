// 公开发行测试：确保 GitHub 导出目录可生成，并且不会带出私有运行信息。

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const exportRoot = "dist/public/navi-calendar";

describe("public release export", () => {
  it("generates an installable public tree without private history", () => {
    execFileSync("node", ["scripts/create-public-export.mjs"], { stdio: "pipe" });
    execFileSync("node", ["scripts/public-release-audit.mjs"], { stdio: "pipe" });

    expect(existsSync(join(exportRoot, "README.md"))).toBe(true);
    expect(existsSync(join(exportRoot, "README.en.md"))).toBe(true);
    expect(existsSync(join(exportRoot, "ARCHITECTURE.md"))).toBe(true);
    expect(existsSync(join(exportRoot, "LICENSE"))).toBe(true);
    expect(existsSync(join(exportRoot, "CONTEXT.md"))).toBe(false);
    expect(existsSync(join(exportRoot, ".planning"))).toBe(false);
    expect(existsSync(join(exportRoot, "docs/reviews"))).toBe(false);

    const packageJson = JSON.parse(readFileSync(join(exportRoot, "package.json"), "utf8"));
    expect(packageJson.private).toBeUndefined();
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.scripts["public:export"]).toBeUndefined();
    expect(packageJson.scripts["public:audit"]).toBeUndefined();
    expect(existsSync(join(exportRoot, "src/.DS_Store"))).toBe(false);
  });
});
