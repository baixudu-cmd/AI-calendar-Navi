import { describe, expect, it } from "vitest";
import {
  createImageDraftRequestOptions,
  normalizeImageCalendarDraft,
  parseOcrCalendarDraftWithModel,
} from "../src/image-capture/index.js";

describe("image capture event parser boundary", () => {
  it("accepts a complete calendar draft from image parser output", () => {
    expect(
      normalizeImageCalendarDraft({
        title: "雷达试验交流",
        date: "2026-05-12",
        startTime: "10:00",
        endTime: "10:45",
        location: "腾讯会议 370 310 601",
        notes: "截图识别",
        unsafe: "drop",
      }),
    ).toEqual({
      ok: true,
      draft: {
        title: "雷达试验交流",
        date: "2026-05-12",
        startTime: "10:00",
        endTime: "10:45",
        location: "腾讯会议 370 310 601",
        notes: "截图识别",
      },
    });
  });

  it("fails closed when image parser output misses required fields", () => {
    expect(normalizeImageCalendarDraft({ title: "雷达试验交流" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("没有识别清楚"),
    });
  });

  it("rejects invalid date and time fields", () => {
    expect(
      normalizeImageCalendarDraft({
        title: "雷达试验交流",
        date: "2026年5月12日",
        startTime: "上午10点",
      }),
    ).toMatchObject({ ok: false });
  });

  it("allows either a complete draft or a schema-bound error result from the image model", () => {
    const options = createImageDraftRequestOptions();
    const schema = (options.response_format as any).json_schema.schema;

    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toBeUndefined();
    expect(schema.anyOf).toEqual([{ required: ["title", "date", "startTime"] }, { required: ["error"] }]);
  });

  it("lets the model parse Tencent Meeting card OCR into event fields", async () => {
    const ocrText = [
      "田 简体中文，",
      "人A腾讯会议",
      "10:00",
      "2026年5月12日",
      "Leap Capital",
      "鑫达试验交流",
      "370 310 601",
      "进行中",
      "45 分钟",
      "（GMT+08:00） 中国标⋯",
      "10:45",
      "2026年5月12日",
      "点击添加到会议列表",
      "AI托管",
      "电话入会",
      "小程序入会",
      "加入会议",
    ].join("\n");

    const result = await parseOcrCalendarDraftWithModel(ocrText, {
      model: "calendar-image-parser",
      transport: async ({ messages }) => {
        expect(messages.at(-1)?.content).toContain("10:00");
        expect(messages.at(-1)?.content).toContain("鑫达试验交流");
        return {
          content: JSON.stringify({
            title: "鑫达试验交流",
            date: "2026-05-12",
            startTime: "10:00",
            endTime: "10:45",
            location: "腾讯会议 370 310 601",
            notes: "由图片截图识别生成。",
          }),
        };
      },
    });

    expect(result).toEqual({
      ok: true,
      draft: {
        title: "鑫达试验交流",
        date: "2026-05-12",
        startTime: "10:00",
        endTime: "10:45",
        location: "腾讯会议 370 310 601",
        notes: "由图片截图识别生成。",
      },
      sourceText: ocrText,
    });
  });

  it("asks the image model for schema-bound structured output", async () => {
    let systemPrompt = "";
    const result = await parseOcrCalendarDraftWithModel("2026年5月12日 10:00 至 10:45\n鑫达试验交流", {
      model: "calendar-image-parser",
      transport: async ({ messages }) => {
        systemPrompt = messages[0]?.content || "";
        return {
          content: JSON.stringify({
            title: "鑫达试验交流",
            date: "2026-05-12",
            startTime: "10:00",
            endTime: "10:45",
          }),
        };
      },
    });

    expect(result.ok).toBe(true);
    expect(systemPrompt).toContain("符合 image_calendar_draft schema");
    expect(systemPrompt).not.toContain("只输出 JSON");
  });

  it("fails closed when the image text model returns unusable JSON", async () => {
    const result = await parseOcrCalendarDraftWithModel("只有一些杂乱文字", {
      model: "calendar-image-parser",
      transport: async () => ({ content: JSON.stringify({ error: "missing time" }) }),
    });

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining("没有识别清楚"),
    });
  });
});
