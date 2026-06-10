// 本地出口绑定 fetch 测试：验证 Feishu 这类外部请求可以指定 Mac mini 的出口源地址。

import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalAddressFetch } from "../src/net/local-address-fetch.js";

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe("local address fetch", () => {
  it("posts through the requested local address and returns a fetch-like response", async () => {
    const seen: Array<{ remoteAddress?: string; body: string }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        seen.push({ remoteAddress: request.socket.remoteAddress, body: Buffer.concat(chunks).toString("utf8") });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      });
    });
    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server address missing");

    const fetchImpl = createLocalAddressFetch("127.0.0.1");
    const response = await fetchImpl(`http://127.0.0.1:${address.port}/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(seen).toEqual([{ remoteAddress: "127.0.0.1", body: "{\"hello\":\"world\"}" }]);
  });

  it("falls back to the normal fetch when no local address is configured", () => {
    expect(createLocalAddressFetch()).toBe(globalThis.fetch);
    expect(createLocalAddressFetch("")).toBe(globalThis.fetch);
  });

});
