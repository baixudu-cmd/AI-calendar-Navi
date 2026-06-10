// 能力 API 目录和聚合入口：给后续 AI 和工程入口读取、调用当前助手已经开放的能力。

import { handleCalendarAgentRequest, type CalendarAgentRequest, type CalendarAgentResponse } from "../agent-api/index.js";
import { runProactiveBriefing, type ProactiveBriefingInput, type ProactiveBriefingResult } from "../live/proactive-briefing.js";
import { consolidateMemoryDream, type MemoryDreamConsolidationInput, type MemoryDreamConsolidationResult } from "../memory-dream/index.js";
import { TOOL_NAMES, TOOL_SCHEMAS, type CalendarToolName, type ToolParameterSchema } from "../tool-contract/index.js";
import {
  dispatchDueWechatReminders,
  inspectWechatReminderStatus,
  type DispatchWechatRemindersInput,
  type WechatReminderStatusSummary,
} from "../wechat-reminder/index.js";

export type CapabilityApiStatus = "implemented";

export type CapabilityApiKind = "assistant_entry" | "model_tool" | "runtime_job";

export type CapabilityApiFailureMode = {
  code: string;
  meaning: string;
  userVisible: boolean;
};

export type CapabilityApiInputContract =
  | { kind: "tool_schema"; schema: ToolParameterSchema }
  | { kind: "typescript_type"; typeName: string }
  | { kind: "cli"; command: string };

export type CapabilityApiEntry = {
  apiName: string;
  kind: CapabilityApiKind;
  title: string;
  ownerModule: string;
  implementationStatus: CapabilityApiStatus;
  inputContract: CapabilityApiInputContract;
  outputContract: string[];
  sideEffects: string[];
  stateTouched: string[];
  failureModes: CapabilityApiFailureMode[];
  tests: string[];
  notes: string;
};

export type AssistantCoreApiDependencies = Omit<
  CalendarAgentRequest,
  "text" | "media" | "requestId" | "messageId" | "seenMessageIds" | "today" | "now" | "timezone"
>;

export type AssistantCoreMessageInput = Pick<
  CalendarAgentRequest,
  "text" | "media" | "requestId" | "messageId" | "seenMessageIds" | "today" | "now" | "timezone"
>;

export type AssistantCoreCapabilityApi = {
  listCapabilities(): readonly CapabilityApiEntry[];
  getCapability(apiName: string): CapabilityApiEntry | undefined;
  handleMessage(input: AssistantCoreMessageInput): Promise<CalendarAgentResponse>;
};

export type RuntimeOperationsCapabilityApi = {
  listCapabilities(): readonly CapabilityApiEntry[];
  consolidateMemory(input: MemoryDreamConsolidationInput): Promise<MemoryDreamConsolidationResult>;
  runProactiveBriefing(input: ProactiveBriefingInput): Promise<ProactiveBriefingResult>;
  dispatchDueReminders(input: DispatchWechatRemindersInput): Promise<{ ok: boolean; sent: number; failed: number }>;
  inspectReminderQueue(input: { store: DispatchWechatRemindersInput["store"]; now: string }): Promise<WechatReminderStatusSummary>;
};

const TOOL_VALIDATION_FAILURES: CapabilityApiFailureMode[] = [
  { code: "malformed_tool_call", meaning: "模型输出不是 toolName + arguments。", userVisible: false },
  { code: "unknown_tool", meaning: "模型请求了未开放工具。", userVisible: false },
  { code: "missing_arguments", meaning: "工具缺少必要参数。", userVisible: true },
  { code: "invalid_arguments", meaning: "工具参数格式或范围不合法。", userVisible: true },
  { code: "guard_rejected", meaning: "本地安全护栏拒绝执行。", userVisible: true },
];

const CALENDAR_EXECUTION_FAILURES: CapabilityApiFailureMode[] = [
  { code: "calendar_api_failed", meaning: "日历执行层返回失败。", userVisible: true },
  { code: "feishu_api_failed", meaning: "真实飞书 API 调用失败。", userVisible: true },
  { code: "state_target_missing", meaning: "本地短期状态里找不到要修改或删除的目标。", userVisible: true },
];

