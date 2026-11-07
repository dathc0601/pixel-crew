// P0.3: previews are served from a separate origin and always sandboxed.
import "./helpers/test-env.js";
import { TEST_HOME } from "./helpers/test-env.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "http";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { previewServer } from "@pixel-crew/orchestrator";
import { config } from "../config.js";
import { wsChannel, getListeningAddress, getPreviewAddress, PREVIEW_CSP } from "../ws-server.js";
import { httpRequest, openWs } from "./helpers/http.js";

describe("preview isolation (P0.3)", () => {
  let port = 0;
  let previewPort = 0;
  before(async () => {
    const site = join(TEST_HOME, "site");
    mkdirSync(site, { recursive: true });
    writeFileSync(join(site, "index.html"), "<script>localStorage.getItem('office_connection')</script>");
    writeFileSync(join(TEST_HOME, "secret.txt"), "do not serve");
    previewServer.setStaticDir(join(site, "index.html"));
    config.wsPort = 0;
    assert.ok(await wsChannel.init(() => {}));
    port = getListeningAddress()!.port;
    previewPort = getPreviewAddress()!.port;
  });
  after(() => {
    wsChannel.destroy?.();
    previewServer.clearStatic();
  });

  it("uses a different port, hence a different origin, from the control UI", () => {
    assert.ok(previewPort > 0);
    assert.notEqual(previewPort, port);
    assert.equal(getPreviewAddress()!.host, "127.0.0.1");
  });

  it("the control origin redirects preview URLs to the preview origin", async () => {
    const r = await httpRequest({ port, path: "/preview-static/index.html", headers: { host: `localhost:${port}` } });
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, `http://localhost:${previewPort}/preview-static/index.html`);
    assert.notEqual(r.headers["content-type"], "text/html");
  });

  it("preview responses carry a CSP sandbox without allow-same-origin", async () => {
    const r = await httpRequest({ port: previewPort, path: "/preview-static/", headers: { host: `localhost:${previewPort}` } });
    assert.equal(r.status, 200);
    assert.match(r.body, /localStorage/);
    const csp = String(r.headers["content-security-policy"]);
    assert.match(csp, /^sandbox /);
    assert.ok(!csp.includes("allow-same-origin"));
    assert.equal(r.headers["access-control-allow-origin"], "*");
    assert.equal(PREVIEW_CSP.includes("allow-same-origin"), false);
  });

  it("the preview origin cannot obtain a session token", async () => {
    const own = await httpRequest({ port: previewPort, path: "/connect", headers: { host: `localhost:${previewPort}` } });
    assert.equal(own.status, 404);
    const cross = await httpRequest({ port, path: "/connect", headers: { host: `localhost:${port}`, origin: `http://localhost:${previewPort}` } });
    assert.equal(cross.status, 403);
    assert.equal(cross.headers["access-control-allow-origin"], undefined);
    await assert.rejects(openWs(`ws://127.0.0.1:${port}`, `http://localhost:${previewPort}`), (e: any) => e.status === 403);
  });

  it("blocks path traversal out of the preview root", async () => {
    const r = await httpRequest({ port: previewPort, path: "/preview-static/..%2Fsecret.txt", headers: { host: `localhost:${previewPort}` } });
    assert.equal(r.status, 403);
    assert.ok(!r.body.includes("do not serve"));
  });

  it("through the tunnel (single port) previews are served in place, still sandboxed", async () => {
    const r = await httpRequest({ port, path: "/preview-static/", headers: { host: "office.example.com", "cf-ray": "test" } });
    assert.equal(r.status, 200);
    assert.match(String(r.headers["content-security-policy"]), /^sandbox /);
  });

  it("proxied app previews get the sandbox too, and the app never sees the null Origin or cookies", async (t) => {
    let seen: Record<string, unknown> = {};
    const app: Server = createServer((req, res) => {
      seen = req.headers;
      res.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'self'", "Access-Control-Allow-Origin": "https://evil.example" });
      res.end("<h1>app</h1>");
    });
    const listening = await new Promise<boolean>((resolve) => {
      app.once("error", () => resolve(false));
      app.listen(previewServer.commandPort, "127.0.0.1", () => resolve(true));
    });
    if (!listening) { t.skip(`port ${previewServer.commandPort} busy`); return; }
    try {
      const r = await httpRequest({ port: previewPort, path: "/preview-app/", headers: { host: `localhost:${previewPort}`, origin: "null", cookie: "a=b" } });
      assert.equal(r.status, 200);
      const csp = r.headers["content-security-policy"];
      const list = Array.isArray(csp) ? csp : String(csp).split(/,\s*/);
      assert.ok(list.some((c) => c.startsWith("sandbox ")));
      assert.ok(list.some((c) => c.includes("default-src 'self'")), "upstream CSP kept");
      assert.equal(r.headers["access-control-allow-origin"], "*");
      assert.equal(seen.origin, undefined);
      assert.equal(seen.cookie, undefined);
    } finally {
      app.close();
    }
  });
});
