// 微信轻量 bridge 类型：只描述 ClawBot 文本入站、上下文 token 和原路回复。

export type ClawBotAccount = {
  accountId: string;
  baseUrl: string;
  token: string;
  cursor?: string;
};

export type ClawBotMessageItem = {
  type?: number;
  text_item?: { text?: string };
  voice_item?: { text?: string };
};

export type ClawBotMessage = {
  message_id?: string | number;
  from_user_id?: string;
  to_user_id?: string;
  context_token?: string;
  item_list?: ClawBotMessageItem[];
};

export type ClawBotPollInput = ClawBotAccount & {
  signal?: AbortSignal;
};

export type ClawBotPollResult =
  | { ok: true; messages: ClawBotMessage[]; cursor?: string; longPollingTimeoutMs?: number }
  | { ok: false; message: string };

export type ClawBotSendTextInput = Omit<ClawBotAccount, "cursor"> & {
  toUserId: string;
  text: string;
  contextToken?: string;
};

export type ClawBotSendResult = { ok: true; messageId?: string } | { ok: false; message: string };

export type ClawBotApi = {
  getUpdates(input: ClawBotPollInput): Promise<ClawBotPollResult>;
  sendText(input: ClawBotSendTextInput): Promise<ClawBotSendResult>;
};

export type NormalizedBridgeMessage = {
  accountId: string;
  wechatUserId: string;
  messageId: string;
  text: string;
  contextToken?: string;
};
