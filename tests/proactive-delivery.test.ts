// P6 主动消息发送层测试：默认 dry-run，真实微信发送必须显式门禁。

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { DeterministicCalendarAdapter } from "../src/calendar-api/index.js";
import {
  createMemoryProactiveMessageStore,
  runProactiveBriefing,
} from "../src/live/proactive-briefing.js";
import {
  createDryRunProactiveDelivery,
  createFunctionProactiveDelivery,
  createOpenClawWeixinProactiveDelivery,
} from "../src/live/proactive-delivery.js";

describe("proactive delivery", () => {
  it("dry-runs proactive messages without external sending", async () => {
    const delivery = createDryRunProactiveDelivery();

    const result = await delivery.deliver({
      key: "briefing:morning:2026-05-14",
      message: "早报｜2026年5月14日 星期四\n1. 09:00 投委会",
      mode: "morning",
    });

    expect(result).toEqual({
      ok: true,
      mode: "dry-run",
      message: "dry-run delivery completed",
    });
  });

  it("wraps an injected delivery function and returns its result", async () => {
    const delivery = createFunctionProactiveDelivery("fake-wechat", async (input) => ({
      ok: true,
      mode: "fake-wechat",
      message: `sent:${input.key}`,
    }));

    await expect(
      delivery.deliver({
        key: "reminder:2026-05-14:evt_1:2026-05-14 09:00",
        message: "日程提醒｜2026年5月14日 星期四\n30 分钟内：09:00 投委会",
        mode: "reminder",
      }),
    ).resolves.toEqual({
      ok: true,
      mode: "fake-wechat",
      message: "sent:reminder:2026-05-14:evt_1:2026-05-14 09:00",
    });
  });

  it("builds OpenClaw Weixin send command with explicit account and target", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const delivery = createOpenClawWeixinProactiveDelivery({
      openclawPath: "/home/example/.openclaw/bin/openclaw",
      accountId: "106501ee843a-im-bot",
      target: "user@im.wechat",
      run: async (command, args) => {
        calls.push({ command, args });
        return { status: 0, stdout: JSON.stringify({ action: "send", channel: "openclaw-weixin" }), stderr: "" };
      },
    });

    await expect(
      delivery.deliver({
        key: "briefing:morning:2026-05-14",
        message: "早报｜2026年5月14日 星期四\n1. 09:00 投委会",
        mode: "morning",
      }),
    ).resolves.toEqual({
      ok: true,
      mode: "wechat",
      message: "openclaw weixin delivery completed",
    });

    expect(calls).toEqual([
      {
        command: "/home/example/.openclaw/bin/openclaw",
        args: [
          "message",
          "send",
          "--channel",
          "openclaw-weixin",
          "--account",
          "106501ee843a-im-bot",
          "--target",
          "user@im.wechat",
          "--message",
          "早报｜2026年5月14日 星期四\n1. 09:00 投委会",
          "--json",
        ],
      },
    ]);
  });

  it("marks sent only after delivery succeeds", async () => {
    const store = createMemoryProactiveMessageStore();
    const result = await runProactiveBriefing({
      mode: "morning",
      today: "2026-05-14",
      now: "2026-05-14T08:30:00+08:00",
      calendar: createCalendar([{ id: "evt_1", title: "投委会", start: "2026-05-14 09:00" }]),
      store,
      commit: true,
      delivery: createDryRunProactiveDelivery(),
    });

    expect(result.sent).toBe(true);
    await expect(store.hasSent("briefing:morning:2026-05-14")).resolves.toBe(true);
  });

  it("does not mark sent when delivery fails", async () => {
    const store = createMemoryProactiveMessageStore();
    const delivery = createFunctionProactiveDelivery("fake-wechat", async () => ({
      ok: false,
      mode: "fake-wechat",
      message: "send failed",
    }));

    const result = await runProactiveBriefing({
      mode: "morning",
      today: "2026-05-14",
      now: "2026-05-14T08:30:00+08:00",
      calendar: createCalendar([{ id: "evt_1", title: "投委会", start: "2026-05-14 09:00" }]),
      store,
      commit: true,
      delivery,
    });

    expect(result).toMatchObject({ ok: false, sent: false, message: "没有发送成功：send failed" });
    await expect(store.hasSent("briefing:morning:2026-05-14")).resolves.toBe(false);
  });

  it("CLI remains dry-run by default and does not require WeChat send env", () => {
    const result = spawnSync("npm", ["run", "live:proactive-briefing"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PROACTIVE_MODE: "morning",
        PROACTIVE_TODAY: "2026-05-14",
        PROACTIVE_NOW: "2026-05-14T08:30:00+08:00",
        PROACTIVE_COMMIT: "1",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Delivery: dry-run");
    expect(result.stdout + result.stderr).not.toContain("push-weixin-calendar.mjs");
  });

  it("CLI fails closed when real WeChat send is requested without target and account", () => {
    const result = spawnSync("npm", ["run", "live:proactive-briefing"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PROACTIVE_MODE: "morning",
        PROACTIVE_TODAY: "2026-05-14",
        PROACTIVE_NOW: "2026-05-14T08:30:00+08:00",
        PROACTIVE_DELIVERY_MODE: "wechat",
        LIVE_PROACTIVE_ENABLE_WECHAT_SEND: "1",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("缺少 PROACTIVE_WECHAT_TARGET 或 PROACTIVE_WECHAT_ACCOUNT_ID");
    expect(result.stdout + result.stderr).not.toContain("WECHAT_ENTRY_SECRET");
  });

  it("CLI fails closed when real WeChat send is requested without the explicit enable gate", () => {
    const result = spawnSync("npm", ["run", "live:proactive-briefing"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PROACTIVE_MODE: "morning",
        PROACTIVE_TODAY: "2026-05-14",
        PROACTIVE_NOW: "2026-05-14T08:30:00+08:00",
        PROACTIVE_DELIVERY_MODE: "wechat",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("缺少 LIVE_PROACTIVE_ENABLE_WECHAT_SEND=1");
    expect(result.stdout + result.stderr).not.toContain("WECHAT_ENTRY_SECRET");
  });
});

function createCalendar(events: Array<{ id: string; title: string; start: string }>): DeterministicCalendarAdapter {
  return {
    async createEvent() {
      throw new Error("delivery tests must not create events");
    },
    async listEvents(input) {
      const date = input.date || input.range?.startDate;
      return { ok: true, data: events.filter((event) => !date || event.start.startsWith(date)) };
    },
    async updateEvent() {
      throw new Error("delivery tests must not update events");
    },
    async deleteEvent() {
      throw new Error("delivery tests must not delete events");
    },
  };
}