const GROUPED_WATCHLIST_STATE = [
  "pending_reminder_seed_items",
  "pending_schedule_seed_items",
  "pending_todo_seed_items",
  "shelved_seed_items",
];

// 返回完整能力目录；调用方只读，不在这里执行真实业务。
export function getCapabilityApiRegistry(): readonly CapabilityApiEntry[] {
  return CAPABILITY_API_REGISTRY;
}

// 创建用户消息主 API；外部只传本次消息，模型、日历、状态和存储依赖由服务端固定。
export function createAssistantCoreCapabilityApi(dependencies: AssistantCoreApiDependencies): AssistantCoreCapabilityApi {
  return {
    listCapabilities: getCapabilityApiRegistry,
    getCapability: findCapabilityApi,
    handleMessage(input) {
      return handleCalendarAgentRequest({
        ...dependencies,
        ...input,
      });
    },
  };
}

// 创建运行任务聚合 API；它只组合已有确定性能力，不新增语义判断。
export function createRuntimeOperationsCapabilityApi(): RuntimeOperationsCapabilityApi {
  return {
    listCapabilities: getCapabilityApiRegistry,
    consolidateMemory: consolidateMemoryDream,
    runProactiveBriefing,
    dispatchDueReminders: dispatchDueWechatReminders,
    inspectReminderQueue: inspectWechatReminderStatus,
  };
}

// 按能力名查找当前 API 合同。
export function findCapabilityApi(apiName: string): CapabilityApiEntry | undefined {
  return CAPABILITY_API_REGISTRY.find((entry) => entry.apiName === apiName);
}

