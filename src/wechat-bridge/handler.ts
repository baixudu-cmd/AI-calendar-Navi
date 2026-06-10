// Navi 微信 bridge handler：确定租户后调用 Navi Core，并通过原账号原用户回复。

import { handleCalendarAgentRequest } from "../agent-api/index.js";
import type { CalendarAdapter } from "../calendar/action-executor.js";
import type { DecisionClient } from "../decision/index.js";
import type { TenantRuntimeRegistry } from "../tenant-runtime/index.js";
import type { ContextTokenStore } from "./context-token-store.js";
import { normalizeClawBotMessage } from "./inbound.js";
import type { TenantStore } from "./tenant-store.js";
import type { ClawBotMessage, ClawBotSendResult } from "./types.js";

export type NaviWeChatBridgeHandler = {
  handleIncoming(input: NaviWeChatBridgeIncoming): Promise<NaviWeChatBridgeResult>;
};

export type NaviWeChatBridgeIncoming = {
  accountId: string;
  message: ClawBotMessage;
};

export type NaviWeChatBridgeResult = { ok: true; reply: string } | { ok: false; message: string };

export type NaviWeChatBridgeClawBotSender = {
  sendText(input: { accountId: string; toUserId: string; text: string; contextToken?: string }): Promise<ClawBotSendResult>;
};

export type CreateNaviWeChatBridgeHandlerInput = {
  tenantStore: TenantStore;
  contextTokenStore: ContextTokenStore;
  runtimeRegistry: TenantRuntimeRegistry<CalendarAdapter>;
  decisionClient: DecisionClient;
  clawbotApi: NaviWeChatBridgeClawBotSender;
  now?: string;
  timezone?: string;
  defaultWechatReminderLeadMinutes?: number[];
};

// 创建 bridge handler；这里不做语义判断，只做协议、租户和依赖编排。
export function createNaviWeChatBridgeHandler(input: CreateNaviWeChatBridgeHandlerInput): NaviWeChatBridgeHandler {
  const seenMessageIds = new Set<string>();
  return {
    async handleIncoming(incoming) {
      const normalized = normalizeClawBotMessage(incoming);
      if (!normalized.ok) return { ok: false, message: normalized.message };

      const message = normalized.message;
      if (seenMessageIds.has(message.messageId)) return { ok: false, message: "这条微信消息已经处理过。" };

      const tenant = await input.tenantStore.resolve({ accountId: message.accountId, wechatUserId: message.wechatUserId });
      if (!tenant.ok) return { ok: false, message: tenant.message };

      seenMessageIds.add(message.messageId);
      if (message.contextToken) {
        await input.contextTokenStore.set({
          accountId: message.accountId,
          wechatUserId: message.wechatUserId,
          contextToken: message.contextToken,
        });
      }

      const runtime = await input.runtimeRegistry.get(tenant.tenantId);
      const response = await handleCalendarAgentRequest({
        text: message.text,
        messageId: message.messageId,
        state: runtime.state,
        decisionClient: input.decisionClient,
        calendar: runtime.calendar,
        seedStore: runtime.seedStore,
        wechatReminderStore: runtime.wechatReminderStore,
        memoryDreamStore: runtime.memoryDreamStore,
        now: input.now,
        timezone: input.timezone,
        defaultWechatReminderLeadMinutes: input.defaultWechatReminderLeadMinutes,
      });

      const contextToken =
        message.contextToken ||
        (await input.contextTokenStore.get({ accountId: message.accountId, wechatUserId: message.wechatUserId }));
      const sent = await input.clawbotApi.sendText({
        accountId: message.accountId,
        toUserId: message.wechatUserId,
        text: response.reply,
        ...(contextToken ? { contextToken } : {}),
      });
      if (!sent.ok) return { ok: false, message: sent.message };
      return response.ok ? { ok: true, reply: response.reply } : { ok: false, message: response.reply };
    },
  };
}
