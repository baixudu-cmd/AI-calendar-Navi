// live shadow message：只验证入口消息和注入式 handler，不绑定真实 OpenClaw / 微信。

import type { AppConfig } from "../config/index.js";
import { protectIncomingMessage } from "../entry/index.js";
import type { WeChatMessage } from "../wechat/message.js";
import { evaluateLiveConfigGate } from "./config-gate.js";

export type ShadowMessageHandler = (message: WeChatMessage) => Promise<{ ok: boolean; reply: string }>;

export type ShadowMessageSmokeInput = {
  config: AppConfig;
  requestId: string;
  messageId: string;
  secret: string;
  text: string;
  seenMessageIds?: ReadonlySet<string>;
  handler: ShadowMessageHandler;
};

export type ShadowMessageSmokeResult =
  | { ok: true; requestId: string; messageId: string; status: "handled"; reply: string }
  | {
      ok: false;
      requestId: string;
      messageId: string;
      status: "rejected" | "handler_failed";
      reason: string;
      reply: string;
    };

// 运行 shadow message smoke；只做入口保护和注入式 handler 调用。
export async function runShadowMessageSmoke(input: ShadowMessageSmokeInput): Promise<ShadowMessageSmokeResult> {
  const gate = evaluateLiveConfigGate(input.config);
  if (!gate.ok) return rejected(input, "config_failed", gate.failures.join("；"));

  if (input.secret !== input.config.wechatEntrySecret) {
    return rejected(input, "wrong_secret", "入口密钥不正确。");
  }

  const protectedMessage = protectIncomingMessage(
    { id: input.messageId, text: input.text },
    input.seenMessageIds || new Set(),
  );
  if (!protectedMessage.ok) {
    return rejected(input, protectedMessage.reason, protectedMessage.message);
  }

  const result = await input.handler({ id: input.messageId, kind: "text", text: protectedMessage.message.text });
  if (!result.ok) {
    return {
      ok: false,
      requestId: input.requestId,
      messageId: input.messageId,
      status: "handler_failed",
      reason: "handler_failed",
      reply: result.reply,
    };
  }

  return { ok: true, requestId: input.requestId, messageId: input.messageId, status: "handled", reply: result.reply };
}

function rejected(input: ShadowMessageSmokeInput, reason: string, reply: string): ShadowMessageSmokeResult {
  return { ok: false, requestId: input.requestId, messageId: input.messageId, status: "rejected", reason, reply };
}
