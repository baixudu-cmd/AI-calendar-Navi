// live 模型 smoke：只验证模型输出合同，不触发任何日历写入。

import { normalizeDecision } from "../contract/index.js";
import { createModelDecisionClient, type ModelDecisionTransport } from "../decision/index.js";
import { createShortTermStateStore } from "../state/index.js";
import type { AppConfig } from "../config/index.js";
import { evaluateLiveConfigGate, type LiveConfigGateReport } from "./config-gate.js";

export type LiveModelSmokeTransport = ModelDecisionTransport;

export type LiveModelContractSmokeInput = {
  config: AppConfig;
  model: string;
  text: string;
  transport: LiveModelSmokeTransport;
};

export type LiveModelContractSmokeWithGateInput = Omit<LiveModelContractSmokeInput, "config"> & {
  gate: LiveConfigGateReport;
};

export type LiveModelContractSmokeResult =
  | { ok: true; actionType: string; message: string }
  | { ok: false; reason: "config_failed" | "contract_rejected" | "transport_failed"; message: string };

// 运行模型合同 smoke；gate 未通过时不调用模型。
export async function runLiveModelContractSmoke(
  input: LiveModelContractSmokeInput,
): Promise<LiveModelContractSmokeResult> {
  return runLiveModelContractSmokeWithGate({
    gate: evaluateLiveConfigGate(input.config),
    model: input.model,
    text: input.text,
    transport: input.transport,
  });
}

// 测试用低层入口；正式调用应传 config，让函数内部执行 live gate。
export async function runLiveModelContractSmokeWithGate(
  input: LiveModelContractSmokeWithGateInput,
): Promise<LiveModelContractSmokeResult> {
  if (!input.gate.ok) {
    return { ok: false, reason: "config_failed", message: input.gate.failures.join("；") };
  }

  const client = createModelDecisionClient({ model: input.model, transport: input.transport });
  let decision: unknown;
  try {
    decision = await client.decide({
      text: input.text,
      state: createShortTermStateStore().snapshot(),
    });
  } catch {
    return { ok: false, reason: "transport_failed", message: "模型 transport 调用失败。" };
  }

  const contract = normalizeDecision(decision);
  if (!contract.ok) {
    return { ok: false, reason: "contract_rejected", message: contract.message };
  }

  return { ok: true, actionType: contract.action.type, message: "model contract accepted" };
}
