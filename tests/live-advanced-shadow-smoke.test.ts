import { describe, expect, it } from "vitest";
import {
  createDefaultAdvancedShadowSmokeScenarios,
  formatAdvancedShadowSmokeReport,
  runAdvancedShadowSmoke,
} from "../src/live/advanced-shadow-smoke.js";

describe("advanced shadow route smoke", () => {
  it("runs advanced multi-turn scenarios through HTTP shadow caller payloads", async () => {
    const result = await runAdvancedShadowSmoke({
      today: "2026-05-20",
      now: "2026-05-20T09:00:00+08:00",
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({ total: 3, passed: 3, failed: 0 });
    expect(result.steps.map((step) => `${step.scenarioId}:${step.actionType}`).filter((item) => !item.endsWith(":seed"))).toEqual([
      "briefing-title-update:daily_briefing",
      "briefing-title-update:update_event",
      "delete-confirm:request_delete_event",
      "delete-confirm:confirm_delete",
      "create-draft-clarification:clarify",
      "create-draft-clarification:create_event",
    ]);
  });

  it("keeps the default scenario set focused on advanced entry-state behavior", () => {
    const scenarios = createDefaultAdvancedShadowSmokeScenarios("2026-05-20");

    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      "briefing-title-update",
      "delete-confirm",
      "create-draft-clarification",
    ]);
    expect(scenarios.find((scenario) => scenario.id === "create-draft-clarification")).toMatchObject({
      steps: [
        { text: "明天约张总开会", expectedAction: "clarify" },
        { text: "上午10点", expectedAction: "create_event" },
      ],
    });
  });

  it("rejects duplicate message ids before a second model or calendar action", async () => {
    const result = await runAdvancedShadowSmoke({
      scenarios: [
        {
          id: "duplicate-message",
          date: "2026-05-20",
          seedEvents: [],
          decisions: [{ action: "list_events", date: "2026-05-20" }],
          steps: [
            { text: "查一下今天日程", messageId: "same-message", expectedAction: "list_events" },
            { text: "查一下今天日程", messageId: "same-message", expectedAction: "rejected", expectOk: false },
          ],
          expectedFinalEvents: [],
        },
      ],
      today: "2026-05-20",
      now: "2026-05-20T09:00:00+08:00",
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(result.steps.map((step) => step.actionType)).toEqual(["list_events", "rejected"]);
  });

  it("fails wrong secret without consuming the scripted decision", async () => {
    const result = await runAdvancedShadowSmoke({
      scenarios: [
        {
          id: "wrong-secret",
          date: "2026-05-20",
          seedEvents: [],
          decisions: [{ action: "list_events", date: "2026-05-20" }],
          steps: [
            { text: "查一下今天日程", secret: "bad-secret", expectedAction: "rejected", expectOk: false },
            { text: "查一下今天日程", expectedAction: "list_events" },
          ],
          expectedFinalEvents: [],
        },
      ],
      today: "2026-05-20",
      now: "2026-05-20T09:00:00+08:00",
    });

    expect(result.ok).toBe(true);
    expect(result.steps.map((step) => step.actionType)).toEqual(["rejected", "list_events"]);
  });

  it("prints only summary and step action information", async () => {
    const result = await runAdvancedShadowSmoke({
      today: "2026-05-20",
      now: "2026-05-20T09:00:00+08:00",
    });

    const report = formatAdvancedShadowSmokeReport(result);

    expect(report).toContain("Advanced shadow smoke: passed");
    expect(report).toContain("Total: 3");
    expect(report).toContain("Passed: 3");
    expect(report).toContain("Failed: 0");
    expect(report).not.toContain("secret");
  });
});
