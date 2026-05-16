// 设置总结：把关键运行配置整理成用户可读、脱敏的只读说明，供主入口直接回复。

import { getConfigDiagnostics, loadConfig, type EnvSource } from "../config/index.js";
import { loadAppSettings, type AppSettings } from "../settings/index.js";
import { DEFAULT_WECHAT_REMINDER_LEAD_MINUTES } from "../wechat-reminder/index.js";
import type { SettingsSummaryTopic } from "../contract/index.js";

export type SettingsSummaryInput = {
  topic?: SettingsSummaryTopic;
  env?: EnvSource;
  defaultWechatReminderLeadMinutes?: number[];
  settings?: AppSettings;
};

// 生成设置总结正文；只读取配置，不写状态、不访问飞书、不暴露密钥原文。
export function buildSettingsSummary(input: SettingsSummaryInput = {}): string {
  const env = input.env || process.env;
  const diagnostics = getConfigDiagnostics(loadConfig(env));
  const settings = input.settings || loadAppSettings({ env });
  const topic = input.topic || "all";
  const sections = [
    ...(includeTopic(topic, "reminder") ? [buildReminderSection(settings, input.defaultWechatReminderLeadMinutes)] : []),
    ...(includeTopic(topic, "calendar") ? [buildCalendarSection(diagnostics.values)] : []),
    ...(includeTopic(topic, "model") ? [buildModelSection(diagnostics.values)] : []),
    ...(includeTopic(topic, "runtime") ? [buildSchedulingSection(settings)] : []),
    ...(includeTopic(topic, "memory") ? [buildMemorySection(settings)] : []),
    ...(includeTopic(topic, "runtime") ? [buildRuntimeSection(diagnostics.values)] : []),
    ...(topic === "all" || topic === "runtime" ? [buildLowFrictionSection()] : []),
    buildEditLocationSection(settings),
  ];

  return `当前关键设置如下：\n\n${sections.join("\n\n")}`;
}

// 判断本次是否需要展示某一类设置。
function includeTopic(topic: SettingsSummaryTopic, section: Exclude<SettingsSummaryTopic, "all">): boolean {
  return topic === "all" || topic === section;
}

// 整理默认提醒提前量和对应环境变量入口。
function buildReminderSection(settings: AppSettings, defaultWechatReminderLeadMinutes?: number[]): string {
  const fallback = defaultWechatReminderLeadMinutes && defaultWechatReminderLeadMinutes.length > 0 ? defaultWechatReminderLeadMinutes : DEFAULT_WECHAT_REMINDER_LEAD_MINUTES;
  const leads = settings.reminders.wechatLeadMinutes.length > 0 ? settings.reminders.wechatLeadMinutes : fallback;
  return [
    "提醒设置",
    `- 默认微信提醒：提前 ${leads.join("、")} 分钟`,
    `- 主动提醒默认提前：${settings.reminders.proactiveLeadMinutes} 分钟`,
    "- 单条日程可以自然说“提前 2 小时提醒我”或“不用提醒”来覆盖默认值",
    "- 默认产品设置：config/settings.local.json；兼容变量：WECHAT_REMINDER_LEAD_MINUTES、PROACTIVE_REMINDER_LEAD_MINUTES",
  ].join("\n");
}

// 整理飞书日历写入相关设置。
function buildCalendarSection(values: Record<string, string>): string {
  return [
    "日历设置",
    `- 主日历：FEISHU_MAIN_CALENDAR_ID：${values.FEISHU_MAIN_CALENDAR_ID}`,
    `- 测试日历：FEISHU_TEST_CALENDAR_ID：${values.FEISHU_TEST_CALENDAR_ID}`,
    `- 默认日历：FEISHU_CALENDAR_ID：${values.FEISHU_CALENDAR_ID}`,
    "- 主日历真实写入门禁：LIVE_MAIN_CALENDAR_ENABLE_REAL_WRITE=1，并设置 LIVE_MAIN_CALENDAR_CONFIRM_TEXT=NAVI_WRITE_MAIN_CALENDAR",
  ].join("\n");
}

// 整理模型理解 API 设置，密钥只展示是否已设置。
function buildModelSection(values: Record<string, string>): string {
  return [
    "模型理解 API",
    `- MODEL_PROVIDER：${values.MODEL_PROVIDER}`,
    `- MODEL_BASE_URL：${values.MODEL_BASE_URL}`,
    `- MODEL_NAME：${values.MODEL_NAME}`,
    `- MODEL_API_KEY：${values.MODEL_API_KEY}`,
  ].join("\n");
}

// 整理本地记忆和提醒队列文件位置。
function buildMemorySection(settings: AppSettings): string {
  return [
    "本地状态文件",
    `- SEED_LITE_STATE_FILE：${settings.stateFiles.seedLite}`,
    `- MEMORY_DREAM_STATE_FILE：${settings.stateFiles.memoryDream}`,
    `- WECHAT_REMINDER_STATE_FILE：${settings.stateFiles.wechatReminder}`,
    "- 当前状态总览：直接问“你现在记着我什么”",
  ].join("\n");
}

// 整理排程默认值，让用户知道推荐候选和默认时长在哪里调。
function buildSchedulingSection(settings: AppSettings): string {
  return [
    "排程设置",
    `- 排程默认候选：${settings.scheduling.defaultOptionCount} 个`,
    `- 默认事项时长：${settings.scheduling.defaultDurationMinutes} 分钟`,
    "- 推荐结果确认前不会写入日历；可以说“换下午”“选第二个”“取消推荐”",
  ].join("\n");
}

// 整理运行入口和时区设置。
function buildRuntimeSection(values: Record<string, string>): string {
  return [
    "运行设置",
    `- TIMEZONE：${values.TIMEZONE}`,
    `- OPENCLAW_WORKSPACE：${values.OPENCLAW_WORKSPACE}`,
    `- WECHAT_ENTRY_SECRET：${values.WECHAT_ENTRY_SECRET}`,
  ].join("\n");
}

// 汇总减少来回沟通的关键策略，方便用户知道系统应该怎么接话。
function buildLowFrictionSection(): string {
  return [
    "低摩擦规则",
    "- 追问策略：只在缺日期、缺开始时间或目标不唯一时追问",
    "- 标题和类型：由模型根据原文自行整理，不追问会议类型或题型",
    "- 早晚报排程：早报和晚报会展示待处理上下文，包含待确认推荐和待补时间",
    "- 排程写入：推荐位确认前不写日历；确认后才走真实日历创建",
  ].join("\n");
}

// 告诉用户去哪里改，避免把真实密钥写进仓库。
function buildEditLocationSection(settings: AppSettings): string {
  return [
    "去哪里修改",
    "- 密钥和外部接入：Mac mini 运行目录的 .env，真实密钥不要写进 Git",
    "- 非密钥产品默认值：复制 config/settings.example.json 为 config/settings.local.json 后修改",
    `- 当前设置来源：${settings.sourcePath || "内置默认值"}`,
    "- 运行说明看 docs/live-macmini-runbook.md",
    "- 能力 API 说明看 docs/api/capability-apis.md",
  ].join("\n");
}
