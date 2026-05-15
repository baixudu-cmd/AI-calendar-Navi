// 每日记忆整理 CLI：只整理本地日程助手记录，不读屏、不发微信、不写日历。

import "dotenv/config";
import { createFileMemoryDreamStore, consolidateMemoryDream, formatMemoryDreamReport } from "../memory-dream/index.js";
import { createFileSeedLiteStore } from "../seed-lite/index.js";

const now = process.env.MEMORY_DREAM_NOW || new Date().toISOString();
const since = process.env.MEMORY_DREAM_SINCE || hoursBefore(now, readLookbackHours(process.env.MEMORY_DREAM_LOOKBACK_HOURS));
const store = createFileMemoryDreamStore(process.env.MEMORY_DREAM_STATE_FILE || "state/memory-dream.json");
const seedStore = createFileSeedLiteStore(process.env.MEMORY_DREAM_SEED_FILE || process.env.SEED_LITE_STATE_FILE || "state/seed-lite.json");

try {
  const result = await consolidateMemoryDream({ store, seedStore, now, since });
  console.log(formatMemoryDreamReport(result));
} catch (error) {
  console.log("Memory dream: failed");
  console.log(error instanceof Error ? error.message : "unknown memory dream error");
  process.exitCode = 1;
}

function readLookbackHours(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

function hoursBefore(value: string, hours: number): string {
  const time = Date.parse(value);
  const base = Number.isFinite(time) ? time : Date.now();
  return new Date(base - hours * 60 * 60 * 1000).toISOString();
}

