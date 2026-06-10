// 结构化输出请求参数测试：保证模型可见合同只有工具名和参数。

import { describe, expect, it } from "vitest";
import { createCalendarToolCallRequestOptions } from "../src/decision/model/index.js";
import { TOOL_NAMES } from "../src/tool-contract/index.js";

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
              additionalProperties: false,
              properties: {
                toolName: { type: "string", enum: TOOL_NAMES },
                arguments: { type: "object" },
              },
          },
        },
      },
    });
  });

  it("keeps execution result fields out of the structured output schema", () => {
    const schema = getCalendarToolCallSchema();
    const executionResultFields = ["event_created", "success", "status", "message"];

    for (const field of executionResultFields) {
      expect(schema.required).not.toContain(field);
      expect(Object.keys(schema.properties)).not.toContain(field);
    }
  });

  it("keeps toolName bound to the model-visible tool registry", () => {
    const schema = getCalendarToolCallSchema();

    expect(schema.properties.toolName.enum).toEqual(TOOL_NAMES);
  });
});

function getCalendarToolCallSchema(): any {
  const options = createCalendarToolCallRequestOptions() as any;
  return options.response_format.json_schema.schema;
}
