// 基础真实压测 runner：只归类链路失败，不在这里做正则补丁或语义修复。

import { executeCalendarAction, type CalendarAdapter } from "../calendar/action-executor.js";
import type { CalendarAction } from "../contract/index.js";
import type { DecisionClient } from "../decision/index.js";
import { runDecisionLoop } from "../loop/index.js";
import { createShortTermStateStore } from "../state/index.js";
import type { BasicRegressionCase } from "./basic-regression-cases.js";

export type RegressionFailureFamily =
  | "entry"
  | "contract"
  | "tool_schema"
  | "model_timeout"
  | "model_intent"
  | "time_extraction"
  | "title_extraction"
  | "clarification"
  | "calendar_api";

export type BasicRegressionFailure = {
  caseId: string;
  text: string;
  family: RegressionFailureFamily;
  message: string;
  actionType?: string;
};

export type BasicRegressionResult = {
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  failures: BasicRegressionFailure[];
};

export type BasicRegressionProgress = {
  index: number;
  total: number;
  caseId: string;
  status: "started" | "passed" | "failed";
  family?: RegressionFailureFamily;
};

export type BasicRegressionInput = {
  cases: BasicRegressionCase[];
  decisionClient: DecisionClient;
  calendar: CalendarAdapter;
  executeCalendar?: boolean;
  perCaseTimeoutMs?: number;
  now?: string;
  timezone?: string;
  onProgress?: (progress: BasicRegressionProgress) => void;
};

export type ClassifyRegressionFailureInput = {
  expectedField?: string;
  actualActionType?: string;
  reason?: string;
  message?: string;
};

// 运行基础压测；默认只验证模型和动作合同，不写日历。
export async function runBasicRegression(input: BasicRegressionInput): Promise<BasicRegressionResult> {
  const failures: BasicRegressionFailure[] = [];
  const total = input.cases.length;

  for (const [caseIndex, testCase] of input.cases.entries()) {
    const index = caseIndex + 1;
    input.onProgress?.({ index, total, caseId: testCase.id, status: "started" });
    const state = createShortTermStateStore(testCase.initialState);
    const loopResult = await runDecisionLoopSafely(testCase, state, input);
    let failure: BasicRegressionFailure | null = null;

    if (loopResult === "timeout") {
      failure = {
        caseId: testCase.id,
        text: testCase.text,
        family: "model_timeout",
        message: `model decision timed out after ${input.perCaseTimeoutMs}ms`,
        actionType: "timeout",
      };
    } else if (!loopResult.ok && loopResult.reason === "model_error") {
      failure = {
        caseId: testCase.id,
        text: testCase.text,
        family: classifyRegressionFailure({ reason: loopResult.message }),
        message: loopResult.message,
        actionType: "model_error",
      };
    } else if (!loopResult.ok) {
      failure = {
        caseId: testCase.id,
        text: testCase.text,
        family: classifyRegressionFailure({ reason: loopResult.reason, message: loopResult.message }),
        message: loopResult.message,
        actionType: "rejected",
      };
    } else {
      failure = compareAction(testCase, loopResult.action);
    }

    if (!failure && loopResult !== "timeout" && loopResult.ok && input.executeCalendar && isExecutableCalendarAction(loopResult.action)) {
      const execution = await executeCalendarAction(loopResult.action, input.calendar);
      if (!execution.ok) {
        failure = {
          caseId: testCase.id,
          text: testCase.text,
          family: "calendar_api",
          message: execution.message,
          actionType: loopResult.action.type,
        };
      }
    }

    if (failure) {
      failures.push(failure);
      input.onProgress?.({ index, total, caseId: testCase.id, status: "failed", family: failure.family });
    } else {
      input.onProgress?.({ index, total, caseId: testCase.id, status: "passed" });
    }
  }

  return {
    summary: {
      total: input.cases.length,
      passed: input.cases.length - failures.length,
      failed: failures.length,
    },
    failures,
  };
}

// 生成简短报告，只输出数量和问题族。
export function formatBasicRegressionReport(result: BasicRegressionResult): string {
  const lines = [
    `Basic regression: ${result.summary.failed === 0 ? "passed" : "failed"}`,
    `Total: ${result.summary.total}`,
    `Passed: ${result.summary.passed}`,
    `Failed: ${result.summary.failed}`,
  ];

  if (result.failures.length > 0) {
    lines.push("Failure families:");
    for (const [family, count] of Object.entries(countFamilies(result.failures))) {
      lines.push(`- ${family}: ${count}`);
    }
  }

  return lines.join("\n");
}

