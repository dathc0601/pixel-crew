import { request } from "http";
import WebSocket from "ws";

export interface HttpResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json<T = any>(): T;
}

export function httpRequest(opts: {
  host?: string;
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  localAddress?: string;
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: opts.host ?? "127.0.0.1",
        port: opts.port,
        path: opts.path,
        method: opts.method ?? "GET",
        headers: opts.headers,
        localAddress: opts.localAddress,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json: () => JSON.parse(body) });
        });
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Open a WebSocket; resolves with the socket on open, or rejects with the HTTP status on a refused upgrade. */
export function openWs(url: string, origin?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, origin ? { origin } : {});
    ws.once("open", () => resolve(ws));
    ws.once("unexpected-response", (_req, res) => {
      reject(Object.assign(new Error(`upgrade refused: ${res.statusCode}`), { status: res.statusCode }));
    });
    ws.once("error", (err) => reject(err));
  });
}

export function nextMessage(ws: WebSocket, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for message")), timeoutMs);
    ws.once("message", (d) => { clearTimeout(t); resolve(JSON.parse(d.toString())); });
  });
}

export function waitClose(ws: WebSocket, timeoutMs = 2000): Promise<number> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve(-1);
    const t = setTimeout(() => reject(new Error("timeout waiting for close")), timeoutMs);
    ws.once("close", (code) => { clearTimeout(t); resolve(code); });
  });
}