export const CAPABILITY_API_REGISTRY: readonly CapabilityApiEntry[] = [
  {
    apiName: "capability.registry",
    kind: "assistant_entry",
    title: "查询当前能力 API 目录",
    ownerModule: "src/capability-api/index.ts",
    implementationStatus: "implemented",
    inputContract: { kind: "typescript_type", typeName: "getCapabilityApiRegistry / findCapabilityApi" },
    outputContract: ["CapabilityApiEntry[]", "CapabilityApiEntry | undefined"],
    sideEffects: ["无副作用"],
    stateTouched: [],
    failureModes: [
      { code: "capability_not_found", meaning: "请求的能力名不存在。", userVisible: false },
    ],
    tests: ["tests/capability-api.test.ts"],
    notes: "后续 AI 进入本项目时优先读取这个目录，再决定调用哪个能力。",
  },
  {
    apiName: "assistant.core",
    kind: "assistant_entry",
    title: "用户消息主能力 API",
    ownerModule: "src/capability-api/index.ts",
    implementationStatus: "implemented",
    inputContract: { kind: "typescript_type", typeName: "AssistantCoreMessageInput" },
    outputContract: ["CalendarAgentResponse"],
    sideEffects: ["复用 assistant.handle_message 的所有副作用"],
    stateTouched: [
      "last_event",
      "pending_delete",
      "pending_conflict",
      "pending_schedule",
      "seed_items",
      ...GROUPED_WATCHLIST_STATE,
      "briefing_items",
    ],
    failureModes: [
      { code: "entry_rejected", meaning: "入口保护拒绝空消息、重复消息或超长消息。", userVisible: true },
      { code: "model_rejected", meaning: "模型输出未通过工具合同或动作合同。", userVisible: true },
      ...CALENDAR_EXECUTION_FAILURES,
    ],
    tests: ["tests/capability-api.test.ts", "tests/agent-api.test.ts"],
    notes: "这是给未来 AI / OpenClaw-facing 入口使用的聚合 facade；服务端固定依赖，调用方只传本次消息。",
  },
  {
    apiName: "runtime.operations",
    kind: "runtime_job",
    title: "运行任务聚合 API",
    ownerModule: "src/capability-api/index.ts",
    implementationStatus: "implemented",
    inputContract: { kind: "typescript_type", typeName: "RuntimeOperationsCapabilityApi" },
    outputContract: ["memory dream report", "proactive briefing result", "wechat reminder dispatch result", "reminder queue status"],
    sideEffects: ["可写 memory dream 文件", "可发送微信", "可更新提醒队列", "可写主动消息去重状态"],
    stateTouched: ["memory-dream entries", "wechat reminder queue", "proactive delivery state"],
    failureModes: [
      { code: "runtime_doctor_failed", meaning: "运行前体检失败时，上层应停止发送。", userVisible: false },
      { code: "delivery_failed", meaning: "微信发送失败。", userVisible: true },
      { code: "store_write_failed", meaning: "本地状态文件写入失败。", userVisible: false },
    ],
    tests: ["tests/capability-api.test.ts", "tests/memory-dream.test.ts", "tests/wechat-reminder.test.ts", "tests/proactive-briefing.test.ts"],
    notes: "把可合并的后台运行能力收成一个 facade；不处理自然语言、不写日历。",
  },
  {
    apiName: "assistant.handle_message",
    kind: "assistant_entry",
    title: "处理单条用户消息",
    ownerModule: "src/agent-api/index.ts",
    implementationStatus: "implemented",
    inputContract: { kind: "typescript_type", typeName: "CalendarAgentRequest" },
    outputContract: ["CalendarAgentResponse", "createdEvents 仅来自真实日历创建结果"],
    sideEffects: ["可写日历", "可写短期状态", "可写 Seed Lite", "可登记微信提醒", "可追加 memory dream observation"],
    stateTouched: [
      "last_event",
      "pending_delete",
      "pending_conflict",
      "pending_schedule",
      "seed_items",
      ...GROUPED_WATCHLIST_STATE,
      "briefing_items",
    ],
    failureModes: [
      { code: "entry_rejected", meaning: "入口保护拒绝空消息、重复消息或超长消息。", userVisible: true },
      { code: "model_rejected", meaning: "模型输出未通过工具合同或动作合同。", userVisible: true },
      ...CALENDAR_EXECUTION_FAILURES,
    ],
    tests: ["tests/agent-api.test.ts", "tests/agent-api-model-path.test.ts", "tests/agent-api-smoke-cli.test.ts"],
    notes: "这是微信和 OpenClaw-facing shadow route 的主 API；外部不应直接注入日历或模型依赖。",
  },
  ...TOOL_NAMES.map(modelToolCapability),
  {
    apiName: "memory_dream.consolidate_daily",
    kind: "runtime_job",
    title: "每日本地记忆整理",
    ownerModule: "src/memory-dream/index.ts",
    implementationStatus: "implemented",
    inputContract: { kind: "cli", command: "npm --silent run live:memory-dream" },
    outputContract: ["memory dream report", "state/memory-dream.json"],
    sideEffects: ["可写本地 memory dream 文件", "只读 Seed Lite"],
    stateTouched: ["memory-dream entries", "schedule_candidate", "preference_candidate"],
    failureModes: [
      { code: "store_read_failed", meaning: "本地记忆或 Seed Lite 文件读取失败。", userVisible: false },
      { code: "store_write_failed", meaning: "本地记忆文件写入失败。", userVisible: false },
    ],
    tests: ["tests/memory-dream.test.ts", "tests/memory-dream-cli-boundary.test.ts", "tests/memory-dream-manifest.test.ts"],
    notes: "只整理本项目内的交互样本，不读屏、不截图、不自动写日历。",
  },
  {
    apiName: "wechat_reminder.dispatch_due",
    kind: "runtime_job",
    title: "派发到点微信提醒",
    ownerModule: "src/wechat-reminder/index.ts",
    implementationStatus: "implemented",
    inputContract: { kind: "cli", command: "npm run live:wechat-reminder-dispatcher" },
    outputContract: ["dispatch report", "reminder queue status"],
    sideEffects: ["可发送微信", "可更新提醒队列 sent/failed 状态", "会压掉同一标题、时间和提前量的活跃重复提醒"],
    stateTouched: ["wechat reminder queue"],
    failureModes: [
      { code: "runtime_doctor_failed", meaning: "发送前运行体检失败，停止派发。", userVisible: false },
      { code: "delivery_failed", meaning: "微信发送失败，队列保留失败状态。", userVisible: true },
    ],
    tests: ["tests/wechat-reminder.test.ts", "tests/proactive-runtime-doctor.test.ts"],
    notes: "默认只保留提前 40 分钟单点提醒；显式关闭提醒时不登记微信提醒；删除日程会取消对应未发送提醒。",
  },
  {
    apiName: "proactive.daily_briefing",
    kind: "runtime_job",
    title: "主动早报和晚报",
    ownerModule: "src/live/proactive-briefing-cli.ts",
    implementationStatus: "implemented",
    inputContract: { kind: "cli", command: "npm run live:proactive-briefing" },
    outputContract: ["briefing text", "delivery report"],
    sideEffects: ["可只读真实主日历", "可发送微信"],
    stateTouched: ["proactive delivery state", "briefing sent markers"],
    failureModes: [
      { code: "runtime_doctor_failed", meaning: "主动发送前体检失败，停止发送。", userVisible: false },
      { code: "delivery_failed", meaning: "微信发送失败。", userVisible: true },
    ],
    tests: ["tests/proactive-briefing.test.ts", "tests/proactive-runtime-doctor.test.ts"],
    notes: "早晚报现在会展示日程和待推进，但不新增日程语义判断。",
  },
  {
    apiName: "runtime.self_use_doctor",
    kind: "runtime_job",
    title: "自用整机运行体检",
    ownerModule: "src/live/self-use-runtime-doctor-cli.ts",
    implementationStatus: "implemented",
    inputContract: { kind: "cli", command: "SELF_USE_RUNTIME_ENABLE_LIVE=1 npm run live:self-use-runtime-doctor" },
    outputContract: ["doctor report"],
    sideEffects: ["只读本机运行状态"],
    stateTouched: [],
    failureModes: [
      { code: "runtime_unhealthy", meaning: "主动链路、微信入口或配置状态不满足运行要求。", userVisible: false },
    ],
    tests: ["tests/self-use-runtime-doctor.test.ts"],
    notes: "只做体检，不自动修复、不发送微信、不写飞书。",
  },
];

