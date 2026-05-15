// P6 主动消息发送闸门：只发送已经生成好的文本，不判断日程语义。

import { spawn } from "node:child_process";

export type ProactiveDeliveryMode = string;

export type ProactiveDeliveryInput = {
  key: string;
  message: string;
  mode: string;
};

export type ProactiveDeliveryResult =
  | {
      ok: true;
      mode: ProactiveDeliveryMode;
      message: string;
    }
  | {
      ok: false;
      mode: ProactiveDeliveryMode;
      message: string;
    };

export type ProactiveDelivery = {
  deliver(input: ProactiveDeliveryInput): Promise<ProactiveDeliveryResult>;
};

export type OpenClawCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export type OpenClawCommandRunner = (command: string, args: string[]) => Promise<OpenClawCommandResult>;

export type OpenClawWeixinDeliveryInput = {
  openclawPath?: string;
  accountId: string;
  target: string;
  run?: OpenClawCommandRunner;
  runner?: OpenClawCommandRunner;
};

// 创建 dry-run 发送器，默认只确认文本已走到发送闸门。
export function createDryRunProactiveDelivery(): ProactiveDelivery {
  return {
    async deliver() {
      return { ok: true, mode: "dry-run", message: "dry-run delivery completed" };
    },
  };
}

// 创建注入式发送器，供测试和本地 smoke 使用。
export function createInjectedProactiveDelivery(deliver: (input: ProactiveDeliveryInput) => Promise<ProactiveDeliveryResult>): ProactiveDelivery {
  return { deliver };
}

// 创建函数式发送器，供计划测试和本地 smoke 使用。
export function createFunctionProactiveDelivery(
  mode: ProactiveDeliveryMode,
  send: (input: ProactiveDeliveryInput) => Promise<ProactiveDeliveryResult>,
): ProactiveDelivery {
  return {
    async deliver(input) {
      const result = await send(input);
      return { ...result, mode: result.mode || mode };
    },
  };
}

// 创建 OpenClaw 微信发送器；只组装命令并调用，不做任何语义判断。
export function createOpenClawWeixinProactiveDelivery(input: OpenClawWeixinDeliveryInput): ProactiveDelivery {
  const runner = input.run || input.runner || runOpenClawCommand;
  const openclawPath = input.openclawPath || "openclaw";
  return {
    async deliver(message) {
      const result = await runner(openclawPath, [
        "message",
        "send",
        "--channel",
        "openclaw-weixin",
        "--account",
        input.accountId,
        "--target",
        input.target,
        "--message",
        message.message,
        "--json",
      ]);

      if (result.status === 0) {
        return { ok: true, mode: "wechat", message: "openclaw weixin delivery completed" };
      }

      const detail = result.stderr.trim() || result.stdout.trim() || "OpenClaw Weixin delivery failed";
      return { ok: false, mode: "wechat", message: detail };
    },
  };
}

// 运行 OpenClaw 命令，避免 shell 拼接带来的转义问题。
async function runOpenClawCommand(command: string, args: string[]): Promise<OpenClawCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      resolve({ status: 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: `${Buffer.concat(stderr).toString("utf8")}${String(error)}` });
    });
    child.on("close", (status) => {
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
