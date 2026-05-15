// 日历事件到短期状态的转换，供 API Bridge 和微信消息处理器复用。

import type { FeishuCalendarEvent } from "../calendar/feishu/types.js";
import type { BriefingItemState, LastEventState } from "./index.js";

// 从日历执行结果里提取用户后续可引用的 last_event 状态。
export function lastEventStateFromCalendarEvent(event: FeishuCalendarEvent): LastEventState {
  const start = splitDateTime(event.start);

  return {
    eventId: event.id,
    title: event.title,
    ...(start.date ? { date: start.date } : {}),
    ...(start.startTime ? { startTime: start.startTime } : {}),
  };
}

// 从列表或日报结果里提取可被“第 N 条”引用的状态。
export function briefingItemStateFromCalendarEvent(event: FeishuCalendarEvent, itemNumber: number): BriefingItemState {
  const start = splitDateTime(event.start);

  return {
    itemNumber,
    eventId: event.id,
    title: event.title,
    ...(start.date ? { date: start.date } : {}),
    ...(start.startTime ? { startTime: start.startTime } : {}),
  };
}

// 只解析日历 adapter 返回的稳定格式，不承担自然语言理解。
function splitDateTime(value: string): { date?: string; startTime?: string } {
  const [date, time] = value.trim().split(/\s+/);
  if (!date || !time) return {};

  const startTime = time.slice(0, 5);
  if (!isDateToken(date) || !isTimeToken(startTime)) return {};

  return { date, startTime };
}

// 校验 YYYY-MM-DD 格式。
function isDateToken(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// 校验 HH:mm 格式。
function isTimeToken(value: string): boolean {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  return (
    value.length === 5 &&
    Number.isInteger(hour) &&
    Number.isInteger(minute) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59
  );
}
