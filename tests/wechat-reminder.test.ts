// P9 微信提醒任务测试：只验证本地提醒队列、CLI 和发送闸门，不扫飞书日历。

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createInjectedProactiveDelivery } from "../src/live/proactive-delivery.js";
import {
  DEFAULT_WECHAT_REMINDER_LEAD_MINUTES,
  buildWechatReminderJobs,
  createMemoryWechatReminderStore,
  dispatchDueWechatReminders,
  inspectWechatReminderStatus,
} from "../src/wechat-reminder/index.js";

describe("WeChat reminder queue", () => {
  it("uses one 40-minute default reminder to avoid repeated reminders", () => {
    expect(DEFAULT_WECHAT_REMINDER_LEAD_MINUTES).toEqual([40]);
    expect(buildWechatReminderJobs({ id: "evt_default", title: "投委会", start: "2026-05-09 15:00" }, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES)).toEqual([
      {
        jobId: "wechat-reminder:evt_default:2026-05-09 15:00:40",
        eventId: "evt_default",
        title: "投委会",
        start: "2026-05-09 15:00",
        leadMinutes: 40,
        dueAt: "2026-05-09T06:20:00.000Z",
        status: "pending",
      },
    ]);
  });

  it("uses explicit reminder leads while keeping 40 minutes as the default", () => {
    expect(
      buildWechatReminderJobs(
        { id: "evt_1", title: "投委会", start: "2026-05-09 15:00" },
        [120, 40],
        { leadSource: "explicit" },
      ),
    ).toEqual([
      {
        jobId: "wechat-reminder:evt_1:2026-05-09 15:00:120",
        eventId: "evt_1",
        title: "投委会",
        start: "2026-05-09 15:00",
        leadMinutes: 120,
        leadSource: "explicit",
        dueAt: "2026-05-09T05:00:00.000Z",
        status: "pending",
      },
      {
        jobId: "wechat-reminder:evt_1:2026-05-09 15:00:40",
        eventId: "evt_1",
        title: "投委会",
        start: "2026-05-09 15:00",
        leadMinutes: 40,
        dueAt: "2026-05-09T06:20:00.000Z",
        status: "pending",
      },
    ]);
  });

  it("skips reminder jobs when the user explicitly asks for no reminder", () => {
    expect(buildWechatReminderJobs({ id: "evt_no", title: "不用提醒", start: "2026-05-09 15:00" }, [0])).toEqual([]);
  });

  it("can create an at-time reminder job without changing the no-reminder meaning of zero", () => {
    expect(
      buildWechatReminderJobs(
        { id: "evt_at_start", title: "1011 的 TS", start: "2026-05-09 08:00" },
        DEFAULT_WECHAT_REMINDER_LEAD_MINUTES,
        { leadSource: "at_start" },
      ),
    ).toEqual([
      {
        jobId: "wechat-reminder:evt_at_start:2026-05-09 08:00:0",
        eventId: "evt_at_start",
        title: "1011 的 TS",
        start: "2026-05-09 08:00",
        leadMinutes: 0,
        leadSource: "at_start",
        dueAt: "2026-05-09T00:00:00.000Z",
        status: "pending",
      },
    ]);
  });

  it("drops old non-40-minute queued jobs that were created before explicit reminder support", async () => {
    const store = createMemoryWechatReminderStore([
      {
        jobId: "wechat-reminder:old_evt:2026-05-09 15:00:30",
        eventId: "old_evt",
        title: "旧提醒",
        start: "2026-05-09 15:00",
        leadMinutes: 30,
        dueAt: "2026-05-09T06:30:00.000Z",
        status: "pending",
      },
    ]);

    await expect(store.list()).resolves.toEqual([]);
  });

  it("dispatches only due unsent jobs and marks them sent after WeChat delivery succeeds", async () => {
    const store = createMemoryWechatReminderStore([
      ...buildWechatReminderJobs({ id: "evt_1", title: "投委会", start: "2026-05-09 15:00" }, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES),
      ...buildWechatReminderJobs({ id: "evt_2", title: "客户电话", start: "2026-05-09 16:00" }, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES),
    ]);
    const delivered: string[] = [];
    const delivery = createInjectedProactiveDelivery(async (input) => {
      delivered.push(input.message);
      return { ok: true, mode: "wechat", message: "sent" };
    });

    const result = await dispatchDueWechatReminders({
      store,
      delivery,
      now: "2026-05-09T06:35:00.000Z",
    });

    expect(result).toEqual({ ok: true, sent: 1, failed: 0 });
    expect(delivered).toEqual(["微信提醒｜还有 40 分钟\n2026年5月9日 星期六 15:00 投委会"]);
    await expect(store.list()).resolves.toMatchObject([
      { jobId: "wechat-reminder:evt_1:2026-05-09 15:00:40", status: "sent" },
      { jobId: "wechat-reminder:evt_2:2026-05-09 16:00:40", status: "pending" },
    ]);
  });

  it("keeps failed due jobs visible and unsent after WeChat delivery fails", async () => {
    const store = createMemoryWechatReminderStore([
      ...buildWechatReminderJobs({ id: "evt_failed", title: "投委会", start: "2026-05-09 15:00" }, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES),
    ]);
    const delivery = createInjectedProactiveDelivery(async () => ({
      ok: false,
      mode: "wechat",
      message: "network unavailable",
    }));

    const result = await dispatchDueWechatReminders({
      store,
      delivery,
      now: "2026-05-09T06:35:00.000Z",
    });

    expect(result).toEqual({ ok: false, sent: 0, failed: 1 });
    await expect(store.list()).resolves.toMatchObject([
      {
        jobId: "wechat-reminder:evt_failed:2026-05-09 15:00:40",
        status: "failed",
        lastError: "network unavailable",
        lastAttemptAt: "2026-05-09T06:35:00.000Z",
      },
    ]);
  });

  it("summarizes queue status without reading Feishu calendar", async () => {
    const store = createMemoryWechatReminderStore([
      { ...buildWechatReminderJobs({ id: "evt_due", title: "投委会", start: "2026-05-09 15:00" }, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES)[0] },
      { ...buildWechatReminderJobs({ id: "evt_later", title: "客户电话", start: "2026-05-09 16:00" }, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES)[0] },
      { ...buildWechatReminderJobs({ id: "evt_sent", title: "已提醒", start: "2026-05-09 17:00" }, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES)[0], status: "sent" },
      {
        ...buildWechatReminderJobs({ id: "evt_failed", title: "失败提醒", start: "2026-05-09 18:00" }, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES)[0],
        status: "failed",
        lastError: "wechat failed",
        lastAttemptAt: "2026-05-09T09:20:00.000Z",
      },
    ]);

    await expect(inspectWechatReminderStatus({ store, now: "2026-05-09T06:35:00.000Z" })).resolves.toEqual({
      ok: true,
      total: 4,
      pending: 2,
      due: 1,
      sent: 1,
      failed: 1,
      nextDueAt: "2026-05-09T06:20:00.000Z",
      failedJobs: [
        {
          jobId: "wechat-reminder:evt_failed:2026-05-09 18:00:40",
          title: "失败提醒",
          dueAt: "2026-05-09T09:20:00.000Z",
          lastError: "wechat failed",
          lastAttemptAt: "2026-05-09T09:20:00.000Z",
        },
      ],
    });
  });

  it("runs the dispatcher CLI in dry-run mode without reading Feishu calendar", () => {
    const root = join(tmpdir(), `wechat-reminder-${Date.now()}`);
    const stateFile = join(root, "state", "wechat-reminders.json");
    mkdirSync(join(root, "state"), { recursive: true });
    writeFileSync(
      stateFile,
      JSON.stringify(
        {
          jobs: buildWechatReminderJobs({ id: "evt_cli", title: "投委会", start: "2026-05-09 15:00" }, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES),
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = spawnSync("npm", ["run", "live:wechat-reminder-dispatcher"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WECHAT_REMINDER_STATE_FILE: stateFile,
        WECHAT_REMINDER_NOW: "2026-05-09T06:35:00.000Z",
      },
      encoding: "utf8",
    });

    rmSync(root, { recursive: true, force: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("WeChat reminder dispatcher: ok");
    expect(result.stdout).toContain("sent=1");
    expect(result.stdout).toContain("mode=dry-run");
    expect(result.stdout).toContain("pending=0");
    expect(result.stdout).toContain("storedFailed=0");
    expect(result.stdout + result.stderr).not.toContain("FEISHU");
  });

  it("prints queue status without requiring WeChat delivery env", () => {
    const root = join(tmpdir(), `wechat-reminder-status-${Date.now()}`);
    const stateFile = join(root, "state", "wechat-reminders.json");
    mkdirSync(join(root, "state"), { recursive: true });
    writeFileSync(
      stateFile,
      JSON.stringify(
        {
          jobs: buildWechatReminderJobs({ id: "evt_status", title: "状态检查", start: "2026-05-09 15:00" }, DEFAULT_WECHAT_REMINDER_LEAD_MINUTES),
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = spawnSync("npm", ["run", "live:wechat-reminder-dispatcher"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WECHAT_REMINDER_MODE: "status",
        WECHAT_REMINDER_STATE_FILE: stateFile,
        WECHAT_REMINDER_NOW: "2026-05-09T06:35:00.000Z",
        PROACTIVE_DELIVERY_MODE: "wechat",
      },
      encoding: "utf8",
    });

    rmSync(root, { recursive: true, force: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("WeChat reminder status: ok");
    expect(result.stdout).toContain("mode=status");
    expect(result.stdout).toContain("pending=1");
    expect(result.stdout).toContain("due=1");
    expect(result.stdout + result.stderr).not.toContain("FEISHU");
    expect(result.stdout + result.stderr).not.toContain("缺少 LIVE_PROACTIVE_ENABLE_WECHAT_SEND");
  });
});
