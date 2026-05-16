// 受控 shadow route：固定服务端依赖，只让外部调用方传文本、消息元信息和 secret。

import type { CalendarAdapter } from "../calendar/action-executor.js";
import type { ClarifyEventDraftRepairer } from "../clarify-repair/index.js";
import type { DecisionClient } from "../decision/index.js";
import type { ImageDraftParser } from "../image-capture/index.js";
import type { MemoryDreamStore } from "../memory-dream/index.js";
import type { SeedLiteStore } from "../seed-lite/index.js";
import type { ShortTermStateStore } from "../state/index.js";
import type { WechatReminderStore } from "../wechat-reminder/index.js";
import { handleCalendarAgentRequest, type CalendarAgentMedia, type CalendarAgentResponse } from "./index.js";

export type ControlledShadowRouteRequest = {
  text: string;
  secret: string;
  requestId?: string;
  messageId?: string;
  media?: CalendarAgentMedia;
};

export type ControlledShadowRouteDependencies = {
  expectedSecret: string;
  state: ShortTermStateStore;
  decisionClient: DecisionClient;
  calendar: CalendarAdapter;
  seenMessageIds?: Set<string>;
  today?: string;
  now?: string | (() => string);
  timezone?: string;
  seedStore?: SeedLiteStore;
  wechatReminderStore?: WechatReminderStore;
  defaultWechatReminderLeadMinutes?: number[];
  imageDraftParser?: ImageDraftParser;
  clarifyEventDraftRepairer?: ClarifyEventDraftRepairer;
  memoryDreamStore?: MemoryDreamStore;
};

export type ControlledShadowRouteHandler = (request: ControlledShadowRouteRequest) => Promise<CalendarAgentResponse>;

// 固定服务端依赖后，返回只接收外部请求的 handler。
export function createControlledShadowRoute(
  dependencies: ControlledShadowRouteDependencies,
): ControlledShadowRouteHandler {
  const seenMessageIds = dependencies.seenMessageIds || new Set<string>();

  return async (request) => {
    const result = await handleControlledShadowRoute(request, { ...dependencies, seenMessageIds });
    if (result.ok && request.messageId) seenMessageIds.add(request.messageId);
    return result;
  };
}

// 内部处理函数；对外使用 createControlledShadowRoute 固定依赖后得到的单参数 handler。
export async function handleControlledShadowRoute(
  request: ControlledShadowRouteRequest,
  dependencies: ControlledShadowRouteDependencies,
): Promise<CalendarAgentResponse> {
  const requestId = request.requestId || `shadow_${Date.now()}`;
  if (request.secret !== dependencies.expectedSecret) {
    return { ok: false, reply: "secret 校验失败。", actionType: "rejected", requestId };
  }

  return handleCalendarAgentRequest({
    text: request.text,
    requestId,
    messageId: request.messageId,
    media: request.media,
    state: dependencies.state,
    decisionClient: dependencies.decisionClient,
    calendar: dependencies.calendar,
    seenMessageIds: dependencies.seenMessageIds,
    today: dependencies.today,
    now: readRouteNow(dependencies.now),
    timezone: dependencies.timezone,
    seedStore: dependencies.seedStore,
    wechatReminderStore: dependencies.wechatReminderStore,
    defaultWechatReminderLeadMinutes: dependencies.defaultWechatReminderLeadMinutes,
    imageDraftParser: dependencies.imageDraftParser,
    clarifyEventDraftRepairer: dependencies.clarifyEventDraftRepairer,
    memoryDreamStore: dependencies.memoryDreamStore,
  });
}

// 每次请求独立读取当前时间，避免长驻 shadow server 把相对日期冻结在启动日。
function readRouteNow(now: ControlledShadowRouteDependencies["now"]): string | undefined {
  return typeof now === "function" ? now() : now;
}
