import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { CommandSchema } from "@pixel-crew/shared";
import type { GatewayEvent, Command, UserRole } from "@pixel-crew/shared";
import { config } from "./config.js";
import { previewServer } from "@pixel-crew/orchestrator";
import { networkInterfaces } from "os";
import { readFile, stat } from "fs/promises";
import { join, extname, resolve } from "path";
import * as Ably from "ably";
import type { Channel, CommandMeta } from "./transport.js";
import { writePortLock } from "./runtime-state.js";
import { nanoid } from "nanoid";
import {
  RateLimiter,
  SessionTokenStore,
  buildTrustedOrigins,
  checkQuickConnect,
  checkWebSocketOrigin,
  clientKey,
  normalizeOrigin,
  safeEqual,
  isTunnelRequest,
} from "./security.js";

let wss: WebSocketServer | null = null;
let httpServer: Server | null = null;
const clients = new Map<WebSocket, { role: UserRole; clientId: string; sessionToken: string }>();
let pairCode: string | null = null;
let onCommand: ((cmd: Command, meta: CommandMeta) => void) | null = null;

// In-memory share token store: token → { role } (for public share links)
const shareTokens = new Map<string, { role: "collaborator" | "spectator" }>();

// Session tokens: persisted (instance-scoped) with an expiry so they survive restarts but not forever
let sessionStore: SessionTokenStore | null = null;
function getSessionStore(): SessionTokenStore {
  if (!sessionStore) {
    sessionStore = new SessionTokenStore(resolve(config.instanceDir, "session-tokens.json"), { ttlMs: config.sessionTtlMs });
  }
  return sessionStore;
}

// Brute-force protection for code/token validation: 5 attempts per minute per client, then 5 min lockout
const authLimiter = new RateLimiter({ max: 5, windowMs: 60_000, lockoutMs: 5 * 60_000 });
const MAX_BODY_BYTES = 16 * 1024;

// Pending WS connections awaiting AUTH
const pendingAuth = new Set<WebSocket>();
const AUTH_TIMEOUT_MS = 5000;

function trustedOrigins(): Set<string> {
  const devPorts = [3000, 3002];
  if (process.env.NEXT_DEV_PORT) devPorts.push(Number(process.env.NEXT_DEV_PORT));
  return buildTrustedOrigins({ port: config.wsPort, isDev: config.isDev, devPorts, extra: config.allowedOrigins });
}

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...extraHeaders });
  res.end(JSON.stringify(body));
}

/** Read a small JSON body (capped). Resolves null on oversize or bad JSON. */
function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolveBody) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let aborted = false;
    req.on("data", (c: Buffer) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) { aborted = true; resolveBody(null); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (aborted) return;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        resolveBody(parsed && typeof parsed === "object" ? parsed : null);
      } catch {
        resolveBody(null);
      }
    });
    req.on("error", () => { if (!aborted) resolveBody(null); });
  });
}

/** Apply the rate limit; writes a 429 and returns false when the client is locked out. */
function rateLimitOk(req: IncomingMessage, res: ServerResponse, bucket: string): boolean {
  const verdict = authLimiter.hit(`${bucket}:${clientKey(req)}`);
  if (verdict.allowed) return true;
  const retryAfter = Math.ceil(verdict.retryAfterMs / 1000);
  console.log(`[Auth] Rate limited ${bucket} from ${clientKey(req)} (retry in ${retryAfter}s)`);
  sendJson(res, 429, { error: "Too many attempts. Try again later." }, { "Retry-After": String(retryAfter) });
  return false;
}

