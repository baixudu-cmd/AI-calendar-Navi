// 微信消息适配器：只统一文字形状，不做日程语义判断。

import type { IncomingMessage } from "../entry/index.js";

export type WeChatMessage =
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "voice_transcript"; transcript: string };

// 把微信文字和语音转写统一成 entry 层能处理的消息。
export function normalizeWeChatMessage(message: WeChatMessage): IncomingMessage {
  const text = message.kind === "text" ? message.text : message.transcript;
  return { id: message.id, text: normalizeWeChatText(text) };
}

// 只做低层文本卫生：统一全角/半角并压缩空白，不修正 ASR 猜错的词。
function normalizeWeChatText(value: string): string {
  let result = "";
  let previousWasSpace = false;
  for (const char of value.normalize("NFKC").trim()) {
    if (char.trim().length === 0) {
      if (!previousWasSpace) result += " ";
      previousWasSpace = true;
      continue;
    }
    result += char;
    previousWasSpace = false;
  }
  return result;
}
