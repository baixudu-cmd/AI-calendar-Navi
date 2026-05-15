import { describe, expect, it } from "vitest";
import {
  formatAdvancedWechatBridgeSmokeReport,
  parseAdvancedWechatBridgeActionType,
  runAdvancedWechatBridgeSmoke,
} from "../src/live/advanced-wechat-bridge-smoke.js";

describe("advanced WeChat bridge smoke", () => {
  it("runs the advanced bridge scenario through an injected dispatcher", async () => {
    const seen: Array<{ text: string; messageId: string; requestId: string }> = [];
    const actions = ["clarify", "create_event", "request_delete_event", "confirm_delete"];

    const result = await runAdvancedWechatBridgeSmoke({
      dispatch: async (input) => {
        seen.push({ text: input.text, messageId: input.messageId, requestId: input.requestId });
        const actionType = actions[seen.length - 1];
        return [
          "OpenClaw shadow caller smoke: passed",
          `requestId=${input.requestId}`,
          `actionType=${actionType}`,
          "已处理。",
        ].join("\n");
      },
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({ total: 4, passed: 4, failed: 0 });
    expect(result.steps.map((step) => step.actionType)).toEqual(actions);
    expect(seen.map((item) => item.text)).toEqual(["明天约张总开会", "上午10点", "删掉刚才那个", "确认删除"]);
    expect(new Set(seen.map((item) => item.messageId)).size).toBe(4);
    expect(new Set(seen.map((item) => item.requestId)).size).toBe(4);
  });

  it("fails closed when bridge output does not contain the expected action", async () => {
    const result = await runAdvancedWechatBridgeSmoke({
      dispatch: async () => "OpenClaw shadow caller smoke: passed\nrequestId=req_1\nactionType=list_events\n已处理。",
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toEqual({ total: 4, passed: 0, failed: 4 });
    expect(result.failures[0]).toMatchObject({ family: "bridge_output" });
  });

  it("parses actionType from diagnostic output only", () => {
    expect(parseAdvancedWechatBridgeActionType("OpenClaw shadow caller smoke: passed\nactionType=create_event\n已创建。")).toBe(
      "create_event",
    );
    expect(parseAdvancedWechatBridgeActionType("已创建。")).toBe("unknown");
  });

  it("prints a short report without leaking secrets", async () => {
    const result = await runAdvancedWechatBridgeSmoke({
      dispatch: async (input) => `OpenClaw shadow caller smoke: passed\nrequestId=${input.requestId}\nactionType=${input.expectedAction}\nsecret-value`,
    });

    const report = formatAdvancedWechatBridgeSmokeReport(result);

    expect(report).toContain("Advanced WeChat bridge smoke: passed");
    expect(report).toContain("Passed: 4");
    expect(report).not.toContain("secret-value");
  });
});
