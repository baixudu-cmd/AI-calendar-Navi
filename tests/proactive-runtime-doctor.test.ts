// P12 主动链路运行体检测试：防止旧 private-toki 调度源再次混入新版主动消息。

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { runProactiveRuntimeDoctor } from "../src/live/proactive-runtime-doctor.js";

const healthyLaunchctl = [
  "-\t0\tcom.navi-calendar.proactive-morning",
  "-\t0\tcom.navi-calendar.proactive-evening",
  "-\t0\tcom.navi-calendar.proactive-reminder",
].join("\n");

const healthyCron = JSON.stringify({
  version: 1,
  jobs: [
    { id: "old_morning", name: "private-toki-morning-briefing", enabled: false },
    { id: "new_other", name: "unrelated-openclaw-job", enabled: true },
  ],
});

describe("proactive runtime doctor", () => {
  it("passes when new proactive jobs are loaded and old cron is disabled", () => {
    const result = runProactiveRuntimeDoctor({
      launchctlList: healthyLaunchctl,
      openclawCronJobsJson: healthyCron,
      processList: "openclaw-gateway\nnode src/agent-api/shadow-http-cli.ts",
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("Proactive runtime doctor: passed");
    expect(result.details).toContain("新版主动 LaunchAgent 已加载 3/3。");
    expect(result.details).toContain("旧 OpenClaw private-toki cron 未启用。");
  });

  it("fails when a legacy OpenClaw private-toki cron is enabled", () => {
    const result = runProactiveRuntimeDoctor({
      launchctlList: healthyLaunchctl,
      openclawCronJobsJson: JSON.stringify({
        jobs: [{ id: "3555c243", name: "private-toki-morning-briefing", enabled: true }],
      }),
      processList: "",
    });

    expect(result.ok).toBe(false);
    expect(result.details).toContain("旧 OpenClaw cron 仍启用：private-toki-morning-briefing。");
  });

  it("fails when a legacy private-toki LaunchAgent is loaded", () => {
    const result = runProactiveRuntimeDoctor({
      launchctlList: `${healthyLaunchctl}\n-\t0\tcom.private-toki.calendar.morning`,
      openclawCronJobsJson: healthyCron,
      processList: "",
    });

    expect(result.ok).toBe(false);
    expect(result.details).toContain("旧 private-toki LaunchAgent 仍在：com.private-toki.calendar.morning。");
  });

  it("fails when a required new proactive LaunchAgent is missing", () => {
    const result = runProactiveRuntimeDoctor({
      launchctlList: "-\t0\tcom.navi-calendar.proactive-morning",
      openclawCronJobsJson: healthyCron,
      processList: "",
    });

    expect(result.ok).toBe(false);
    expect(result.details).toContain("缺少新版主动 LaunchAgent：com.navi-calendar.proactive-evening。");
    expect(result.details).toContain("缺少新版主动 LaunchAgent：com.navi-calendar.proactive-reminder。");
  });

  it("fails when proactive Weixin target casing does not match the context token cache", () => {
    const result = runProactiveRuntimeDoctor({
      launchctlList: healthyLaunchctl,
      openclawCronJobsJson: healthyCron,
      processList: "",
      proactiveWechatAccountId: "106501ee843a-im-bot",
      proactiveWechatTarget: "o9cq80yspgcctonn6_g9ir3cpcwu@im.wechat",
      weixinContextTokensJson: JSON.stringify({
        "o9cq80ySPgCcTOnn6_g9Ir3CpcWU@im.wechat": "context-token",
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.details).toContain("微信主动发送 target 大小写与 context token 不一致，可能无法可见送达。");
  });

  it("passes when proactive Weixin target exactly matches the context token cache", () => {
    const result = runProactiveRuntimeDoctor({
      launchctlList: healthyLaunchctl,
      openclawCronJobsJson: healthyCron,
      processList: "",
      proactiveWechatAccountId: "106501ee843a-im-bot",
      proactiveWechatTarget: "o9cq80ySPgCcTOnn6_g9Ir3CpcWU@im.wechat",
      weixinContextTokensJson: JSON.stringify({
        "o9cq80ySPgCcTOnn6_g9Ir3CpcWU@im.wechat": "context-token",
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.details).toContain("微信主动发送目标已匹配 context token。");
  });

  it("runs from the CLI with snapshot files", () => {
    const dir = mkdtempSync(join(tmpdir(), "navi-proactive-runtime-"));
    const launchctlFile = join(dir, "launchctl.txt");
    const cronFile = join(dir, "jobs.json");
    const processFile = join(dir, "ps.txt");
    const contextTokensFile = join(dir, "context-tokens.json");
    writeFileSync(launchctlFile, healthyLaunchctl, "utf8");
    writeFileSync(cronFile, healthyCron, "utf8");
    writeFileSync(processFile, "openclaw-gateway\n", "utf8");
    writeFileSync(contextTokensFile, JSON.stringify({ "user@im.wechat": "context-token" }), "utf8");

    const result = spawnSync("npm", ["run", "live:proactive-runtime-doctor"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PROACTIVE_RUNTIME_LAUNCHCTL_FILE: launchctlFile,
        PROACTIVE_RUNTIME_OPENCLAW_CRON_FILE: cronFile,
        PROACTIVE_RUNTIME_PROCESS_FILE: processFile,
        PROACTIVE_RUNTIME_WEIXIN_CONTEXT_TOKENS_FILE: contextTokensFile,
        PROACTIVE_WECHAT_ACCOUNT_ID: "account-1",
        PROACTIVE_WECHAT_TARGET: "user@im.wechat",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Proactive runtime doctor: passed");
    expect(result.stdout).toContain("微信主动发送目标已匹配 context token。");
    expect(result.stdout + result.stderr).not.toContain("FEISHU_APP_SECRET");
  });
});