// 将模型可见工具转换成能力目录项。
function modelToolCapability(toolName: CalendarToolName): CapabilityApiEntry {
  const schema = TOOL_SCHEMAS[toolName];
  return {
    apiName: `model_tool.${toolName}`,
    kind: "model_tool",
    title: schema.description,
    ownerModule: "src/tool-contract",
    implementationStatus: "implemented",
    inputContract: { kind: "tool_schema", schema: schema.parameters },
    outputContract: ["CalendarAction", "fail-closed validation failure"],
    sideEffects: sideEffectsForTool(toolName),
    stateTouched: stateForTool(toolName),
    failureModes: [...TOOL_VALIDATION_FAILURES, ...executionFailuresForTool(toolName)],
    tests: testsForTool(toolName),
    notes: "模型只能填写参数；真实执行结果由 API Bridge 和底层工具返回。",
  };
}

// 标注工具可能产生的外部副作用。
function sideEffectsForTool(toolName: CalendarToolName): string[] {
  if (toolName === "calendar.list_events" || toolName === "calendar.daily_briefing") return ["只读日历"];
  if (toolName === "assistant.settings_summary") return ["只读配置诊断", "不暴露密钥原文"];
  if (toolName === "assistant.status_overview") return ["只读短期状态和 Seed Lite"];
  if (toolName === "assistant.dismiss_context") return ["只清理短期 pending 状态", "不写日历", "不删除 Seed Lite"];
  if (toolName === "assistant.manage_todos" || toolName === "assistant.remember_todo") return ["可写 Seed Lite"];
  if (toolName === "calendar.propose_schedule") return ["可读 Seed Lite", "可写 pending_schedule", "确认后可写日历"];
  if (toolName === "calendar.confirm_schedule") return ["可写 pending_schedule", "确认后可写日历"];
  if (toolName === "calendar.delete_event" || toolName === "calendar.delete_events" || toolName === "calendar.confirm_delete") {
    return ["可写 pending_delete", "确认后可删除日历事件"];
  }
  if (toolName === "calendar.confirm_create") return ["确认后可写日历"];
  if (toolName === "assistant.clarify") return ["可写 pending_clarification"];
  if (toolName === "calendar.update_event") return ["可写日历", "可刷新对应未发送微信提醒"];
  if (toolName === "calendar.create_recurring_event") return ["可写日历", "使用飞书原生 recurrence", "不展开微信提醒队列"];
  return ["可写日历", "可登记微信提醒"];
}

