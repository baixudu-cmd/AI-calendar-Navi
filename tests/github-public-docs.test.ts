// GitHub 公开文档测试：约束 README、OpenClaw 上手说明和 GitHub 模板不要退化成内部记录。

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GitHub public docs", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  it("keeps the README useful as a public GitHub landing page", () => {
    const readme = read("README.md");

    expect(readme).toContain("[![Tests]");
    expect(readme).toContain("[English](README.en.md)");
    expect(readme).toContain("## Quick Start");
    expect(readme).toContain("## OpenClaw Setup");
    expect(readme).toContain("docs/openclaw/install-and-debug.md");
    expect(readme).toContain("PUBLICATION.md");
    expect(readme).toContain("npm run public:export");
    expect(readme).not.toContain(["100", "109", "83", "68"].join("."));
    expect(readme).not.toContain(["100", "64", "0", "1"].join("."));
    expect(readme).not.toContain("/Users/" + "vine/");
  });

  it("ships an English README for public distribution", () => {
    const readme = read("README.en.md");

    expect(readme).toContain("# Navi Calendar");
    expect(readme).toContain("Quick Start");
    expect(readme).toContain("OpenClaw Setup");
    expect(readme).toContain("Publishing");
    expect(readme).toContain("dist/public/navi-calendar");
    expect(readme).not.toContain(["100", "109", "83", "68"].join("."));
    expect(readme).not.toContain("/Users/" + "vine/");
  });

  it("documents the OpenClaw install and debug path with copy-paste commands", () => {
    const guide = read("docs/openclaw/install-and-debug.md");

    for (const expected of [
      "npm ci",
      "cp .env.example .env",
      "cp config/settings.example.json config/settings.local.json",
      "npm run agent:shadow-server",
      "npm run openclaw:shadow-caller-smoke",
      "OPENCLAW_SHADOW_REPLY_ONLY=1",
      "npm run live:env-doctor",
    ]) {
      expect(guide).toContain(expected);
    }
    expect(guide).not.toContain(["100", "109", "83", "68"].join("."));
    expect(guide).not.toContain(["100", "64", "0", "1"].join("."));
    expect(guide).not.toContain("/Users/" + "vine/");
  });

  it("keeps a public release checklist for deciding what belongs on GitHub", () => {
    const publication = read("PUBLICATION.md");

    expect(publication).toContain("Public by default");
    expect(publication).toContain("Keep private");
    expect(publication).toContain(".env");
    expect(publication).toContain("Private network addresses");
    expect(publication).toContain("OpenClaw");
    expect(publication).toContain("dist/public/navi-calendar");
  });

  it("ships GitHub issue templates for external users", () => {
    expect(existsSync(".github/ISSUE_TEMPLATE/bug_report.yml")).toBe(true);
    expect(existsSync(".github/ISSUE_TEMPLATE/setup_help.yml")).toBe(true);

    const setupTemplate = read(".github/ISSUE_TEMPLATE/setup_help.yml");
    expect(setupTemplate).toContain("OpenClaw");
    expect(setupTemplate).toContain("redacted");
    expect(setupTemplate).not.toContain("MODEL_API_KEY");

    const pullRequestTemplate = read(".github/PULL_REQUEST_TEMPLATE.md");
    expect(pullRequestTemplate).toContain("Runtime checks");
    expect(pullRequestTemplate).not.toContain("Mac mini");
  });
});
