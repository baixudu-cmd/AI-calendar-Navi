// P14 自用运行体检：只读聚合主动链路、微信入口和提醒队列状态。

import type { ProactiveRuntimeDoctorResult } from "./proactive-runtime-doctor.js";
import type { WechatReminderStatusSummary } from "../wechat-reminder/index.js";

export type ShadowRouteProbeResult = {
  ok: boolean;
  message: string;
};

export type SelfUseRuntimeDoctorInput = {
  proactive: ProactiveRuntimeDoctorResult;
  shadowRoute: ShadowRouteProbeResult;
  reminderStatus: WechatReminderStatusSummary;
};

export type SelfUseRuntimeDoctorResult = {
  ok: boolean;
  summary: string;
  details: string[];
};

// 聚合当前自用运行时状态；不发送微信、不访问飞书、不自动修复。
export function runSelfUseRuntimeDoctor(input: SelfUseRuntimeDoctorInput): SelfUseRuntimeDoctorResult {
  const details: string[] = [];
  const failures: string[] = [];

  if (input.proactive.ok) {
    details.push("主动链路体检通过。");
  } else {
    failures.push("主动链路体检失败。");
    failures.push(...input.proactive.details);
  }

  if (input.shadowRoute.ok) {
    details.push("微信入口 shadow server 可达。");
  } else {
    failures.push(`微信入口 shadow server 不可达：${trimMessage(input.shadowRoute.message)}。`);
  }

  if (!input.reminderStatus.ok) {
    failures.push("微信提醒队列读取失败。");
  } else {
    details.push(
      `微信提醒队列可读：total=${input.reminderStatus.total} pending=${input.reminderStatus.pending} due=${input.reminderStatus.due} failed=${input.reminderStatus.failed}。`,
    );
    if (input.reminderStatus.due > 0) details.push(`微信提醒队列有到点未发送任务：${input.reminderStatus.due}。`);
    if (input.reminderStatus.failed > 0) failures.push(`微信提醒队列有失败任务：${input.reminderStatus.failed}。`);
  }

  return {
    ok: failures.length === 0,
    summary: `Self-use runtime doctor: ${failures.length === 0 ? "passed" : "failed"}`,
    details: [...details, ...failures],
  };
}

// 格式化体检输出，保持 CLI 和 runbook 结果一致。
export function formatSelfUseRuntimeDoctorReport(result: SelfUseRuntimeDoctorResult): string {
  return [result.summary, ...result.details.map((detail) => `- ${detail}`)].join("\n");
}

// 用错误 secret 探测 shadow route 是否可达；正常结果应在鉴权前失败，不触发模型或飞书。
export async function probeShadowRoute(input: { url: string; timeoutMs?: number }): Promise<ShadowRouteProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs || 3_000);
  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "",
        requestId: "runtime_doctor",
        messageId: `runtime_doctor_${Date.now()}`,
        secret: "__runtime_doctor_probe__",
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, message: `HTTP ${response.status}` };

    const parsed = JSON.parse(text) as { actionType?: unknown; reply?: unknown };
    const actionType = typeof parsed.actionType === "string" ? parsed.actionType : "";
    const reply = typeof parsed.reply === "string" ? parsed.reply : "";
    if (actionType === "rejected" || reply.includes("secret 校验失败")) {
      return { ok: true, message: "shadow route reachable" };
    }
    return { ok: false, message: "shadow route returned unexpected response" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "shadow route probe failed" };
  } finally {
    clearTimeout(timeout);
  }
}

function trimMessage(message: string): string {
  const trimmed = message.trim();
  return trimmed.endsWith("。") ? trimmed.slice(0, -1) : trimmed || "未知错误";
}
