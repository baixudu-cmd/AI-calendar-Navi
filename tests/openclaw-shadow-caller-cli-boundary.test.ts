import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  server.close();
  await once(server, "close");
  server = undefined;
});

// 启动本地临时服务，模拟 Calendar Agent 返回可读的业务失败回执。
async function startBusinessFailureServer() {
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      ok: false,
      reply: "图片里的会议时间没有识别清楚。",
      actionType: "image_calendar_draft_rejected",
      requestId: "req_image_failed",
    }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing server address");
  return `http://127.0.0.1:${address.port}/calendar-agent/shadow`;
}

describe("OpenClaw shadow caller CLI boundary", () => {
  it("is exposed through package script", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

    expect(pkg.scripts["openclaw:shadow-caller-smoke"]).toBe("tsx src/openclaw/shadow-caller-cli.ts");
  });

  it("fails closed without required env and does not leak secret", () => {
    const result = spawnSync("npm", ["run", "openclaw:shadow-caller-smoke"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_SHADOW_URL: "",
        OPENCLAW_SHADOW_SECRET: "secret-openclaw-shadow",
        OPENCLAW_SHADOW_TEXT: "明天 7 点开会",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("OpenClaw shadow caller smoke: failed");
    expect(result.stdout + result.stderr).not.toContain("secret-openclaw-shadow");
  });

  it("forwards business failure replies in reply-only mode", async () => {
    const url = await startBusinessFailureServer();
    const child = spawn("npm", ["--silent", "run", "openclaw:shadow-caller-smoke"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        OPENCLAW_SHADOW_URL: url,
        OPENCLAW_SHADOW_SECRET: "secret-openclaw-shadow",
        OPENCLAW_SHADOW_TEXT: "",
        OPENCLAW_SHADOW_MEDIA_PATH: "/tmp/openclaw-weixin/inbound/image.png",
        OPENCLAW_SHADOW_MEDIA_TYPE: "image/png",
        OPENCLAW_SHADOW_REPLY_ONLY: "1",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
    const [status] = await once(child, "exit");

    expect(status).toBe(0);
    expect(stdout.trim()).toBe("图片里的会议时间没有识别清楚。");
    expect(stdout + stderr).not.toContain("secret-openclaw-shadow");
  });

  it("keeps the CLI as a thin caller without server-owned dependencies", () => {
    const content = readFileSync(join(process.cwd(), "src/openclaw/shadow-caller-cli.ts"), "utf8");

    expect(content).toContain("callOpenClawShadowRoute");
    expect(content).toContain("OPENCLAW_SHADOW_MEDIA_PATH");
    expect(content).toContain("OPENCLAW_SHADOW_MEDIA_TYPE");
    expect(content).not.toContain("../agent-api");
    expect(content).not.toContain("../calendar-api");
    expect(content).not.toContain("../decision");
    expect(content).not.toContain("../calendar/feishu");
    expect(content).not.toContain("../wechat");
    expect(content).not.toContain("@openclaw");
    expect(content).not.toContain("createModelDecisionClient");
    expect(content).not.toContain("createLiveFeishuCalendarAdapter");
  });
});
