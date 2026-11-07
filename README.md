<div align="center">

# Pixel Crew

### A pixel-art office where a small crew of AI coding agents works as one team.

Fork of [longyangxi/OpenOffice](https://github.com/longyangxi/OpenOffice) (formerly "bit-office"), MIT.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/dathc0601/pixel-crew/pulls)

**Supports Claude, Codex, Gemini, Copilot, Cursor, Aider, OpenCode, Pi & Sapling — one team 🚀**


[Quick Start](#quick-start) | [Features](#features) | [Architecture](#architecture) | [Contributing](#contributing)

</div>

---
![Image](https://github.com/user-attachments/assets/ecfcd88b-e72e-4b04-bdd7-87eea9f00b51)


## Features
- **8 AI backends, 23 roles** — Claude, Codex, Gemini, Copilot, and more in one pipeline  
- **Team-based delivery** — Leader coordinates planning, coding, review, and release  
- **Parallel collaboration** — Worktree isolation with auto commit, merge, and undo  
- **Flexible code review** — Mix Claude Code, Codex, or any tool you prefer  
- **Preview & feedback** — Live preview, rating, and continuous learning  
- **Persistent memory** — 4-layer memory across sessions and agents  
- **Telegram Control** — Manage your agent team remotely  
- **Native desktop app** — Tauri-based app with system notifications  
- **Token cost tracking** — Real-time usage per agent and team  

## Quick Start

Pixel Crew is not published to npm yet. Run it from source (see below).

By default the daemon listens on `127.0.0.1` only and runs Claude Code with `--permission-mode auto`. See [Security defaults](#security-defaults).

## Learn More

- **Team workflow** — how agents plan, execute, and deliver ([view](team-workflow.md))  
- **Collaboration system** — multi-agent orchestration and worktree isolation ([view](packages/orchestrator/README.md))  
- **Memory design** — four-layer persistent memory architecture ([view](packages/memory/README.md))  

## Run from Source

### Prerequisites

- **Node.js** 22+
- **pnpm** 9
- At least one AI CLI installed (see [Supported Backends](#supported-backends))

### Setup

```bash
git clone https://github.com/dathc0601/pixel-crew.git
cd pixel-crew
pnpm install
pnpm dev
```

## Desktop App (Tauri)

Pixel Crew also ships as a native **macOS desktop app** powered by [Tauri](https://tauri.app). 

### Prerequisites

- **Node.js** 22+, **pnpm**
- **Rust** toolchain — install via: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

### Dev Mode

```bash
pnpm dev:desktop
```


### Build Release

```bash
pnpm build:desktop
```

Produces `Pixel Crew.app` and `.dmg` at:
```
apps/desktop/src-tauri/target/release/bundle/macos/Pixel Crew.app
apps/desktop/src-tauri/target/release/bundle/dmg/Pixel Crew_0.1.0_aarch64.dmg
```

## Supported Backends

Pixel Crew auto-detects installed AI CLIs at startup. Each backend has its own instruction file convention and capability set.

| Backend | Command | Stability | Guard | Instruction File | Resume | Structured Output | Tested |
|---|---|---|---|---|---|---|---|
| **Claude Code** | `claude` | Stable | Hooks | `.claude/CLAUDE.md` | Yes | Yes (stream-json) | ✅ |
| **Codex CLI** | `codex` | Stable | Sandbox (Seatbelt/Landlock) | `AGENTS.md` | — | — | ✅ |
| **Gemini CLI** | `gemini` | Beta | `--sandbox` flag | `GEMINI.md` | — | — | — |
| **GitHub Copilot** | `copilot` | Experimental | — | `.github/copilot-instructions.md` | — | — | — |
| **Cursor CLI** | `agent` | Experimental | — | `.cursor/rules/instructions.md` | — | — | — |
| **Aider** | `aider` | Experimental | — | `.aider.conf.yml` | — | — | — |
| **OpenCode** | `opencode` | Experimental | — | `AGENTS.md` | — | Yes (json) | — |
| **Pi** | `pi` | Experimental | — | `.claude/CLAUDE.md` | — | — | — |
| **Sapling** | `sp` | Experimental | — | `SAPLING.md` | — | Yes (json) | — |

> ✅ = actively tested in production workflows. Other backends have not yet verified end-to-end.
>
> Backends with ambiguous binary names (`agent`, `pi`, `sp`) use version-probe detection to avoid false positives.

## Architecture

```
pixel-crew/
├── apps/
│   ├── web/            # Next.js PWA + Canvas 2D pixel office + control UI
│   ├── gateway/        # Runtime daemon: events, channels, policy, orchestration
│   └── desktop/        # Tauri v2 native shell (macOS .app/.dmg)
└── packages/
    ├── memory/         # Four-layer persistent memory (L0–L3)
    ├── orchestrator/   # Multi-agent execution engine
    └── shared/         # Typed command/event contracts (Zod schemas)
```

**Channels**: WebSocket (always on), Ably (optional), Telegram (optional)

## Tech Stack

- **Frontend**: Next.js 15 (static export), React 19, Canvas 2D renderer, Zustand
- **Desktop**: Tauri v2 (Rust + system WebView)
- **Backend**: Node.js daemon, WebSocket
- **Memory**: Four-layer JSON store (session → agent → shared), Jaccard dedup
- **Protocol**: Zod-validated event schemas
- **Integrations**: Ably, Telegram, external process detection

## Security defaults

- The daemon binds to `127.0.0.1`. LAN access needs an explicit `--lan` flag (or `"lan": true` in the config file); remote devices then pair with the pair code.
- `GET /connect` (quick connect) answers only loopback requests from the UI's own origin. CORS uses an allowlist, and WebSocket upgrades from foreign origins are rejected.
- Pairing and share-link endpoints are rate-limited. Session tokens expire after 7 days; the owner can revoke all other sessions.
- Agents run Claude Code with `--permission-mode auto`. Backends without an auto mode ask you (the CEO) to approve before each spawn. Bypass mode is only used for a backend you opt into explicitly in the config file.
- The daemon refuses to run as root unless started with `--allow-root`.
- Previews are served from a separate port and sandboxed, so preview code cannot read the control UI's storage.

## Contributing

Issues and PRs are welcome. If you're exploring AI-native dev tooling, workflows, or interfaces, Pixel Crew is a great playground for experiments.

## Credits

- Fork of [longyangxi/OpenOffice](https://github.com/longyangxi/OpenOffice) (formerly "bit-office"), MIT.
- The pixel office (character and wall sprites, sprite data, default layout and the Canvas 2D engine) is derived from [pixel-agents](https://github.com/pablodelucca/pixel-agents) by Pablo De Lucca, MIT.
- Character sprites are based on JIK-A-4's [Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) pack, CC0.

Full license texts and the list of assets that are deliberately not shipped are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE) - feel free to use, modify, and distribute.

---

<div align="center">

**If Pixel Crew helps your workflow, consider giving it a star!**

</div>
