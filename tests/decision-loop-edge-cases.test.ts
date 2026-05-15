import { describe, expect, it } from "vitest";
import { runDecisionLoop } from "../src/loop/index.js";
import { createShortTermStateStore } from "../src/state/index.js";

describe("decision loop edge cases", () => {
  it("does not write state when contract rejects an unknown action", async () => {
    const state = createShortTermStateStore();

    const result = await runDecisionLoop({
      message: { id: "m1", text: "删掉明天的会" },
      state,
      decisionClient: {
        decide: async () => ({ action: "delete_event" }),
      },
    });

    expect(result).toEqual({
      ok: false,
      reason: "contract_rejected",
      message: "不支持的动作：delete_event",
    });
    expect(state.snapshot()).toEqual({});
  });

  it("does not write state when model output is malformed", async () => {
    const state = createShortTermStateStore();

    const result = await runDecisionLoop({
      message: { id: "m2", text: "明天开会" },
      state,
      decisionClient: {
        decide: async () => null,
      },
    });

    expect(result.ok).toBe(false);
    expect(state.snapshot()).toEqual({});
  });
});
