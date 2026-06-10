// Tenant runtime：为每个租户创建独立的 Navi 本地依赖，避免状态互相串线。

import { type CalendarAdapter } from "../calendar/action-executor.js";
import { createMemoryMemoryDreamStore, type MemoryDreamStore } from "../memory-dream/index.js";
import { createMemorySeedLiteStore, type SeedLiteStore } from "../seed-lite/index.js";
import { createShortTermStateStore, type ShortTermStateStore } from "../state/index.js";
import { createMemoryWechatReminderStore, type WechatReminderStore } from "../wechat-reminder/index.js";

export type TenantRuntime<TCalendar = CalendarAdapter> = {
  tenantId: string;
  state: ShortTermStateStore;
  seedStore: SeedLiteStore;
  wechatReminderStore: WechatReminderStore;
  memoryDreamStore: MemoryDreamStore;
  calendar: TCalendar;
};

export type TenantRuntimeRegistry<TCalendar = CalendarAdapter> = {
  get(tenantId: string): Promise<TenantRuntime<TCalendar>>;
};

export type CreateMemoryTenantRuntimeRegistryInput<TCalendar> = {
  createCalendar(tenantId: string): TCalendar;
};

// 创建内存 runtime registry；同一 tenant 复用实例，不同 tenant 完全隔离。
export function createMemoryTenantRuntimeRegistry<TCalendar = CalendarAdapter>(
  input: CreateMemoryTenantRuntimeRegistryInput<TCalendar>,
): TenantRuntimeRegistry<TCalendar> {
  const runtimes = new Map<string, TenantRuntime<TCalendar>>();
  return {
    async get(tenantId) {
      const key = tenantId.trim();
      const existing = runtimes.get(key);
      if (existing) return existing;
      const runtime: TenantRuntime<TCalendar> = {
        tenantId: key,
        state: createShortTermStateStore(),
        seedStore: createMemorySeedLiteStore(),
        wechatReminderStore: createMemoryWechatReminderStore(),
        memoryDreamStore: createMemoryMemoryDreamStore(),
        calendar: input.createCalendar(key),
      };
      runtimes.set(key, runtime);
      return runtime;
    },
  };
}
