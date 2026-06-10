// ClawBot 入站归一化：把微信消息变成 Navi 能处理的文本输入。

import type { ClawBotMessage, ClawBotMessageItem, NormalizedBridgeMessage } from "./types.js";

export type NormalizeClawBotMessageInput = {
  accountId: string;
  message: ClawBotMessage;
};

export type NormalizeClawBotMessageResult =
  | { ok: true; message: NormalizedBridgeMessage }
  | { ok: false; message: string };

// 归一化 ClawBot 消息；P38.1 只接文本和微信语音转写文本。
export function normalizeClawBotMessage(input: NormalizeClawBotMessageInput): NormalizeClawBotMessageResult {
  const accountId = input.accountId.trim();
  const wechatUserId = input.message.from_user_id?.trim();
  const rawMessageId = input.message.message_id;
  if (!accountId) return { ok: false, message: "缺少 ClawBot accountId。" };
  if (!wechatUserId) return { ok: false, message: "缺少微信发送人。" };
  if (rawMessageId === undefined || rawMessageId === null || String(rawMessageId).trim().length === 0) {
    return { ok: false, message: "缺少微信消息 ID。" };
  }

  const text = extractText(input.message.item_list || []);
  if (!text) return { ok: false, message: "这条微信消息暂时不是可处理的文本。" };

  return {
    ok: true,
    message: {
      accountId,
      wechatUserId,
      messageId: `${accountId}:${String(rawMessageId).trim()}`,
      text,
      ...(input.message.context_token?.trim() ? { contextToken: input.message.context_token.trim() } : {}),
    },
  };
}

function extractText(items: ClawBotMessageItem[]): string | undefined {
  for (const item of items) {
    const text = item.text_item?.text?.trim();
    if (text) return text;
    const voiceText = item.voice_item?.text?.trim();
    if (voiceText) return voiceText;
  }
  return undefined;
}
