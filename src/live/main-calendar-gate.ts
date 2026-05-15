// 主日历写入门禁：只有显式打开并确认后才允许真实主日历 smoke。

import type { AppConfig, EnvSource } from "../config/index.js";

export type MainCalendarGateReport = {
  ok: boolean;
  failures: string[];
  targetCalendarId?: string;
};

// 检查主日历 smoke 的显式开关；不访问外部服务。
export function evaluateMainCalendarGate(config: AppConfig, env: EnvSource = process.env): MainCalendarGateReport {
  const failures: string[] = [];
  const mainCalendarId = config.feishuMainCalendarId?.trim();

  if (!mainCalendarId) failures.push("缺少 FEISHU_MAIN_CALENDAR_ID。");
  if (mainCalendarId && mainCalendarId === config.feishuTestCalendarId) {
    failures.push("FEISHU_MAIN_CALENDAR_ID 不能等于 FEISHU_TEST_CALENDAR_ID。");
  }
  if (env.LIVE_MAIN_CALENDAR_ENABLE_REAL_WRITE !== "1") {
    failures.push("缺少 LIVE_MAIN_CALENDAR_ENABLE_REAL_WRITE=1。");
  }
  if (env.LIVE_MAIN_CALENDAR_CONFIRM_TEXT !== "NAVI_WRITE_MAIN_CALENDAR") {
    failures.push("缺少 LIVE_MAIN_CALENDAR_CONFIRM_TEXT=NAVI_WRITE_MAIN_CALENDAR。");
  }

  return {
    ok: failures.length === 0,
    failures,
    targetCalendarId: failures.length === 0 ? mainCalendarId : undefined,
  };
}