function pairCodeMatches(code: unknown): boolean {
  return typeof code === "string" && !!pairCode && safeEqual(code.trim().toUpperCase(), pairCode);
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".txt": "text/plain",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

export function setPairCode(code: string) {
  pairCode = code.toUpperCase();
}

/** Send an event to a specific client by clientId (unicast) */
export function sendToClient(clientId: string, event: GatewayEvent) {
  const data = JSON.stringify(event);
  for (const [ws, info] of clients) {
    if (info.clientId === clientId && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
      return;
    }
  }
}

/**
 * Revoke all session tokens and disconnect their clients.
 * `exceptClientId` keeps the requesting client's session alive.
 * Returns the number of revoked tokens.
 */
export function revokeAllSessions(opts: { exceptClientId?: string } = {}): number {
  const keep: string[] = [];
  for (const [, info] of clients) {
    if (opts.exceptClientId && info.clientId === opts.exceptClientId) keep.push(info.sessionToken);
  }
  const revoked = getSessionStore().revokeAll(keep);
  shareTokens.clear();
  for (const [ws, info] of clients) {
    if (keep.includes(info.sessionToken)) continue;
    try { ws.send(JSON.stringify({ type: "AUTH_FAILED" })); } catch { /* closing anyway */ }
    ws.close(4001, "Session revoked");
    clients.delete(ws);
  }
  console.log(`[Auth] Revoked ${revoked} session token(s)`);
  return revoked;
}

/** Address the HTTP server is bound to (tests, logging). */
export function getListeningAddress(): { host: string; port: number } | null {
  const addr = httpServer?.address();
  if (!addr || typeof addr === "string") return null;
  return { host: addr.address, port: addr.port };
}

export const wsChannel: Channel = {
  name: "WebSocket",

  async init(commandHandler: (cmd: Command, meta: CommandMeta) => void): Promise<boolean> {
    onCommand = commandHandler;

    return new Promise((promiseResolve) => {
      const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
        // CORS: allowlist only (never "*"). Same-origin pages need no CORS headers.
        const origin = req.headers.origin;
        const normOrigin = normalizeOrigin(origin);
        const originTrusted = !!normOrigin && trustedOrigins().has(normOrigin);
        if (originTrusted) {
          res.setHeader("Access-Control-Allow-Origin", normOrigin!);
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        }
        res.setHeader("Vary", "Origin");

        if (req.method === "OPTIONS") {
          res.writeHead(originTrusted ? 204 : 403);
          res.end();
          return;
        }

        // Quick connect: owner token without a pair code — local UI only
        if (req.method === "GET" && (req.url === "/connect" || req.url?.startsWith("/connect?"))) {
          const verdict = checkQuickConnect(req, { trustedOrigins: trustedOrigins(), ablyConfigured: !!config.ablyApiKey });
          if (!verdict.ok) {
            console.log(`[Auth] /connect refused (${verdict.reason}) remote=${req.socket.remoteAddress} host=${req.headers.host} origin=${origin ?? "-"}`);
            sendJson(res, verdict.status, { error: verdict.reason });
            return;
          }
          const sessionToken = getSessionStore().issue("owner");
          sendJson(res, 200, {
            machineId: config.machineId,
            gatewayId: config.gatewayId,
            wsUrl: `ws://localhost:${config.wsPort}`,
            role: "owner",
            sessionToken,
          });
          return;
        }

        if (req.method === "POST" && req.url === "/pair/validate") {
          if (!rateLimitOk(req, res, "pair")) return;
          const body = await readJsonBody(req);
          if (!body) { sendJson(res, 400, { error: "Bad request" }); return; }
          if (!pairCodeMatches(body.code)) { sendJson(res, 401, { error: "Invalid pair code" }); return; }
          const sessionToken = getSessionStore().issue("owner");
          sendJson(res, 200, {
            machineId: config.machineId,
            wsUrl: `ws://localhost:${config.wsPort}`,
            hasAbly: !!config.ablyApiKey,
            role: "owner",
            sessionToken,
          });
          return;
        }

        // Share link creation (owner-only: proves ownership with the pair code)
        if (req.method === "POST" && req.url === "/share/create") {
          if (!rateLimitOk(req, res, "share-create")) return;
          const body = await readJsonBody(req);
          if (!body) { sendJson(res, 400, { error: "Bad request" }); return; }
          if (!pairCodeMatches(body.code)) { sendJson(res, 401, { error: "Invalid pair code" }); return; }
          const shareRole = body.role === "collaborator" ? "collaborator" : "spectator";
          const token = nanoid();
          shareTokens.set(token, { role: shareRole });
          sendJson(res, 200, { token, role: shareRole });
          return;
        }

        // Share link validation (public users)
        if (req.method === "POST" && req.url === "/share/validate") {
          if (!rateLimitOk(req, res, "share")) return;
          const body = await readJsonBody(req);
          if (!body) { sendJson(res, 400, { error: "Bad request" }); return; }
          const share = typeof body.token === "string" ? shareTokens.get(body.token) : undefined;
          if (!share) { sendJson(res, 401, { error: "Invalid share token" }); return; }
          const sessionToken = getSessionStore().issue(share.role);
          sendJson(res, 200, {
            machineId: config.machineId,
            wsUrl: `ws://localhost:${config.wsPort}`,
            hasAbly: !!config.ablyApiKey,
            role: share.role,
            sessionToken,
          });
          return;
        }

        // Ably token endpoint
        if (req.method === "POST" && req.url === "/ably/token") {
          if (!config.ablyApiKey) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Ably not configured" }));
            return;
          }

          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", async () => {
            try {
              let targetMachineId = config.machineId;
              let sessionToken: string | undefined;
              try {
                const parsed = JSON.parse(body);
                if (parsed.machineId) targetMachineId = parsed.machineId;
                if (parsed.sessionToken) sessionToken = parsed.sessionToken;
              } catch {
                // no body
              }

              // Require valid sessionToken — derive role from server, never from client
              if (!sessionToken) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Session token required" }));
                return;
              }
              const clientRole = getSessionStore().validate(sessionToken);
              if (!clientRole) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid session token" }));
                return;
              }

              if (!targetMachineId) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "No machine ID" }));
                return;
              }

              // Spectators get subscribe-only (no publish on commands channel)
              const commandsCap: Ably.capabilityOp[] = clientRole === "spectator" ? ["subscribe"] : ["publish"];
              const rest = new Ably.Rest({ key: config.ablyApiKey });
              const tokenRequest = await rest.auth.createTokenRequest({
                clientId: `${clientRole}:${nanoid(8)}`,
                ttl: 5 * 60 * 1000,
                capability: {
                  [`machine:${targetMachineId}:commands`]: commandsCap,
                  [`machine:${targetMachineId}:events`]: ["subscribe"],
                },
              });

              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(tokenRequest));
            } catch (err) {
              console.error("[WS] Ably token error:", err);
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Token creation failed" }));
            }
          });
          return;
        }

        // --- Previews live on a separate origin (P0.3) ---
        // Agent-generated pages must not share an origin with the control UI, whose
        // session token is in localStorage. Redirect to the preview port; through the
        // Cloudflare tunnel (single port) serve them here under a CSP sandbox instead.
        if (isPreviewPath(req.url)) {
          if (isTunnelRequest(req)) {
            await handlePreviewRequest(req, res);
            return;
          }
          const target = previewRedirectUrl(req);
          if (!target) {
            res.writeHead(503, { "Content-Type": "text/plain" });
            res.end("Preview server not running");
            return;
          }
          res.writeHead(302, { Location: target, "Cache-Control": "no-store" });
          res.end();
          return;
        }

        // --- Static file serving (fallback, production only) ---
        if (process.env.NODE_ENV === "development") {
          // In dev mode, redirect page requests to the Next.js dev server
          const url = req.url?.split("?")[0] ?? "/";
          const isPageRoute = url === "/" || url === "/pair" || url === "/office" || url === "/join" || !url.includes(".");
          if (isPageRoute) {
            const nextPort = process.env.NEXT_DEV_PORT ?? "3000";
            const query = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
            res.writeHead(302, { Location: `http://localhost:${nextPort}${url}${query}` });
            res.end();
            return;
          }
          res.writeHead(404);
          res.end("Not Found (dev mode — use Next.js dev server)");
          return;
        }
        await serveStatic(req, res);
      };

      const maxRetries = 10;
      let port = config.wsPort;

      const tryListen = () => {
        const server = createServer(requestHandler);
        server.listen(port, config.listenHost, () => {
          httpServer = server;
          // When port=0, OS assigns a random port — read the actual value
          const actualPort = (server.address() as any)?.port ?? port;
          port = actualPort;
          config.wsPort = actualPort;

          // Attach WebSocket server only after successful listen.
          // Browsers always send Origin on WebSocket upgrades; reject foreign pages.
          wss = new WebSocketServer({
            server,
            verifyClient: (info: { origin: string; req: IncomingMessage }, cb: (ok: boolean, code?: number, message?: string) => void) => {
              const verdict = checkWebSocketOrigin(info.req.headers.origin, info.req.headers.host, trustedOrigins());
              if (verdict.ok) return cb(true);
              console.log(`[WS] Upgrade rejected: ${verdict.reason} (origin=${info.req.headers.origin}, host=${info.req.headers.host})`);
              cb(false, verdict.status, verdict.reason);
            },
          });
          wss.on("connection", (ws) => {
            pendingAuth.add(ws);
            console.log(`[WS] Client connected, awaiting AUTH...`);

            // Disconnect if no AUTH within timeout
            const authTimer = setTimeout(() => {
              if (pendingAuth.has(ws)) {
                console.log(`[WS] AUTH timeout, disconnecting client`);
                pendingAuth.delete(ws);
                ws.close();
              }
            }, AUTH_TIMEOUT_MS);

            ws.on("message", (data) => {
              try {
                const msg = JSON.parse(data.toString());

                // Handle AUTH handshake
                if (pendingAuth.has(ws)) {
                  if (msg.type === "AUTH") {
                    if (msg.sessionToken) {
                      const role = getSessionStore().validate(msg.sessionToken);
                      if (role) {
                        const clientId = nanoid(8);
                        clients.set(ws, { role, clientId, sessionToken: msg.sessionToken });
                        pendingAuth.delete(ws);
                        clearTimeout(authTimer);
                        console.log(`[WS] Client authenticated as ${role} (total: ${clients.size})`);
                        return;
                      }
                    }
                    // AUTH with invalid/missing token — tell client and disconnect
                    console.log(`[WS] Invalid AUTH token, rejecting`);
                    ws.send(JSON.stringify({ type: "AUTH_FAILED" }));
                    pendingAuth.delete(ws);
                    clearTimeout(authTimer);
                    ws.close();
                    return;
                  }

                  // No AUTH message — reject unauthenticated client
                  console.log(`[WS] Non-AUTH message from unauthenticated client, rejecting`);
                  ws.send(JSON.stringify({ type: "AUTH_FAILED" }));
                  pendingAuth.delete(ws);
                  clearTimeout(authTimer);
                  ws.close();
                  return;
                }

                const clientInfo = clients.get(ws);
                if (!clientInfo) return; // not authenticated
                const parsed = CommandSchema.parse(msg);
                onCommand?.(parsed, { role: clientInfo.role, clientId: clientInfo.clientId });
              } catch (err) {
                console.error("[WS] Invalid command:", err);
              }
            });

            ws.on("close", () => {
              pendingAuth.delete(ws);
              clients.delete(ws);
              clearTimeout(authTimer);
              console.log(`[WS] Client disconnected (total: ${clients.size})`);
            });
          });

          console.log(`[WS] Server listening on ${config.listenHost}:${port}`);
          writePortLock(port);
          if (config.listenHost === "127.0.0.1") {
            console.log(`[WS] Loopback only. Start with --lan to let phones on your network pair.`);
          } else {
            printLanAddresses();
          }

          // Signal for Tauri sidecar — Rust parses this to emit port to webview
          console.log(`GATEWAY_READY ${JSON.stringify({ port, gatewayId: config.gatewayId })}`);

          startPreviewServer().then(() => promiseResolve(true));
        });

        server.once("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE" && port - config.wsPort < maxRetries) {
            const oldPort = port;
            port++;
            console.log(`[WS] Port ${oldPort} in use, trying ${port}...`);
            tryListen();
          } else {
            console.error(`[WS] Failed to start server:`, err.message);
            promiseResolve(false);
          }
        });
      };

      tryListen();
    });
  },

  broadcast(event: GatewayEvent) {
    const data = JSON.stringify(event);
    for (const [ws] of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  },

  destroy() {
    for (const [ws] of clients) {
      ws.close();
    }
    clients.clear();
    for (const ws of pendingAuth) ws.terminate();
    pendingAuth.clear();
    wss?.close();
    wss = null;
    httpServer?.close();
    httpServer?.closeAllConnections?.();
    httpServer = null;
    previewHttpServer?.close();
    previewHttpServer?.closeAllConnections?.();
    previewHttpServer = null;
  },
};

