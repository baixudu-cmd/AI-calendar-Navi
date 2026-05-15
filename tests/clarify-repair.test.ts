import { describe, expect, it } from "vitest";
import {
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

    expect(missingItems.enum).toEqual(["date", "startTime"]);
    expect(schema.properties.draft.required).toEqual(["title"]);
    expect(JSON.stringify(schema)).not.toContain("error");
    expect(JSON.stringify(schema)).not.toContain("eventType");
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
