// Portable process helpers (P5.1). These run on every CI OS; the Windows-only cases
// (PATHEXT, .cmd shims) are skipped elsewhere and the Unix-only ones on Windows.
import "./helpers/env.js";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { isPidAlive, killTree, npmShimTarget, pathExtensions, planSpawn, resolveCommand, spawnPortable, spawnPortableSync } from "../proc.js";

const isWindows = process.platform === "win32";
const dir = mkdtempSync(path.join(tmpdir(), "pixel-crew-proc-"));
after(() => rmSync(dir, { recursive: true, force: true }));

/** A JS script that prints its argv as JSON. */
const echoScript = path.join(dir, "echo-args.mjs");
writeFileSync(echoScript, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");

/** Install `name` on a private PATH the way npm would on this OS. */
function installShim(name: string): void {
  if (isWindows) {
    // The shape npm's cmd-shim writes for a node bin
    writeFileSync(path.join(dir, `${name}.cmd`), [
      "@ECHO off",
      "GOTO start",
      ":find_dp0",
      "SET dp0=%~dp0",
      "EXIT /b",
      ":start",
      "SETLOCAL",
      "CALL :find_dp0",
      "",
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ") ELSE (",
      '  SET "_prog=node"',
      "  SET PATHEXT=%PATHEXT:;.JS;=;%",
      ")",
      "",
      `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\echo-args.mjs" %*`,
      "",
    ].join("\r\n"));
  } else {
    const file = path.join(dir, name);
    writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${echoScript}" "$@"\n`);
    chmodSync(file, 0o755);
  }
}
installShim("fake-cli");
const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}` };

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnPortable(command, args, { env, stdio: ["ignore", "pipe", "pipe"], group: true });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${err}`))));
  });
}

describe("command lookup", () => {
  it("finds a command on PATH in-process, with PATHEXT on Windows", () => {
    const found = resolveCommand("fake-cli", env);
    assert.ok(found, "fake-cli resolves");
    assert.equal(path.dirname(found!), dir);
    if (isWindows) assert.equal(path.extname(found!).toLowerCase(), ".cmd");
    assert.equal(resolveCommand("definitely-not-a-command-xyz", env), null);
  });

  it("resolves absolute paths as given", () => {
    assert.equal(resolveCommand(process.execPath, env), process.execPath);
  });

  it("reads PATHEXT only on Windows", () => {
    assert.deepEqual(pathExtensions({ PATHEXT: ".EXE;.CMD" }, "win32"), [".exe", ".cmd"]);
    assert.deepEqual(pathExtensions({}, "win32"), [".com", ".exe", ".bat", ".cmd"]);
    assert.deepEqual(pathExtensions({ PATHEXT: ".EXE" }, "linux"), [""]);
  });
});

describe("spawning", () => {
  // Prompts are multi-line and full of quotes; cmd.exe would cut them at the first newline.
  const tricky = ["line one\nline two", 'say "hi" & echo pwned', "100% ^caret | pipe > out", "", "tab\there"];

  it("passes multi-line, quoted arguments through an installed CLI shim unchanged", async () => {
    const out = await run("fake-cli", tricky);
    assert.deepEqual(JSON.parse(out), tricky);
  });

  it("unwraps npm .cmd shims to node + script on Windows (no cmd.exe)", { skip: !isWindows }, () => {
    const shim = resolveCommand("fake-cli", env)!;
    assert.equal(npmShimTarget(shim), echoScript);
    const plan = planSpawn("fake-cli", ["x"], env);
    assert.equal(plan.viaShell, false);
    assert.deepEqual(plan.args, [echoScript, "x"]);
  });

  it("runs a non-node batch file through cmd.exe quoting (cross-spawn)", { skip: !isWindows }, () => {
    writeFileSync(path.join(dir, "plain.bat"), "@echo off\r\necho %~1\r\n");
    const plan = planSpawn("plain", ["a b"], env);
    assert.equal(plan.viaShell, true);
    const r = spawnPortableSync("plain", ["hello world"], { env, encoding: "utf-8" });
    assert.equal(String(r.stdout).trim(), "hello world");
  });

  it("spawnPortableSync runs a shim and returns its output", () => {
    const r = spawnPortableSync("fake-cli", ["--version"], { env, encoding: "utf-8" });
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(String(r.stdout)), ["--version"]);
  });
});

describe("killTree", () => {
  it("kills a process and the child it started", async () => {
    // parent prints its child's pid, then both idle forever
    const parentScript = path.join(dir, "parent.mjs");
    writeFileSync(parentScript, [
      'import { spawn } from "node:child_process";',
      'const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
      "process.stdout.write(String(c.pid) + \"\\n\");",
      "setInterval(() => {}, 1000);",
    ].join("\n"));
    const parent = spawnPortable(process.execPath, [parentScript], { stdio: ["ignore", "pipe", "ignore"], group: true });
    const childPid = await new Promise<number>((resolve, reject) => {
      parent.stdout?.once("data", (d) => resolve(Number(String(d).trim())));
      parent.once("error", reject);
    });
    assert.ok(isPidAlive(childPid), "grandchild is running");
    assert.equal(killTree(parent.pid, "SIGKILL", { sync: true }), true);
    const deadline = Date.now() + 5000;
    while ((isPidAlive(childPid) || isPidAlive(parent.pid!)) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(isPidAlive(parent.pid!), false, "parent is gone");
    assert.equal(isPidAlive(childPid), false, "grandchild is gone too");
  });

  it("returns false for nothing to kill", () => {
    assert.equal(killTree(undefined), false);
    assert.equal(killTree(0), false);
  });
});
