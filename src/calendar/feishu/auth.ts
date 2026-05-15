// 飞书鉴权 helper：只负责获取 tenant access token，不记录或输出密钥。

import type { FeishuResult } from "./types.js";

export type FetchTenantAccessTokenInput = {
  appId?: string;
  appSecret?: string;
  fetch?: typeof globalThis.fetch;
};

type TokenBody = {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
};

// 获取飞书 tenant access token；失败时返回脱敏错误。
export async function fetchTenantAccessToken(input: FetchTenantAccessTokenInput): Promise<FeishuResult<string>> {
  if (!input.appId?.trim() || !input.appSecret?.trim()) {
    return { ok: false, code: "missing_config", message: "飞书应用配置不完整。" };
  }

  const fetchImpl = input.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: input.appId, app_secret: input.appSecret }),
    });
  } catch {
    return { ok: false, code: "network_error", message: "飞书 tenant token 获取失败：网络请求失败。" };
  }

  let body: TokenBody;
  try {
    body = (await response.json()) as TokenBody;
  } catch {
    return { ok: false, code: "invalid_response", message: "飞书 tenant token 返回格式不可解析。" };
  }

  if (!response.ok || body.code !== 0 || !body.tenant_access_token?.trim()) {
    return { ok: false, code: "api_error", message: `飞书 tenant token 获取失败：${body.msg || "未知错误"}` };
  }

  return { ok: true, data: body.tenant_access_token };
}
