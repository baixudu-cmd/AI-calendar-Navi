// 结构化输出请求参数测试：保证模型可见合同只有工具名和参数。

import { describe, expect, it } from "vitest";
import { createCalendarToolCallRequestOptions } from "../src/decision/model/index.js";

describe("calendar tool call structured output", () => {
  it("builds a json schema response format for calendar tool calls", () => {
    const options = createCalendarToolCallRequestOptions();

    expect(options).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "calendar_tool_call",
          schema: {
            type: "object",
            required: ["toolName", "arguments"],
            properties: {
              toolName: { type: "string" },
              arguments: { type: "object" },
            },
          },
        },
      },
    });
  });

  it("keeps execution result fields out of the structured output schema", () => {
    const serialized = JSON.stringify(getCalendarToolCallSchema());

    expect(serialized).not.toContain("event_created");
    expect(serialized).not.toContain("success");
    expect(serialized).not.toContain("status");
    expect(serialized).not.toContain("message");
  });
});

function getCalendarToolCallSchema(): any {
  const options = createCalendarToolCallRequestOptions() as any;
  return options.response_format.json_schema.schema;
}
