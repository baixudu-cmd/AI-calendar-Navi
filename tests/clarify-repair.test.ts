import { describe, expect, it } from "vitest";
import {
  createClarifyEventDraftRepairer,
  createClarifyRepairRequestOptions,
  normalizeClarifyRepairResponse,
} from "../src/clarify-repair/index.js";

describe("clarify repair", () => {
  it("accepts a complete repaired event draft from the structured completion contract", () => {
    const result = normalizeClarifyRepairResponse(JSON.stringify({
      status: "complete",
      event: {
        title: "确认 TS 修改意见",
        date: "2026-05-15",
        startTime: "15:00",
        notes: "都总，这是我们结合群里讨论和杨院反馈修改后的 TS，确认后发给投资人。",
      },
    }));

    expect(result).toEqual({
      ok: true,
      draft: {
        title: "确认 TS 修改意见",
        date: "2026-05-15",
        startTime: "15:00",
        notes: "都总，这是我们结合群里讨论和杨院反馈修改后的 TS，确认后发给投资人。",
      },
    });
  });

  it("does not allow title or type as repair-layer missing fields", () => {
    const options = createClarifyRepairRequestOptions();
    const schema = (options.response_format as any).json_schema.schema;
    const missingItems = schema.properties.missing.items;

    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.event.additionalProperties).toBe(false);
    expect(schema.properties.draft.additionalProperties).toBe(false);
    expect(missingItems.enum).toEqual(["date", "startTime"]);
    expect(schema.properties.draft.required).toEqual(["title"]);
    expect(JSON.stringify(schema)).not.toContain("error");
    expect(JSON.stringify(schema)).not.toContain("eventType");
  });

  it("asks the repair model for schema-bound structured output", async () => {
    let systemPrompt = "";
    const repairer = createClarifyEventDraftRepairer({
      model: "repair-model",
      transport: async ({ messages }) => {
        systemPrompt = messages[0]?.content || "";
        return {
          content: JSON.stringify({
            status: "missing_time",
            missing: ["startTime"],
            question: "这个日程几点开始？",
            draft: { title: "约张总开会", date: "2026-05-15" },
          }),
        };
      },
    });

    await repairer({
      sourceText: "明天约张总开会",
      clarify: { type: "clarify", question: "是什么会议？", missing: ["title"] },
      now: "2026-05-14T10:00:00+08:00",
      timezone: "Asia/Shanghai",
    });

    expect(systemPrompt).toContain("符合 clarify_event_draft_repair schema");
    expect(systemPrompt).not.toContain("只输出 JSON");
  });

  it("keeps necessary clarification only when date or start time is missing", () => {
    const result = normalizeClarifyRepairResponse(JSON.stringify({
      status: "missing_time",
      missing: ["startTime"],
      question: "这个日程几点开始？",
      draft: {
        title: "确认 TS 修改意见",
        date: "2026-05-15",
      },
    }));

    expect(result).toEqual({
      ok: false,
      message: "这个日程几点开始？",
      missing: ["startTime"],
      createDraft: {
        title: "确认 TS 修改意见",
        date: "2026-05-15",
      },
    });
  });

  it("rewrites invalid title-missing repair output into a concise time-only question", () => {
    const result = normalizeClarifyRepairResponse(JSON.stringify({
      status: "missing_time",
      missing: ["title", "startTime"],
      question: "请提供日程的标题和开始时间。",
      draft: {
        title: "确认 TS 修改意见",
        date: "2026-05-15",
      },
    }));

    expect(result).toEqual({
      ok: false,
      message: "这个日程几点开始？",
      missing: ["startTime"],
      createDraft: {
        title: "确认 TS 修改意见",
        date: "2026-05-15",
      },
    });
  });
});
