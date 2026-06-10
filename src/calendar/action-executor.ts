// 日历动作执行器：把合同层动作分派给日历 adapter，非写入阶段动作直接跳过。

import {
  createEvent,
  type CalendarGuardFailure,
  listEvents,
  updateEvent,
  type DeterministicCalendarAdapter,
} from "../calendar-api/index.js";
import type { CalendarAction } from "../contract/index.js";
import type { FeishuCalendarEvent, FeishuResult } from "./feishu/types.js";

export type CalendarAdapter = DeterministicCalendarAdapter;

export type CalendarExecutionSkippedResult = {
  ok: false;
  code: "skipped";
  message: string;
};

export type CalendarExecutionResult =
  | FeishuResult<FeishuCalendarEvent>
  | FeishuResult<FeishuCalendarEvent[]>
  | CalendarGuardFailure
  | CalendarExecutionSkippedResult;

// 执行日历动作；Phase 3 只允许 create/list/update 进入 adapter。
export async function executeCalendarAction(
  action: CalendarAction,
  adapter: CalendarAdapter,
): Promise<CalendarExecutionResult> {
  switch (action.type) {
    case "create_event":
      return createEvent(adapter, action.event);
    case "create_recurring_event":
      return createEvent(adapter, action.event);
    case "create_events": {
      const created: FeishuCalendarEvent[] = [];
      for (const event of action.events) {
        const result = await createEvent(adapter, event);
        if (!result.ok) return result;
        created.push(result.data);
      }
      return { ok: true, data: created };
    }
    case "create_and_propose_schedule":
      return { ok: false, code: "skipped", message: "create_and_propose_schedule 由 API Bridge 拆成创建和排程推荐。" };
    case "list_events":
      return listEvents(adapter, { date: action.date, range: action.range });
    case "update_event":
      if (action.target.kind === "briefing_item") {
        return { ok: false, code: "skipped", message: "briefing_item 修改留到日报阶段处理。" };
      }
      if (action.target.kind !== "last_event") {
        return { ok: false, code: "skipped", message: "结构化查询修改由 API Bridge 先解析成事件 ID。" };
      }

      return updateEvent(adapter, { eventId: action.target.eventId, patch: action.patch });
    case "update_and_create_events":
      return { ok: false, code: "skipped", message: "update_and_create_events 由 API Bridge 按顺序拆成修改和创建。" };
    case "propose_schedule":
      return { ok: false, code: "skipped", message: "propose_schedule 由 API Bridge 生成排程推荐。" };
    case "confirm_schedule":
      return { ok: false, code: "skipped", message: "confirm_schedule 由 API Bridge 执行排程确认。" };
    case "remember_todo":
      return { ok: false, code: "skipped", message: "remember_todo 由 API Bridge 写入待推进事项。" };
    case "manage_todos":
      return { ok: false, code: "skipped", message: "manage_todos 由 API Bridge 管理待推进事项。" };
    case "clarify":
      return { ok: false, code: "skipped", message: "clarify 不执行日历工具。" };
    case "request_delete_event":
      return { ok: false, code: "skipped", message: "request_delete_event 由 API Bridge 写入待确认状态。" };
    case "request_delete_events":
      return { ok: false, code: "skipped", message: "request_delete_events 由 API Bridge 查询并写入待确认状态。" };
    case "confirm_delete":
      return { ok: false, code: "skipped", message: "confirm_delete 由 API Bridge 执行删除确认。" };
    case "confirm_create":
      return { ok: false, code: "skipped", message: "confirm_create 由 API Bridge 执行创建确认。" };
    case "daily_briefing":
      return { ok: false, code: "skipped", message: "daily_briefing 留到后续阶段处理。" };
    case "settings_summary":
      return { ok: false, code: "skipped", message: "settings_summary 由 API Bridge 生成只读设置说明。" };
    case "status_overview":
      return { ok: false, code: "skipped", message: "status_overview 由 API Bridge 生成只读状态总览。" };
    case "dismiss_context":
      return { ok: false, code: "skipped", message: "dismiss_context 由 API Bridge 清理短期上下文。" };
  }
}