// ---------------------------------------------------------------------------
// Preview origin (P0.3)
// ---------------------------------------------------------------------------

/**
 * Every preview response runs in an opaque origin: even when opened directly
 * (new tab, tunnel), the page cannot read cookies or storage of any real origin.
 * ACAO "*" is safe here (the preview origin holds no secrets) and is needed for
 * module scripts and fetches made from the opaque origin.
 */
export const PREVIEW_CSP = "sandbox allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads";

function previewHeaders(extra: Record<string, string | number | string[] | undefined> = {}): Record<string, string | number | string[]> {
  const out: Record<string, string | number | string[]> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) continue;
    const lk = k.toLowerCase();
    // Drop upstream CORS/frame headers; ours below are authoritative
    if (lk === "access-control-allow-origin" || lk === "x-frame-options") continue;
    if (lk === "content-security-policy") {
      out["Content-Security-Policy"] = [...(Array.isArray(v) ? v : [String(v)]), PREVIEW_CSP];
      continue;
    }
    out[k] = v as string | number | string[];
  }
  if (!out["Content-Security-Policy"]) out["Content-Security-Policy"] = PREVIEW_CSP;
  out["Access-Control-Allow-Origin"] = "*";
  out["X-Content-Type-Options"] = "nosniff";
  return out;
}

