// 微信消息适配测试：确认文字和语音转写只被统一成内部消息形状。

import { describe, expect, it } from "vitest";
import { normalizeWeChatMessage } from "../src/wechat/message.js";

describe("normalizeWeChatMessage", () => {
  it("normalizes text messages into incoming messages", () => {
    expect(normalizeWeChatMessage({ id: "wx_1", kind: "text", text: "  明天下午三点见张总  " })).toEqual({
      id: "wx_1",
      text: "明天下午三点见张总",
    });
  });

  it("normalizes voice transcript messages into the same incoming shape", () => {
    expect(normalizeWeChatMessage({ id: "wx_2", kind: "voice_transcript", transcript: "明早九点开会" })).toEqual({
      id: "wx_2",
      text: "明早九点开会",
    });
  });

  it("keeps empty transcripts for entry protection instead of deciding semantics", () => {
    expect(normalizeWeChatMessage({ id: "wx_3", kind: "voice_transcript", transcript: "   " })).toEqual({
      id: "wx_3",
      text: "",
    });
  });
});
