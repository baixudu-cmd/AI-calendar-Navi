import { describe, expect, it } from "vitest";
import { protectIncomingMessage } from "../src/entry/index.js";

describe("protectIncomingMessage", () => {
  it("rejects empty messages without semantic inference", () => {
    const result = protectIncomingMessage({ id: "m1", text: "   " });

    expect(result).toEqual({
      ok: false,
      reason: "empty_input",
      message: "请重新发一下要处理的日程。",
    });
  });

  it("rejects overlong messages without model or calendar behavior", () => {
    const result = protectIncomingMessage({ id: "m2", text: "x".repeat(2001) });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("input_too_long");
    }
  });

  it("deduplicates repeated message ids", () => {
    const seen = new Set(["m3"]);
    const result = protectIncomingMessage({ id: "m3", text: "明天三点开会" }, seen);

    expect(result).toEqual({
      ok: false,
      reason: "duplicate_message",
      message: "这条消息已经处理过。",
    });
  });

  it("passes valid text through unchanged and does not classify intent", () => {
    const result = protectIncomingMessage({ id: "m4", text: "明天三点开会" });

    expect(result).toEqual({
      ok: true,
      message: { id: "m4", text: "明天三点开会" },
    });
    expect(JSON.stringify(result)).not.toContain("create_event");
  });
});
