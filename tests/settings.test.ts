// 设置层测试：约束 GitHub 发布所需的非密钥 JSON 设置入口。

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAppSettings } from "../src/settings/index.js";
import { buildSettingsSummary } from "../src/settings-summary/index.js";

describe("app settings", () => {
  it("ships a JSON example settings file for non-secret defaults", () => {
    expect(existsSync("config/settings.example.json")).toBe(true);
    const example = JSON.parse(readFileSync("config/settings.example.json", "utf8"));

    expect(example.reminders.wechatLeadMinutes).toEqual([40]);
    expect(example.reminders.proactiveLeadMinutes).toBe(40);
    expect(example.stateFiles.seedLite).toBe("state/seed-lite.json");
    expect(example.stateFiles.memoryDream).toBe("state/memory-dream.json");
    expect(example.stateFiles.wechatReminder).toBe("state/wechat-reminders.json");
    expect(JSON.stringify(example)).not.toContain("MODEL_API_KEY");
    expect(JSON.stringify(example)).not.toContain("FEISHU_APP_SECRET");
    expect(JSON.stringify(example)).not.toContain("WECHAT_ENTRY_SECRET");
  });

  it("loads local JSON settings and keeps environment variables out of the product defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "navi-settings-"));
    const settingsPath = join(dir, "settings.local.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        reminders: { wechatLeadMinutes: [30, 10], proactiveLeadMinutes: 20 },
        stateFiles: {
          seedLite: "custom/seed.json",
          memoryDream: "custom/memory.json",
          wechatReminder: "custom/reminders.json",
        },
      }),
      "utf8",
    );

    const settings = loadAppSettings({ env: { NAVI_SETTINGS_FILE: settingsPath } });

    expect(settings.reminders.wechatLeadMinutes).toEqual([30, 10]);
    expect(settings.reminders.proactiveLeadMinutes).toBe(20);
    expect(settings.stateFiles.seedLite).toBe("custom/seed.json");
    expect(settings.stateFiles.memoryDream).toBe("custom/memory.json");
    expect(settings.stateFiles.wechatReminder).toBe("custom/reminders.json");
  });

  it("rejects secret-like keys in JSON settings", () => {
    const dir = mkdtempSync(join(tmpdir(), "navi-settings-secret-"));
    const settingsPath = join(dir, "settings.local.json");
    writeFileSync(settingsPath, JSON.stringify({ MODEL_API_KEY: "secret" }), "utf8");

    expect(() => loadAppSettings({ env: { NAVI_SETTINGS_FILE: settingsPath } })).toThrow("设置文件不能包含密钥字段");
  });

  it("uses JSON settings in the assistant settings summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "navi-settings-summary-"));
    const settingsPath = join(dir, "settings.local.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        reminders: { wechatLeadMinutes: [25], proactiveLeadMinutes: 15 },
        stateFiles: {
          seedLite: "runtime/seed.json",
          memoryDream: "runtime/memory.json",
          wechatReminder: "runtime/reminders.json",
        },
      }),
      "utf8",
    );

    const reply = buildSettingsSummary({
      topic: "all",
      env: {
        NAVI_SETTINGS_FILE: settingsPath,
        MODEL_API_KEY: "secret-model-key",
      },
    });

    expect(reply).toContain("默认微信提醒：提前 25 分钟");
    expect(reply).toContain("主动提醒默认提前：15 分钟");
    expect(reply).toContain("排程默认候选：3 个");
    expect(reply).toContain("当前状态总览：直接问“你现在记着我什么”");
    expect(reply).toContain("低摩擦规则");
    expect(reply).toContain("追问策略：只在缺日期、缺开始时间或目标不唯一时追问");
    expect(reply).toContain("早晚报排程：早报和晚报会展示待处理上下文");
    expect(reply).toContain("SEED_LITE_STATE_FILE：runtime/seed.json");
    expect(reply).toContain("settings.local.json");
    expect(reply).not.toContain("secret-model-key");
  });
});
