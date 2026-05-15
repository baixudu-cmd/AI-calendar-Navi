// 本地决策闭环：entry -> decision -> contract -> state，不执行任何外部工具。

import { protectIncomingMessage, type IncomingMessage } from "../entry/index.js";
import { type CalendarAction, type ContractResult, type EventDraft, normalizeDecision } from "../contract/index.js";
import { decideNextAction, type DecisionClient } from "../decision/index.js";
import { type ShortTermStateStore } from "../state/index.js";

export type DecisionLoopResult =
  | { ok: true; action: CalendarAction }
  | { ok: false; reason: "entry_rejected"; message: string }
  | { ok: false; reason: "contract_rejected"; message: string };

export type DecisionLoopInput = {
  message: IncomingMessage;
  state: ShortTermStateStore;
  decisionClient: DecisionClient;
  seenMessageIds?: ReadonlySet<string>;
  now?: string;
  timezone?: string;
};

// 串联本地决策链路；这里只有合同结果，不写飞书、不回微信。
export async function runDecisionLoop(input: DecisionLoopInput): Promise<DecisionLoopResult> {
  const protectedInput = protectIncomingMessage(input.message, input.seenMessageIds);
  if (!protectedInput.ok) {
    return { ok: false, reason: "entry_rejected", message: protectedInput.message };
  }

  const rawDecision = await decideNextAction(input.decisionClient, {
    text: protectedInput.message.text,
    state: input.state.snapshot(),
    now: input.now,
    timezone: input.timezone,
  });

  const contractResult = normalizeDecision(rawDecision);
  if (!contractResult.ok) {
    return { ok: false, reason: "contract_rejected", message: contractResult.message };
  }

  const resolvedResult = resolveClarifyCreateDraft(input.state.snapshot().pending_clarification?.createDraft, contractResult);
  updateStateFromAction(input.state, resolvedResult);
  return { ok: true, action: resolvedResult.action };
}

function resolveClarifyCreateDraft(
  pendingDraft: Partial<EventDraft> | undefined,
  result: Extract<ContractResult, { ok: true }>,
): Extract<ContractResult, { ok: true }> {
  const action = result.action;
  if (action.type !== "clarify") return result;
  if (!pendingDraft && !action.createDraft) return result;

  const shouldMergePendingDraft = canMergeCreateDraft(pendingDraft, action.createDraft);
  const mergedDraft = shouldMergePendingDraft ? { ...pendingDraft, ...action.createDraft } : { ...action.createDraft };
  const mergedResult = normalizeDecision({ action: "create_event", event: mergedDraft });
  if (!mergedResult.ok) return result;
  if (mergedResult.action.type === "create_event") return mergedResult;
  if (mergedResult.action.type === "clarify") {
    return {
      ok: true,
      action: {
        ...mergedResult.action,
        createDraft: mergedDraft,
      },
    };
  }

  return mergedResult;
}

function canMergeCreateDraft(pendingDraft: Partial<EventDraft> | undefined, nextDraft: Partial<EventDraft> | undefined): boolean {
  if (!pendingDraft || !nextDraft) return true;
  if (!pendingDraft.title || !nextDraft.title) return true;
  return pendingDraft.title.trim() === nextDraft.title.trim();
}

function updateStateFromAction(state: ShortTermStateStore, result: Extract<ContractResult, { ok: true }>) {
  const action = result.action;
  if (action.type === "status_overview") return;
  if (action.type === "clarify") {
    state.update({
      pending_clarification: {
        question: action.question,
        missing: action.missing,
        ...(action.createDraft ? { createDraft: action.createDraft } : {}),
      },
    });
    return;
  }

  state.clearPendingClarification();
}
