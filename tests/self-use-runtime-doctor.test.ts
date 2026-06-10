// P14 自用运行体检测试：聚合主动链路、微信入口和提醒队列状态，只读不发送。

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { runSelfUseRuntimeDoctor } from "../src/live/self-use-runtime-doctor.js";

const healthyProactive = {
  ok: true,
  summary: "Proactive runtime doctor: passed",
  details: ["新版主动 LaunchAgent 已加载 3/3。"],
};

const healthyReminder = {
  ok: true,
  total: 1,
  pending: 1,
  due: 0,
  sent: 0,
  failed: 0,
  nextDueAt: "2026-05-12T02:30:00.000Z",
  failedJobs: [],
};

describe("self-use runtime doctor", () => {
  it("passes when proactive runtime, shadow route, and reminder queue are healthy", () => {
    const result = runSelfUseRuntimeDoctor({
      proactive: healthyProactive,
      shadowRoute: { ok: true, message: "shadow route reachable" },
      reminderStatus: healthyReminder,
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("Self-use runtime doctor: passed");
    expect(result.details).toContain("主动链路体检通过。");
    expect(result.details).toContain("微信入口 shadow server 可达。");
    expect(result.details).toContain("微信提醒队列可读：total=1 pending=1 due=0 failed=0。");
  });

  it("fails when shadow route is not reachable", () => {
    const result = runSelfUseRuntimeDoctor({
      proactive: healthyProactive,
      shadowRoute: { ok: false, message: "connect ECONNREFUSED 127.0.0.1:37891" },
      reminderStatus: healthyReminder,
    });

    expect(result.ok).toBe(false);
    expect(result.details).toContain("微信入口 shadow server 不可达：connect ECONNREFUSED 127.0.0.1:37891。");
  });

  it("fails when reminder queue contains failed jobs", () => {
    const result = runSelfUseRuntimeDoctor({
      proactive: healthyProactive,
      shadowRoute: { ok: true, message: "shadow route reachable" },
      reminderStatus: {
        ...healthyReminder,
        failed: 1,
        failedJobs: [
          {
            jobId: "wechat-reminder:evt_failed:2026-05-12 10:00:30",
            title: "投委会",
            dueAt: "2026-05-12T01:30:00.000Z",
            lastError: "wechat failed",
            lastAttemptAt: "2026-05-12T01:30:00.000Z",
          },
        ],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.details).toContain("微信提醒队列有失败任务：1。");
  });

  it("runs from the CLI with local snapshots and a safe shadow probe", async () => {
    const root = mkdtempSync(join(tmpdir(), "navi-self-use-runtime-"));
    const launchctlFile = join(root, "launchctl.txt");
    const cronFile = join(root, "jobs.json");
    const processFile = join(root, "ps.txt");
    const reminderFile = join(root, "wechat-reminders.json");
    const shadowProbeFile = join(root, "shadow-probe.json");

    writeFileSync(
      launchctlFile,
      [
        "-\t0\tcom.navi-calendar.proactive-morning",
        "-\t0\tcom.navi-calendar.proactive-evening",
        "-\t0\tcom.navi-calendar.proactive-reminder",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(cronFile, JSON.stringify({ jobs: [{ name: "private-toki-morning-briefing", enabled: false }] }), "utf8");
    writeFileSync(processFile, "node src/agent-api/shadow-http-cli.ts\n", "utf8");
    writeFileSync(reminderFile, JSON.stringify({ jobs: [] }), "utf8");
    writeFileSync(shadowProbeFile, JSON.stringify({ ok: true, message: "shadow route reachable" }), "utf8");

    const result = spawnSync("npm", ["run", "live:self-use-runtime-doctor"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PROACTIVE_RUNTIME_LAUNCHCTL_FILE: launchctlFile,
        PROACTIVE_RUNTIME_OPENCLAW_CRON_FILE: cronFile,
        PROACTIVE_RUNTIME_PROCESS_FILE: processFile,
        WECHAT_REMINDER_STATE_FILE: reminderFile,
        SELF_USE_RUNTIME_SHADOW_PROBE_FILE: shadowProbeFile,
        WECHAT_REMINDER_NOW: "2026-05-12T01:30:00.000Z",
      },
    });

    rmSync(root, { recursive: true, force: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Self-use runtime doctor: passed");
    expect(result.stdout).toContain("微信入口 shadow server 可达。");
    expect(result.stdout + result.stderr).not.toContain("FEISHU_APP_SECRET");
  });

  it("lets the live CLI bind the shadow probe to the configured local loopback interface", () => {
    const content = readFileSync(join(process.cwd(), "src/live/self-use-runtime-doctor-cli.ts"), "utf8");

    expect(content).toContain("createLocalAddressFetch");
    expect(content).toContain("OPENCLAW_SHADOW_LOCAL_ADDRESS");
  });
});
