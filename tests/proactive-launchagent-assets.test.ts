// P6.5 主动消息 LaunchAgent 资产测试：确保定时任务只走新版安全 runner。

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const launchAgentDir = path.join(process.cwd(), "ops/launchagents");
const scriptPath = path.join(process.cwd(), "scripts/run-proactive-launchagent.sh");

describe("proactive LaunchAgent assets", () => {
  it("defines three new proactive LaunchAgent labels without legacy paths", () => {
    const files = [
      "com.navi-calendar.proactive-morning.plist",
      "com.navi-calendar.proactive-evening.plist",
      "com.navi-calendar.proactive-reminder.plist",
    ];

    const combined = files.map((file) => fs.readFileSync(path.join(launchAgentDir, file), "utf8")).join("\n");

    expect(combined).toContain("com.navi-calendar.proactive-morning");
    expect(combined).toContain("com.navi-calendar.proactive-evening");
    expect(combined).toContain("com.navi-calendar.proactive-reminder");
    expect(combined).toContain("scripts/run-proactive-launchagent.sh");
    expect(combined).not.toContain("com.private-toki.calendar");
    expect(combined).not.toContain("push-weixin-calendar.mjs");
    expect(combined).not.toContain(`${"tracklog"}-${"agent"}`);
  });

  it("runner keeps real read, real send, commit, and project state gates explicit", () => {
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(script).toContain("LIVE_PROACTIVE_ENABLE_REAL_READ=1");
    expect(script).toContain("PROACTIVE_DELIVERY_MODE=wechat");
    expect(script).toContain("LIVE_PROACTIVE_ENABLE_WECHAT_SEND=1");
    expect(script).toContain("PROACTIVE_COMMIT=1");
    expect(script).toContain("PROACTIVE_STATE_FILE=");
    expect(script).toContain("PROACTIVE_SEED_FILE=");
    expect(script).toContain("WECHAT_REMINDER_STATE_FILE=");
    expect(script).toContain("npm --silent run live:wechat-reminder-dispatcher");
    expect(script).toContain("PROACTIVE_WECHAT_TARGET");
    expect(script).toContain("PROACTIVE_WECHAT_ACCOUNT_ID");
    expect(script).toContain("PROACTIVE_RUNTIME_ENABLE_LIVE=1 npm --silent run live:proactive-runtime-doctor");
    expect(script).toContain("PROACTIVE_RUNTIME_SKIP_DOCTOR");
    expect(script).toContain("npm --silent run live:proactive-briefing");
    expect(script).not.toContain("push-weixin-calendar.mjs");
    expect(script).not.toContain(`${"tracklog"}-${"agent"}`);
  });
});