/** Forward a preview request to the app server without the sandbox's "null" Origin or cookies. */
function proxyRequestHeaders(req: IncomingMessage, targetPort: number): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: `127.0.0.1:${targetPort}` };
  delete headers.origin;
  delete headers.cookie;
  return headers;
}

function isPreviewPath(url: string | undefined): boolean {
  return !!url && /^\/preview-(static|app)(\/|$|\?)/.test(url);
}

let previewHttpServer: Server | null = null;

/** http://<same host as the request>:<preview port><path>, or null when the preview server is down. */
function previewRedirectUrl(req: IncomingMessage): string | null {
  const addr = previewHttpServer?.address();
  if (!addr || typeof addr === "string") return null;
  const hostHeader = req.headers.host ?? `localhost:${config.wsPort}`;
  const hostname = hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) : hostHeader.split(":")[0];
  return `http://${hostname}:${addr.port}${req.url ?? "/"}`;
}

/** Address of the preview server (tests, logging). */
export function getPreviewAddress(): { host: string; port: number } | null {
  const addr = previewHttpServer?.address();
  if (!addr || typeof addr === "string") return null;
  return { host: addr.address, port: addr.port };
}

/** Serve /preview-static/* from disk and proxy /preview-app/* to the command preview port. */
async function handlePreviewRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  // Static preview: serve files directly from disk (no child process)
  const staticMatch = url.match(/^\/preview-static(\/.*)?$/);
  if (staticMatch) {
    const root = previewServer.staticRoot;
    const entry = previewServer.staticEntry;
    if (!root) {
      res.writeHead(404, previewHeaders({ "Content-Type": "text/plain" }));
      res.end("No static preview configured");
      return;
    }
    const reqPath = decodeURIComponent((staticMatch[1] || "/").split("?")[0]);
    const filePath = resolve(root, reqPath === "/" ? (entry ?? "index.html") : reqPath.slice(1));
    // Security: prevent path traversal outside root (trailing sep avoids sibling-prefix bypass)
    const rootWithSep = resolve(root) + "/";
    if (filePath !== resolve(root) && !filePath.startsWith(rootWithSep)) {
      res.writeHead(403, previewHeaders({ "Content-Type": "text/plain" }));
      res.end("Forbidden");
      return;
    }
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        res.writeHead(404, previewHeaders({ "Content-Type": "text/plain" }));
        res.end("Not found");
        return;
      }
      const ext = extname(filePath).toLowerCase();
      const mime: Record<string, string> = {
        ".html": "text/html", ".htm": "text/html",
        ".css": "text/css", ".js": "application/javascript", ".mjs": "application/javascript",
        ".json": "application/json", ".xml": "application/xml",
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
        ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".eot": "application/vnd.ms-fontobject",
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
        ".mp4": "video/mp4", ".webm": "video/webm",
        ".wasm": "application/wasm", ".pdf": "application/pdf", ".zip": "application/zip",
        ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
        ".ts": "application/javascript", ".tsx": "application/javascript", ".jsx": "application/javascript",
      };
      const contentType = mime[ext] || "application/octet-stream";
      const data = await readFile(filePath);
      res.writeHead(200, previewHeaders({
        "Content-Type": contentType,
        "Content-Length": data.length,
        "Cache-Control": "no-cache",
      }));
      res.end(data);
    } catch {
      res.writeHead(404, previewHeaders({ "Content-Type": "text/plain" }));
      res.end("Not found");
    }
    return;
  }

  // Command preview: reverse proxy to COMMAND_PORT with auto-restart on failure
  const appMatch = url.match(/^\/preview-app(\/.*)?$/);
  if (appMatch) {
    const targetPath = appMatch[1] || "/";
    const targetPort = previewServer.commandPort;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const send502 = () => {
        res.writeHead(502, previewHeaders({ "Content-Type": "text/plain" }));
        res.end("Preview app not running");
      };
      const doProxy = (isRetry: boolean) => {
        const proxyReq = httpRequest(
          { hostname: "127.0.0.1", port: targetPort, path: targetPath, method: req.method, headers: proxyRequestHeaders(req, targetPort) },
          (proxyRes) => {
            const status = proxyRes.statusCode ?? 502;
            if (status === 502 && !isRetry) {
              proxyRes.resume();
              previewServer.ensureCommandRunning().then((ok) => ok ? doProxy(true) : send502());
              return;
            }
            res.writeHead(status, previewHeaders(proxyRes.headers));
            proxyRes.pipe(res, { end: true });
          },
        );
        proxyReq.on("error", () => {
          if (!isRetry) {
            previewServer.ensureCommandRunning().then((ok) => ok ? doProxy(true) : send502());
          } else {
            send502();
          }
        });
        if (body.length > 0) proxyReq.write(body);
        proxyReq.end();
      };
      doProxy(false);
    });
    return;
  }
  res.writeHead(404, previewHeaders({ "Content-Type": "text/plain" }));
  res.end("Not found");
}

