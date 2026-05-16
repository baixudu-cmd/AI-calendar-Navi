// 工具合同测试：约束模型可见工具 Schema 和运行时校验边界。

import { describe, expect, it } from "vitest";
import { TOOL_SCHEMAS, TOOL_NAMES, toolCallToCalendarAction, validateToolCall } from "../src/tool-contract/index.js";

const EXECUTION_RESULT_FIELDS = ["status", "message", "event_created", "success"];

describe("tool-contract schema registry", () => {
  it("exposes exactly the model-visible thin calendar tools", () => {
    expect(TOOL_NAMES).toEqual([
      "calendar.create_event",
      "calendar.create_reminder",
      "calendar.create_events",
      "calendar.create_and_propose_schedule",
      "calendar.list_events",
      "calendar.update_event",
      "calendar.propose_schedule",
      "calendar.confirm_schedule",
      "assistant.remember_todo",
      "assistant.manage_todos",
      "calendar.delete_event",
      "calendar.delete_events",
      "calendar.confirm_delete",
      "calendar.confirm_create",
      "calendar.daily_briefing",
      "assistant.settings_summary",
      "assistant.status_overview",
      "assistant.dismiss_context",
      "assistant.clarify",
    ]);
    expect(Object.keys(TOOL_SCHEMAS)).toEqual(TOOL_NAMES);
  });

  it("keeps schemas parameter-only without execution result fields", () => {
    for (const schema of Object.values(TOOL_SCHEMAS)) {
      const serialized = JSON.stringify(schema);

      for (const field of EXECUTION_RESULT_FIELDS) {
        expect(serialized).not.toContain(`"${field}"`);
      }
    }
  });

  it("declares required fields for create, update, and delete", () => {
    expect(TOOL_SCHEMAS["calendar.create_event"].parameters.required).toEqual(["title", "date", "startTime"]);
    expect(TOOL_SCHEMAS["calendar.create_reminder"].parameters.required).toEqual(["title", "date", "startTime"]);
    expect(TOOL_SCHEMAS["calendar.create_events"].parameters.required).toEqual(["events"]);
    expect(TOOL_SCHEMAS["calendar.create_and_propose_schedule"].parameters.required).toEqual(["events", "items"]);
    expect(TOOL_SCHEMAS["calendar.update_event"].parameters.required).toEqual(["target", "patch"]);
    expect(TOOL_SCHEMAS["calendar.propose_schedule"].parameters.required).toEqual([]);
    expect(TOOL_SCHEMAS["calendar.confirm_schedule"].parameters.required).toEqual(["confirmed"]);
    expect(TOOL_SCHEMAS["assistant.remember_todo"].parameters.required).toEqual(["title"]);
    expect(TOOL_SCHEMAS["assistant.manage_todos"].parameters.required).toEqual(["operation"]);
    expect(TOOL_SCHEMAS["calendar.delete_event"].parameters.required).toEqual(["target"]);
    expect(TOOL_SCHEMAS["calendar.delete_events"].parameters.required).toEqual(["query"]);
    expect(TOOL_SCHEMAS["calendar.confirm_delete"].parameters.required).toEqual(["confirmed"]);
    expect(TOOL_SCHEMAS["calendar.confirm_create"].parameters.required).toEqual(["confirmed"]);
    expect(TOOL_SCHEMAS["assistant.settings_summary"].parameters.required).toEqual([]);
    expect(TOOL_SCHEMAS["assistant.status_overview"].parameters.required).toEqual([]);
    expect(TOOL_SCHEMAS["assistant.dismiss_context"].parameters.required).toEqual([]);
  });

  it("exposes a read-only settings summary tool with topic narrowing", () => {
    expect(TOOL_SCHEMAS["assistant.settings_summary"].parameters.properties.topic).toEqual({
      type: "string",
      enum: ["all", "reminder", "calendar", "model", "memory", "runtime"],
    });
  });

  it("accepts a read-only status overview tool for current unfinished context", () => {
    const result = validateToolCall({
      toolName: "assistant.status_overview",
      arguments: {},
    });

    expect(result).toEqual({
      ok: true,
      call: { toolName: "assistant.status_overview", arguments: {} },
    });
    if (result.ok) {
      expect(toolCallToCalendarAction(result.call)).toEqual({ type: "status_overview" });
    }
  });

  it("accepts a dismiss context tool that clears pending state without calendar parameters", () => {
    const result = validateToolCall({
      toolName: "assistant.dismiss_context",
      arguments: {},
    });

    expect(result).toEqual({
      ok: true,
      call: { toolName: "assistant.dismiss_context", arguments: {} },
    });
    if (result.ok) {
      expect(toolCallToCalendarAction(result.call)).toEqual({ type: "dismiss_context" });
    }
  });

  it("exposes pending schedule continuation as a model-visible propose_schedule argument", () => {
    expect(TOOL_SCHEMAS["calendar.propose_schedule"].parameters.properties.contextRef).toEqual({
      type: "string",
      enum: ["pending_schedule"],
    });
  });

  it("exposes source time evidence for model-visible create tools", () => {
    expect(TOOL_SCHEMAS["calendar.create_event"].parameters.properties.startTimeEvidence).toEqual({ type: "string" });
    expect(TOOL_SCHEMAS["calendar.create_reminder"].parameters.properties.startTimeEvidence).toEqual({ type: "string" });
    const batchEventSchema = TOOL_SCHEMAS["calendar.create_events"].parameters.properties.events as {
      items: { properties: Record<string, unknown> };
    };
    const mixedEventSchema = TOOL_SCHEMAS["calendar.create_and_propose_schedule"].parameters.properties.events as {
      items: { properties: Record<string, unknown> };
    };

    expect(batchEventSchema.items.properties.startTimeEvidence).toEqual({ type: "string" });
    expect(mixedEventSchema.items.properties.startTimeEvidence).toEqual({ type: "string" });
  });
});

