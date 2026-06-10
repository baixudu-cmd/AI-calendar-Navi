import { describe, expect, it } from "vitest";
import { buildModelDecisionMessages, createModelDecisionClient } from "../src/decision/index.js";
import { createShortTermStateStore } from "../src/state/index.js";

describe("model decision client", () => {
  it("builds a prompt with toolName, arguments, and schema-bound instruction", () => {
    const messages = buildModelDecisionMessages({
      text: "明天下午三点见张总",
      state: createShortTermStateStore().snapshot(),
      now: "2026-05-09T07:30:00+08:00",
      timezone: "Asia/Shanghai",
    });

    const systemPrompt = messages[0]?.content || "";
    const userPrompt = messages[1]?.content || "";

    expect(systemPrompt).toContain("toolName");
    expect(systemPrompt).toContain("arguments");
    expect(systemPrompt).toContain("calendar.create_event");
    expect(systemPrompt).toContain("calendar.create_recurring_event");
    expect(systemPrompt).toContain("calendar.create_reminder");
    expect(systemPrompt).toContain("calendar.create_events");
    expect(systemPrompt).toContain("calendar.list_events");
    expect(systemPrompt).toContain("calendar.update_event");
    expect(systemPrompt).toContain("calendar.update_and_create_events");
    expect(systemPrompt).toContain("calendar.propose_schedule");
    expect(systemPrompt).toContain("calendar.confirm_schedule");
    expect(systemPrompt).toContain("assistant.remember_todo");
    expect(systemPrompt).toContain("assistant.manage_todos");
    expect(systemPrompt).toContain("calendar.delete_event");
    expect(systemPrompt).toContain("calendar.confirm_delete");
    expect(systemPrompt).toContain("calendar.confirm_create");
    expect(systemPrompt).toContain("calendar.daily_briefing");
    expect(systemPrompt).toContain("assistant.dismiss_context");
    expect(systemPrompt).toContain("assistant.clarify");
    expect(systemPrompt).toContain("符合 calendar_tool_call schema");
    expect(systemPrompt).not.toContain("只输出 JSON");
    expect(systemPrompt).toContain('"toolName":"calendar.create_event"');
    expect(systemPrompt).toContain('"toolName":"calendar.create_recurring_event"');
    expect(systemPrompt).toContain('"recurrence":{"frequency":"weekly","byWeekday":["MO"]}');
    expect(systemPrompt).toContain("以后每天早上8点提醒我吃药");
    expect(systemPrompt).toContain('"reminderAtStart":true');
    expect(systemPrompt).toContain("不要输出 RRULE");
    expect(systemPrompt).toContain('"toolName":"calendar.create_reminder"');
    expect(systemPrompt).toContain('"toolName":"calendar.create_events"');
    expect(systemPrompt).toContain('"arguments"');
    expect(systemPrompt).toContain("不要自创 event_created、status、message、success");
    expect(systemPrompt).toContain("今晚=今天晚上");
    expect(systemPrompt).toContain("重复出现同一个周几时，不能自动顺延成下一天");
    expect(systemPrompt).toContain("晚上帮我复盘明天安排");
    expect(systemPrompt).toContain("明天工作台");
    expect(systemPrompt).toContain('"toolName":"calendar.daily_briefing","arguments":{"briefingType":"morning","date":"2026-05-10"}');
    expect(systemPrompt).toContain('"toolName":"calendar.confirm_delete"');
    expect(systemPrompt).toContain('"toolName":"calendar.confirm_create"');
    expect(systemPrompt).toContain('"toolName":"calendar.propose_schedule"');
    expect(systemPrompt).toContain('"toolName":"assistant.manage_todos"');
    expect(systemPrompt).toContain("我还有哪些待推进");
    expect(systemPrompt).toContain("拿币那个完成了");
    expect(systemPrompt).toContain('"itemNumbers":[1,3]');
    expect(systemPrompt).toContain("把第一个和第三个安排一下");
    expect(systemPrompt).toContain("reminderAt");
    expect(systemPrompt).toContain("reminderMinutes 可以是数组");
    expect(systemPrompt).toContain("不要再用 assistant.remember_todo 重复记录");
    expect(systemPrompt).toContain('"sourceIds":["seed_1"]');
    expect(systemPrompt).toContain("state.pending_schedule");
    expect(systemPrompt).toContain("optionCount");
    expect(systemPrompt).toContain("preferredWindow");
    expect(systemPrompt).toContain("选第二个");
    expect(systemPrompt).toContain("pending_conflict.action");
    expect(systemPrompt).toContain('"toolName":"assistant.dismiss_context"');
    expect(systemPrompt).toContain("OK");
    expect(systemPrompt).toContain("先不删");
    expect(systemPrompt).toContain("日报条目删除示例");
    expect(systemPrompt).toContain('"target":{"kind":"briefing_item","itemNumber":1}');
    expect(systemPrompt).toContain('"toolName":"calendar.update_and_create_events"');
    expect(systemPrompt).toContain("先修改已有日程，再创建新日程");
    expect(userPrompt).toContain('"currentDate":"2026-05-09"');
    expect(userPrompt).toContain('"timezone":"Asia/Shanghai"');
  });

  it("builds currentDate from the configured timezone instead of UTC slicing", () => {
    const messages = buildModelDecisionMessages({
      text: "周一上午九点投委会",
      state: createShortTermStateStore().snapshot(),
      now: "2026-05-10T16:30:00.000Z",
      timezone: "Asia/Shanghai",
    });

    expect(messages[1]?.content || "").toContain('"currentDate":"2026-05-11"');
  });

  it("calls transport and parses tool-call JSON content into an internal action", async () => {
    const calls: unknown[] = [];
    const client = createModelDecisionClient({
      model: "fake-model",
      transport: async (input) => {
        calls.push(input);
        return {
          content: JSON.stringify({
            toolName: "calendar.list_events",
            arguments: { date: "2026-05-09" },
          }),
        };
      },
    });

    const result = await client.decide({
      text: "看看明天日程",
      state: createShortTermStateStore().snapshot(),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: "fake-model",
      messages: expect.any(Array),
    });
    expect(result).toEqual({ type: "list_events", date: "2026-05-09" });
  });

  it("retries once when a created event is not backed by source time evidence", async () => {
    const calls: unknown[] = [];
    const outputs = [
      JSON.stringify({
        toolName: "calendar.create_event",
        arguments: {
          title: "处理拿币",
          date: "2026-05-08",
          startTime: "09:00",
          startTimeEvidence: "09:00",
        },
      }),
      JSON.stringify({
        toolName: "calendar.propose_schedule",
        arguments: { date: "2026-05-09", contextRef: "pending_schedule" },
      }),
    ];
    const client = createModelDecisionClient({
      model: "fake-model",
      transport: async (input) => {
        calls.push(input);
        return { content: outputs.shift() || outputs[0] };
      },
    });

    const result = await client.decide({
      text: "今天太满，明天吧",
      state: createShortTermStateStore({
        pending_schedule: {
          date: "2026-05-08",
          options: [
            {
              optionNumber: 1,
              items: [
                { itemNumber: 1, title: "处理拿币", date: "2026-05-08", startTime: "09:00", durationMinutes: 60 },
              ],
            },
          ],
        },
      }).snapshot(),
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      model: "fake-model",
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("工具合同"),
        }),
      ]),
    });
    expect(result).toEqual({ type: "propose_schedule", date: "2026-05-09", items: [], contextRef: "pending_schedule" });
  });

  it("parses batch create tool calls into an internal action", async () => {
    const client = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          toolName: "calendar.create_events",
          arguments: {
            events: [
              { title: "投委会", date: "2026-05-12", startTime: "09:00", startTimeEvidence: "9点" },
              { title: "客户电话", date: "2026-05-12", startTime: "14:00", startTimeEvidence: "下午2点" },
            ],
          },
        }),
      }),
    });

    await expect(
      client.decide({
        text: "明天9点投委会，下午2点客户电话，都帮我记一下",
        state: createShortTermStateStore().snapshot(),
      }),
    ).resolves.toEqual({
      type: "create_events",
      events: [
        { title: "投委会", date: "2026-05-12", startTime: "09:00" },
        { title: "客户电话", date: "2026-05-12", startTime: "14:00" },
      ],
    });
  });

  it("rejects legacy action JSON from the model client", async () => {
    const client = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          action: "create_event",
          event: { title: "见张总", date: "2026-05-09", startTime: "15:00" },
        }),
      }),
    });

    const result = await client.decide({
      text: "明天下午三点见张总",
      state: createShortTermStateStore().snapshot(),
    });

    expect(result).toMatchObject({
      action: "__tool_schema_rejected__",
      reason: "malformed_tool_call",
    });
  });

  it("parses delete request and confirmation tool calls into internal actions", async () => {
    const deleteClient = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          toolName: "calendar.delete_event",
          arguments: { target: { kind: "last_event" } },
        }),
      }),
    });

    await expect(deleteClient.decide({
      text: "删掉刚才那个",
      state: createShortTermStateStore().snapshot(),
    })).resolves.toEqual({ type: "request_delete_event", target: { kind: "last_event", eventId: "" } });

    const confirmClient = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          toolName: "calendar.confirm_delete",
          arguments: { confirmed: true },
        }),
      }),
    });

    await expect(confirmClient.decide({
      text: "确认删除",
      state: createShortTermStateStore({
        pending_delete: { eventId: "evt_1", title: "见张总", source: "last_event" },
      }).snapshot(),
    })).resolves.toEqual({ type: "confirm_delete", confirmed: true });
  });

  it("parses selected pending delete item numbers from model tool calls", async () => {
    const client = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          toolName: "calendar.confirm_delete",
          arguments: { confirmed: true, itemNumbers: [1] },
        }),
      }),
    });

    await expect(client.decide({
      text: "只删第一个",
      state: createShortTermStateStore({
        pending_delete: {
          source: "date_query",
          title: "2026年5月12日 星期二的 2 个日程",
          eventIds: ["evt_1", "evt_2"],
          items: [
            { eventId: "evt_1", title: "投委会" },
            { eventId: "evt_2", title: "基石" },
          ],
        },
      } as never).snapshot(),
    })).resolves.toEqual({ type: "confirm_delete", confirmed: true, itemNumbers: [1] });
  });

  it("parses pending create confirmation tool calls into internal actions", async () => {
    const client = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          toolName: "calendar.confirm_create",
          arguments: { confirmed: true },
        }),
      }),
    });

    await expect(client.decide({
      text: "OK",
      state: createShortTermStateStore({
        pending_conflict: {
          action: { type: "create_event", event: { title: "见张总", date: "2026-05-09", startTime: "15:00" } },
          conflicts: [{ existingEventId: "evt_1", title: "已有电话会", start: "2026-05-09 15:00" }],
        },
      }).snapshot(),
    })).resolves.toEqual({ type: "confirm_create", confirmed: true });
  });

  it("parses dismiss context tool calls into an internal action", async () => {
    const client = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({
        content: JSON.stringify({
          toolName: "assistant.dismiss_context",
          arguments: {},
        }),
      }),
    });

    await expect(client.decide({
      text: "算了，先不管了",
      state: createShortTermStateStore({
        pending_clarification: {
          question: "这个日程几点开始？",
          missing: ["startTime"],
          createDraft: { title: "约张总", date: "2026-05-16" },
        },
      }).snapshot(),
    })).resolves.toEqual({ type: "dismiss_context" });
  });

  it("returns malformed shape when content is not a parseable tool call", async () => {
    const client = createModelDecisionClient({
      model: "fake-model",
      transport: async () => ({ content: "不是 JSON" }),
    });

    const result = await client.decide({
      text: "明天有什么",
      state: createShortTermStateStore().snapshot(),
    });

    expect(result).toEqual({
      action: "__malformed_model_output__",
      error: "模型输出不是可解析的工具调用。",
    });
  });
});
