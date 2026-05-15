// 微信入口保护层，只做输入保护，不做任何日程语义判断。

export type IncomingMessage = {
  id: string;
  text: string;
};

export type EntryProtectionResult =
  | {
      ok: true;
      message: IncomingMessage;
    }
  | {
      ok: false;
      reason: "empty_input" | "input_too_long" | "duplicate_message";
      message: string;
    };

const MAX_INPUT_LENGTH = 2000;

// 对微信消息做最小保护；不得判断创建、修改、查询等语义。
export function protectIncomingMessage(
  message: IncomingMessage,
  seenMessageIds: ReadonlySet<string> = new Set(),
): EntryProtectionResult {
  const text = message.text.trim();

  if (!text) {
    return { ok: false, reason: "empty_input", message: "请重新发一下要处理的日程。" };
  }

  if (text.length > MAX_INPUT_LENGTH) {
    return { ok: false, reason: "input_too_long", message: "这条消息太长了，请拆短一点发。" };
  }

  if (seenMessageIds.has(message.id)) {
    return { ok: false, reason: "duplicate_message", message: "这条消息已经处理过。" };
  }

  return { ok: true, message: { ...message, text } };
}
