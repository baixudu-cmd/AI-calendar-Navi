// Shadow 日历目标选择：真实微信入口只允许在主日历 gate 通过后写主日历。

import type { AppConfig, EnvSource } from "../config/index.js";
import { evaluateMainCalendarGate } from "../live/main-calendar-gate.js";

export type ShadowCalendarTarget =
  | { ok: true; calendarId: string }
  | { ok: false; message: string };

// 解析真实微信 shadow server 的写入目标；不再默认写测试日历。
export function resolveShadowCalendarTarget(config: AppConfig, env: EnvSource = process.env): ShadowCalendarTarget {
  const gate = evaluateMainCalendarGate(config, env);
  if (!gate.ok || !gate.targetCalendarId) {
    return { ok: false, message: gate.failures.join("；") };
  }

  return { ok: true, calendarId: gate.targetCalendarId };
}
