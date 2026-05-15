// 模型决策模块出口：集中导出 prompt builder 和注入式模型客户端。

export { createModelDecisionClient, type ModelDecisionClientOptions, type ModelDecisionTransport } from "./client.js";
export { createOpenAICompatibleTransport, type OpenAICompatibleTransportOptions } from "./openai-compatible-transport.js";
export { buildModelDecisionMessages, type ModelMessage } from "./prompt.js";
export { createCalendarToolCallRequestOptions } from "./structured-output.js";
