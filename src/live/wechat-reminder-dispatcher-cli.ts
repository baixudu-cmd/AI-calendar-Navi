// P9 微信提醒 dispatcher：只读取本地提醒任务，到点后通过 P6 微信发送门禁主动送达。

import "dotenv/config";
import {
  createDryRunProactiveDelivery,
  createOpenClawWeixinProactiveDelivery,
  type ProactiveDelivery,
} from "./proactive-delivery.js";
import { createFileWechatReminderStore, dispatchDueWechatReminders, inspectWechatReminderStatus } from "../wechat-reminder/index.js";

const stateFile = process.env.WECHAT_REMINDER_STATE_FILE || "state/wechat-reminders.json";
const now = process.env.WECHAT_REMINDER_NOW || new Date().toISOString();
const store = createFileWechatReminderStore(stateFile);

if (process.env.WECHAT_REMINDER_MODE === "status") {
  const status = await inspectWechatReminderStatus({ store, now });
  console.log(`WeChat reminder status: ${status.ok ? "ok" : "failed"}`);
  console.log("mode=status");
  printStatus(status, "status");
  if (!status.ok) process.exitCode = 1;
  process.exit();
}

const delivery = resolveDelivery();
if (!delivery.ok) {
  console.log(`WeChat reminder dispatcher: failed\n${delivery.message}`);
  process.exitCode = 1;
  process.exit();
}

const result = await dispatchDueWechatReminders({
  store,
  delivery: delivery.data,
  now,
});
const status = await inspectWechatReminderStatus({ store, now });

console.log(`WeChat reminder dispatcher: ${result.ok ? "ok" : "failed"}`);
console.log(`mode=${delivery.mode}`);
console.log(`sent=${result.sent}`);
console.log(`failed=${result.failed}`);
printStatus(status, delivery.mode);
if (!result.ok) process.exitCode = 1;

function resolveDelivery(): { ok: true; data: ProactiveDelivery; mode: string } | { ok: false; message: string } {
  if (process.env.PROACTIVE_DELIVERY_MODE !== "wechat") {
    return { ok: true, data: createDryRunProactiveDelivery(), mode: "dry-run" };
  }

  if (process.env.LIVE_PROACTIVE_ENABLE_WECHAT_SEND !== "1") {
    return { ok: false, message: "缺少 LIVE_PROACTIVE_ENABLE_WECHAT_SEND=1，不能真实发送微信。" };
  }
  if (!process.env.PROACTIVE_WECHAT_TARGET || !process.env.PROACTIVE_WECHAT_ACCOUNT_ID) {
    return { ok: false, message: "缺少 PROACTIVE_WECHAT_TARGET 或 PROACTIVE_WECHAT_ACCOUNT_ID，不能真实发送微信。" };
  }

  return {
    ok: true,
    mode: "wechat",
    data: createOpenClawWeixinProactiveDelivery({
      openclawPath: process.env.PROACTIVE_OPENCLAW_PATH,
      accountId: process.env.PROACTIVE_WECHAT_ACCOUNT_ID,
      target: process.env.PROACTIVE_WECHAT_TARGET,
    }),
  };
}

function printStatus(
  status: Awaited<ReturnType<typeof inspectWechatReminderStatus>>,
  mode: string,
): void {
  console.log(`statusMode=${mode}`);
  console.log(`total=${status.total}`);
  console.log(`pending=${status.pending}`);
  console.log(`due=${status.due}`);
  console.log(`storedSent=${status.sent}`);
  console.log(`storedFailed=${status.failed}`);
  if (status.nextDueAt) console.log(`nextDueAt=${status.nextDueAt}`);
  for (const job of status.failedJobs) {
    console.log(`failedJob=${job.jobId} title=${job.title} error=${job.lastError || "未知错误"}`);
  }
}
