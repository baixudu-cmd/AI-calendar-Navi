// 飞书字段映射集中在这里，避免业务层直接拼飞书字段。

import type { EventDraft } from "../../contract/index.js";
import type { FeishuCreatePayload, FeishuUpdatePayload, ListEventsInput } from "./types.js";

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const CHINA_TIMEZONE_OFFSET = "+08:00";
const DEFAULT_CREATE_REMINDER_MINUTES = 40;

// 把本地日程草稿转成飞书创建事件 payload。
export function mapCreateEventPayload(event: EventDraft, timezone = DEFAULT_TIMEZONE): FeishuCreatePayload {
  const startTimestamp = toSecondTimestamp(event.date, event.startTime);
  const endTimestamp = event.endTime ? toSecondTimestamp(event.date, event.endTime) : addOneHourTimestamp(startTimestamp);

  return {
    summary: event.title,
    start_time: { timestamp: startTimestamp, timezone },
    end_time: { timestamp: endTimestamp, timezone },
    ...(event.location ? { location: { name: event.location } } : {}),
    ...(event.notes ? { description: event.notes } : {}),
    ...mapReminderMinutes(event.reminderMinutes, DEFAULT_CREATE_REMINDER_MINUTES),
  };
}

// 把本地查询条件转成飞书查询参数。
export function mapListEventsQuery(input: ListEventsInput): Record<string, string> {
  if (input.range) {
    return {
      start_time: toSecondTimestamp(input.range.startDate, "00:00"),
      end_time: toSecondTimestamp(input.range.endDate, "23:59:59"),
    };
  }

  if (input.date) {
    return {
      start_time: toSecondTimestamp(input.date, "00:00"),
      end_time: toSecondTimestamp(input.date, "23:59:59"),
    };
  }

  return {};
}

// 把本地修改 patch 转成飞书修改事件 payload。
export function mapUpdateEventPayload(patch: Partial<EventDraft>, timezone = DEFAULT_TIMEZONE): FeishuUpdatePayload {
  return {
    ...(patch.title ? { summary: patch.title } : {}),
    ...(patch.date && patch.startTime ? { start_time: { timestamp: toSecondTimestamp(patch.date, patch.startTime), timezone } } : {}),
    ...(patch.date && patch.endTime ? { end_time: { timestamp: toSecondTimestamp(patch.date, patch.endTime), timezone } } : {}),
    ...(patch.location ? { location: { name: patch.location } } : {}),
    ...(patch.notes ? { description: patch.notes } : {}),
    ...mapReminderMinutes(patch.reminderMinutes),
  };
}

function mapReminderMinutes(value: number | number[] | undefined, defaultMinute?: number): { reminders?: Array<{ minutes: number }> } {
  if (value === undefined && defaultMinute === undefined) return {};
  const effectiveValue = value === undefined ? defaultMinute : value;
  const raw = Array.isArray(effectiveValue) ? effectiveValue : typeof effectiveValue === "number" ? [effectiveValue] : [];
  const minutes = [...new Set(raw.filter((item) => Number.isInteger(item) && item > 0))].sort((a, b) => b - a).slice(0, 3);
  return { reminders: minutes.map((minute) => ({ minutes: minute })) };
}

// 把本地日期和时间转换为飞书需要的秒级 timestamp 字符串。
function toSecondTimestamp(date: string, time: string): string {
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  return String(Math.floor(new Date(`${date}T${normalizedTime}${CHINA_TIMEZONE_OFFSET}`).getTime() / 1000));
}

// 简单处理 HH:mm 的默认结束时间；无效格式保持原值，避免误改用户输入。
function addOneHourTimestamp(timestamp: string): string {
  return String(Number(timestamp) + 60 * 60);
}
