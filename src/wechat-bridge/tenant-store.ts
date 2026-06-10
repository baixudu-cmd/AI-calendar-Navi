// 租户绑定 store：用 accountId + wechatUserId 在模型前确定 tenant。

export type TenantBinding = {
  tenantId: string;
  accountId: string;
  wechatUserId: string;
};

export type TenantResolveInput = {
  accountId: string;
  wechatUserId: string;
};

export type TenantResolveResult = { ok: true; tenantId: string } | { ok: false; message: string };

export type TenantStore = {
  resolve(input: TenantResolveInput): Promise<TenantResolveResult>;
};

// 创建内存租户绑定；P38.1 用于 fake 双租户隔离验证。
export function createMemoryTenantStore(bindings: TenantBinding[] = []): TenantStore {
  const byKey = new Map<string, TenantBinding>();
  for (const binding of bindings) {
    const key = tenantKey(binding.accountId, binding.wechatUserId);
    if (!byKey.has(key)) byKey.set(key, binding);
  }

  return {
    async resolve(input) {
      const binding = byKey.get(tenantKey(input.accountId, input.wechatUserId));
      if (!binding) return { ok: false, message: "这个微信用户还未绑定 Navi 租户。" };
      return { ok: true, tenantId: binding.tenantId };
    },
  };
}

function tenantKey(accountId: string, wechatUserId: string): string {
  return `${accountId.trim()}:${wechatUserId.trim()}`;
}
