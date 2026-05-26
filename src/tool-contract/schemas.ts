// 工具 Schema 注册表：只暴露模型可见的工具名和参数形状，不包含执行结果。

export const TOOL_NAMES = [
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
] as const;

export type CalendarToolName = (typeof TOOL_NAMES)[number];
export type ToolName = CalendarToolName;

export type ToolParameterSchema = {
  type: "object";
  required: string[];
  properties: Record<string, unknown>;
};
export type JsonSchemaLike = ToolParameterSchema;

export type ToolSchema = {
  toolName: CalendarToolName;
  description: string;
  parameters: ToolParameterSchema;
};

export const TOOL_SCHEMAS: Record<CalendarToolName, ToolSchema> = {
  "calendar.create_event": {
    toolName: "calendar.create_event",
    description: "创建一个明确日期和开始时间的日程。",
    parameters: {
      type: "object",
      required: ["title", "date", "startTime"],
      properties: {
        title: { type: "string" },
        date: { type: "string", format: "date" },
        startTime: { type: "string", format: "time" },
        startTimeEvidence: { type: "string" },
        endTime: { type: "string", format: "time" },
        location: { type: "string" },
        reminderMinutes: { anyOf: [{ type: "number" }, { type: "array", items: { type: "number" }, maxItems: 3 }] },
        sourceIds: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
      },
    },
  },
  "calendar.create_reminder": {
    toolName: "calendar.create_reminder",
    description: "创建一个到点微信提醒；用于用户明确说某天某时提醒自己做某事。",
    parameters: {
      type: "object",
      required: ["title", "date", "startTime"],
      properties: {
        title: { type: "string" },
        date: { type: "string", format: "date" },
        startTime: { type: "string", format: "time" },
        startTimeEvidence: { type: "string" },
        endTime: { type: "string", format: "time" },
        location: { type: "string" },
        sourceIds: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
      },
    },
  },
  "calendar.create_events": {
    toolName: "calendar.create_events",
    description: "一次创建 2 到 5 个已经排好日期和时间的日程。",
    parameters: {
      type: "object",
      required: ["events"],
      properties: {
        events: {
          type: "array",
          minItems: 2,
          maxItems: 5,
          items: {
            type: "object",
            required: ["title", "date", "startTime"],
            properties: {
              title: { type: "string" },
              date: { type: "string", format: "date" },
              startTime: { type: "string", format: "time" },
              startTimeEvidence: { type: "string" },
              endTime: { type: "string", format: "time" },
              location: { type: "string" },
              reminderMinutes: { anyOf: [{ type: "number" }, { type: "array", items: { type: "number" }, maxItems: 3 }] },
              notes: { type: "string" },
            },
          },
        },
      },
    },
  },
  "calendar.create_and_propose_schedule": {
    toolName: "calendar.create_and_propose_schedule",
    description: "同一条消息里既有明确时间日程、又有只给日期或时段的待安排事项时，先创建明确日程，再为未定事项推荐空档。",
    parameters: {
      type: "object",
      required: ["events", "items"],
      properties: {
        events: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            required: ["title", "date", "startTime"],
            properties: {
              title: { type: "string" },
              date: { type: "string", format: "date" },
              startTime: { type: "string", format: "time" },
              startTimeEvidence: { type: "string" },
              endTime: { type: "string", format: "time" },
              location: { type: "string" },
              reminderMinutes: { anyOf: [{ type: "number" }, { type: "array", items: { type: "number" }, maxItems: 3 }] },
              notes: { type: "string" },
            },
          },
        },
        date: { type: "string", format: "date" },
        preferredStartTime: { type: "string", format: "time" },
        preferredWindow: { type: "string", enum: ["morning", "afternoon", "evening", "later"] },
        optionCount: { type: "number", minimum: 1, maximum: 5 },
        contextRef: { type: "string", enum: ["pending_schedule"] },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            required: [],
            properties: {
              title: { type: "string" },
              target: {
                type: "object",
                required: [],
                properties: {
                  seedId: { type: "string" },
                  itemNumber: { type: "number" },
                  itemNumbers: { type: "array", items: { type: "number" } },
                  title: { type: "string" },
                  group: { type: "string", enum: ["pending_schedule", "pending_reminder", "pending_todo", "all"] },
                },
              },
              sourceIds: { type: "array", items: { type: "string" } },
              durationMinutes: { type: "number" },
              location: { type: "string" },
              reminderMinutes: { anyOf: [{ type: "number" }, { type: "array", items: { type: "number" }, maxItems: 3 }] },
              notes: { type: "string" },
            },
          },
        },
      },
    },
  },
  "calendar.list_events": {
    toolName: "calendar.list_events",
    description: "查询某一天或某个日期范围内的日程。",
    parameters: {
      type: "object",
      required: [],
      properties: {
        date: { type: "string", format: "date" },
        range: {
          type: "object",
          required: ["startDate", "endDate"],
          properties: {
            startDate: { type: "string", format: "date" },
            endDate: { type: "string", format: "date" },
          },
        },
      },
    },
  },
  "calendar.update_event": {
    toolName: "calendar.update_event",
    description: "修改本地状态引用到的日程，或按结构化日期、时间段、标题查询后修改唯一匹配的日程。",
    parameters: {
      type: "object",
      required: ["target", "patch"],
      properties: {
        target: { type: "object" },
        patch: { type: "object" },
      },
    },
  },
  "calendar.propose_schedule": {
    toolName: "calendar.propose_schedule",
    description: "为一个或多个待安排事项推荐当天空档；items 可用 title 或 target 引用待推进收件箱；已有推荐时可省略 items 重新推荐；autoCreate 为 true 时自动写入第一个推荐位。",
    parameters: {
      type: "object",
      required: [],
      properties: {
        date: { type: "string", format: "date" },
        autoCreate: { type: "boolean" },
        preferredStartTime: { type: "string", format: "time" },
        preferredWindow: { type: "string", enum: ["morning", "afternoon", "evening", "later"] },
        optionCount: { type: "number", minimum: 1, maximum: 5 },
        contextRef: { type: "string", enum: ["pending_schedule"] },
        items: {
          type: "array",
          minItems: 0,
          maxItems: 5,
          items: {
            type: "object",
            required: [],
            properties: {
              title: { type: "string" },
              target: {
                type: "object",
                required: [],
                properties: {
                  seedId: { type: "string" },
                  itemNumber: { type: "number" },
                  itemNumbers: { type: "array", items: { type: "number" } },
                  title: { type: "string" },
                  group: { type: "string", enum: ["pending_schedule", "pending_reminder", "pending_todo", "all"] },
                },
              },
              sourceIds: { type: "array", items: { type: "string" } },
              durationMinutes: { type: "number" },
              location: { type: "string" },
              reminderMinutes: { anyOf: [{ type: "number" }, { type: "array", items: { type: "number" }, maxItems: 3 }] },
              notes: { type: "string" },
            },
          },
        },
      },
    },
  },
  "calendar.confirm_schedule": {
    toolName: "calendar.confirm_schedule",
    description: "确认、取消或修改当前本地排程推荐；不能指定事件 ID。",
    parameters: {
      type: "object",
      required: ["confirmed"],
      properties: {
        confirmed: { type: "boolean" },
        optionNumber: { type: "number" },
        itemChanges: { type: "array", items: { type: "object" } },
      },
    },
  },
  "assistant.remember_todo": {
    toolName: "assistant.remember_todo",
    description: "记录一个没有明确开始时间的待推进事项；autoSchedule 为 true 时系统会按排程记忆自动写入日历。",
    parameters: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        autoSchedule: { type: "boolean" },
        date: { type: "string", format: "date" },
      },
    },
  },
  "assistant.manage_todos": {
    toolName: "assistant.manage_todos",
    description: "查看、完成、取消或修改当前待推进收件箱；不能写日历。",
    parameters: {
      type: "object",
      required: ["operation"],
      properties: {
        operation: { type: "string", enum: ["list", "list_shelved", "complete", "delete", "shelve", "restore", "update"] },
        limit: { type: "number" },
        target: {
          type: "object",
          required: [],
          properties: {
            seedId: { type: "string" },
            itemNumber: { type: "number" },
            itemNumbers: { type: "array", items: { type: "number" } },
            title: { type: "string" },
            group: { type: "string", enum: ["pending_schedule", "pending_reminder", "pending_todo", "all"] },
          },
        },
        patch: {
          type: "object",
          required: [],
          properties: {
            title: { type: "string" },
            targetDate: { type: "string", format: "date" },
            reminderAt: { type: "string" },
            clearReminder: { type: "boolean" },
          },
        },
      },
    },
  },
  "calendar.delete_event": {
    toolName: "calendar.delete_event",
    description: "发起单个日程删除确认；可引用本地状态，也可按结构化日期、时间段、标题查询候选后确认。",
    parameters: {
      type: "object",
      required: ["target"],
      properties: {
        target: { type: "object" },
      },
    },
  },
  "calendar.delete_events": {
    toolName: "calendar.delete_events",
    description: "按明确日期或日期范围请求批量删除，执行前必须先锁定查询结果并等待用户确认。",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "object",
          required: [],
          properties: {
            date: { type: "string", format: "date" },
            range: {
              type: "object",
              required: ["startDate", "endDate"],
              properties: {
                startDate: { type: "string", format: "date" },
                endDate: { type: "string", format: "date" },
              },
            },
          },
        },
      },
    },
  },
  "calendar.confirm_delete": {
    toolName: "calendar.confirm_delete",
    description: "确认或取消当前本地待删除日程；可选择当前待删除列表里的序号；不能指定新的事件。",
    parameters: {
      type: "object",
      required: ["confirmed"],
      properties: {
        confirmed: { type: "boolean" },
        itemNumbers: { type: "array", items: { type: "number" } },
      },
    },
  },
  "calendar.confirm_create": {
    toolName: "calendar.confirm_create",
    description: "确认或取消当前本地待创建冲突日程；不能指定新的事件。",
    parameters: {
      type: "object",
      required: ["confirmed"],
      properties: {
        confirmed: { type: "boolean" },
      },
    },
  },
  "calendar.daily_briefing": {
    toolName: "calendar.daily_briefing",
    description: "生成早报或晚报。",
    parameters: {
      type: "object",
      required: ["briefingType"],
      properties: {
        briefingType: { enum: ["morning", "evening"] },
      },
    },
  },
  "assistant.settings_summary": {
    toolName: "assistant.settings_summary",
    description: "只读总结关键运行设置，例如提醒、日历、模型、记忆和运行入口在哪里配置。",
    parameters: {
      type: "object",
      required: [],
      properties: {
        topic: { type: "string", enum: ["all", "reminder", "calendar", "model", "memory", "runtime"] },
      },
    },
  },
  "assistant.status_overview": {
    toolName: "assistant.status_overview",
    description: "只读总结当前还挂着的待处理上下文，按待补信息、待确认、待安排、待提醒、待推进分组。",
    parameters: {
      type: "object",
      required: [],
      properties: {},
    },
  },
  "assistant.dismiss_context": {
    toolName: "assistant.dismiss_context",
    description: "放弃当前挂起的短期上下文，例如待补时间、待确认推荐、待确认删除、冲突确认或图片草稿；不写日历、不删除待推进收件箱。",
    parameters: {
      type: "object",
      required: [],
      properties: {},
    },
  },
  "assistant.clarify": {
    toolName: "assistant.clarify",
    description: "向用户追问缺失信息；如果是创建日程缺字段，可以附带已知创建草稿。",
    parameters: {
      type: "object",
      required: ["question", "missing"],
      properties: {
        question: { type: "string" },
        missing: { type: "array", items: { type: "string" } },
        createDraft: { type: "object" },
      },
    },
  },
};

export function isCalendarToolName(value: unknown): value is CalendarToolName {
  return typeof value === "string" && TOOL_NAMES.includes(value as CalendarToolName);
}
