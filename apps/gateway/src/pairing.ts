/**
 * Pairing v2 (P5.4): one-time `…/pair#<token>` links shown as QR codes in the office
 * settings panel and in the terminal.
 *
 * The token sits in the URL fragment, so it never reaches server logs or proxies; the
 * phone's pair page POSTs it to /pair/exchange, which trades it once for a device-bound
 * session token (see security.ts: PairingTokenStore, SessionTokenStore).
 */
import { networkInterfaces } from "os";
import qrcode from "qrcode-generator";
import type { UserRole } from "@pixel-crew/shared";

export interface PairUrlContext {
  port: number;
  listenHost: string;
  publicUrl?: string;
  tunnelBaseUrl?: string;
}

/** LAN IPv4 addresses of this machine (non-internal interfaces). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out;
}

/**
 * Base URLs a phone could use, best first: the configured public HTTPS address
 * (Tailscale serve, reverse proxy), the Cloudflare tunnel, LAN addresses when the
 * gateway listens on the LAN, and finally localhost (this machine only).
 */
export function pairBaseUrls(ctx: PairUrlContext, lan: string[] = lanAddresses()): string[] {
  const urls: string[] = [];
  if (ctx.publicUrl) urls.push(ctx.publicUrl);
  if (ctx.tunnelBaseUrl) urls.push(ctx.tunnelBaseUrl);
  if (ctx.listenHost !== "127.0.0.1") for (const ip of lan) urls.push(`http://${ip}:${ctx.port}`);
  urls.push(`http://localhost:${ctx.port}`);
  return [...new Set(urls)];
}

/** Why a phone may not be able to open the link (shown next to the QR code). */
export function pairWarning(baseUrl: string): string | undefined {
  const host = new URL(baseUrl).hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return "This gateway only listens on this computer. Start it with --lan, or set publicUrl (for example a Tailscale serve address), so a phone can open this link.";
  }
  if (baseUrl.startsWith("http://")) {
    return "Plain http on the LAN: the page works, but it cannot be installed as an app. Use Tailscale serve for HTTPS.";
  }
  return undefined;
}

export function pairLinkUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/pair#${token}`;
}

/** QR code of `text` as rows of "1"/"0" modules (error correction M, auto size). */
export function qrModules(text: string): { size: number; modules: string } {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  let modules = "";
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) modules += qr.isDark(r, c) ? "1" : "0";
  return { size, modules };
}

/** The QR code for a terminal: two rows per line with half blocks, plus a quiet zone. */
export function qrTerminal(text: string): string {
  const { size, modules } = qrModules(text);
  const dark = (r: number, c: number) => r >= 0 && c >= 0 && r < size && c < size && modules[r * size + c] === "1";
  const lines: string[] = [];
  const pad = 2;
  for (let r = -pad; r < size + pad; r += 2) {
    let line = "";
    for (let c = -pad; c < size + pad; c++) {
      const top = dark(r, c);
      const bottom = dark(r + 1, c);
      // Light modules are drawn in the text colour, dark ones are left as background: the right
      // polarity on dark terminals (light terminals show it inverted; the text link is printed too)
      line += !top && !bottom ? "█" : !top ? "▀" : !bottom ? "▄" : " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export const ROLE_LABEL: Record<UserRole, string> = {
  owner: "owner (full control)",
  collaborator: "collaborator",
  spectator: "spectator (watch only)",
};
