// 结构化输出请求参数：给模型声明日历工具调用外形，实际业务校验仍在本地完成。

const calendarToolCallSchema = {
  type: "object",
  required: ["toolName", "arguments"],
  properties: {
    toolName: { type: "string" },
    arguments: { type: "object" },
  },
};

// 创建 Calendar Tool Call 的 OpenAI-compatible 结构化输出请求参数。
export function createCalendarToolCallRequestOptions(): Record<string, unknown> {
  return {
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "calendar_tool_call",
        schema: calendarToolCallSchema,
      },
    },
  };
}
