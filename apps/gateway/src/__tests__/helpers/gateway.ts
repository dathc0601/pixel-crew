// A real gateway process in demo mode for end-to-end tests (fake agents, no tokens).
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const gatewayDir = path.resolve(here, "..", "..", "..");
const entry = path.join(gatewayDir, "src", "index.ts");

export interface Gateway { child: ChildProcess; port: number; output: string[] }

export function startGateway(home: string, workspace: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<Gateway> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PIXEL_CREW_HOME: home,
      WORKSPACE: workspace,
      WS_PORT: String(20000 + Math.floor(Math.random() * 20000)),
      GATEWAY_ID: "e2e",
      NO_OPEN: "1",
      PIXEL_CREW_DEMO_DELAY_SCALE: "0.05",
      ...extraEnv,
    };
    delete env.NODE_ENV;
    delete env.PIXEL_CREW_LAN;
    delete env.ABLY_API_KEY;
    delete env.TELEGRAM_BOT_TOKEN;
    const child = spawn(process.execPath, ["--import", "tsx", entry, "--demo"], {
      cwd: gatewayDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const output: string[] = [];
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`gateway did not start:\n${output.slice(-40).join("\n")}`)), 30_000);
    child.stdout!.on("data", (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        output.push(line);
        const m = line.match(/^GATEWAY_READY (.*)$/);
        if (m) {
          clearTimeout(timer);
          resolve({ child, port: JSON.parse(m[1]).port, output });
        }
      }
    });
    child.stderr!.on("data", (d: Buffer) => output.push(`[stderr] ${d.toString().trim()}`));
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`gateway exited early (${code}):\n${output.slice(-40).join("\n")}`)); });
  });
}
