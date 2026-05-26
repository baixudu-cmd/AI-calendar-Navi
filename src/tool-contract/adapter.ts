// 工具调用适配器：把已校验工具调用转成现有 CalendarAction 兼容执行链路。

import type { CalendarAction, EventReference } from "../contract/index.js";
import type { CalendarToolCall, ToolTargetReference } from "./validator.js";

export type AdaptableCalendarToolCall = CalendarToolCall;

// 转换为现有动作合同；删除工具只发起待确认状态，不直接执行。
export function toolCallToCalendarAction(call: AdaptableCalendarToolCall): CalendarAction {
  switch (call.toolName) {
    case "calendar.create_event":
      return { type: "create_event", event: call.arguments };
    case "calendar.create_reminder":
      return { type: "create_event", event: call.arguments };
    case "calendar.create_events":
      return { type: "create_events", events: call.arguments.events };
    case "calendar.create_and_propose_schedule":
      return {
        type: "create_and_propose_schedule",
        events: call.arguments.events,
        ...(call.arguments.date ? { date: call.arguments.date } : {}),
        items: call.arguments.items,
        ...(call.arguments.preferredStartTime ? { preferredStartTime: call.arguments.preferredStartTime } : {}),
        ...(call.arguments.preferredWindow ? { preferredWindow: call.arguments.preferredWindow } : {}),
        ...(call.arguments.optionCount ? { optionCount: call.arguments.optionCount } : {}),
      };
    case "calendar.list_events":
      return { type: "list_events", ...call.arguments };
    case "calendar.update_event":
      return { type: "update_event", target: toEventReference(call.arguments.target), patch: call.arguments.patch };
    case "calendar.propose_schedule":
      return {
        type: "propose_schedule",
        ...(call.arguments.date ? { date: call.arguments.date } : {}),
        items: call.arguments.items,
        ...(call.arguments.autoCreate !== undefined ? { autoCreate: call.arguments.autoCreate } : {}),
        ...(call.arguments.preferredStartTime ? { preferredStartTime: call.arguments.preferredStartTime } : {}),
        ...(call.arguments.preferredWindow ? { preferredWindow: call.arguments.preferredWindow } : {}),
        ...(call.arguments.optionCount ? { optionCount: call.arguments.optionCount } : {}),
        ...(call.arguments.contextRef ? { contextRef: call.arguments.contextRef } : {}),
      };
    case "calendar.confirm_schedule":
      return {
        type: "confirm_schedule",
        confirmed: call.arguments.confirmed,
        ...(call.arguments.optionNumber ? { optionNumber: call.arguments.optionNumber } : {}),
        ...(call.arguments.itemChanges ? { itemChanges: call.arguments.itemChanges } : {}),
      };
    case "assistant.remember_todo":
      return {
        type: "remember_todo",
        title: call.arguments.title,
        autoSchedule: call.arguments.autoSchedule !== false,
        ...(call.arguments.date ? { date: call.arguments.date } : {}),
      };
    case "assistant.manage_todos":
      if (call.arguments.operation === "list" || call.arguments.operation === "list_shelved") {
        return {
          type: "manage_todos",
          operation: call.arguments.operation,
          ...(call.arguments.limit ? { limit: call.arguments.limit } : {}),
        };
      }
      if (call.arguments.operation === "update") {
        return {
          type: "manage_todos",
          operation: "update",
          target: call.arguments.target,
          patch: call.arguments.patch,
        };
      }
      return {
        type: "manage_todos",
        operation: call.arguments.operation,
        target: call.arguments.target,
      };
    case "calendar.delete_event":
      return { type: "request_delete_event", target: toEventReference(call.arguments.target) };
    case "calendar.delete_events":
      return { type: "request_delete_events", query: call.arguments.query };
    case "calendar.confirm_delete":
      return { type: "confirm_delete", confirmed: call.arguments.confirmed, ...(call.arguments.itemNumbers ? { itemNumbers: call.arguments.itemNumbers } : {}) };
    case "calendar.confirm_create":
      return { type: "confirm_create", confirmed: call.arguments.confirmed };
    case "calendar.daily_briefing":
      return { type: "daily_briefing", briefingType: call.arguments.briefingType };
    case "assistant.settings_summary":
      return { type: "settings_summary", ...(call.arguments.topic ? { topic: call.arguments.topic } : {}) };
    case "assistant.status_overview":
      return { type: "status_overview" };
    case "assistant.dismiss_context":
      return { type: "dismiss_context" };
    case "assistant.clarify":
      return {
        type: "clarify",
        question: call.arguments.question,
        missing: call.arguments.missing,
        ...(call.arguments.createDraft ? { createDraft: call.arguments.createDraft } : {}),
      };
  }
}

function toEventReference(target: ToolTargetReference): EventReference {
  if (target.kind === "last_event") return { kind: "last_event", eventId: "" };
  if (target.kind === "briefing_item") return { kind: "briefing_item", itemNumber: target.itemNumber };
  if (target.kind === "recent_event_item") return { kind: "recent_event_item", itemNumber: target.itemNumber };
  return target;
}
