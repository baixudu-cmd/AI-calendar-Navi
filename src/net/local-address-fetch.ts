// 出站网络 helper：需要时把 HTTP/HTTPS 请求绑定到指定本机出口地址。

import { spawn } from "node:child_process";

type FetchBody = BodyInit | null | undefined;

// 创建可选绑定 localAddress 的 fetch；未配置时保持原生 fetch 行为。
export function createLocalAddressFetch(localAddress?: string, resolveIp?: string): typeof globalThis.fetch {
  const trimmed = localAddress?.trim();
  if (!trimmed) return globalThis.fetch;
  const resolved = resolveIp?.trim();

  return async (input, init = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return globalThis.fetch(input, init);
    }

    return requestWithCurl(url, init, trimmed, resolved);
  };
}

// 用 curl 绑定出口地址。Mac mini 当前 Node socket 路径会卡住，curl 的 --interface 能稳定走有线出口。
async function requestWithCurl(url: URL, init: RequestInit, localAddress: string, resolveIp?: string): Promise<Response> {
  const body = await normalizeBody(init.body);
  const headers = new Headers(init.headers);
  const args = [
    "--silent",
    "--show-error",
    "--max-time",
    "30",
    "--interface",
    localAddress,
    "--request",
    init.method || "GET",
  ];
  for (const [key, value] of headers.entries()) {
    args.push("--header", `${key}: ${value}`);
  }
  if (resolveIp && (url.protocol === "https:" || url.protocol === "http:")) {
    args.push("--resolve", `${url.hostname}:${url.port || defaultPort(url)}:${resolveIp}`);
  }
  if (body) args.push("--data-binary", "@-");
  args.push("--write-out", "\n__NAVI_CURL_STATUS__:%{http_code}", url.toString());

  return new Promise<Response>((resolve, reject) => {
    const child = spawn("curl", args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf8");
      const marker = "\n__NAVI_CURL_STATUS__:";
      const markerIndex = output.lastIndexOf(marker);
      if (code !== 0 || markerIndex < 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `curl exited with ${code}`));
        return;
      }

      const responseBody = output.slice(0, markerIndex);
      const status = Number(output.slice(markerIndex + marker.length).trim()) || 0;
      resolve(new Response(responseBody, { status }));
    });
    if (init.signal) {
      init.signal.addEventListener("abort", () => {
        child.kill("SIGTERM");
        reject(new Error("request_aborted"));
      }, { once: true });
    }
    if (body) child.stdin.write(body);
    child.stdin.end();
  });
}

function defaultPort(url: URL): string {
  return url.protocol === "https:" ? "443" : "80";
}

// 目前项目只传字符串 JSON body；其他可转类型做保守支持。
async function normalizeBody(body: FetchBody): Promise<Buffer | string | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string" || body instanceof Buffer) return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  throw new Error("unsupported_fetch_body");
}
