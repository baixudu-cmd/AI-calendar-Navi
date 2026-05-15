import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("shadow HTTP CLI boundary", () => {
  it("uses server-owned dependencies and local-only default binding", () => {
    const content = readFileSync(join(process.cwd(), "src/agent-api/shadow-http-cli.ts"), "utf8");

    expect(content).toContain("127.0.0.1");
    expect(content).toContain("createOpenAICompatibleTransport");
    expect(content).toContain("createModelDecisionClient");
    expect(content).not.toContain("createRoutedModelDecisionClient");
    expect(content).toContain("createCalendarToolCallRequestOptions");
    expect(content).toContain("requestOptions: createCalendarToolCallRequestOptions()");
    expect(content).toContain("createLiveFeishuCalendarAdapter");
    expect(content).toContain("resolveShadowCalendarTarget");
    expect(content).toContain("createControlledShadowRoute");
    expect(content).toContain("createShortTermStateStore");
    expect(content).toContain("createFileWechatReminderStore");
    expect(content).toContain("loadAppSettings");
    expect(content).toContain("createImageDraftParserFromEnv");
    expect(content).toContain("IMAGE_CAPTURE_ENABLE_DRAFT");
    expect(content).toContain("process.env.WECHAT_REMINDER_STATE_FILE || appSettings.stateFiles.wechatReminder");
    expect(content).toContain("defaultWechatReminderLeadMinutes: readLeadMinutes(process.env.WECHAT_REMINDER_LEAD_MINUTES, appSettings.reminders.wechatLeadMinutes)");
    expect(content).not.toContain("0.0.0.0");
    expect(content).not.toContain("SHADOW_ROUTE_HOST");
    expect(content).not.toContain("../wechat/index");
    expect(content).not.toContain("/wechat/index");
    expect(content).not.toContain("openclaw/");
    expect(content).not.toContain("@openclaw");
  });

  it("is exposed through package script", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

    expect(pkg.scripts["agent:shadow-server"]).toBe("tsx src/agent-api/shadow-http-cli.ts");
    expect(pkg.scripts["live:wechat-reminder-dispatcher"]).toBe("tsx src/live/wechat-reminder-dispatcher-cli.ts");
  });
});
