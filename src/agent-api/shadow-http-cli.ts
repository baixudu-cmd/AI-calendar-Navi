// 本机 shadow HTTP 入口：组装服务端依赖后，只给本机 OpenClaw 调用最小 payload。

import "dotenv/config";
import { createLiveFeishuCalendarAdapter } from "../calendar/feishu/live-adapter.js";
import { createClarifyEventDraftRepairer, createClarifyRepairRequestOptions } from "../clarify-repair/index.js";
import { loadConfig } from "../config/index.js";
import {
  createCalendarToolCallRequestOptions,
  createModelDecisionClient,
  createOpenAICompatibleTransport,
} from "../decision/model/index.js";
import { createImageDraftParserFromEnv, createImageDraftRequestOptions } from "../image-capture/index.js";
import { evaluateLiveConfigGate, formatLiveConfigGateReport } from "../live/config-gate.js";
import { createFileMemoryDreamStore } from "../memory-dream/index.js";
import { createFileSeedLiteStore } from "../seed-lite/index.js";
import { loadAppSettings } from "../settings/index.js";
import { createShortTermStateStore } from "../state/index.js";
import { createFileWechatReminderStore, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES } from "../wechat-reminder/index.js";
import { resolveShadowCalendarTarget } from "./shadow-calendar-target.js";
import { createControlledShadowRoute } from "./controlled-shadow-route.js";
import { startShadowHttpServer } from "./shadow-http-server.js";

const config = loadConfig();
const appSettings = loadAppSettings();
const gate = evaluateLiveConfigGate(config);
if (!gate.ok) {
  console.log(formatLiveConfigGateReport(gate));
  process.exitCode = 1;
} else {
  await startServerWithLiveDependencies();
}

// 组装真实微信入口依赖；写入目标必须通过主日历 gate。
async function startServerWithLiveDependencies() {
  const target = resolveShadowCalendarTarget(config);
  if (!target.ok) {
    console.log("Shadow HTTP server: failed");
    console.log(target.message);
    process.exitCode = 1;
    return;
  }

  const calendar = await createLiveFeishuCalendarAdapter({
    config: {
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      calendarId: target.calendarId,
      timezone: config.timezone,
      defaultAttendeeOpenId: config.feishuDefaultAttendeeOpenId,
    },
  });

  if (!calendar.ok) {
    console.log("Shadow HTTP server: failed");
    console.log(calendar.message);
    process.exitCode = 1;
  } else {
    const route = createControlledShadowRoute({
      expectedSecret: config.wechatEntrySecret || "",
      state: createShortTermStateStore(),
      seenMessageIds: new Set<string>(),
      decisionClient: createModelDecisionClient({
        model: config.modelName || "",
        transport: createOpenAICompatibleTransport({
          baseUrl: config.modelBaseUrl || "",
          apiKey: config.modelApiKey || "",
          requestOptions: createCalendarToolCallRequestOptions(),
        }),
      }),
      calendar: calendar.data,
      now: process.env.SHADOW_ROUTE_NOW,
      timezone: config.timezone,
      seedStore: createFileSeedLiteStore(process.env.SEED_LITE_STATE_FILE || appSettings.stateFiles.seedLite),
      memoryDreamStore: createFileMemoryDreamStore(process.env.MEMORY_DREAM_STATE_FILE || appSettings.stateFiles.memoryDream),
      wechatReminderStore: createFileWechatReminderStore(process.env.WECHAT_REMINDER_STATE_FILE || appSettings.stateFiles.wechatReminder),
      defaultWechatReminderLeadMinutes: readLeadMinutes(process.env.WECHAT_REMINDER_LEAD_MINUTES, appSettings.reminders.wechatLeadMinutes),
      imageDraftParser: createImageDraftParserFromEnv(process.env, {
        model: config.modelName || "",
        transport: createOpenAICompatibleTransport({
          baseUrl: config.modelBaseUrl || "",
          apiKey: config.modelApiKey || "",
          requestOptions: createImageDraftRequestOptions(),
        }),
      }), // 只有 IMAGE_CAPTURE_ENABLE_DRAFT=1 时才启用图片草稿解析。
      clarifyEventDraftRepairer: createClarifyEventDraftRepairer({
        model: config.modelName || "",
        transport: createOpenAICompatibleTransport({
          baseUrl: config.modelBaseUrl || "",
          apiKey: config.modelApiKey || "",
          requestOptions: createClarifyRepairRequestOptions(),
        }),
      }),
    });

    const host = "127.0.0.1";
    const port = Number(process.env.SHADOW_ROUTE_PORT || "37891");
    await startShadowHttpServer({ route, host, port });
    console.log(`Shadow HTTP server: listening on http://${host}:${port}/calendar-agent/shadow`);
  }
}

function readLeadMinutes(value: string | undefined, fallback: number[] = DEFAULT_WECHAT_REMINDER_LEAD_MINUTES): number[] {
  const raw = value || fallback.join(",");
  const minutes = raw
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
  return minutes.length > 0 ? minutes : fallback;
}
