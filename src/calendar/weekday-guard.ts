// 周几日期护栏：写入前核对并归一化模型给出的日期，避免模型星期漂移。

import type { CalendarAction, EventDraft } from "../contract/index.js";

const WEEKDAY_LABELS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"] as const;
const WEEKDAY_VALUE: Record<string, number> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

type WeekdayMention = {
  label: string;
  weekday: number;
  modifier?: "下" | "本" | "这" | "上";
};

export type ExplicitWeekdayGuardResult = { ok: true } | { ok: false; message: string };
export type ExplicitWeekdayNormalizationResult = { ok: true; action: CalendarAction } | { ok: false; message: string };

// 校验创建类动作的日期星期；不匹配时失败关闭，避免把模型漂移日期写入主日历。
export function validateExplicitWeekdayCreate(input: {
  text: string;
  action: CalendarAction;
}): ExplicitWeekdayGuardResult {
  const events = getCreateEvents(input.action);
  if (events.length === 0) return { ok: true };

  const mentions = extractWeekdayMentions(input.text);
  if (mentions.length === 0) return { ok: true };
  if (mentions.length !== events.length) return { ok: true };

  for (let index = 0; index < events.length; index += 1) {
    const actualWeekday = weekdayForDate(events[index].date);
    const expected = mentions[index];
    if (actualWeekday === undefined || actualWeekday === expected.weekday) continue;

    return {
      ok: false,
      message: `模型日期和你说的星期不一致：第 ${index + 1} 个日程说的是${expected.label}，但日期 ${events[index].date} 是${WEEKDAY_LABELS[actualWeekday]}。请重新说一下日期或星期。`,
    };
  }

  return { ok: true };
}

// 用户只说周几时，按当前时间把模型漂移的日期修正到可写入的具体日期。
export function normalizeExplicitWeekdayCreateDates(input: {
  text: string;
  action: CalendarAction;
  now?: string;
  timezone?: string;
}): ExplicitWeekdayNormalizationResult {
  const events = getCreateEvents(input.action);
  if (events.length === 0) return { ok: true, action: input.action };

  const mentions = extractWeekdayMentions(input.text);
  if (mentions.length === 0) return { ok: true, action: input.action };
  if (mentions.length !== events.length) return { ok: true, action: input.action };

  const repairedEvents: EventDraft[] = [];
  const hasExplicitDate = hasExplicitCalendarDate(input.text);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const expected = mentions[index];
    const actualWeekday = weekdayForDate(event.date);
    const shouldNormalizeRelativeWeekday = !hasExplicitDate && (!expected.modifier || expected.modifier === "下");
    if (shouldNormalizeRelativeWeekday) {
      const repairedDate = resolveWeekdayDate({
        weekday: expected.weekday,
        modifier: expected.modifier,
        startTime: event.startTime,
        now: input.now,
        timezone: input.timezone,
      });
      if (repairedDate) {
        repairedEvents.push(event.date === repairedDate ? event : { ...event, date: repairedDate });
        continue;
      }
    }

    if (actualWeekday === undefined || actualWeekday === expected.weekday) {
      repairedEvents.push(event);
      continue;
    }

    if (hasExplicitDate || (expected.modifier && expected.modifier !== "下")) {
      return weekdayMismatch(index, expected, event.date, actualWeekday);
    }

    const repairedDate = resolveWeekdayDate({
      weekday: expected.weekday,
      modifier: expected.modifier,
      startTime: event.startTime,
      now: input.now,
      timezone: input.timezone,
    });
    if (!repairedDate) return weekdayMismatch(index, expected, event.date, actualWeekday);
    repairedEvents.push({ ...event, date: repairedDate });
  }

  if (input.action.type === "create_event") return { ok: true, action: { ...input.action, event: repairedEvents[0] } };
  if (input.action.type === "create_events") return { ok: true, action: { ...input.action, events: repairedEvents } };
  return { ok: true, action: input.action };
}

// 取出创建类动作里的日程草稿。
function getCreateEvents(action: CalendarAction): EventDraft[] {
  if (action.type === "create_event") return [action.event];
  if (action.type === "create_events") return action.events;
  return [];
}

// 提取用户原文里明确写出的周几，不把它当作意图分类。
function extractWeekdayMentions(text: string): WeekdayMention[] {
  const mentions: WeekdayMention[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const modifier = readWeekModifier(text[index]);
    const prefixStart = modifier ? index + 1 : index;
    const prefix = readWeekPrefix(text, prefixStart);
    if (!prefix) continue;

    const weekdayChar = text[prefixStart + prefix.length];
    const weekday = WEEKDAY_VALUE[weekdayChar];
    if (weekday === undefined) continue;

    const end = prefixStart + prefix.length + 1;
    mentions.push({
      label: text.slice(index, end),
      weekday,
      ...(modifier ? { modifier } : {}),
    });
    index = end - 1;
  }
  return mentions;
}

// 生成周几不一致的失败信息，保留原有失败关闭能力。
function weekdayMismatch(
  index: number,
  expected: WeekdayMention,
  date: string,
  actualWeekday: number,
): ExplicitWeekdayNormalizationResult {
  return {
    ok: false,
    message: `模型日期和你说的星期不一致：第 ${index + 1} 个日程说的是${expected.label}，但日期 ${date} 是${WEEKDAY_LABELS[actualWeekday]}。请重新说一下日期或星期。`,
  };
}

