import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("memory dream CLI boundary", () => {
  it("runs against explicit local state files and does not use legacy paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "navi-memory-dream-cli-"));
    tempDirs.push(dir);
    const memoryFile = join(dir, "memory-dream.json");
    const seedFile = join(dir, "seed-lite.json");
    writeFileSync(
      memoryFile,
      JSON.stringify({
        observations: [
          {
            id: "obs_1",
            observedAt: "2026-05-13T01:00:00.000Z",
            requestId: "req_1",
            actionType: "create_event",
            ok: true,
            sourceText: "明天三点见张总",
            reply: "已新增日程：\n2026年5月14日 星期四 15:00 见张总",
          },
        ],
        entries: [],
        dreamRuns: [],
      }),
      "utf8",
    );
    writeFileSync(seedFile, JSON.stringify({ seedItems: [{ seedId: "seed_1", title: "整理材料" }] }), "utf8");

    const result = spawnSync("npm", ["run", "live:memory-dream"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MEMORY_DREAM_STATE_FILE: memoryFile,
        MEMORY_DREAM_SEED_FILE: seedFile,
        MEMORY_DREAM_NOW: "2026-05-13T03:20:00.000Z",
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Memory dream: passed");
    expect(result.stdout).toContain("Entries:");
    expect(result.stdout + result.stderr).not.toContain(`${"tracklog"}-${"agent"}`);
    expect(result.stdout + result.stderr).not.toContain("private-toki");
  });
});
