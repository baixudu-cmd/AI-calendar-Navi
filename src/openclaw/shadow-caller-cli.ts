// OpenClaw shadow caller smoke：只验证 caller 能发送最小 payload，不绑定真实微信。

import { callOpenClawShadowRoute, formatOpenClawShadowCallerOutput } from "./shadow-caller.js";

const url = process.env.OPENCLAW_SHADOW_URL || "";
const secret = process.env.OPENCLAW_SHADOW_SECRET || "";
const text = process.env.OPENCLAW_SHADOW_TEXT || "";
const messageId = process.env.OPENCLAW_SHADOW_MESSAGE_ID || `openclaw_msg_${Date.now()}`;
const requestId = process.env.OPENCLAW_SHADOW_REQUEST_ID || `openclaw_req_${Date.now()}`;
const replyOnly = process.env.OPENCLAW_SHADOW_REPLY_ONLY === "1";
const mediaPath = process.env.OPENCLAW_SHADOW_MEDIA_PATH || "";
const mediaType = process.env.OPENCLAW_SHADOW_MEDIA_TYPE || "";
const media = mediaPath || mediaType ? { path: mediaPath, type: mediaType } : undefined;

if (!url || !secret || (!text && !media)) {
  console.log("OpenClaw shadow caller smoke: failed");
  console.log("missing required env: OPENCLAW_SHADOW_URL, OPENCLAW_SHADOW_SECRET, and OPENCLAW_SHADOW_TEXT or OPENCLAW_SHADOW_MEDIA_PATH/TYPE");
  process.exitCode = 1;
} else {
  const result = await callOpenClawShadowRoute({ url, text, messageId, requestId, secret, ...(media ? { media } : {}) });
  console.log(formatOpenClawShadowCallerOutput(result, { replyOnly }));
  if (!replyOnly && !result.ok) process.exitCode = 1;
}
