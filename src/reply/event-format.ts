// 日程展示格式器：把日历 adapter 返回的稳定日期、时间和标题转成用户可读文本。

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"] as const;

export type CalendarEventForReply = {
  id: string;
  title: string;
  start?: string;
};

export type CalendarEventFormatOptions = {
  fallbackDate?: string;
};

// 格式化只有日期的标题标签，供早晚报标题复用。
export function formatCalendarDateLabel(dateText: string): string {
  const stableDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!stableDate) return dateText;

  return formatDateLabel(stableDate[1], stableDate[2], stableDate[3]);
}

// 格式化单条日程详情；只接受稳定日期时间或 fallback 日期加时间。
export function formatCalendarEventDetail(event: CalendarEventForReply, options: CalendarEventFormatOptions = {}): string {
  const stableStart = formatStableStart(event.start, options.fallbackDate);
  if (!stableStart) return event.title;

  return `${stableStart} ${event.title}`;
}

// 格式化列表里的单条日程，并添加序号前缀。
export function formatCalendarEventLine(
  event: CalendarEventForReply,
  index: number,
  options: CalendarEventFormatOptions = {},
): string {
  return `${index}. ${formatCalendarEventDetail(event, options)}`;
}

// 只把 adapter 的结构化日期时间转成中文日期；不从自然语言里猜时间。
function formatStableStart(start: string | undefined, fallbackDate: string | undefined): string | undefined {
  if (!start) return undefined;

  const fullDateTime = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(start);
  if (fullDateTime) {
    return formatDateTime(fullDateTime[1], fullDateTime[2], fullDateTime[3], fullDateTime[4], fullDateTime[5]);
  }

  const timeOnly = /^(\d{2}):(\d{2})$/.exec(start);
  const stableFallbackDate = fallbackDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(fallbackDate) : undefined;
  if (timeOnly && stableFallbackDate) {
    return formatDateTime(stableFallbackDate[1], stableFallbackDate[2], stableFallbackDate[3], timeOnly[1], timeOnly[2]);
  }

  return undefined;
}

// 生成中文日期、星期和时间。
function formatDateTime(yearText: string, monthText: string, dayText: string, hourText: string, minuteText: string): string {
  return `${formatDateLabel(yearText, monthText, dayText)} ${hourText}:${minuteText}`;
}

// 生成中文日期和星期。
function formatDateLabel(yearText: string, monthText: string, dayText: string): string {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];

  return `${year}年${month}月${day}日 ${weekday}`;
}