// 只做问题族归类，不给句子级补丁建议。
export function classifyRegressionFailure(input: ClassifyRegressionFailureInput): RegressionFailureFamily {
  if (input.reason === "entry_rejected") return "entry";
  if (
    input.reason === "tool_schema_rejected" ||
    input.reason === "unknown_tool" ||
    input.reason === "missing_arguments" ||
    input.reason === "invalid_arguments" ||
    input.reason === "guard_rejected" ||
    input.message?.includes("工具 Schema 未通过") ||
    input.message?.includes("__tool_schema_rejected__") ||
    input.message?.includes("missing_arguments") ||
    input.message?.includes("invalid_arguments") ||
    input.message?.includes("unknown_tool") ||
    input.message?.includes("guard_rejected")
  ) {
    return "tool_schema";
  }
  if (input.reason === "contract_rejected") return "contract";
  if (input.reason === "model_timeout" || input.reason?.includes("超时")) return "model_timeout";
  if (input.expectedField === "title") return "title_extraction";
  if (input.expectedField === "date" || input.expectedField === "startTime") return "time_extraction";
  if (input.actualActionType === "clarify") return "clarification";
  return "model_intent";
}

// 捕获模型异常，让真实压测输出问题族，而不是直接崩掉。
async function runDecisionLoopSafely(
  testCase: BasicRegressionCase,
  state: ReturnType<typeof createShortTermStateStore>,
  input: BasicRegressionInput,
) {
  try {
    return await runWithOptionalTimeout(
      runDecisionLoop({
        message: { id: testCase.id, text: testCase.text },
        state,
        decisionClient: input.decisionClient,
        now: input.now,
        timezone: input.timezone,
      }),
      input.perCaseTimeoutMs,
    );
  } catch (error) {
    return {
      ok: false as const,
      reason: "model_error" as const,
      message: error instanceof Error ? error.message : "模型服务调用失败。",
    };
  }
}

// 单条样例超时后继续跑下一条，避免真实模型慢请求卡住整轮压测。
async function runWithOptionalTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T | "timeout"> {
  if (!timeoutMs || timeoutMs <= 0) return promise;

  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), timeoutMs);
    }),
  ]);
}

function compareAction(testCase: BasicRegressionCase, action: CalendarAction): BasicRegressionFailure | null {
  if (action.type !== testCase.expected.type) {
    return {
      caseId: testCase.id,
      text: testCase.text,
      family: classifyRegressionFailure({ actualActionType: action.type }),
      message: `expected ${testCase.expected.type}, got ${action.type}`,
      actionType: action.type,
    };
  }

  if (action.type === "create_event") {
    return compareEventFields(testCase, action.type, action.event);
  }

  if (action.type === "list_events") {
    if (testCase.expected.date && action.date !== testCase.expected.date) {
      return fieldFailure(testCase, action.type, "date", `expected date ${testCase.expected.date}, got ${action.date || "missing"}`);
    }
    return null;
  }

  if (action.type === "update_event") {
    return compareEventFields(testCase, action.type, fillPatchDateFromState(testCase, action.patch));
  }

  if (action.type === "daily_briefing" && testCase.expected.briefingType !== action.briefingType) {
    return {
      caseId: testCase.id,
      text: testCase.text,
      family: "model_intent",
      message: `expected briefing ${testCase.expected.briefingType}, got ${action.briefingType}`,
      actionType: action.type,
    };
  }

  return null;
}

function fillPatchDateFromState(
  testCase: BasicRegressionCase,
  patch: { title?: string; date?: string; startTime?: string },
): { title?: string; date?: string; startTime?: string } {
  if (patch.date || !patch.startTime) return patch;
  const date = testCase.initialState?.last_event?.date;
  if (!date) return patch;
  return { ...patch, date };
}

function compareEventFields(
  testCase: BasicRegressionCase,
  actionType: string,
  event: { title?: string; date?: string; startTime?: string },
): BasicRegressionFailure | null {
  const titleOptions = normalizeTitleOptions(testCase.expected.titleIncludes);
  if (titleOptions.length > 0 && !titleOptions.some((title) => event.title?.includes(title))) {
    return fieldFailure(
      testCase,
      actionType,
      "title",
      `expected title to include one of ${titleOptions.join(", ")}, got ${event.title || "missing"}`,
    );
  }
  if (testCase.expected.date && event.date !== testCase.expected.date) {
    return fieldFailure(testCase, actionType, "date", `expected date ${testCase.expected.date}, got ${event.date || "missing"}`);
  }
  if (testCase.expected.startTime && event.startTime !== testCase.expected.startTime) {
    return fieldFailure(
      testCase,
      actionType,
      "startTime",
      `expected startTime ${testCase.expected.startTime}, got ${event.startTime || "missing"}`,
    );
  }
  return null;
}

function normalizeTitleOptions(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function fieldFailure(testCase: BasicRegressionCase, actionType: string, field: string, message: string): BasicRegressionFailure {
  return {
    caseId: testCase.id,
    text: testCase.text,
    family: classifyRegressionFailure({ expectedField: field, actualActionType: actionType }),
    message,
    actionType,
  };
}

function isExecutableCalendarAction(action: CalendarAction): boolean {
  return action.type === "create_event" || action.type === "list_events" || action.type === "update_event";
}

function countFamilies(failures: BasicRegressionFailure[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const failure of failures) counts[failure.family] = (counts[failure.family] || 0) + 1;
  return counts;
}
