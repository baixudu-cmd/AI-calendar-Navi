import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("live model smoke CLI boundary", () => {
  it("does not include a real HTTP model transport by default", () => {
    const content = readFileSync(join(process.cwd(), "src/live/model-cli.ts"), "utf8");

    expect(content).not.toContain("fetch(");
    expect(content).not.toContain("axios");
    expect(content).not.toContain("calendar-api");
    expect(content).not.toContain("calendar/feishu");
    expect(content).not.toContain("./index.js");
  });
});
