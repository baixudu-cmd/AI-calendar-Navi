// P12 主动链路运行体检 CLI：支持快照文件和 Mac mini 本机只读 live 模式。

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { formatProactiveRuntimeDoctorReport, runProactiveRuntimeDoctor } from "./proactive-runtime-doctor.js";

const execFileAsync = promisify(execFile);

const snapshot = await loadSnapshot();

if (!snapshot.ok) {
  console.log("Proactive runtime doctor: failed");
  console.log(`- ${snapshot.message}`);
  process.exitCode = 1;
} else {
  const result = runProactiveRuntimeDoctor(snapshot.data);
  console.log(formatProactiveRuntimeDoctorReport(result));
  if (!result.ok) process.exitCode = 1;
}

type RuntimeSnapshot = {
  launchctlList: string;
  openclawCronJobsJson: string;
  processList: string;
  proactiveWechatAccountId?: string;
  proactiveWechatTarget?: string;
  weixinContextTokensJson?: string;
};

async function loadSnapshot(): Promise<{ ok: true; data: RuntimeSnapshot } | { ok: false; message: string }> {
  const fileSnapshot = await loadFileSnapshot();
  if (fileSnapshot.ok) return fileSnapshot;
  if (process.env.PROACTIVE_RUNTIME_ENABLE_LIVE === "1") return loadLiveSnapshot();
  return {
    ok: false,
    message: "请设置快照文件环境变量，或在 Mac mini 上显式设置 PROACTIVE_RUNTIME_ENABLE_LIVE=1。",
  };
}

async function loadFileSnapshot(): Promise<{ ok: true; data: RuntimeSnapshot } | { ok: false; message: string }> {
  const launchctlFile = process.env.PROACTIVE_RUNTIME_LAUNCHCTL_FILE;
  const cronFile = process.env.PROACTIVE_RUNTIME_OPENCLAW_CRON_FILE;
  const processFile = process.env.PROACTIVE_RUNTIME_PROCESS_FILE;
  if (!launchctlFile && !cronFile && !processFile) return { ok: false, message: "未提供快照文件。" };
  if (!launchctlFile || !cronFile || !processFile) return { ok: false, message: "快照文件不完整。" };

  return {
    ok: true,
    data: {
      launchctlList: await readFile(launchctlFile, "utf8"),
      openclawCronJobsJson: await readFile(cronFile, "utf8"),
      processList: await readFile(processFile, "utf8"),
      proactiveWechatAccountId: process.env.PROACTIVE_WECHAT_ACCOUNT_ID,
      proactiveWechatTarget: process.env.PROACTIVE_WECHAT_TARGET,
      weixinContextTokensJson: await readOptionalWeixinContextTokens(),
    },
  };
}

async function loadLiveSnapshot(): Promise<{ ok: true; data: RuntimeSnapshot }> {
  const launchctlList = await runCommand("launchctl", ["list"]);
  const processList = await runCommand("ps", ["aux"]);
  const cronPath =
    process.env.PROACTIVE_RUNTIME_OPENCLAW_CRON_PATH ||
    join(homedir(), ".openclaw", "cron", "jobs.json");
  return {
    ok: true,
    data: {
      launchctlList,
      processList,
      openclawCronJobsJson: await readFile(cronPath, "utf8"),
      proactiveWechatAccountId: process.env.PROACTIVE_WECHAT_ACCOUNT_ID,
      proactiveWechatTarget: process.env.PROACTIVE_WECHAT_TARGET,
      weixinContextTokensJson: await readOptionalWeixinContextTokens(),
    },
  };
}

async function runCommand(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { encoding: "utf8" });
  return stdout;
}

async function readOptionalWeixinContextTokens(): Promise<string | undefined> {
  const explicitPath = process.env.PROACTIVE_RUNTIME_WEIXIN_CONTEXT_TOKENS_FILE;
  const accountId = process.env.PROACTIVE_WECHAT_ACCOUNT_ID;
  const tokenPath =
    explicitPath ||
    (accountId
      ? join(homedir(), ".openclaw", "openclaw-weixin", "accounts", `${accountId}.context-tokens.json`)
      : undefined);
  if (!tokenPath) return undefined;

  try {
    return await readFile(tokenPath, "utf8");
  } catch {
    return undefined;
  }
}
