import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("OpenClaw shadow integration design doc", () => {
  const content = readFileSync(join(process.cwd(), "docs/openclaw/calendar-agent-shadow-design.md"), "utf8");

  it("documents the design-only OpenClaw boundary", () => {
    expect(content).toContain("不真接微信");
    expect(content).toContain("不改写 OpenClaw 运行配置");
    expect(content).toContain("不写真实飞书日历");
    expect(content).toContain(`不迁移旧 \`${"tracklog"}-${"agent"}\``);
  });

  it("keeps server-owned dependencies out of the OpenClaw caller", () => {
    expect(content).toContain("不能注入 `decisionClient`");
    expect(content).toContain("`calendar`");
    expect(content).toContain("`state`");
    expect(content).toContain("`seenMessageIds`");
  });

  it("defines the minimal request and rollout gates", () => {
    for (const field of ["text", "messageId", "requestId", "secret"]) {
      expect(content).toContain(`\"${field}\"`);
    }

    expect(content).toContain("npm run live:env-doctor");
    expect(content).toContain("npm run agent:model-smoke");
    expect(content).toContain("npm run live:feishu-smoke");
    expect(content).toContain("npm run agent:shadow-smoke");
  });

  it("defines failure handling and safe observability", () => {
    for (const failure of ["wrong secret", "duplicate message", "model failure", "calendar failure", "timeout"]) {
      expect(content).toContain(failure);
    }

    expect(content).toContain("日志禁止记录");
    expect(content).toContain("MODEL_API_KEY");
    expect(content).toContain("飞书 app secret");
  });
});
