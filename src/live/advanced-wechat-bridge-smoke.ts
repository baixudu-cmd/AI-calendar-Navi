// 进阶微信桥接 smoke：验证外部 dispatch 脚本能承载 Calendar Agent 的多轮 shadow 调用。

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export type AdvancedWechatBridgeSmokeStepDefinition = {
  text: string;
  expectedAction: string;
};

export type AdvancedWechatBridgeDispatchInput = AdvancedWechatBridgeSmokeStepDefinition & {
  messageId: string;
  requestId: string;
};

export type AdvancedWechatBridgeDispatch = (input: AdvancedWechatBridgeDispatchInput) => Promise<string>;

export type AdvancedWechatBridgeSmokeStep = {
  text: string;
  actionType: string;
  ok: boolean;
};

export type AdvancedWechatBridgeSmokeFailure = {
  family: "bridge_dispatch" | "bridge_output";
  message: string;
};

export type AdvancedWechatBridgeSmokeResult = {
  ok: boolean;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  steps: AdvancedWechatBridgeSmokeStep[];
  failures: AdvancedWechatBridgeSmokeFailure[];
};

export type AdvancedWechatBridgeSmokeInput = {
  dispatch?: AdvancedWechatBridgeDispatch;
  dispatchScript?: string;
  messagePrefix?: string;
};

const DEFAULT_DISPATCH_SCRIPT = join(
  homedir(),
  "projects",
  "codex-workspaces",
  "navi-calendar-agent",
  "scripts",
  "dispatch-shadow.sh",
);

const DEFAULT_STEPS: AdvancedWechatBridgeSmokeStepDefinition[] = [
  { text: "明天约张总开会", expectedAction: "clarify" },
  { text: "上午10点", expectedAction: "create_event" },
  { text: "删掉刚才那个", expectedAction: "request_delete_event" },
  { text: "确认删除", expectedAction: "confirm_delete" },
];

// 运行桥接级 smoke；测试可注入 dispatch，真实运行通过 Mac mini 上的 dispatch 脚本。
export async function runAdvancedWechatBridgeSmoke(
  input: AdvancedWechatBridgeSmokeInput = {},
): Promise<AdvancedWechatBridgeSmokeResult> {
  const dispatch = input.dispatch || createShellAdvancedWechatBridgeDispatch(input.dispatchScript || DEFAULT_DISPATCH_SCRIPT);
  const messagePrefix = input.messagePrefix || `advanced_wechat_bridge_${Date.now()}`;
  const steps: AdvancedWechatBridgeSmokeStep[] = [];
  const failures: AdvancedWechatBridgeSmokeFailure[] = [];

  for (const [index, step] of DEFAULT_STEPS.entries()) {
    const messageId = `${messagePrefix}_msg_${index + 1}`;
    const requestId = `${messagePrefix}_req_${index + 1}`;

    try {
      const output = await dispatch({ ...step, messageId, requestId });
      const actionType = parseAdvancedWechatBridgeActionType(output);
      const ok = actionType === step.expectedAction;
      steps.push({ text: step.text, actionType, ok });
      if (!ok) {
        failures.push({
          family: "bridge_output",
          message: `expected ${step.expectedAction}, got ${actionType}`,
        });
      }
    } catch (error) {
      steps.push({ text: step.text, actionType: "dispatch_failed", ok: false });
      failures.push({
        family: "bridge_dispatch",
        message: error instanceof Error ? error.message : "桥接脚本执行失败。",
      });
    }
  }

  return {
    ok: failures.length === 0,
    summary: {
      total: DEFAULT_STEPS.length,
      passed: DEFAULT_STEPS.length - failures.length,
      failed: failures.length,
    },
    steps,
    failures,
  };
}

// 从 shadow caller 诊断输出中读取 actionType；reply-only 输出没有诊断时返回 unknown。
export function parseAdvancedWechatBridgeActionType(output: string): string {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("actionType=")) return trimmed.slice("actionType=".length).trim() || "unknown";
  }
  return "unknown";
}

// 输出给人看的汇总；不输出原始桥接回包，避免泄露密钥或运行时细节。
export function formatAdvancedWechatBridgeSmokeReport(result: AdvancedWechatBridgeSmokeResult): string {
  const lines = [
    `Advanced WeChat bridge smoke: ${result.ok ? "passed" : "failed"}`,
    `Total: ${result.summary.total}`,
    `Passed: ${result.summary.passed}`,
    `Failed: ${result.summary.failed}`,
  ];

  for (const step of result.steps) {
    lines.push(`${step.ok ? "ok" : "failed"} - ${step.actionType}`);
  }

  if (result.failures.length > 0) {
    lines.push("Failure families:");
    for (const [family, count] of Object.entries(countFamilies(result.failures))) {
      lines.push(`- ${family}: ${count}`);
    }
  }

  return lines.join("\n");
}

// 构造真实 shell dispatcher，只通过环境变量传 messageId/requestId，文本走脚本参数。
export function createShellAdvancedWechatBridgeDispatch(dispatchScript: string): AdvancedWechatBridgeDispatch {
  return async (input) =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(dispatchScript, [input.text], {
        env: {
          ...process.env,
          OPENCLAW_SHADOW_MESSAGE_ID: input.messageId,
          OPENCLAW_SHADOW_REQUEST_ID: input.requestId,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout.on("data", (chunk) => stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      child.stderr.on("data", (chunk) => stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      child.on("error", (error) => reject(new Error(`桥接脚本无法启动：${error.message}`)));
      child.on("close", (code) => {
        const output = Buffer.concat(stdout).toString("utf8");
        if (code === 0) {
          resolve(output);
          return;
        }
        const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
        reject(new Error(errorOutput ? `桥接脚本退出：${code}` : "桥接脚本执行失败。"));
      });
    });
}

function countFamilies(failures: AdvancedWechatBridgeSmokeFailure[]): Record<string, number> {
  return failures.reduce<Record<string, number>>((acc, failure) => {
    acc[failure.family] = (acc[failure.family] || 0) + 1;
    return acc;
  }, {});
}