// 读取 YYYY-MM-DD 对应的星期。
function weekdayForDate(dateText: string): number | undefined {
  const parts = dateText.split("-");
  if (parts.length !== 3 || parts[0].length !== 4 || parts[1].length !== 2 || parts[2].length !== 2) return undefined;
  if (!parts.every((part) => isDigits(part))) return undefined;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.getUTCDay();
}

// 判断用户是否已经给了具体日历日期；这种情况不自动改模型日期。
function hasExplicitCalendarDate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (readsFullDate(text, index) || readsMonthDay(text, index)) return true;
  }
  return false;
}

// 把“周几”解析到当前时间之后最近的可写入日期。
function resolveWeekdayDate(input: {
  weekday: number;
  modifier?: WeekdayMention["modifier"];
  startTime: string;
  now?: string;
  timezone?: string;
}): string | undefined {
  const localNow = localDateTimeParts(input.now, input.timezone || "Asia/Shanghai");
  if (!localNow) return undefined;

  const currentWeekday = weekdayForParts(localNow.year, localNow.month, localNow.day);
  let daysToAdd = (input.weekday - currentWeekday + 7) % 7;
  if (input.modifier === "下" && daysToAdd === 0) daysToAdd = 7;
  if (!input.modifier && daysToAdd === 0 && isStartTimePast(input.startTime, localNow.hour, localNow.minute)) {
    daysToAdd = 7;
  }

  return addDays(localNow.year, localNow.month, localNow.day, daysToAdd);
}

// 按指定时区读取本地日期时间。
function localDateTimeParts(now: string | undefined, timezone: string) {
  const date = now ? new Date(now) : new Date();
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = value("hour");
  const minute = value("minute");
  if ([year, month, day, hour, minute].some((part) => !Number.isInteger(part))) return undefined;
  return { year, month, day, hour, minute };
}

// 计算日历日期对应星期。
function weekdayForParts(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// 判断当天同一时间是否已经过去。
function isStartTimePast(startTime: string, hour: number, minute: number): boolean {
  const parts = startTime.split(":");
  if (parts.length !== 2 || parts[0].length !== 2 || parts[1].length !== 2) return false;
  if (!isDigits(parts[0]) || !isDigits(parts[1])) return false;
  const startMinutes = Number(parts[0]) * 60 + Number(parts[1]);
  return startMinutes <= hour * 60 + minute;
}

// 在 UTC 日历日上加天数，避免本地时区造成跨日漂移。
function addDays(year: number, month: number, day: number, daysToAdd: number): string {
  const date = new Date(Date.UTC(year, month - 1, day + daysToAdd));
  const safeYear = date.getUTCFullYear();
  const safeMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const safeDay = String(date.getUTCDate()).padStart(2, "0");
  return `${safeYear}-${safeMonth}-${safeDay}`;
}

// 读取“下周一”这类周修饰词。
function readWeekModifier(char: string): WeekdayMention["modifier"] | undefined {
  return char === "下" || char === "本" || char === "这" || char === "上" ? char : undefined;
}

// 读取周几前缀。
function readWeekPrefix(text: string, index: number): string | undefined {
  for (const prefix of ["星期", "礼拜", "周"]) {
    if (text.startsWith(prefix, index)) return prefix;
  }
  return undefined;
}

// 判断字符串是否全是数字。
function isDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (const char of value) {
    if (char < "0" || char > "9") return false;
  }
  return true;
}

// 读取一个数字片段。
function readNumber(text: string, index: number, maxLength: number): { value: number; next: number; length: number } | undefined {
  let next = index;
  while (next < text.length && next - index < maxLength && text[next] >= "0" && text[next] <= "9") next += 1;
  if (next === index) return undefined;
  return { value: Number(text.slice(index, next)), next, length: next - index };
}

// 跳过日期中的空格。
function skipSpaces(text: string, index: number): number {
  let next = index;
  while (next < text.length && isSpace(text[next])) next += 1;
  return next;
}

// 判断日期片段中的空白字符。
function isSpace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

// 读取完整年月日。
function readsFullDate(text: string, index: number): boolean {
  const year = readNumber(text, index, 4);
  if (!year || year.length !== 4) return false;

  let cursor = skipSpaces(text, year.next);
  const separator = text[cursor];
  if (separator !== "年" && separator !== "-" && separator !== "/") return false;
  cursor = skipSpaces(text, cursor + 1);

  const month = readNumber(text, cursor, 2);
  if (!month || month.value < 1 || month.value > 12) return false;
  cursor = skipSpaces(text, month.next);

  if (separator === "年") {
    if (text[cursor] !== "月") return false;
    cursor = skipSpaces(text, cursor + 1);
  } else {
    if (text[cursor] !== separator) return false;
    cursor = skipSpaces(text, cursor + 1);
  }

  const day = readNumber(text, cursor, 2);
  return Boolean(day && day.value >= 1 && day.value <= 31);
}

// 读取月日。
function readsMonthDay(text: string, index: number): boolean {
  const month = readNumber(text, index, 2);
  if (!month || month.value < 1 || month.value > 12) return false;
  let cursor = skipSpaces(text, month.next);
  if (text[cursor] !== "月") return false;
  cursor = skipSpaces(text, cursor + 1);
  const day = readNumber(text, cursor, 2);
  return Boolean(day && day.value >= 1 && day.value <= 31);
}
