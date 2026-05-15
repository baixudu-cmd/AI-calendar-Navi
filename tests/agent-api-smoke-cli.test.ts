import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("agent api smoke CLI", () => {
  it("runs local fake create/list/update flow without external services", () => {
    const result = spawnSync("npm", ["run", "agent:api-smoke"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Calendar Agent API smoke: passed");
    expect(result.stdout).toContain("create_event");
    expect(result.stdout).toContain("list_events");
    expect(result.stdout).toContain("update_event");
  });
});
