// 模型决策适配器：通过注入的 transport 调模型，只接受 toolName + arguments。

import { type DecisionClient, type DecisionRequest } from "../index.js";
import { toolCallToCalendarAction, validateToolCall } from "../../tool-contract/index.js";
import { buildModelDecisionMessages, type ModelMessage } from "./prompt.js";

export type ModelDecisionTransport = (input: {
  model: string;
  messages: ModelMessage[];
}) => Promise<{ content: string }>;

export type ModelDecisionClientOptions = {
  model: string;
  transport: ModelDecisionTransport;
};

// 创建模型决策客户端；不直接访问网络，真实调用由外部 transport 注入。
export function createModelDecisionClient(options: ModelDecisionClientOptions): DecisionClient {
  return {
    async decide(request: DecisionRequest): Promise<unknown> {
      let messages = buildModelDecisionMessages(request);
      let lastFailure: unknown = {
        action: "__malformed_model_output__",
        error: "模型输出不是 JSON。",
      };

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await options.transport({
          model: options.model,
          messages,
        });
        const parsed = parseToolCallContent(response.content, request.text);
        if (parsed.ok) return parsed.action;
        lastFailure = parsed.failure;
        if (attempt === 0) messages = buildToolContractRetryMessages(messages, response.content, parsed.message);
      }

      return lastFailure;
    },
  };
}

type ParsedToolCallContent =
  | { ok: true; action: unknown }
  | { ok: false; failure: unknown; message: string };

function parseToolCallContent(content: string, sourceText: string): ParsedToolCallContent {
  try {
    const parsed = parseToolCall(JSON.parse(content), sourceText);
    if (isToolSchemaRejected(parsed)) {
      return { ok: false, failure: parsed, message: parsed.error };
    }
    return { ok: true, action: parsed };
  } catch {
    return {
      ok: false,
      message: "模型输出不是 JSON。",
      failure: {
        action: "__malformed_model_output__",
        error: "模型输出不是 JSON。",
      },
    };
  }
}

function isToolSchemaRejected(value: unknown): value is { action: "__tool_schema_rejected__"; error: string } {
  return isRecord(value) && value.action === "__tool_schema_rejected__" && typeof value.error === "string";
}

function buildToolContractRetryMessages(messages: ModelMessage[], content: string, message: string): ModelMessage[] {
  return [
    ...messages,
    {
      role: "user",
      content: JSON.stringify({
        toolContractError: message,
        previousOutput: trimForRetry(content),
        instruction: "上一轮输出没有通过工具合同。请重新输出一个合法的 {toolName, arguments} JSON；不要解释。",
      }),
    },
  ];
}

function trimForRetry(content: string): string {
  return content.length > 1000 ? content.slice(0, 1000) : content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 模型输出必须先通过工具 Schema，再转入现有内部动作合同。
function parseToolCall(value: unknown, sourceText: string): unknown {
  const validation = validateToolCall(value, { sourceText });
  if (!validation.ok) {
    return {
      action: "__tool_schema_rejected__",
      error: validation.message,
      reason: validation.reason,
    };
  }

  return toolCallToCalendarAction(validation.call);
}
