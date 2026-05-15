import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scanForForbiddenLegacyReferences } from "../src/health/index.js";

const LEGACY_RUNTIME_NAME = `${"tracklog"}-${"agent"}`;

describe("legacy isolation docs", () => {
  it("documents whitelist and forbidden inheritance rules", () => {
    const doc = readFileSync("docs/legacy-isolation.md", "utf8");

    expect(doc).toContain("NAVI_LEGACY_RUNTIME_PATH");
    expect(doc).toContain("minical-agent");
    expect(doc).toContain("白名单复用");
    expect(doc).toContain("禁止继承");
    expect(doc).toContain("旧目录只读");
  });

  it("documents how old failures become new scenario cases", () => {
    const doc = readFileSync("docs/failure-case-transfer.md", "utf8");

    expect(doc).toContain("用户原话");
    expect(doc).toContain("预期动作");
    expect(doc).toContain("预期追问");
    expect(doc).toContain("不得保留旧 harness");
  });
});

describe("legacy boundary scanner", () => {
  it("does not scan docs as forbidden runtime imports", () => {
    const findings = scanForForbiddenLegacyReferences(process.cwd(), ["docs"]);

    expect(findings).toEqual([]);
  });
});
