// Memory Dream manifest 测试：确保每日记忆整理边界写清楚，避免后台任务越权。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("memory dream manifest", () => {
  it("documents allowed inputs, outputs, and forbidden side effects", () => {
    const manifest = readFileSync(new URL("../docs/runbooks/memory-dream-manifest.md", import.meta.url), "utf8");

    expect(manifest).toContain("MEMORY_DREAM_STATE_FILE");
    expect(manifest).toContain("SEED_LITE_STATE_FILE");
    expect(manifest).toContain("不发微信");
    expect(manifest).toContain("不写日历");
    expect(manifest).toContain("排程候选");
    expect(manifest).toContain("不读取屏幕");
    expect(manifest).toContain("不把整理后的记忆注入模型主 prompt");
    expect(manifest).toContain("不自动排期");
  });
});
