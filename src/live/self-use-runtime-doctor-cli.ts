// P14 自用运行体检 CLI：只读检查 Mac mini 关键运行链路。

import "dotenv/config";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createLocalAddressFetch } from "../net/local-address-fetch.js";
import { createFileWechatReminderStore, inspectWechatReminderStatus } from "../wechat-reminder/index.js";
import { runProactiveRuntimeDoctor } from "./proactive-runtime-doctor.js";
import {
  formatSelfUseRuntimeDoctorReport,
  probeShadowRoute,
  runSelfUseRuntimeDoctor,
  type ShadowRouteProbeResult,
} from "./self-use-runtime-doctor.js";

const execFileAsync = promisify(execFile);

const proactive = await loadProactiveRuntime();
const reminderStatus = await inspectWechatReminderStatus({
  store: createFileWechatReminderStore(process.env.WECHAT_REMINDER_STATE_FILE || "state/wechat-reminders.json"),
  now: process.env.WECHAT_REMINDER_NOW || new Date().toISOString(),
});
const shadowRoute = await loadShadowProbe();

const result = runSelfUseRuntimeDoctor({
  proactive,
  reminderStatus,
  shadowRoute,
});

console.log(formatSelfUseRuntimeDoctorReport(result));
if (!result.ok) process.exitCode = 1;

async function loadProactiveRuntime() {
  const snapshot = await loadProactiveSnapshot();
  if (snapshot.ok) return runProactiveRuntimeDoctor(snapshot.data);
  if (process.env.SELF_USE_RUNTIME_ENABLE_LIVE === "1") return runProactiveRuntimeDoctor(await loadLiveProactiveSnapshot());
  return {
    ok: false,
    summary: "Proactive runtime doctor: failed",
    details: ["请设置主动链路快照文件，或在 Mac mini 上显式设置 SELF_USE_RUNTIME_ENABLE_LIVE=1。"],
  };
}

async function loadProactiveSnapshot():
  Promise<
    | { ok: true; data: { launchctlList: string; openclawCronJobsJson: string; processList: string } }
    | { ok: false }
  > {
  const launchctlFile = process.env.PROACTIVE_RUNTIME_LAUNCHCTL_FILE;
  const cronFile = process.env.PROACTIVE_RUNTIME_OPENCLAW_CRON_FILE;
  const processFile = process.env.PROACTIVE_RUNTIME_PROCESS_FILE;
  if (!launchctlFile || !cronFile || !processFile) return { ok: false };

  return {
    ok: true,
    data: {
      launchctlList: await readFile(launchctlFile, "utf8"),
      openclawCronJobsJson: await readFile(cronFile, "utf8"),
      processList: await readFile(processFile, "utf8"),
    },
  };
}

async function loadLiveProactiveSnapshot(): Promise<{ launchctlList: string; openclawCronJobsJson: string; processList: string }> {
  const launchctlList = await runCommand("launchctl", ["list"]);
  const processList = await runCommand("ps", ["aux"]);
  const cronPath =
    process.env.PROACTIVE_RUNTIME_OPENCLAW_CRON_PATH ||
    join(homedir(), ".openclaw", "cron", "jobs.json");
  return {
    launchctlList,
    processList,
    openclawCronJobsJson: await readFile(cronPath, "utf8"),
  };
}

async function loadShadowProbe(): Promise<ShadowRouteProbeResult> {
  const shadowProbeFile = process.env.SELF_USE_RUNTIME_SHADOW_PROBE_FILE;
  if (shadowProbeFile) return readShadowProbeFile(shadowProbeFile);
  const shadowUrl = process.env.SELF_USE_RUNTIME_SHADOW_URL || readLiveShadowUrl();
  if (!shadowUrl) return { ok: false, message: "缺少 SELF_USE_RUNTIME_SHADOW_URL 或 SELF_USE_RUNTIME_ENABLE_LIVE=1" };
  return probeShadowRoute({
    url: shadowUrl,
    fetch: createLocalAddressFetch(process.env.OPENCLAW_SHADOW_LOCAL_ADDRESS),
  });
}

async function readShadowProbeFile(filePath: string): Promise<ShadowRouteProbeResult> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as { ok?: unknown; message?: unknown };
    return {
      ok: parsed.ok === true,
      message: typeof parsed.message === "string" ? parsed.message : "shadow route probe snapshot",
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "shadow route probe snapshot failed" };
  }
}

function readLiveShadowUrl(): string {
  if (process.env.SELF_USE_RUNTIME_ENABLE_LIVE !== "1") return "";
  const port = process.env.SHADOW_ROUTE_PORT || "37891";
  return `http://127.0.0.1:${port}/calendar-agent/shadow`;
}

async function runCommand(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { encoding: "utf8" });
  return stdout;
}
