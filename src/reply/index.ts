// 回执层：只根据动作合同和工具执行结果生成用户可见短回复。

import type { CalendarExecutionResult } from "../calendar/action-executor.js";
import type { FeishuCalendarEvent } from "../calendar/feishu/types.js";
import type { CalendarAction } from "../contract/index.js";
import { formatCalendarDateLabel, formatCalendarEventDetail, formatCalendarEventLine } from "./event-format.js";

// 根据动作和工具结果生成回执；不能从用户原文猜测是否成功。
export function buildActionReply(action: CalendarAction, result?: CalendarExecutionResult): string {
  if (action.type === "clarify") return action.question;
  if (!result) return "没有执行日历工具。";
  if (!result.ok) return `没有成功：${result.message}`;

  if (Array.isArray(result.data)) {
    if (action.type === "create_events") return formatCreatedEventList(result.data);
    return formatEventList(result.data, action.type === "list_events" ? action.date : undefined);
  }

  if (action.type === "create_event") return `已新增日程：\n${formatCalendarEventDetail(result.data)}`;
  if (action.type === "create_recurring_event") return `已新增重复日程：\n${formatCalendarEventDetail(result.data)}`;
  if (action.type === "update_event") return `已修改日程：\n${formatCalendarEventDetail(result.data)}`;
  return `已处理：${result.data.title}`;
}

// 把批量创建结果压成微信里容易核对的短列表。
function formatCreatedEventList(events: FeishuCalendarEvent[]): string {
  if (events.length === 0) return "已新增 0 个日程。";

  const lines = events.map((event, index) => formatCalendarEventLine(event, index + 1));
  return `已新增 ${events.length} 个日程：\n${lines.join("\n")}`;
}

// 把查询结果压成微信里容易读的短列表。
function formatEventList(events: FeishuCalendarEvent[], fallbackDate?: string): string {
  if (events.length === 0) {
    return fallbackDate ? `没有找到 ${formatCalendarDateLabel(fallbackDate)} 的日程。` : "没有找到日程。";
  }

  const lines = events.map((event, index) => formatCalendarEventLine(event, index + 1, { fallbackDate }));
  return `找到 ${events.length} 个日程：\n${lines.join("\n")}`;
}
