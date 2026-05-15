// 决策模块出口：保留本地决策接口，并导出注入式模型适配器。

import { type ShortTermState } from "../state/index.js";

export type DecisionRequest = {
  text: string;
  state: ShortTermState;
  now?: string;
  timezone?: string;
};

export type DecisionClient = {
  decide(request: DecisionRequest): Promise<unknown>;
};

// 调用注入的决策客户端，确保语义判断只有这一个入口。
export async function decideNextAction(client: DecisionClient, request: DecisionRequest): Promise<unknown> {
  return client.decide(request);
}

export * from "./model/index.js";
