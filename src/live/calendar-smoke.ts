// live 日历 smoke 编排骨架：后续真实飞书 smoke 必须通过 calendar-api 执行。

import {
  createEvent,
  deleteEvent,
  listEvents,
  updateEvent,
  type CalendarGuardFailure,
  type DeterministicCalendarAdapter,
} from "../calendar-api/index.js";
import type {
  DeleteEventInput,
  DeleteEventResult,
  FeishuCalendarEvent,
  FeishuResult,
  ListEventsInput,
  UpdateEventInput,
} from "../calendar/feishu/types.js";
import type { AppConfig } from "../config/index.js";
import type { EventDraft } from "../contract/index.js";
import { evaluateLiveConfigGate, type LiveConfigGateReport } from "./config-gate.js";

export type LiveCalendarApi = {
  createEvent(adapter: DeterministicCalendarAdapter, event: EventDraft): Promise<FeishuResult<FeishuCalendarEvent>>;
  listEvents(adapter: DeterministicCalendarAdapter, input: ListEventsInput): Promise<FeishuResult<FeishuCalendarEvent[]>>;
  updateEvent(
    adapter: DeterministicCalendarAdapter,
    input: UpdateEventInput,
  ): Promise<FeishuResult<FeishuCalendarEvent> | CalendarGuardFailure>;
  deleteEvent(
    adapter: DeterministicCalendarAdapter,
    input: DeleteEventInput,
  ): Promise<FeishuResult<DeleteEventResult> | CalendarGuardFailure>;
};

export type CalendarSmokeStep = {
  name: "config" | "create" | "list" | "update" | "delete";
  ok: boolean;
  message: string;
};

export type CalendarApiDryRunSmokeInput = {
  adapter: DeterministicCalendarAdapter;
  config: AppConfig;
  date: string;
  startTime: string;
};

export type CalendarApiDryRunSmokeWithGateInput = Omit<CalendarApiDryRunSmokeInput, "config"> & {
  api?: LiveCalendarApi;
  gate: LiveConfigGateReport;
};

export type CalendarApiDryRunSmokeResult = {
  ok: boolean;
  steps: CalendarSmokeStep[];
};

export const defaultLiveCalendarApi: LiveCalendarApi = {
  createEvent,
  listEvents,
  updateEvent,
  deleteEvent,
};

// 按 create/list/update/delete 顺序走 API wrapper；失败时立即停止。
export async function runCalendarApiDryRunSmoke(
  input: CalendarApiDryRunSmokeInput,
): Promise<CalendarApiDryRunSmokeResult> {
  return runCalendarApiDryRunSmokeWithGate({
    adapter: input.adapter,
    gate: evaluateLiveConfigGate(input.config),
    date: input.date,
    startTime: input.startTime,
  });
}

// 测试用低层入口；正式调用应传 config，让函数内部执行 live gate。
export async function runCalendarApiDryRunSmokeWithGate(
  input: CalendarApiDryRunSmokeWithGateInput,
): Promise<CalendarApiDryRunSmokeResult> {
  const api = input.api ?? defaultLiveCalendarApi;
  const steps: CalendarSmokeStep[] = [];
  const title = "Live bring-up smoke";

  if (!input.gate.ok) {
    return {
      ok: false,
      steps: [{ name: "config", ok: false, message: input.gate.failures.join("；") }],
    };
  }

  const created = await api.createEvent(input.adapter, { title, date: input.date, startTime: input.startTime });
  steps.push({ name: "create", ok: created.ok, message: created.ok ? "created" : created.message });
  if (!created.ok || !created.data.id.trim()) return { ok: false, steps };

  const eventId = created.data.id;
  const listed = await api.listEvents(input.adapter, { date: input.date });
  steps.push({ name: "list", ok: listed.ok, message: listed.ok ? "listed" : listed.message });
  if (!listed.ok) return { ok: false, steps };

  const updated = await api.updateEvent(input.adapter, { eventId, patch: { title: `${title} updated` } });
  steps.push({ name: "update", ok: updated.ok, message: updated.ok ? "updated" : updated.message });
  if (!updated.ok) return { ok: false, steps };

  const deleted = await api.deleteEvent(input.adapter, { eventId });
  steps.push({ name: "delete", ok: deleted.ok, message: deleted.ok ? "deleted" : deleted.message });

  return { ok: deleted.ok, steps };
}
