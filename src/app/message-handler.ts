// 本地消息处理器：串联微信消息、决策合同、日历执行、日报执行和回执。

import { executeCalendarAction, type CalendarAdapter } from "../calendar/action-executor.js";
import type { FeishuCalendarEvent } from "../calendar/feishu/types.js";
import { executeDailyBriefing, resolveBriefingItemUpdate } from "../briefing/index.js";
import type { CalendarAction } from "../contract/index.js";
import type { DecisionClient } from "../decision/index.js";
import { runDecisionLoop } from "../loop/index.js";
import { buildActionReply } from "../reply/index.js";
import { briefingItemStateFromCalendarEvent, lastEventStateFromCalendarEvent } from "../state/calendar-event.js";
import type { ShortTermStateStore } from "../state/index.js";
import { normalizeWeChatMessage, type WeChatMessage } from "../wechat/message.js";

export type HandleWeChatMessageInput = {
  message: WeChatMessage;
  state: ShortTermStateStore;
  decisionClient: DecisionClient;
  calendar: CalendarAdapter;
  seenMessageIds?: ReadonlySet<string>;
  today?: string;
};

export type HandleWeChatMessageResult = { ok: true; reply: string } | { ok: false; reply: string };

type UpdateEventPatch = Extract<CalendarAction, { type: "update_event" }>["patch"];

// 处理单条微信消息；这里不判断语义，只编排已有模块。
export async function handleWeChatMessage(input: HandleWeChatMessageInput): Promise<HandleWeChatMessageResult> {
  const loopResult = await runDecisionLoop({
    message: normalizeWeChatMessage(input.message),
    state: input.state,
    decisionClient: input.decisionClient,
    seenMessageIds: input.seenMessageIds,
  });

  if (!loopResult.ok) return { ok: false, reply: loopResult.message };

  if (loopResult.action.type === "clarify") {
    return { ok: true, reply: buildActionReply(loopResult.action) };
  }

  if (loopResult.action.type === "daily_briefing") {
    return executeDailyBriefing({
      briefingType: loopResult.action.briefingType,
      today: input.today || todayInShanghai(),
      state: input.state,
      calendar: input.calendar,
    });
  }

  const executableAction = resolveCalendarAction(loopResult.action, input.state);
  if (!executableAction.ok) return { ok: true, reply: `没有成功：${executableAction.message}` };

  const execution = await executeCalendarAction(executableAction.action, input.calendar);
  if (execution.ok) updateStateFromExecution(input.state, execution.data);

  return { ok: true, reply: buildActionReply(executableAction.action, execution) };
}

// 把需要状态辅助的动作解析成可执行日历动作。
function resolveCalendarAction(
  action: CalendarAction,
  state: ShortTermStateStore,
): { ok: true; action: CalendarAction } | { ok: false; message: string } {
  const resolved = resolveBriefingItemUpdate(action, state);
  if (!resolved.ok) return resolved;

  const snapshot = state.snapshot();
  if (
    action.type === "update_event" &&
    action.target.kind === "last_event" &&
    resolved.action.type === "update_event" &&
    resolved.action.target.kind === "last_event"
  ) {
    if (!snapshot.last_event) return { ok: false, message: "没有找到刚才那个日程。" };
    if (changesTimeWithoutDate(resolved.action.patch, snapshot.last_event.date)) {
      return { ok: false, message: "这个日程是哪一天？" };
    }
    return {
      ok: true,
      action: {
        ...resolved.action,
        target: { kind: "last_event", eventId: snapshot.last_event.eventId },
        patch: fillPatchDateFromLastEvent(resolved.action.patch, snapshot.last_event.date),
      },
    };
  }

  return resolved;
}

// 工具成功后才更新用户可引用的短期状态。
function updateStateFromExecution(state: ShortTermStateStore, data: FeishuCalendarEvent | FeishuCalendarEvent[]) {
  if (Array.isArray(data)) {
    state.update({
      briefing_items: data.map((event, index) => briefingItemStateFromCalendarEvent(event, index + 1)),
    });
    return;
  }

  state.update({ last_event: lastEventStateFromCalendarEvent(data) });
}

// 只在本地状态明确知道日期时，补齐“刚才那个改到几点”的可执行 patch。
function fillPatchDateFromLastEvent<T extends UpdateEventPatch>(patch: T, date: string | undefined): T {
  if (!date || patch.date || (!patch.startTime && !patch.endTime)) return patch;
  return { ...patch, date };
}

function changesTimeWithoutDate(patch: UpdateEventPatch, stateDate: string | undefined): boolean {
  return !patch.date && !stateDate && Boolean(patch.startTime || patch.endTime);
}

// 默认日期只作为兜底；测试和定时日报应显式注入 today。
function todayInShanghai(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}