describe("validateToolCall", () => {
  it("rejects unknown and malformed tool calls", () => {
    expect(validateToolCall({ toolName: "calendar.clear_all", arguments: {} })).toMatchObject({
      ok: false,
      reason: "unknown_tool",
    });

    expect(validateToolCall({ toolName: "calendar.create_event" })).toMatchObject({
      ok: false,
      reason: "malformed_tool_call",
    });
  });

  it("rejects missing create arguments before execution", () => {
    expect(
      validateToolCall({
        toolName: "calendar.create_event",
        arguments: { title: "见张总", date: "2026-05-09" },
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing_arguments",
    });
  });

  it("accepts an explicit at-time reminder as a calendar create action", () => {
    const result = validateToolCall(
      {
        toolName: "calendar.create_reminder",
        arguments: {
          title: "1011 的 TS",
          date: "2026-05-16",
          startTime: "08:00",
          startTimeEvidence: "上午8点",
          sourceIds: ["seed_1"],
        },
      },
      { sourceText: "明天上午8点提醒我一下1011的TS" },
    );

    expect(result).toEqual({
      ok: true,
      call: {
        toolName: "calendar.create_reminder",
        arguments: {
          title: "1011 的 TS",
          date: "2026-05-16",
          startTime: "08:00",
          sourceIds: ["seed_1"],
          reminderAtStart: true,
        },
      },
    });
    if (result.ok) {
      expect(toolCallToCalendarAction(result.call)).toEqual({
        type: "create_event",
        event: {
          title: "1011 的 TS",
          date: "2026-05-16",
          startTime: "08:00",
          sourceIds: ["seed_1"],
          reminderAtStart: true,
        },
      });
    }
  });

  it("accepts an inbox-backed reminder without repeating source time evidence", () => {
    const result = validateToolCall(
      {
        toolName: "calendar.create_reminder",
        arguments: {
          title: "订1011的PS",
          date: "2026-05-16",
          startTime: "08:00",
          sourceIds: ["seed_1"],
        },
      },
      { sourceText: "把第一个提醒转成日程，到时候提醒我" },
    );

    expect(result).toEqual({
      ok: true,
      call: {
        toolName: "calendar.create_reminder",
        arguments: {
          title: "订1011的PS",
          date: "2026-05-16",
          startTime: "08:00",
          sourceIds: ["seed_1"],
          reminderAtStart: true,
        },
      },
    });
  });

  it("rejects invalid date and time arguments", () => {
    expect(
      validateToolCall({
        toolName: "calendar.create_event",
        arguments: { title: "见张总", date: "2026-02-30", startTime: "10:00" },
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid_arguments",
    });

    expect(
      validateToolCall({
        toolName: "calendar.create_event",
        arguments: { title: "见张总", date: "2026-05-09", startTime: "24:00" },
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid_arguments",
    });
  });

  it("accepts valid create and keeps only normalized arguments", () => {
    expect(
      validateToolCall({
        toolName: "calendar.create_event",
        arguments: {
          title: "见张总",
          date: "2026-05-09",
          startTime: "10:00",
          location: "上海",
          success: true,
        },
      }),
    ).toEqual({
      ok: true,
      call: {
        toolName: "calendar.create_event",
        arguments: { title: "见张总", date: "2026-05-09", startTime: "10:00", location: "上海" },
      },
    });
  });

  it("accepts start time evidence with harmless spacing and full-width differences", () => {
    expect(
      validateToolCall(
        {
          toolName: "calendar.create_event",
          arguments: {
            title: "看材料",
            date: "2026-05-09",
            startTime: "10:00",
            startTimeEvidence: "10点",
          },
        },
        { sourceText: "今天 10 点提醒我看材料" },
      ),
    ).toMatchObject({ ok: true });

    expect(
      validateToolCall(
        {
          toolName: "calendar.create_event",
          arguments: {
            title: "和张总开会",
            date: "2026-05-09",
            startTime: "15:30",
            startTimeEvidence: "3:30",
          },
        },
        { sourceText: "下午３：３０和张总开会" },
      ),
    ).toMatchObject({ ok: true });
  });

  it("still rejects create time evidence that is not present in the user source", () => {
    expect(
      validateToolCall(
        {
          toolName: "calendar.create_event",
          arguments: {
            title: "处理拿币",
            date: "2026-05-09",
            startTime: "09:00",
            startTimeEvidence: "09:00",
          },
        },
        { sourceText: "帮我安排一下明天处理拿币" },
      ),
    ).toMatchObject({
      ok: false,
      reason: "guard_rejected",
    });
  });

  it("accepts canonical start time evidence when the source has equivalent spoken times", () => {
    expect(
      validateToolCall(
        {
          toolName: "calendar.create_events",
          arguments: {
            events: [
              { title: "去牙医", date: "2026-05-18", startTime: "09:00", startTimeEvidence: "09:00" },
              { title: "取快递", date: "2026-05-18", startTime: "14:00", startTimeEvidence: "14:00" },
              { title: "健身", date: "2026-05-18", startTime: "19:00", startTimeEvidence: "19:00" },
            ],
          },
        },
        { sourceText: "后天上午 9 点去牙医，下午 2 点取快递，晚上 7 点健身" },
      ),
    ).toMatchObject({ ok: true });
  });

  it("accepts valid batch create and normalizes each event", () => {
    const result = validateToolCall({
      toolName: "calendar.create_events",
      arguments: {
        events: [
          { title: "投委会", date: "2026-05-12", startTime: "09:00", success: true },
          { title: "客户电话", date: "2026-05-12", startTime: "14:00", location: "线上" },
        ],
      },
    });

    expect(result).toEqual({
      ok: true,
      call: {
        toolName: "calendar.create_events",
        arguments: {
          events: [
            { title: "投委会", date: "2026-05-12", startTime: "09:00" },
            { title: "客户电话", date: "2026-05-12", startTime: "14:00", location: "线上" },
          ],
        },
      },
    });
    if (result.ok) {
      expect(toolCallToCalendarAction(result.call)).toEqual({
        type: "create_events",
        events: [
          { title: "投委会", date: "2026-05-12", startTime: "09:00" },
          { title: "客户电话", date: "2026-05-12", startTime: "14:00", location: "线上" },
        ],
      });
    }
  });

  it("accepts mixed create plus schedule proposal in one model decision", () => {
    const result = validateToolCall({
      toolName: "calendar.create_and_propose_schedule",
      arguments: {
        events: [{ title: "澄澄游泳", date: "2026-05-16", startTime: "10:00", success: true }],
        date: "2026-05-16",
        preferredWindow: "afternoon",
        items: [{ title: "和 hanqi 吃饭以及去奥莱", durationMinutes: 120 }],
      },
    });

    expect(result).toEqual({
      ok: true,
      call: {
        toolName: "calendar.create_and_propose_schedule",
        arguments: {
          events: [{ title: "澄澄游泳", date: "2026-05-16", startTime: "10:00" }],
          date: "2026-05-16",
          preferredWindow: "afternoon",
          items: [{ title: "和 hanqi 吃饭以及去奥莱", durationMinutes: 120 }],
        },
      },
    });
    if (result.ok) {
      expect(toolCallToCalendarAction(result.call)).toEqual({
        type: "create_and_propose_schedule",
        events: [{ title: "澄澄游泳", date: "2026-05-16", startTime: "10:00" }],
        date: "2026-05-16",
        preferredWindow: "afternoon",
        items: [{ title: "和 hanqi 吃饭以及去奥莱", durationMinutes: 120 }],
      });
    }
  });

  it("keeps schedule item source ids so scheduled todos can be completed after creation", () => {
    const result = validateToolCall({
      toolName: "calendar.propose_schedule",
      arguments: {
        date: "2026-05-14",
        items: [{ title: "拿币", sourceIds: ["seed_1"], durationMinutes: 45 }],
      },
    });

    expect(result).toEqual({
      ok: true,
      call: {
        toolName: "calendar.propose_schedule",
        arguments: {
          date: "2026-05-14",
          items: [{ title: "拿币", sourceIds: ["seed_1"], durationMinutes: 45 }],
        },
      },
    });
    if (result.ok) {
      expect(toolCallToCalendarAction(result.call)).toEqual({
        type: "propose_schedule",
        date: "2026-05-14",
        items: [{ title: "拿币", sourceIds: ["seed_1"], durationMinutes: 45 }],
      });
    }
  });

  it("accepts a schedule item that references a visible todo target", () => {
    const result = validateToolCall({
      toolName: "calendar.propose_schedule",
      arguments: {
        date: "2026-05-14",
        items: [{ target: { itemNumber: 1 }, durationMinutes: 45 }],
      },
    });

    expect(result).toEqual({
      ok: true,
      call: {
        toolName: "calendar.propose_schedule",
        arguments: {
          date: "2026-05-14",
          items: [{ target: { itemNumber: 1 }, durationMinutes: 45 }],
        },
      },
    });
    if (result.ok) {
      expect(toolCallToCalendarAction(result.call)).toEqual({
        type: "propose_schedule",
        date: "2026-05-14",
        items: [{ target: { itemNumber: 1 }, durationMinutes: 45 }],
      });
    }
  });

  it("accepts a schedule item that references multiple visible todo targets", () => {
    const result = validateToolCall({
      toolName: "calendar.propose_schedule",
      arguments: {
        date: "2026-05-14",
        items: [{ target: { itemNumbers: [1, 2, 2] }, durationMinutes: 45 }],
      },
    });

    expect(result).toEqual({
      ok: true,
      call: {
        toolName: "calendar.propose_schedule",
        arguments: {
          date: "2026-05-14",
          items: [{ target: { itemNumbers: [1, 2] }, durationMinutes: 45 }],
        },
      },
    });
    if (result.ok) {
      expect(toolCallToCalendarAction(result.call)).toEqual({
        type: "propose_schedule",
        date: "2026-05-14",
        items: [{ target: { itemNumbers: [1, 2] }, durationMinutes: 45 }],
      });
    }
  });

  it("rejects invalid batch create before execution", () => {
    expect(validateToolCall({ toolName: "calendar.create_events", arguments: { events: [] } })).toMatchObject({
      ok: false,
      reason: "invalid_arguments",
    });

    expect(
      validateToolCall({
        toolName: "calendar.create_events",
        arguments: {
          events: [
            { title: "1", date: "2026-05-12", startTime: "09:00" },
            { title: "2", date: "2026-05-12", startTime: "10:00" },
            { title: "3", date: "2026-05-12", startTime: "11:00" },
            { title: "4", date: "2026-05-12", startTime: "12:00" },
            { title: "5", date: "2026-05-12", startTime: "13:00" },
            { title: "6", date: "2026-05-12", startTime: "14:00" },
          ],
        },
      }),
    ).toMatchObject({ ok: false, reason: "invalid_arguments" });

    expect(
      validateToolCall({
        toolName: "calendar.create_events",
        arguments: { events: [{ title: "投委会", date: "2026-05-12" }, { title: "客户电话", date: "2026-05-12", startTime: "14:00" }] },
      }),
    ).toMatchObject({ ok: false, reason: "missing_arguments" });
  });

  it("accepts a time-only last_event update as a tool intent before state resolution", () => {
    expect(
      validateToolCall({
        toolName: "calendar.update_event",
        arguments: { target: { kind: "last_event" }, patch: { startTime: "21:00" } },
      }),
    ).toEqual({
      ok: true,
      call: {
        toolName: "calendar.update_event",
        arguments: { target: { kind: "last_event" }, patch: { startTime: "21:00" } },
      },
    });
  });

  it("accepts schedule proposal and confirmation without event ids", () => {
    const proposal = validateToolCall({
      toolName: "calendar.propose_schedule",
      arguments: { date: "2026-05-12", items: [{ title: "看材料", durationMinutes: 45, success: true }] },
    });

    expect(proposal).toEqual({
      ok: true,
      call: {
        toolName: "calendar.propose_schedule",
        arguments: { date: "2026-05-12", items: [{ title: "看材料", durationMinutes: 45 }] },
      },
    });
    if (proposal.ok) {
      expect(toolCallToCalendarAction(proposal.call)).toEqual({
        type: "propose_schedule",
        date: "2026-05-12",
        items: [{ title: "看材料", durationMinutes: 45 }],
      });
    }

    const confirmation = validateToolCall({
      toolName: "calendar.confirm_schedule",
      arguments: {
        confirmed: true,
        optionNumber: 2,
        itemChanges: [{ itemNumber: 1, startTime: "11:00" }],
      },
    });
    expect(confirmation).toEqual({
      ok: true,
      call: {
        toolName: "calendar.confirm_schedule",
        arguments: { confirmed: true, optionNumber: 2, itemChanges: [{ itemNumber: 1, startTime: "11:00" }] },
      },
    });
    if (confirmation.ok) {
      expect(toolCallToCalendarAction(confirmation.call)).toEqual({
        type: "confirm_schedule",
        confirmed: true,
        optionNumber: 2,
        itemChanges: [{ itemNumber: 1, startTime: "11:00" }],
      });
    }
  });

  it("accepts schedule reproposal preferences without writing confirmation", () => {
    const proposal = validateToolCall({
      toolName: "calendar.propose_schedule",
      arguments: { date: "2026-05-13", preferredStartTime: "14:00", contextRef: "pending_schedule" },
    });

    expect(proposal).toEqual({
      ok: true,
      call: {
        toolName: "calendar.propose_schedule",
        arguments: { date: "2026-05-13", items: [], preferredStartTime: "14:00", contextRef: "pending_schedule" },
      },
    });
    if (proposal.ok) {
      expect(toolCallToCalendarAction(proposal.call)).toEqual({
        type: "propose_schedule",
        date: "2026-05-13",
        items: [],
        preferredStartTime: "14:00",
        contextRef: "pending_schedule",
      });
    }
  });

  it("accepts coarse schedule reproposal windows", () => {
    const proposal = validateToolCall({
      toolName: "calendar.propose_schedule",
      arguments: { date: "2026-05-13", preferredWindow: "afternoon", optionCount: 4, contextRef: "pending_schedule" },
    });

    expect(proposal).toEqual({
      ok: true,
      call: {
        toolName: "calendar.propose_schedule",
        arguments: { date: "2026-05-13", items: [], preferredWindow: "afternoon", optionCount: 4, contextRef: "pending_schedule" },
      },
    });
    if (proposal.ok) {
      expect(toolCallToCalendarAction(proposal.call)).toEqual({
        type: "propose_schedule",
        date: "2026-05-13",
        items: [],
        preferredWindow: "afternoon",
        optionCount: 4,
        contextRef: "pending_schedule",
      });
    }
  });

  it("rejects unknown schedule continuation references", () => {
    expect(
      validateToolCall({
        toolName: "calendar.propose_schedule",
        arguments: { contextRef: "last_event" },
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid_arguments",
    });
  });

  it("accepts a bounded schedule proposal option count", () => {
    const proposal = validateToolCall({
      toolName: "calendar.propose_schedule",
      arguments: { date: "2026-05-13", items: [{ title: "看材料" }], optionCount: 5 },
    });

    expect(proposal).toEqual({
      ok: true,
      call: {
        toolName: "calendar.propose_schedule",
        arguments: { date: "2026-05-13", items: [{ title: "看材料" }], optionCount: 5 },
      },
    });
    if (proposal.ok) {
      expect(toolCallToCalendarAction(proposal.call)).toEqual({
        type: "propose_schedule",
        date: "2026-05-13",
        items: [{ title: "看材料" }],
        optionCount: 5,
      });
    }
  });

  it("rejects out-of-range schedule proposal option counts", () => {
    expect(
      validateToolCall({
        toolName: "calendar.propose_schedule",
        arguments: { date: "2026-05-13", items: [{ title: "看材料" }], optionCount: 6 },
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid_arguments",
    });
  });

  it("rejects invalid schedule reproposal preferences", () => {
    expect(
      validateToolCall({
        toolName: "calendar.propose_schedule",
        arguments: { preferredStartTime: "下午" },
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid_arguments",
    });
    expect(
      validateToolCall({
        toolName: "calendar.propose_schedule",
        arguments: { preferredWindow: "no_morning" },
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid_arguments",
    });
  });

  it("accepts explicit no-reminder values in schedule tools", () => {
    const proposal = validateToolCall({
      toolName: "calendar.propose_schedule",
      arguments: { date: "2026-05-12", items: [{ title: "看材料", reminderMinutes: 0 }] },
    });

    expect(proposal).toEqual({
      ok: true,
      call: {
        toolName: "calendar.propose_schedule",
        arguments: { date: "2026-05-12", items: [{ title: "看材料", reminderMinutes: 0 }] },
      },
    });

    const confirmation = validateToolCall({
      toolName: "calendar.confirm_schedule",
      arguments: { confirmed: true, itemChanges: [{ itemNumber: 1, reminderMinutes: 0 }] },
    });

    expect(confirmation).toEqual({
      ok: true,
      call: {
        toolName: "calendar.confirm_schedule",
        arguments: { confirmed: true, itemChanges: [{ itemNumber: 1, reminderMinutes: 0 }] },
      },
    });
  });

  it("accepts schedule proposal without explicit items for memory candidates", () => {
    const proposal = validateToolCall({
      toolName: "calendar.propose_schedule",
      arguments: { date: "2026-05-12" },
    });

    expect(proposal).toEqual({
      ok: true,
      call: {
        toolName: "calendar.propose_schedule",
        arguments: { date: "2026-05-12", items: [] },
      },
    });
    if (proposal.ok) {
      expect(toolCallToCalendarAction(proposal.call)).toEqual({
        type: "propose_schedule",
        date: "2026-05-12",
        items: [],
      });
    }
  });

  it("accepts auto schedule proposal without an explicit date", () => {
    const proposal = validateToolCall({
      toolName: "calendar.propose_schedule",
      arguments: { autoCreate: true },
    });

    expect(proposal).toEqual({
      ok: true,
      call: {
        toolName: "calendar.propose_schedule",
        arguments: { items: [], autoCreate: true },
      },
    });
    if (proposal.ok) {
      expect(toolCallToCalendarAction(proposal.call)).toEqual({
        type: "propose_schedule",
        items: [],
        autoCreate: true,
      });
    }
  });

  it("accepts remember_todo for natural no-time work items", () => {
    const result = validateToolCall({
      toolName: "assistant.remember_todo",
      arguments: { title: "拿币", date: "2026-05-14", success: true },
    });

    expect(result).toEqual({
      ok: true,
      call: {
        toolName: "assistant.remember_todo",
        arguments: { title: "拿币", autoSchedule: true, date: "2026-05-14" },
      },
    });
    if (result.ok) {
      expect(toolCallToCalendarAction(result.call)).toEqual({
        type: "remember_todo",
        title: "拿币",
        autoSchedule: true,
        date: "2026-05-14",
      });
    }
  });

  it("accepts manage_todos for inbox list, completion, deletion, and update", () => {
    const list = validateToolCall({
      toolName: "assistant.manage_todos",
      arguments: { operation: "list", limit: 3 },
    });
    expect(list).toEqual({
      ok: true,
      call: { toolName: "assistant.manage_todos", arguments: { operation: "list", limit: 3 } },
    });
    if (list.ok) {
      expect(toolCallToCalendarAction(list.call)).toEqual({ type: "manage_todos", operation: "list", limit: 3 });
    }

    const complete = validateToolCall({
      toolName: "assistant.manage_todos",
      arguments: { operation: "complete", target: { title: "拿币" } },
    });
    expect(complete).toEqual({
      ok: true,
      call: { toolName: "assistant.manage_todos", arguments: { operation: "complete", target: { title: "拿币" } } },
    });
    if (complete.ok) {
      expect(toolCallToCalendarAction(complete.call)).toEqual({ type: "manage_todos", operation: "complete", target: { title: "拿币" } });
    }

    const remove = validateToolCall({
      toolName: "assistant.manage_todos",
      arguments: { operation: "delete", target: { itemNumber: 2 } },
    });
    expect(remove).toEqual({
      ok: true,
      call: { toolName: "assistant.manage_todos", arguments: { operation: "delete", target: { itemNumber: 2 } } },
    });

    const batchComplete = validateToolCall({
      toolName: "assistant.manage_todos",
      arguments: { operation: "complete", target: { itemNumbers: [1, 3, 3] } },
    });
    expect(batchComplete).toEqual({
      ok: true,
      call: { toolName: "assistant.manage_todos", arguments: { operation: "complete", target: { itemNumbers: [1, 3] } } },
    });
    if (batchComplete.ok) {
      expect(toolCallToCalendarAction(batchComplete.call)).toEqual({ type: "manage_todos", operation: "complete", target: { itemNumbers: [1, 3] } });
    }

    const update = validateToolCall({
      toolName: "assistant.manage_todos",
      arguments: {
        operation: "update",
        target: { itemNumber: 1 },
        patch: { targetDate: "2026-05-18", title: "拿币资料", reminderAt: "2026-05-18 14:00" },
      },
    });
    expect(update).toEqual({
      ok: true,
      call: {
        toolName: "assistant.manage_todos",
        arguments: {
          operation: "update",
          target: { itemNumber: 1 },
          patch: { targetDate: "2026-05-18", title: "拿币资料", reminderAt: "2026-05-18 14:00" },
        },
      },
    });
    if (update.ok) {
      expect(toolCallToCalendarAction(update.call)).toEqual({
        type: "manage_todos",
        operation: "update",
        target: { itemNumber: 1 },
        patch: { targetDate: "2026-05-18", title: "拿币资料", reminderAt: "2026-05-18 14:00" },
      });
    }

    const clearReminder = validateToolCall({
      toolName: "assistant.manage_todos",
      arguments: {
        operation: "update",
        target: { itemNumber: 2 },
        patch: { clearReminder: true },
      },
    });
    expect(clearReminder).toEqual({
      ok: true,
      call: {
        toolName: "assistant.manage_todos",
        arguments: {
          operation: "update",
          target: { itemNumber: 2 },
          patch: { clearReminder: true },
        },
      },
    });
    if (clearReminder.ok) {
      expect(toolCallToCalendarAction(clearReminder.call)).toEqual({
        type: "manage_todos",
        operation: "update",
        target: { itemNumber: 2 },
        patch: { clearReminder: true },
      });
    }
  });

  it("rejects schedule confirmation that tries to specify an event id", () => {
    expect(
      validateToolCall({
        toolName: "calendar.confirm_schedule",
        arguments: { confirmed: true, optionNumber: 1, eventId: "evt_fake" },
      }),
    ).toMatchObject({ ok: false, reason: "guard_rejected" });
  });

  it("accepts update with explicit event query target", () => {
    const result = validateToolCall({
      toolName: "calendar.update_event",
      arguments: {
        target: { kind: "event_query", date: "2026-05-17", timeWindow: "afternoon", title: "健身" },
        patch: { startTime: "16:00" },
      },
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(toolCallToCalendarAction(result.call)).toEqual({
        type: "update_event",
        target: { kind: "event_query", date: "2026-05-17", timeWindow: "afternoon", title: "健身" },
        patch: { startTime: "16:00" },
      });
    }
  });

  it("accepts update and delete with recent displayed event references", () => {
    const update = validateToolCall({
      toolName: "calendar.update_event",
      arguments: { target: { kind: "recent_event_item", itemNumber: 3 }, patch: { startTime: "16:00" } },
    });

    expect(update).toMatchObject({ ok: true });
    if (update.ok) {
      expect(toolCallToCalendarAction(update.call)).toEqual({
        type: "update_event",
        target: { kind: "recent_event_item", itemNumber: 3 },
        patch: { startTime: "16:00" },
      });
    }

    const deletion = validateToolCall({
      toolName: "calendar.delete_event",
      arguments: { target: { kind: "recent_event_item", itemNumber: 3 } },
    });

    expect(deletion).toMatchObject({ ok: true });
    if (deletion.ok) {
      expect(toolCallToCalendarAction(deletion.call)).toEqual({
        type: "request_delete_event",
        target: { kind: "recent_event_item", itemNumber: 3 },
      });
    }
  });

  it("rejects delete without an explicit local reference", () => {
    expect(
      validateToolCall({
        toolName: "calendar.delete_event",
        arguments: { target: { kind: "free_text", text: "删除明天全部日程" } },
      }),
    ).toMatchObject({
      ok: false,
      reason: "guard_rejected",
    });

    expect(
      validateToolCall({
        toolName: "calendar.delete_event",
        arguments: { target: { kind: "all_events" } },
      }),
    ).toMatchObject({
      ok: false,
      reason: "guard_rejected",
    });
  });

  it("accepts delete with local references or explicit event query shape", () => {
    expect(
      validateToolCall({
        toolName: "calendar.delete_event",
        arguments: { target: { kind: "last_event" } },
      }),
    ).toEqual({
      ok: true,
      call: { toolName: "calendar.delete_event", arguments: { target: { kind: "last_event" } } },
    });

    expect(
      validateToolCall({
        toolName: "calendar.delete_event",
        arguments: { target: { kind: "briefing_item", itemNumber: 2 } },
      }),
    ).toEqual({
      ok: true,
      call: { toolName: "calendar.delete_event", arguments: { target: { kind: "briefing_item", itemNumber: 2 } } },
    });

    const byQuery = validateToolCall({
      toolName: "calendar.delete_event",
      arguments: { target: { kind: "event_query", date: "2026-05-17", startTime: "19:00", title: "健身" } },
    });

    expect(byQuery).toEqual({
      ok: true,
      call: {
        toolName: "calendar.delete_event",
        arguments: { target: { kind: "event_query", date: "2026-05-17", startTime: "19:00", title: "健身" } },
      },
    });
    if (byQuery.ok) {
      expect(toolCallToCalendarAction(byQuery.call)).toEqual({
        type: "request_delete_event",
        target: { kind: "event_query", date: "2026-05-17", startTime: "19:00", title: "健身" },
      });
    }
  });

  it("rejects explicit delete query without enough target fields", () => {
    expect(
      validateToolCall({
        toolName: "calendar.delete_event",
        arguments: { target: { kind: "event_query", date: "2026-05-17" } },
      }),
    ).toMatchObject({ ok: false, reason: "guard_rejected" });

    expect(
      validateToolCall({
        toolName: "calendar.delete_event",
        arguments: { target: { kind: "event_query", startTime: "19:00" } },
      }),
    ).toMatchObject({ ok: false, reason: "guard_rejected" });

    expect(
      validateToolCall({
        toolName: "calendar.delete_event",
        arguments: { target: { kind: "event_query", title: "健身" } },
      }),
    ).toMatchObject({ ok: true });
  });

  it("accepts batch delete only by explicit date or date range query", () => {
    const result = validateToolCall({
      toolName: "calendar.delete_events",
      arguments: { query: { date: "2026-05-12" } },
    });

    expect(result).toEqual({
      ok: true,
      call: { toolName: "calendar.delete_events", arguments: { query: { date: "2026-05-12" } } },
    });
    if (result.ok) {
      expect(toolCallToCalendarAction(result.call)).toEqual({
        type: "request_delete_events",
        query: { date: "2026-05-12" },
      });
    }

    expect(
      validateToolCall({
        toolName: "calendar.delete_events",
        arguments: { query: { range: { startDate: "2026-05-12", endDate: "2026-05-13" } } },
      }),
    ).toMatchObject({ ok: true });

    expect(validateToolCall({ toolName: "calendar.delete_events", arguments: { query: {} } })).toMatchObject({
      ok: false,
      reason: "missing_arguments",
    });

    expect(validateToolCall({ toolName: "calendar.delete_events", arguments: { query: { text: "周二所有日程" } } })).toMatchObject({
      ok: false,
      reason: "missing_arguments",
    });
  });

  it("accepts delete confirmation with optional locked item numbers", () => {
    expect(
      validateToolCall({
        toolName: "calendar.confirm_delete",
        arguments: { confirmed: true },
      }),
    ).toEqual({
      ok: true,
      call: { toolName: "calendar.confirm_delete", arguments: { confirmed: true } },
    });

    const selected = validateToolCall({
      toolName: "calendar.confirm_delete",
      arguments: { confirmed: true, itemNumbers: [1, 2] },
    });
    expect(selected).toEqual({
      ok: true,
      call: { toolName: "calendar.confirm_delete", arguments: { confirmed: true, itemNumbers: [1, 2] } },
    });
    if (selected.ok) {
      expect(toolCallToCalendarAction(selected.call)).toEqual({ type: "confirm_delete", confirmed: true, itemNumbers: [1, 2] });
    }

    expect(
      validateToolCall({
        toolName: "calendar.confirm_delete",
        arguments: { confirmed: "yes" },
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid_arguments",
    });

    expect(
      validateToolCall({
        toolName: "calendar.confirm_delete",
        arguments: { confirmed: true, eventId: "evt_hallucinated" },
      }),
    ).toMatchObject({
      ok: false,
      reason: "guard_rejected",
    });

    expect(
      validateToolCall({
        toolName: "calendar.confirm_delete",
        arguments: { confirmed: true, itemNumbers: [0] },
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid_arguments",
    });
  });

  it("accepts create confirmation without allowing new event data", () => {
    const result = validateToolCall({
      toolName: "calendar.confirm_create",
      arguments: { confirmed: true },
    });

    expect(result).toEqual({
      ok: true,
      call: { toolName: "calendar.confirm_create", arguments: { confirmed: true } },
    });
    if (result.ok) {
      expect(toolCallToCalendarAction(result.call)).toEqual({ type: "confirm_create", confirmed: true });
    }

    expect(
      validateToolCall({
        toolName: "calendar.confirm_create",
        arguments: { confirmed: false },
      }),
    ).toEqual({
      ok: true,
      call: { toolName: "calendar.confirm_create", arguments: { confirmed: false } },
    });

    expect(
      validateToolCall({
        toolName: "calendar.confirm_create",
        arguments: { confirmed: "OK" },
      }),
    ).toMatchObject({ ok: false, reason: "invalid_arguments" });

    expect(
      validateToolCall({
        toolName: "calendar.confirm_create",
        arguments: { confirmed: true, event: { title: "模型新编的日程" } },
      }),
    ).toMatchObject({ ok: false, reason: "guard_rejected" });
  });

  it("accepts clarify with a sanitized create draft for incomplete create follow-up", () => {
    expect(
      validateToolCall({
        toolName: "assistant.clarify",
        arguments: {
          question: "这个日程几点开始？",
          missing: ["startTime"],
          createDraft: { title: "见张总", date: "2026-05-09", success: true },
        },
      }),
    ).toEqual({
      ok: true,
      call: {
        toolName: "assistant.clarify",
        arguments: {
          question: "这个日程几点开始？",
          missing: ["startTime"],
          createDraft: { title: "见张总", date: "2026-05-09" },
        },
      },
    });
  });

  it("accepts settings summary without calendar write parameters", () => {
    const result = validateToolCall({
      toolName: "assistant.settings_summary",
      arguments: { topic: "reminder" },
    });

    expect(result).toEqual({
      ok: true,
      call: { toolName: "assistant.settings_summary", arguments: { topic: "reminder" } },
    });
    if (result.ok) {
      expect(toolCallToCalendarAction(result.call)).toEqual({ type: "settings_summary", topic: "reminder" });
    }

    expect(
      validateToolCall({
        toolName: "assistant.settings_summary",
        arguments: { topic: "secret" },
      }),
    ).toMatchObject({ ok: false, reason: "invalid_arguments" });
  });
});
