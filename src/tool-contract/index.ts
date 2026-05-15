// 工具合同入口：集中导出模型可见 Schema、校验器和兼容适配器。

export {
  TOOL_NAMES,
  TOOL_SCHEMAS,
  type CalendarToolName,
  type ToolParameterSchema,
  type ToolSchema,
} from "./schemas.js";
export {
  validateToolCall,
  type CalendarToolCall,
  type ToolDeleteEventsQuery,
  type ToolTodoPatch,
  type ToolTodoTarget,
  type ToolTargetReference,
  type ToolValidationFailureReason,
  type ToolValidationResult,
} from "./validator.js";
export { toolCallToCalendarAction, type AdaptableCalendarToolCall } from "./adapter.js";