function startPreviewServer(): Promise<void> {
  return new Promise((resolveStart) => {
    const server = createServer((req, res) => {
      if (req.method === "OPTIONS") {
        res.writeHead(204, previewHeaders({ "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS", "Access-Control-Allow-Headers": "*" }));
        res.end();
        return;
      }
      handlePreviewRequest(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500, previewHeaders({ "Content-Type": "text/plain" }));
        res.end("Preview error");
      });
    });
    server.once("error", (err) => {
      console.warn(`[Preview] Preview server failed to start: ${err.message}. Previews are unavailable.`);
      resolveStart();
    });
    server.listen(config.previewPort, config.listenHost, () => {
      previewHttpServer = server;
      const a = server.address();
      if (a && typeof a !== "string") console.log(`[Preview] Serving previews on ${config.listenHost}:${a.port} (separate origin)`);
      resolveStart();
    });
  });
}

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = decodeURIComponent(req.url?.split("?")[0] ?? "/");

  const routeMap: Record<string, string> = {
    "/": "/index.html",
    "/pair": "/pair.html",
    "/office": "/office.html",
    "/join": "/join.html",
  };

  let filePath: string;
  if (routeMap[url]) {
    filePath = join(config.webDir, routeMap[url]);
  } else {
    filePath = join(config.webDir, url);
  }

  // Security: prevent path traversal outside webDir
  const webRoot = resolve(config.webDir);
  const resolvedPath = resolve(filePath);
  if (resolvedPath !== webRoot && !resolvedPath.startsWith(webRoot + "/")) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    const content = await readFile(filePath);
    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(content);
  } catch {
    try {
      const htmlPath = filePath + ".html";
      const content = await readFile(htmlPath);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(content);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  }
}

function printLanAddresses() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`[WS] LAN: http://${net.address}:${config.wsPort}`);
      }
    }
  }
}
