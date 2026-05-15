// P19 每日记忆整理 LaunchAgent 资产测试：确保只运行本地整理任务，不触发微信发送或旧系统。

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("memory dream LaunchAgent assets", () => {
  it("defines a dedicated memory dream LaunchAgent and runner", () => {
    const plist = fs.readFileSync(path.join(process.cwd(), "ops/launchagents/com.navi-calendar.memory-dream.plist"), "utf8");
    const script = fs.readFileSync(path.join(process.cwd(), "scripts/run-memory-dream-launchagent.sh"), "utf8");

    expect(plist).toContain("com.navi-calendar.memory-dream");
    expect(plist).toContain("scripts/run-memory-dream-launchagent.sh");
    expect(script).toContain("npm --silent run live:memory-dream");
    expect(script).toContain("MEMORY_DREAM_STATE_FILE");
    expect(script).toContain("MEMORY_DREAM_SEED_FILE");
    expect(script).not.toContain("PROACTIVE_DELIVERY_MODE=wechat");
    expect(script).not.toContain("LIVE_PROACTIVE_ENABLE_WECHAT_SEND=1");
    expect(script).not.toContain("push-weixin-calendar.mjs");
    expect(script).not.toContain(`${"tracklog"}-${"agent"}`);
    expect(plist + script).not.toContain("com.private-toki.calendar");
  });
});
