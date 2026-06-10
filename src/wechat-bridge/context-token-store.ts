// 微信 context token store：按 accountId + wechatUserId 保存，避免多账号串回复。

export type ContextTokenRef = {
  accountId: string;
  wechatUserId: string;
};

export type ContextTokenSetInput = ContextTokenRef & {
  contextToken: string;
};

export type ContextTokenStore = {
  get(input: ContextTokenRef): Promise<string | undefined>;
  set(input: ContextTokenSetInput): Promise<void>;
};

// 创建内存 context token store；真实落盘在后续 P38.x 再接。
export function createMemoryContextTokenStore(): ContextTokenStore {
  const tokens = new Map<string, string>();
  return {
    async get(input) {
      return tokens.get(tokenKey(input.accountId, input.wechatUserId));
    },
    async set(input) {
      const contextToken = input.contextToken.trim();
      if (!contextToken) return;
      tokens.set(tokenKey(input.accountId, input.wechatUserId), contextToken);
    },
  };
}

function tokenKey(accountId: string, wechatUserId: string): string {
  return `${accountId.trim()}:${wechatUserId.trim()}`;
}
