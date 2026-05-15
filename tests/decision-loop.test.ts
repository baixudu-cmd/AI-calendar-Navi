import { describe, expect, it } from "vitest";
import { runDecisionLoop } from "../src/loop/index.js";
import { createShortTermStateStore } from "../src/state/index.js";

describe("runDecisionLoop", () => {
  it("uses the decision client as the only semantic step", async () => {
    const calls: string[] = [];
    const state = createShortTermStateStore();

    const result = await runDecisionLoop({
      message: { id: "m1", text: "明天下午三点见张总" },
      state,
      decisionClient: {
        decide: async (request) => {
          calls.push(request.text);
          return {
            action: "create_event",
            event: {
              title: "见张总",
              date: "2026-05-09",
              startTime: "15:00",
            },
          };
        },
      },
    });

    expect(calls).toEqual(["明天下午三点见张总"]);
    expect(result).toEqual({
      ok: true,
      action: {
        type: "create_event",
        event: {
          title: "见张总",
          date: "2026-05-09",
          startTime: "15:00",
        },
      },
    });
    expect(state.snapshot()).toEqual({});
  });

  it("does not call decision client when entry protection rejects input", async () => {
    let called = false;

    const result = await runDecisionLoop({
      message: { id: "m2", text: "   " },
      state: createShortTermStateStore(),
      decisionClient: {
        decide: async () => {
          called = true;
          return { action: "clarify", question: "?", missing: ["text"] };
        },
      },
    });

    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected entry rejection");
    expect(result.reason).toBe("entry_rejected");
  });

  it("stores pending clarification when required fields are missing", async () => {
    const state = createShortTermStateStore();

    const result = await runDecisionLoop({
      message: { id: "m3", text: "明天见张总" },
      state,
      decisionClient: {
        decide: async () => ({
          action: "create_event",
          event: { title: "见张总", date: "2026-05-09" },
        }),
      },
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.action.type).toBe("clarify");
    expect(state.snapshot()).toEqual({
      pending_clarification: {
        question: "这个日程几点开始？",
        missing: ["startTime"],
        createDraft: { title: "见张总", date: "2026-05-09" },
      },
    });
  });

  it("combines pending create draft with a follow-up time into a complete create action", async () => {
    const state = createShortTermStateStore({
      pending_clarification: {
        question: "这个日程几点开始？",
        missing: ["startTime"],
        createDraft: { title: "见张总", date: "2026-05-09" },
      },
    });

    const result = await runDecisionLoop({
      message: { id: "m4", text: "上午10点" },
      state,
      decisionClient: {
        decide: async () => ({
          action: "create_event",
          event: { startTime: "10:00" },
        }),
      },
    });

    expect(result).toEqual({
      ok: true,
      action: {
        type: "create_event",
        event: { title: "见张总", date: "2026-05-09", startTime: "10:00" },
      },
    });
    expect(state.snapshot()).toEqual({});
  });

  it("does not inherit an old pending create date when the model starts a different draft", async () => {
    const state = createShortTermStateStore({
      pending_clarification: {
        question: "这个日程几点开始？",
        missing: ["startTime"],
        createDraft: { title: "约张总开会", date: "2026-05-09" },
      },
    });

    const result = await runDecisionLoop({
      message: { id: "m5", text: "帮我安排拿币" },
      state,
      decisionClient: {
        decide: async () => ({
          action: "create_event",
          event: { title: "拿币" },
        }),
      },
    });

    expect(result).toEqual({
      ok: true,
      action: {
        type: "clarify",
        question: "这个日程是哪天几点？",
        missing: ["date", "startTime"],
        createDraft: { title: "拿币" },
      },
    });
    expect(state.snapshot()).toEqual({
      pending_clarification: {
        question: "这个日程是哪天几点？",
        missing: ["date", "startTime"],
        createDraft: { title: "拿币" },
      },
    });
  });
});
