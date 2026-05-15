// 飞书真实日历 adapter 组装层：每次日历操作前获取 token，避免长运行服务复用过期 token。

import type { DeterministicCalendarAdapter } from "../../calendar-api/index.js";
import { fetchTenantAccessToken } from "./auth.js";
import { createFeishuCalendarClient } from "./client.js";
import { createFeishuHttpTransport } from "./http-transport.js";
import type { FeishuCalendarConfig, FeishuResult } from "./types.js";

export type CreateLiveFeishuCalendarAdapterInput = {
  config: FeishuCalendarConfig;
  fetch?: typeof globalThis.fetch;
};

// 创建真实飞书日历 adapter；调用方仍必须先通过 live config gate。
export async function createLiveFeishuCalendarAdapter(
  input: CreateLiveFeishuCalendarAdapterInput,
): Promise<FeishuResult<DeterministicCalendarAdapter>> {
  const token = await fetchTenantAccessToken({
    appId: input.config.appId,
    appSecret: input.config.appSecret,
    fetch: input.fetch,
  });
  if (!token.ok) return token;

  return { ok: true, data: createRefreshingFeishuCalendarAdapter(input) };
}

// 创建会自动刷新 tenant token 的 adapter，适合 shadow server 这类长运行进程。
function createRefreshingFeishuCalendarAdapter(input: CreateLiveFeishuCalendarAdapterInput): DeterministicCalendarAdapter {
  return {
    async createEvent(event) {
      return withFreshClient(input, (client) => client.createEvent(event));
    },
    async listEvents(listInput) {
      return withFreshClient(input, (client) => client.listEvents(listInput));
    },
    async updateEvent(updateInput) {
      return withFreshClient(input, (client) => client.updateEvent(updateInput));
    },
    async deleteEvent(deleteInput) {
      return withFreshClient(input, (client) => client.deleteEvent(deleteInput));
    },
  };
}

// 获取新 token 并执行一次日历操作；失败时直接返回脱敏错误。
async function withFreshClient<T>(
  input: CreateLiveFeishuCalendarAdapterInput,
  operation: (client: DeterministicCalendarAdapter) => Promise<FeishuResult<T>>,
): Promise<FeishuResult<T>> {
  const token = await fetchTenantAccessToken({
    appId: input.config.appId,
    appSecret: input.config.appSecret,
    fetch: input.fetch,
  });
  if (!token.ok) return token;

  return operation(createFeishuCalendarClient({
    config: input.config,
    tenantAccessToken: token.data,
    transport: createFeishuHttpTransport({ fetch: input.fetch }),
  }));
}
