// 短期 pending 状态生命周期：按下一步动作统一终结过期上下文。

import type { CalendarAction } from "../contract/index.js";
import type { ShortTermStateStore } from "./index.js";

export type PendingLifecycleActionType = CalendarAction["type"] | "media_request";
export type PendingLifecycleNextAction = CalendarAction | PendingLifecycleActionType;

// 清理与本次动作无关的 pending 状态，避免后续短回复误触旧上下文。
export function expirePendingInteractionState(state: ShortTermStateStore, nextAction: PendingLifecycleNextAction) {
  const snapshot = state.snapshot();
  const nextActionType = typeof nextAction === "string" ? nextAction : nextAction.type;
  if (nextActionType === "status_overview") return;
  const hasMixedConflictAndSchedule = Boolean(snapshot.pending_conflict && snapshot.pending_schedule);
  const isScheduleContinuation = isScheduleContinuationAction(nextAction);

  if (snapshot.pending_image_draft) state.clearPendingImageDraft();
  if (snapshot.pending_delete && nextActionType !== "confirm_delete") state.clearPendingDelete();
  if (snapshot.pending_conflict && nextActionType !== "confirm_create" && !(hasMixedConflictAndSchedule && isScheduleContinuation)) {
    state.clearPendingConflict();
  }
  if (snapshot.pending_schedule && !isScheduleContinuation && !(hasMixedConflictAndSchedule && nextActionType === "confirm_create")) {
    state.clearPendingSchedule();
  }
}

function isScheduleContinuationAction(nextAction: PendingLifecycleNextAction): boolean {
  if (typeof nextAction === "string") return nextAction === "confirm_schedule" || nextAction === "propose_schedule";
  return nextAction.type === "confirm_schedule" || (nextAction.type === "propose_schedule" && nextAction.contextRef === "pending_schedule");
}