// 标注工具会读写的短期状态。
function stateForTool(toolName: CalendarToolName): string[] {
  if (toolName === "calendar.update_event") return ["last_event", "briefing_items"];
  if (toolName === "calendar.propose_schedule") return ["pending_schedule", "seed_items", ...GROUPED_WATCHLIST_STATE];
  if (toolName === "calendar.confirm_schedule") return ["pending_schedule"];
  if (toolName === "assistant.manage_todos") return ["seed_items", ...GROUPED_WATCHLIST_STATE];
  if (toolName === "calendar.delete_event" || toolName === "calendar.delete_events" || toolName === "calendar.confirm_delete") return ["pending_delete"];
  if (toolName === "calendar.confirm_create") return ["pending_conflict"];
  if (toolName === "calendar.daily_briefing") return ["briefing_items", "seed_items", ...GROUPED_WATCHLIST_STATE];
  if (toolName === "assistant.settings_summary") return [];
  if (toolName === "assistant.status_overview") {
    return ["pending_clarification", "pending_delete", "pending_conflict", "pending_schedule", "seed_items", ...GROUPED_WATCHLIST_STATE];
  }
  if (toolName === "assistant.dismiss_context") return ["pending_clarification", "pending_delete", "pending_conflict", "pending_schedule", "pending_image_draft"];
  if (toolName === "assistant.clarify") return ["pending_clarification"];
  return ["last_event"];
}

// 标注工具执行期可能额外出现的失败。
function executionFailuresForTool(toolName: CalendarToolName): CapabilityApiFailureMode[] {
  if (toolName.startsWith("calendar.") && toolName !== "calendar.propose_schedule") return CALENDAR_EXECUTION_FAILURES;
  if (toolName === "assistant.settings_summary") return [];
  if (toolName === "assistant.status_overview") return [];
  if (toolName === "assistant.dismiss_context") return [];
  if (toolName === "assistant.manage_todos") {
    return [{ code: "todo_target_ambiguous", meaning: "待推进目标匹配不到或匹配多个。", userVisible: true }];
  }
  if (toolName === "calendar.propose_schedule") {
    return [
      { code: "todo_target_ambiguous", meaning: "待推进目标匹配不到或匹配多个。", userVisible: true },
      { code: "no_schedule_candidate", meaning: "没有可安排事项或没有可用空档。", userVisible: true },
    ];
  }
  return [];
}

// 标注当前覆盖这个工具的测试文件。
function testsForTool(toolName: CalendarToolName): string[] {
  const tests = ["tests/tool-contract.test.ts", "tests/agent-api.test.ts"];
  if (toolName === "calendar.daily_briefing") tests.push("tests/briefing.test.ts");
  if (toolName === "calendar.propose_schedule" || toolName === "calendar.confirm_schedule") tests.push("tests/scheduler.test.ts");
  if (toolName === "assistant.remember_todo" || toolName === "assistant.manage_todos") tests.push("tests/seed-lite.test.ts");
  return tests;
}
