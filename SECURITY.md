# Security policy

Pixel Crew starts AI coding agents that can read, write and run code on your machine. We treat anything that lets someone else drive those agents as a serious bug.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub Security Advisories:
**[Report a vulnerability](https://github.com/dathc0601/pixel-crew/security/advisories/new)** (the repository's **Security** tab → **Report a vulnerability**).

Please include:
- what an attacker can do, and from where (a web page you visit, the LAN, a paired phone, a malicious repo);
- the steps to reproduce, and the version or commit;
- your OS, and how the gateway was started (`--lan`, a tunnel, the desktop app).

This is a hobby project maintained in spare time. You should get a reply within 7 days. We will agree on a disclosure date with you, normally once a fixed release is out, and credit you in the advisory unless you prefer otherwise.

## Supported versions

Only the latest release, and the `master` branch, get security fixes.

## Threat model

### What we protect

The gateway can start Claude Code with tools enabled, inside the folders you point it at. Whoever can send it commands can effectively run code as your user. The assets are therefore:

1. **control of the gateway**: owner sessions, pairing links and pair codes;
2. **your files and repos**, which the agents can read and change;
3. **your credentials**: the AI CLIs keep their own logins, and Pixel Crew never stores API keys in its config.

### Attackers we design against

| Attacker | Example | Defense |
|---|---|---|
| A web page in your browser | `fetch("http://localhost:9090/connect")`, DNS rebinding, a cross-site WebSocket | The gateway binds to loopback. `/connect` needs a loopback socket, a loopback `Host` and an absent or trusted `Origin`. CORS uses an allowlist. WebSocket upgrades from foreign origins are rejected. |
| Someone on your network | Scanning for port 9090 | Loopback-only by default; LAN access needs `--lan`. Pair codes are 8 characters and rate-limited. QR pairing links carry 128 random bits and are single-use with a 2-minute lifetime. |
| A lost or stolen phone | A paired device that should no longer have access | Device-bound sessions expire (7 days by default, `sessionTtlMs`) and can be revoked one by one, or all at once, in Office settings. Tokens are stored hashed on disk. |
| Agent-generated or prompt-injected HTML | A preview page trying to read the UI's token | Previews run on a separate port (a different origin), with a CSP `sandbox` header and a sandboxed iframe. |
| A proxy or tunnel in front of the gateway | Tailscale serve or a reverse proxy making remote requests look local | `/connect` refuses proxied requests; remote devices must pair. |
| XSS in the UI reaching native code | A payload trying to use the desktop shell | The Tauri webview has no shell permissions, no global Tauri object and no `'unsafe-eval'`. |

### Agent permissions

- Claude Code runs with `--permission-mode auto` by default.
- A backend without an auto mode asks you, the Boss, to approve before every run. It never falls back to bypass silently.
- Bypass (`--dangerously-skip-permissions` and the like) is only possible as an explicit per-backend opt-in in `config.json` (`"backendPermissions": {"claude": "bypass"}`).
- The Lead runs without tools unless the lead policy allows otherwise. The gateway enforces the policy with CLI flags, not with prompts.
- The gateway refuses to run as root unless started with `--allow-root`. It writes nothing under `~/.claude/`: role packs are passed per run with `--agents <file>` from the Pixel Crew data dir. At startup it deletes a role pack copy that an older version left in `~/.claude/agents/`, but only when the file is byte-identical to a pack Pixel Crew shipped. Files with any other content are kept.

### Out of scope

- **Prompt injection through the repo you work on.** Files, issues and dependencies can contain instructions an agent follows. Pixel Crew cannot fully prevent this: treat the repo as untrusted input, and use worktrees with approvals for code you don't trust.
- What the AI CLIs themselves do with your code and prompts. That is between you and the vendor.
- Exposing the gateway with a raw port forward, or turning on bypass for a backend. Both are your explicit choice.
- Attackers who already run code as your user.

## Operating guidance

- Keep the default loopback bind. For phone access, use Tailscale serve or a tunnel with authentication, such as Cloudflare Access. Never use a raw port forward. See [docs/mobile.md](docs/mobile.md).
- Run agents in worktrees (the default) and leave approval or auto mode on.
- Keep API keys in the vendor CLIs' own credential stores, never in `~/.pixel-crew/config.json`.
- Revoke devices you no longer use (**Office settings → Paired devices**, or press `r` in the gateway terminal to revoke all).
- Ably and Telegram are optional cloud channels and are off by default. Ably routes commands through a third party. An empty Telegram allowlist denies everyone.
- `gateway.log` contains your prompts. It is capped at 5 MB with two rotated copies, under `~/.pixel-crew/data/instances/`.

## Telemetry and privacy

**Pixel Crew has no telemetry.** It sends no analytics, crash reports, usage pings or update checks, and the web UI loads no third-party scripts, fonts or beacons. The fonts are self-hosted. This was checked for the 0.2.0 release by searching the code for analytics SDKs, `sendBeacon` and outbound URLs.

The only network connections are the ones you set up:
- the AI CLIs you run (for example Claude Code talking to Anthropic);
- optional channels you configure yourself: Ably, Telegram, or a Cloudflare tunnel (`cloudflared`).

If a change ever adds telemetry, it must be opt-in, off by default and documented here first.
