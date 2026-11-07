// P0.1: with --lan the server listens on all interfaces, but /connect still refuses
// requests that arrive from a non-loopback address. Uses this machine's real LAN IP;
// skipped when the machine has none (e.g. some CI sandboxes).
import "./helpers/test-env.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { networkInterfaces } from "os";
import { config } from "../config.js";
import { wsChannel, getListeningAddress, setPairCode } from "../ws-server.js";
import { httpRequest } from "./helpers/http.js";

function lanIPv4(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family === "IPv4" && !n.internal) return n.address;
    }
  }
  return null;
}

const lanIp = lanIPv4();

describe("gateway in LAN mode", { skip: lanIp ? false : "no non-loopback IPv4 interface" }, () => {
  let port = 0;
  before(async () => {
    config.wsPort = 0;
    config.listenHost = "0.0.0.0";
    assert.ok(await wsChannel.init(() => {}));
    port = getListeningAddress()!.port;
    setPairCode("ABCD2345");
  });
  after(() => wsChannel.destroy?.());

  it("refuses /connect from a LAN address", async () => {
    const r = await httpRequest({ host: lanIp!, port, path: "/connect", headers: { host: `${lanIp}:${port}` }, localAddress: lanIp! });
    assert.equal(r.status, 403);
    assert.equal(r.body.includes("sessionToken"), false);
  });

  it("refuses /connect from a LAN address even with a spoofed localhost Host header", async () => {
    const r = await httpRequest({ host: lanIp!, port, path: "/connect", headers: { host: `localhost:${port}` }, localAddress: lanIp! });
    assert.equal(r.status, 403);
  });

  it("still lets LAN devices pair with the pair code", async () => {
    const r = await httpRequest({ host: lanIp!, port, path: "/pair/validate", method: "POST", headers: { host: `${lanIp}:${port}` }, body: JSON.stringify({ code: "abcd2345" }), localAddress: lanIp! });
    assert.equal(r.status, 200);
    assert.ok(r.json().sessionToken);
  });

  it("still answers /connect on loopback", async () => {
    const r = await httpRequest({ port, path: "/connect", headers: { host: `localhost:${port}` } });
    assert.equal(r.status, 200);
  });
});
