// live shadow message CLI；本地默认只调用注入式 handler，不绑定真实渠道。

import "dotenv/config";
import { loadConfig } from "../config/index.js";
import { runShadowMessageSmoke } from "./shadow-message.js";

const requestId = process.env.LIVE_SHADOW_REQUEST_ID || `shadow_${Date.now()}`;
const messageId = process.env.LIVE_SHADOW_MESSAGE_ID || requestId;

const result = await runShadowMessageSmoke({
  config: loadConfig(),
  requestId,
  messageId,
  secret: process.env.LIVE_SHADOW_SECRET || "",
  text: process.env.LIVE_SHADOW_TEXT || "看看明天日程",
  seenMessageIds: new Set((process.env.LIVE_SHADOW_SEEN_MESSAGE_IDS || "").split(",").filter(Boolean)),
  handler: async () => ({ ok: true, reply: "shadow reply" }),
});

console.log(`Live shadow message: ${result.status}`);
console.log(`requestId=${result.requestId}`);
console.log(`messageId=${result.messageId}`);
console.log(result.reply);

if (!result.ok) {
  process.exitCode = 1;
}
