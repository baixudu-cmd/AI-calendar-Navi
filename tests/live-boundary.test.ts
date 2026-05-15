import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const liveFiles = readdirSync(join(process.cwd(), "src/live"))
  .filter((file) => file.endsWith(".ts"))
  .sort();

describe("live module boundaries", () => {
  it("does not import the Feishu client directly", () => {
    const contents = liveFiles
      .map((file) => readFileSync(join(process.cwd(), "src/live", file), "utf8"))
      .join("\n");

    expect(contents).not.toContain("calendar/feishu/client");
    expect(contents).not.toContain("createFeishuCalendarClient");
  });
});
