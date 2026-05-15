// P12 主动链路运行体检：只读检查新版定时任务和旧 private-toki 调度源。

export type ProactiveRuntimeDoctorInput = {
  launchctlList: string;
  openclawCronJobsJson?: string;
  processList?: string;
  requiredLabels?: string[];
  proactiveWechatAccountId?: string;
  proactiveWechatTarget?: string;
  weixinContextTokensJson?: string;
};

export type ProactiveRuntimeDoctorResult = {
  ok: boolean;
  summary: string;
  details: string[];
};

const DEFAULT_REQUIRED_LABELS = [
  "com.navi-calendar.proactive-morning",
  "com.navi-calendar.proactive-evening",
  "com.navi-calendar.proactive-reminder",
];
const LEGACY_PROCESS_MARKER = process.env.NAVI_LEGACY_PROCESS_MARKER || "legacy-calendar-agent";
const LEGACY_PUSH_SCRIPT_MARKER = process.env.NAVI_LEGACY_PUSH_SCRIPT_MARKER || "legacy-push-calendar.mjs";

// 对运行快照做只读体检；不访问外部服务，也不自动修复。
export function runProactiveRuntimeDoctor(input: ProactiveRuntimeDoctorInput): ProactiveRuntimeDoctorResult {
  const details: string[] = [];
  const failures: string[] = [];
  const requiredLabels = input.requiredLabels || DEFAULT_REQUIRED_LABELS;

  for (const label of requiredLabels) {
    if (!input.launchctlList.includes(label)) failures.push(`缺少新版主动 LaunchAgent：${label}。`);
  }
  if (requiredLabels.every((label) => input.launchctlList.includes(label))) {
    details.push(`新版主动 LaunchAgent 已加载 ${requiredLabels.length}/${requiredLabels.length}。`);
  }

  const legacyLaunchAgents = findMatches(input.launchctlList, /com\.private-toki\.calendar\.[A-Za-z0-9_.-]+/g);
  for (const label of legacyLaunchAgents) failures.push(`旧 private-toki LaunchAgent 仍在：${label}。`);
  if (legacyLaunchAgents.length === 0) details.push("旧 private-toki LaunchAgent 未加载。");

  const legacyCronFailures = findLegacyCronFailures(input.openclawCronJobsJson);
  failures.push(...legacyCronFailures);
  if (legacyCronFailures.length === 0) details.push("旧 OpenClaw private-toki cron 未启用。");

  if ((input.processList || "").includes(LEGACY_PROCESS_MARKER) && (input.processList || "").includes(LEGACY_PUSH_SCRIPT_MARKER)) {
    failures.push("旧主动推送脚本仍在运行。");
  } else {
    details.push("旧主动推送脚本未运行。");
  }

  const weixinCheck = checkWeixinContextToken(input);
  details.push(...weixinCheck.details);
  failures.push(...weixinCheck.failures);

  return {
    ok: failures.length === 0,
    summary: `Proactive runtime doctor: ${failures.length === 0 ? "passed" : "failed"}`,
    details: [...details, ...failures],
  };
}

// 格式化体检输出，保持 CLI 和测试可读。
export function formatProactiveRuntimeDoctorReport(result: ProactiveRuntimeDoctorResult): string {
  return [result.summary, ...result.details.map((detail) => `- ${detail}`)].join("\n");
}

function findLegacyCronFailures(openclawCronJobsJson: string | undefined): string[] {
  if (!openclawCronJobsJson) return ["缺少 OpenClaw cron jobs.json 快照。"];

  try {
    const parsed = JSON.parse(openclawCronJobsJson) as { jobs?: unknown };
    if (!Array.isArray(parsed.jobs)) return ["OpenClaw cron jobs.json 格式不正确。"];

    return parsed.jobs.flatMap((job) => {
      if (!isRecord(job)) return [];
      const name = typeof job.name === "string" ? job.name : "";
      const message = readPayloadMessage(job);
      const enabled = job.enabled === true;
      const isLegacy =
        name.startsWith("private-toki-") ||
        message.includes(LEGACY_PROCESS_MARKER) ||
        message.includes(LEGACY_PUSH_SCRIPT_MARKER);
      return enabled && isLegacy ? [`旧 OpenClaw cron 仍启用：${name || "未命名任务"}。`] : [];
    });
  } catch {
    return ["OpenClaw cron jobs.json 解析失败。"];
  }
}

function checkWeixinContextToken(input: ProactiveRuntimeDoctorInput): { details: string[]; failures: string[] } {
  const accountId = input.proactiveWechatAccountId?.trim() || "";
  const target = input.proactiveWechatTarget?.trim() || "";
  if (!accountId && !target) return { details: [], failures: [] };
  if (!accountId || !target) return { details: [], failures: ["缺少主动微信 account 或 target，不能做可见送达体检。"] };
  if (!input.weixinContextTokensJson) return { details: [], failures: ["缺少 OpenClaw Weixin context token 快照。"] };

  try {
    const parsed = JSON.parse(input.weixinContextTokensJson) as unknown;
    if (!isRecord(parsed)) return { details: [], failures: ["OpenClaw Weixin context token 快照格式不正确。"] };

    const knownTargets = Object.keys(parsed).filter((key) => typeof parsed[key] === "string" && String(parsed[key]).length > 0);
    if (knownTargets.includes(target)) return { details: ["微信主动发送目标已匹配 context token。"], failures: [] };

    const caseOnlyMatch = knownTargets.find((key) => key.toLowerCase() === target.toLowerCase());
    if (caseOnlyMatch) {
      return { details: [], failures: ["微信主动发送 target 大小写与 context token 不一致，可能无法可见送达。"] };
    }

    return { details: [], failures: ["微信主动发送 target 没有 context token，请先从该微信会话发一条消息或修正 target。"] };
  } catch {
    return { details: [], failures: ["OpenClaw Weixin context token 快照解析失败。"] };
  }
}

function readPayloadMessage(job: Record<string, unknown>): string {
  const payload = job.payload;
  if (!isRecord(payload)) return "";
  return typeof payload.message === "string" ? payload.message : "";
}

function findMatches(text: string, pattern: RegExp): string[] {
  return [...new Set([...text.matchAll(pattern)].map((match) => match[0]))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
