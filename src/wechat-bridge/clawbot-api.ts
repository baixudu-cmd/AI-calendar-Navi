// ClawBot HTTP API 封装：只做 getUpdates 和 sendText，不理解 Navi 业务。

import type { ClawBotApi, ClawBotPollInput, ClawBotPollResult, ClawBotSendResult, ClawBotSendTextInput } from "./types.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type CreateClawBotApiInput = {
  fetch?: FetchLike;
};

// 创建 ClawBot API 客户端；fetch 可注入，方便 P38.1 使用 fake transport。
export function createClawBotApi(input: CreateClawBotApiInput = {}): ClawBotApi {
  const fetchImpl = input.fetch || fetch;
  return {
    async getUpdates(pollInput) {
      return getUpdates(fetchImpl, pollInput);
    },
    async sendText(sendInput) {
      return sendText(fetchImpl, sendInput);
    },
  };
}

// 拉取单个账号的增量消息；cursor 由调用方按 account 独立保存。
async function getUpdates(fetchImpl: FetchLike, input: ClawBotPollInput): Promise<ClawBotPollResult> {
  const response = await postJson(fetchImpl, input, "ilink/bot/getupdates", { get_updates_buf: input.cursor || "" });
  if (!response.ok) return response;
  const body = response.body;
  if (!isRecord(body)) return { ok: false, message: "ClawBot getUpdates 返回格式不正确。" };
  if (body.ret !== undefined && body.ret !== 0) return { ok: false, message: `ClawBot getUpdates 失败：${String(body.ret)}` };
  return {
    ok: true,
    messages: Array.isArray(body.msgs) ? body.msgs : [],
    ...(typeof body.get_updates_buf === "string" ? { cursor: body.get_updates_buf } : {}),
    ...(Number.isInteger(body.longpolling_timeout_ms) ? { longPollingTimeoutMs: Number(body.longpolling_timeout_ms) } : {}),
  };
}

// 发送文本回复；调用方必须显式传入原账号、原用户和 context token。
async function sendText(fetchImpl: FetchLike, input: ClawBotSendTextInput): Promise<ClawBotSendResult> {
  const response = await postJson(fetchImpl, input, "ilink/bot/sendmessage", {
    msg: {
      to_user_id: input.toUserId,
      ...(input.contextToken ? { context_token: input.contextToken } : {}),
      item_list: input.text ? [{ type: 1, text_item: { text: input.text } }] : [],
    },
  });
  if (!response.ok) return response;
  const body = response.body;
  if (!isRecord(body)) return { ok: false, message: "ClawBot sendMessage 返回格式不正确。" };
  if (body.ret !== undefined && body.ret !== 0) return { ok: false, message: `ClawBot sendMessage 失败：${String(body.ret)}` };
  return { ok: true, ...(typeof body.message_id === "string" ? { messageId: body.message_id } : {}) };
}

async function postJson(
  fetchImpl: FetchLike,
  account: { baseUrl: string; token: string },
  endpoint: string,
  body: unknown,
): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  const response = await fetchImpl(`${trimTrailingSlash(account.baseUrl)}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.token}`,
      AuthorizationType: "ilink_bot_token",
      "Content-Type": "application/json",
      "X-WECHAT-UIN": randomWechatUin(),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) return { ok: false, message: `ClawBot HTTP ${response.status}` };
  return { ok: true, body: await response.json() };
}

function randomWechatUin(): string {
  const value = Math.floor(Math.random() * 4_294_967_295);
  return Buffer.from(String(value), "utf8").toString("base64");
}

function trimTrailingSlash(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
