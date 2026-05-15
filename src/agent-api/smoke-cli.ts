// Calendar Agent API smoke：本地 fake 流程验证，不访问模型、飞书、OpenClaw 或微信。

import { handleCalendarAgentRequest } from "./index.js";
import type { CalendarAdapter } from "../calendar/action-executor.js";
import type { DecisionClient } from "../decision/index.js";
import { createShortTermStateStore } from "../state/index.js";

function createFakeCalendar(): CalendarAdapter {
  const events: Array<{ id: string; title: string; start: string }> = [];
  return {
    async createEvent(event) {
      const created = { id: `evt_${events.length + 1}`, title: event.title, start: `${event.date} ${event.startTime}` };
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
      return { ok: true, data: event };
    },
    async deleteEvent(input) {
      return { ok: true, data: { eventId: input.eventId } };
    },
  };
}

function decisionClient(decisions: unknown[]): DecisionClient {
  let index = 0;
  return {
    decide: async () => decisions[index++] ?? { action: "clarify", question: "缺少动作。", missing: ["action"] },
  };
}

const state = createShortTermStateStore();
const calendar = createFakeCalendar();
const client = decisionClient([
  {
    action: "create_event",
    event: { title: "见张总", date: "2026-05-09", startTime: "15:00" },
  },
  { action: "list_events", date: "2026-05-09" },
  {
    action: "update_event",
    target: { kind: "last_event", eventId: "ignored_by_state" },
    patch: { title: "见李总" },
  },
]);

const steps = [
  await handleCalendarAgentRequest({ text: "明天下午三点见张总", requestId: "smoke_create", state, decisionClient: client, calendar }),
  await handleCalendarAgentRequest({ text: "查一下明天日程", requestId: "smoke_list", state, decisionClient: client, calendar }),
  await handleCalendarAgentRequest({ text: "改成见李总", requestId: "smoke_update", state, decisionClient: client, calendar }),
];

const passed = steps.every((step) => step.ok);
console.log(`Calendar Agent API smoke: ${passed ? "passed" : "failed"}`);
for (const step of steps) {
  console.log(`- ${step.actionType}: ${step.reply}`);
}

if (!passed) process.exitCode = 1;
