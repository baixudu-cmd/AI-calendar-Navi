// 能力 API 目录测试：保证给 AI 调阅的能力清单和真实工具合同保持一致。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_API_REGISTRY,
  createAssistantCoreCapabilityApi,
  createRuntimeOperationsCapabilityApi,
  findCapabilityApi,
  getCapabilityApiRegistry,
} from "../src/capability-api/index.js";
import type { CalendarAdapter } from "../src/calendar/action-executor.js";
import type { DecisionClient } from "../src/decision/index.js";
import { createMemoryMemoryDreamStore } from "../src/memory-dream/index.js";
import { createMemoryProactiveMessageStore } from "../src/live/proactive-briefing.js";
import { createMemorySeedLiteStore } from "../src/seed-lite/index.js";
import { createShortTermStateStore } from "../src/state/index.js";
import { TOOL_NAMES, TOOL_SCHEMAS } from "../src/tool-contract/index.js";
import { createMemoryWechatReminderStore } from "../src/wechat-reminder/index.js";

function createFakeCalendar(): CalendarAdapter {
  const events: Array<{ id: string; title: string; start: string; end?: string }> = [];
  return {
    async createEvent(event) {
      const created = {
        id: `evt_${events.length + 1}`,
        title: event.title,
        start: `${event.date} ${event.startTime}`,
        ...(event.endTime ? { end: `${event.date} ${event.endTime}` } : {}),
      };
      events.push(created);
      return { ok: true, data: created };
    },
    async listEvents() {
      return { ok: true, data: events };
    },
    async updateEvent(input) {
      const event = events.find((candidate) => candidate.id === input.eventId);
      if (!event) return { ok: false, code: "not_found", message: "没有找到日程。" };
      if (input.patch.title) event.title = input.patch.title;
      if (input.patch.date && input.patch.startTime) event.start = `${input.patch.date} ${input.patch.startTime}`;
      return { ok: true, data: event };
    },
    async deleteEvent(input) {
      return { ok: true, data: { eventId: input.eventId } };
    },
  };
}

describe("capability api registry", () => {
  it("exposes a stable read-only registry", () => {
    expect(getCapabilityApiRegistry()).toBe(CAPABILITY_API_REGISTRY);
    expect(CAPABILITY_API_REGISTRY.length).toBeGreaterThan(TOOL_NAMES.length);
    expect(findCapabilityApi("assistant.core")?.implementationStatus).toBe("implemented");
    expect(findCapabilityApi("runtime.operations")?.implementationStatus).toBe("implemented");
  });

  it("keeps one model capability per tool-contract tool", () => {
    const modelApis = CAPABILITY_API_REGISTRY.filter((entry) => entry.kind === "model_tool").map((entry) => entry.apiName);

    expect(modelApis).toEqual(TOOL_NAMES.map((toolName) => `model_tool.${toolName}`));
  });

  it("reuses the real tool parameter schemas instead of duplicating contracts", () => {
    for (const toolName of TOOL_NAMES) {
      const entry = CAPABILITY_API_REGISTRY.find((item) => item.apiName === `model_tool.${toolName}`);

      expect(entry?.inputContract).toEqual({
        kind: "tool_schema",
        schema: TOOL_SCHEMAS[toolName].parameters,
      });
    }
  });

  it("documents implementation status, failures, side effects, and tests for every capability", () => {
    const apiNames = new Set<string>();

    for (const entry of CAPABILITY_API_REGISTRY) {
      expect(apiNames.has(entry.apiName)).toBe(false);
      apiNames.add(entry.apiName);
      expect(entry.implementationStatus).toBe("implemented");
      expect(["assistant_entry", "model_tool", "runtime_job"]).toContain(entry.kind);
      expect(entry.failureModes.length).toBeGreaterThan(0);
      expect(entry.sideEffects).toBeDefined();
      expect(entry.tests.length).toBeGreaterThan(0);
    }
  });

  it("keeps the human API document aligned with exported capability names", () => {
    const document = readFileSync("docs/api/capability-apis.md", "utf8");

    for (const entry of CAPABILITY_API_REGISTRY) {
      expect(document).toContain(entry.apiName);
    }
  });

  it("wraps the message handler as the assistant core API", async () => {
    const decisionClient: DecisionClient = {
      async decide() {
        return { type: "remember_todo", title: "拿币", autoSchedule: false };
      },
    };
    const api = createAssistantCoreCapabilityApi({
      state: createShortTermStateStore(),
      decisionClient,
      calendar: createFakeCalendar(),
      seedStore: createMemorySeedLiteStore(),
    });

    const result = await api.handleMessage({
      text: "把拿币记一下",
      requestId: "req_capability_core",
      now: "2026-05-14T10:00:00+08:00",
    });

    expect(result).toMatchObject({ ok: true, actionType: "seed_lite" });
    expect(api.getCapability("assistant.handle_message")?.apiName).toBe("assistant.handle_message");
  });

  it("wraps runtime jobs as one operations API without model routing", async () => {
    const api = createRuntimeOperationsCapabilityApi();
    const memoryStore = createMemoryMemoryDreamStore();
    await memoryStore.addObservation({
      observedAt: "2026-05-14T08:00:00.000Z",
      requestId: "req_memory",
      actionType: "seed_lite",
      ok: true,
      reply: "已记到待推进：拿币",
    });

    const memory = await api.consolidateMemory({
      store: memoryStore,
      seedStore: createMemorySeedLiteStore([{ seedId: "seed_1", title: "拿币", createdAt: "2026-05-14T08:00:00.000Z" }]),
      now: "2026-05-14T09:00:00.000Z",
      since: "2026-05-14T00:00:00.000Z",
    });
    const reminderStore = createMemoryWechatReminderStore();
    const reminderStatus = await api.inspectReminderQueue({ store: reminderStore, now: "2026-05-14T09:00:00.000Z" });
    const briefing = await api.runProactiveBriefing({
      mode: "morning",
      today: "2026-05-14",
      now: "2026-05-14T09:00:00+08:00",
      calendar: createFakeCalendar(),
      store: createMemoryProactiveMessageStore(),
      seedStore: createMemorySeedLiteStore(),
    });

    expect(memory.ok).toBe(true);
    expect(reminderStatus).toMatchObject({ ok: true, total: 0 });
    expect(briefing).toMatchObject({ ok: true, sent: false });
  });
});
