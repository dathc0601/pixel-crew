# Fork Improvement Plan: from "Open Office" to a pixel-art AI mini company

Date: 2026-11-07
Status: owner decisions recorded (§0). Phase 0 merged (2026-11-07). Phase 1 (daemon and UI) implemented on branch `phase-1-boss-flow` (2026-11-07), with a token-free demo mode (`pnpm dev:demo`). Phase 3 (office layout, rooms, art) implemented on branch `phase-3-office-art` (2026-11-07). Phase 4 (performance) implemented on branch `phase-4-performance` (2026-11-07); measurements in `docs/perf/baseline-2026-11-07.md`. See the status lines under each item.
Scope: `~/WebstormProjects/OpenOffice`. `origin` is `github.com/dathc0601/pixel-crew` (renamed from OpenOffice on 2026-11-07); `upstream` is `github.com/longyangxi/OpenOffice` (formerly "bit-office", MIT).

Legend used throughout:
- **[V]** I verified it in this session (code read, command run, or page fetched).
- **[I]** inferred from code reading, not exercised at runtime.
- **[U]** unverified; needs a check before relying on it.

---

## 0. Owner decisions (2026-11-07). These override anything below that conflicts.

1. **Name: Pixel Crew.** Package/CLI name `pixel-crew` (free on npm, checked). Data dir `~/.pixel-crew/` (dev: `~/.pixel-crew-dev/`), migrating from `~/.open-office[-dev]/` on first run. Tauri `productName` "Pixel Crew", identifier `dev.pixelcrew.app`. GitHub repo already renamed.
2. **Agent permissions: default `auto`.** Claude Code supports `--permission-mode auto` (verified on the CLI, v2.1.319). This replaces both today's `--dangerously-skip-permissions` default and §P0.2's proposed "safe" default. Any backend that has no auto mode must **ask the CEO** (the UI user) through an approval prompt **before the agent is spawned**. It must never fall back to bypass silently. Bypass stays available only as an explicit opt-in per backend.
3. **Lead policy is user-configurable**, in the config file **and** through toggles in the office UI. The owner should never need to edit the file by hand. Defaults:
   - `lead.selfWork = "never"`: the Lead does not do dev work itself.
   - `lead.subagents = "when_all_devs_busy"`: the Lead may spawn subagents only when every dev is busy.
   - This replaces the §7.3 defaults. Per-task overrides in the Boss composer (P1.5) still apply. The daemon enforces the policy; the prompt only explains it.
4. **The hand-off walk delays real work.** Default `handoff.durationMs = 2500`: about 1.9 s of walking plus about 0.6 s of handing over the paper. The range is 0–10000, and 0 means instant. The daemon owns the timer. It never waits for a client acknowledgement, and the scene scales walking speed to fit the duration. It is editable in the config file and the office UI. This replaces the §7.4 `handoffDelayMs` of 1200.
5. **v1 is Claude Code only.** Phase 2 (ACP, other vendors, Antigravity) moves to a later version. When it starts, port logic from projects that already integrate those CLIs (pixtuoid, acpx, claw-orchestrator, ORCH) and credit them.
6. **Upstream PR for the P0.1 security fix: deferred.** Fix it in the fork first. Ask the owner again when the project is complete.

**Status (2026-11-07):** the `office` section is implemented (zod schema in `packages/shared/src/office-config.ts`, loader + hot reload in `apps/gateway/src/office-config.ts`, plus `backendPermissions` for the per-backend bypass opt-in). Dispatcher enforcement and the owner-only office settings panel (`ui/OfficeSettingsPanel.tsx`, incl. "Revoke all devices") landed in Phase 1.

**Config file shape** (in `~/.pixel-crew/config.json`; the daemon hot-reloads on file change; UI edits go through an owner-authenticated command and are written back to the file):
```json
{
  "office": {
    "permissionMode": "auto",
    "lead": { "selfWork": "never", "subagents": "when_all_devs_busy", "waitMs": 120000 },
    "handoff": { "durationMs": 2500 }
  }
}
```

---

## 1. Executive summary

The fork already has most of the plumbing the vision needs:
- a Node daemon (`apps/gateway`) that spawns nine AI CLIs, with a per-agent backend choice;
- a multi-agent orchestrator with a Team Lead, phases, review loops and git-worktree isolation;
- a Zod-typed WebSocket protocol;
- a static-exported Next.js PWA with a pixel office. That office uses **Canvas 2D, not PixiJS** [V]: there is no `pixi.js` dependency and the README is wrong about it. It has BFS pathfinding and an idle-sleeping render loop.

What is missing is the **company metaphor**:
- there is no Boss character;
- nobody walks to anybody;
- the Lead picks developers *by name* in free text (`@Name: task`), rather than a dispatcher picking an *idle* developer;
- the Lead is hard-locked into delegate-only mode with no permission model;
- there is no ACP or Antigravity support;
- attached (external) sessions are view-only and detected through `ps`/`lsof` CPU heuristics.

Three things must be fixed **before anything is shared publicly**:
1. **A critical remote-control hole** [I, by code reading; not exploited live]. `GET /connect` hands out an *owner* session token to anyone who can reach the port. The server listens on all interfaces and sends `Access-Control-Allow-Origin: *`. Agents run with `--dangerously-skip-permissions` by default. Together, any web page you visit, or anyone on your LAN, can drive your agents, which amounts to remote code execution. See §8.
2. **Art licensing hygiene.** The characters, walls, sprite code and default layout are MIT assets from pablodelucca/pixel-agents, but without the required copyright notice. There is also an optional loader for a paid, non-redistributable tileset (Donarg). The 12 themed office backgrounds have unknown provenance. See §4.
3. **The name.** "OpenOffice" is an Apache Software Foundation trademark [U, general knowledge; confirm], and the npm name `open-office` belongs to an unrelated package [V]. Rename early, before the protocol and package names spread.

Top-level recommendations:
- **Keep the current stack for the MVP**: Next.js static export + Canvas 2D + Zustand + Node daemon + Tauri shell. Do not add PixiJS. Re-evaluate Vite + Preact only after the performance phase measures a real win (§7.1).
- **Introduce an `AgentDriver` abstraction** with three implementations:
  - `LegacyCliDriver`, which is today's spawn-per-task code, moved as-is;
  - `AcpDriver`, built on `acpx`'s runtime library, which gives persistent sessions, Antigravity and about 30 agents;
  - `ClaudeHooksObserver`, which reads status from attached Claude Code sessions.

  Make ACP the default for every new vendor.
- **Replace `@Name` targeting with a daemon-side Dispatcher.** The Dispatcher owns a shared work-item pool, picks idle developers, makes the Lead wait when nobody is free, and enforces the Boss's "urgent / allow lead self-work / allow subagents" flags in code, not in prompts.
- **Keep the walking animation cosmetic and decoupled from execution.** The daemon emits `HANDOFF` events and the scene choreographs them. Work never waits on pixels, except for an optional, configurable delay of at most about 1.5 s so the walk is watchable.
- **Make the fork primarily a `npx`-installed daemon plus a browser/PWA.** The Tauri app becomes an optional thin tray shell for macOS, Windows and Linux. Mobile is a PWA remote over LAN, Tailscale or a tunnel, with proper pairing; it never runs agents itself.

**Branding note (optional).** Pick a name that reads as "tiny pixel company" and is free on npm and GitHub. Candidates (availability **[U]**): `pixel-company`, `agent-office`, `tiny-agency`, `deskside`, `byte-corp`. Rename the npm/bin names (`bit-office`), the workspace packages (`@bit-office/*`, `@office/shared`), the data dir (`~/.open-office`), the Tauri identifier (`com.openoffice.desktop`) and the README in one Phase 0 commit.

---

## 2. Current architecture (with file references)

### 2.1 Monorepo layout [V]
| Path | What it is |
|---|---|
| `package.json` | pnpm 9 workspace root; scripts `dev`, `build`, `build:desktop`. `postinstall` calls the missing `scripts/install-agents.sh` (the error is swallowed by `|| true`). |
| `apps/gateway` | Node daemon (npm/bin name `bit-office`, v1.2.5). It is bundled by tsup into `dist/index.js` (459 KB) and copies `apps/web/out` into `dist/web`. |
| `apps/web` | Next.js 15.5 + React 19 + Zustand 5 + Tailwind 3 + Radix. In production it does a static export (`apps/web/next.config.ts:47`, `output: "export"`) and the gateway serves it. |
| `apps/desktop` | Tauri v2 shell (macOS only today) that runs a bundled Node binary and `gateway.js` as a sidecar. |
| `packages/shared` | Zod schemas for commands and events (`commands.ts`, `events.ts`, `types.ts`). |
| `packages/orchestrator` | Agent sessions, delegation, phases, worktrees, preview, prompts. Ships 18 role definitions in `packages/orchestrator/agents/*.md`. |
| `packages/memory` | Four-layer JSON memory store, with the only tests in the repo. |

### 2.2 Daemon (`apps/gateway`)
- **Entry:** `apps/gateway/src/index.ts` (1606 lines).
  - `main()` is at `:1215`. It does setup, backend detection, orchestrator creation (`:1252`), team-state restore, and starts the process scanner (`:1436`).
  - `handleCommand` is a big switch (`:417`) guarded by role-based access control (RBAC) (`ALLOWED`, `:395`). The roles are owner / collaborator / spectator.
- **Channels** (`transport.ts`):
  - WebSocket + HTTP (`ws-server.ts`), always on;
  - Ably cloud relay (`ably-client.ts`), optional;
  - Telegram bot (`telegram-channel.ts`), optional;
  - Cloudflare tunnel (`tunnel.ts`, spawns `cloudflared`).
- **HTTP routes** (`ws-server.ts`):
  - pairing: `/connect` (`:117`), `/pair/validate` (`:137`);
  - share links: `/share/create`, `/share/validate`;
  - `/ably/token`;
  - preview serving: `/preview-static` (`:290`) and a `/preview-app` proxy;
  - the static web UI (`serveStatic`, around `:530`).
  - The WebSocket requires an `AUTH {sessionToken}` first message within 5 s (`:424-465`). Commands are validated with `CommandSchema.parse` (`:470`).
- **Config** (`config.ts`):
  - data dir `~/.open-office[-dev]` (`:12`);
  - port 9090, or 9099 in dev (`:164`);
  - `sandboxMode` defaults to `"full"` (`:181`);
  - per-instance dirs under `data/instances/<gatewayId>`.
- **Backends** (`backends.ts`) cover nine CLIs: claude, codex, gemini, copilot, cursor (`agent`), aider, opencode, pi, sapling. Each defines `buildArgs`.
  - Claude: `-p <prompt> --output-format stream-json --verbose --dangerously-skip-permissions [--resume id]` (`:56-75`).
  - Running as root rewrites `~/.claude/settings.json` to `bypassPermissions` **at module import** (`:13-40`).
  - The Windows path fix from upstream PR #16 is at `:286`.
- **External session discovery:**
  - `process-scanner.ts` runs `ps -eo pid,ppid,pcpu,etime,args` every 7 s (`:120`, `:134`) and `lsof` for cwd (`:89`). Status comes from a CPU heuristic: `cpu >= 5` means working (`:185`).
  - `external-output-reader.ts` tails Claude JSONL in `~/.claude/projects/<cwd with / replaced by ->` (`:93`), using `fs.watch` plus a 3 s poll. For other CLIs it polls `lsof` every 5 s.
  - External agents can be viewed and killed, but **not assigned work**.

### 2.3 Orchestrator (`packages/orchestrator/src`)
- **`agent-session.ts`** (1203 lines): one `AgentSession` per hired agent, and **one CLI process per task**.
  - `spawn(command, args, {detached: true, stdio: ["ignore","pipe","pipe"]})` is at `:488`.
  - It parses stream-json or plain text.
  - Kills use a process group: `process.kill(-pgid, ...)` at `:735`, `:1061`, `:1107`. This is POSIX only.
  - `which` is called via `execSync` at `:475` (POSIX).
  - Each agent has its own FIFO queue (`taskQueue`, `:219`), and `runTask` queues when the process is busy (`:310-320`).
  - Statuses are `idle | working | waiting_approval | done | error` (`packages/shared/src/types.ts:3`).
  - `requestApproval()` (`:1154`) exists but nothing calls it [V]. The approval UI is effectively dead, because agents run with permission bypass.
- **Delegation** (`delegation.ts`):
  - The Lead's stdout is scanned with `DELEGATION_RE = /^...@(\w+):\s*(.+)$/` (`agent-session.ts:512`). Each match calls `onDelegation`, then `DelegationRouter.wireDelegation` (`delegation.ts:185-300`), which resolves the target **by name** (`agentManager.findByName`, `agent-manager.ts:68`) and calls `target.runTask`, which queues if that agent is busy.
  - Limits (`config.ts`): depth 5, 20 delegations in total, 7 leader rounds, 3 review rounds. Timeouts are 3 min for the Lead and 30 min for workers.
  - Results are batched back to the Lead with a 20 s window (`delegation.ts:559-600`).
- **Lead constraints:** the Lead runs with `noTools: this._isTeamLead` (`agent-session.ts:463`). Its prompt says "You CANNOT write code, run commands, or use any tools. You can ONLY delegate." (`prompt-templates.ts:59`).
- **Phases:** `phase-machine.ts` runs create → design (plan approval) → execute → complete. Delegation is blocked outside `execute` (`delegation.ts:190`).
- **Team creation:** `CREATE_TEAM` (`apps/gateway/src/index.ts:592-664`) takes a per-member backend map (`backends?.[defId]`), so **multi-vendor teams already work at the protocol level**. Creating a team immediately runs a paid Lead "greet" task (`:660`).
- **Worktrees:** `worktree.ts` gives each agent its own branch, auto-merges on completion, and supports undo. Previews are handled by `preview-server.ts` and `preview-resolver.ts`.

### 2.4 Protocol (`packages/shared`)
- **Commands:** about 35 Zod objects, discriminated on `type` (`commands.ts:227`).
- **Events:** about 33 (`events.ts:305`). Relevant ones are `TASK_DELEGATED` (`:72`), `TASK_QUEUED` (`:126`), `TEAM_CHAT` (`:116`), `AGENT_STATUS`, `TOOL_ACTIVITY` and `TEAM_PHASE`.
- The web client validates every incoming event with `GatewayEventSchema.parse` (`apps/web/src/lib/ws-client.ts:73`), so Zod ships in the client bundle.

### 2.5 Web / pixel office (`apps/web/src`)
- **`app/office/page.tsx`** (2675 lines) is a monolithic page. It also contains a scripted demo with a timeline (`:98-125`).
- **`store/office-store.ts`** (1172 lines) is the Zustand store. It handles events (`TASK_DELEGATED` at `:887`) and trims messages (`:327`).
- **Scene, a pluggable adapter:**
  - `components/office/scene/SceneAdapter.ts:23-28` defines `addAgent / removeAgent / updateAgent / showSpeechBubble / selectAgent / dispose`. It has **no movement or hand-off API**.
  - `useSceneBridge.ts` maps store state to the adapter.
  - `PixelOfficeScene.tsx` and `PixelSceneAdapter.ts` are the pixel implementation.
- **Engine** (a port of pixel-agents):
  - `engine/gameLoop.ts` uses rAF with **render-on-demand**: `isDirty`, and sleep after 10 clean frames. But `needsTick` keeps rAF running whenever any idle character has a wander or seat timer (`engine/officeState.ts:483-489`), which is almost always.
  - `engine/officeState.ts` handles seats, wandering and the "matrix" spawn/despawn effect.
  - `engine/characters.ts` has the states `IDLE / WALK / TYPE` (`types.ts:37-40`).
  - `engine/renderer.ts` uses a sprite cache and a text-measure cache.
  - `layout/tileMap.ts:51` has BFS `findPath` (4-connected, flat queue).
- **Layouts:**
  - `public/pixel-agents-layout.json` is the default.
  - There are 12 themed "office" zips (`public/offices/*.zip`, about 3.2 MB in total). Each holds a 1024×1024 `background.jpeg` plus a `room.json` 64×64 walk grid, loaded by `layout/roomZipLoader.ts` with JSZip.
  - There is a furniture editor (`components/office/editor/*`) and `layout/furnitureCatalog.ts`.
  - `sprites/assetLoader.ts:237-339` optionally loads the gitignored, paid "Office Tileset".
- **Other UI:**
  - Sounds are synthesized with Web Audio (`lib/sound-manager.ts`).
  - Fonts come from the Google Fonts CDN (`app/layout.tsx:21`).
- **Connection** (`lib/connection.ts`, `lib/ws-client.ts`): the client uses WS with reconnect backoff, or Ably. Pairing lives in `app/pair/page.tsx`, which auto-fetches `http://localhost:<port>/connect` (`:13`, `:85`, `:100`). `app/office/page.tsx:523`/`:537` do the same.
- **PWA:**
  - `@ducanh2912/next-pwa` (Workbox) is set up in `next.config.ts:6-21`.
  - `public/manifest.json` has `start_url: /office`, but **both icons are 1×1 placeholders** [V].
  - The service worker is unregistered on `localhost` (an inline script in `layout.tsx`).

### 2.6 Desktop (`apps/desktop`)
- `src-tauri/tauri.conf.json`:
  - bundle targets are `dmg` and `app` only;
  - the CSP includes `'unsafe-eval'`;
  - `withGlobalTauri: true`;
  - resources are `sidecar/node`, `sidecar/gateway.js` and `sidecar/web/`.
- `scripts/build-desktop.sh` copies `$(command -v node)` into the bundle, which adds about 57 MB on this machine [V].
- `src-tauri/src/main.rs`:
  - it resolves PATH through the login shell, with a macOS-only branch (`:121-195`);
  - it kills the gateway with **un-gated** `libc::kill(SIGTERM/SIGKILL)` (`:45-56`), which will not compile on Windows [I].
- `capabilities/default.json` grants `shell:allow-spawn`, `shell:allow-execute` and `shell:allow-stdin-write` to the webview. That is broader than needed.
- Placeholder files were committed under a mistaken nested path: `apps/desktop/src-tauri/apps/desktop/src-tauri/sidecar/{node,gateway.js,web/index.html}` [V].

### 2.7 Tests, CI and repo hygiene [V]
- The only tests are `packages/memory/src/__tests__/*` (node:test + tsx). There is no CI: no `.github/` directory.
- There is no root `typecheck` or `test` script, and no ESLint config, although `web` has a `next lint` script.
- Tracked junk:
  - `.next/trace`, `.next/trace-build` at the repo root;
  - the nested sidecar placeholders;
  - the build artifact `apps/web/public/workbox-a92c5218.js`;
  - an empty `.gitmodules`.
- The README points at `github.com/longyangxi/open-office` (404) and at an npm badge for the unrelated `open-office` package. Its quick start, `npx bit-office`, installs **upstream's** package.
- History: 715 commits, 696 of them in March 2026. Many are agent-authored micro-commits ("Rex:", "Jax:", "[kanban-…]"). Upstream has been dormant since 2026-08-05.

---

## 3. Build and test health (run 2026-11-07, macOS arm64, Node 22.19, pnpm 9.15.4, Rust 1.88)

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ 10.6 s. `postinstall` fails quietly: `scripts/install-agents.sh` does not exist. |
| `tsc --noEmit` `packages/shared` | ✅ |
| `tsc --noEmit` `packages/memory` | ✅ |
| `tsc --noEmit` `packages/orchestrator` | ❌ `src/prompt-templates.ts(406,59)` TS7053, implicit `any` index |
| `tsc --noEmit` `apps/gateway` | ❌ `src/telegram-channel.ts(391,37)` TS2345 (`reply_markup` type), plus the orchestrator error |
| `tsc --noEmit` `apps/web` | ✅ (`next build` type-check also passes) |
| `pnpm test` `packages/memory` | ❌ 53/54 pass. `memory.test.ts:64-78` expects a 10-session ring buffer, but `memory.ts:50` sets `MAX_SESSION_HISTORY = 30`. The test went stale after commit `aeb54d6`. |
| `pnpm --filter web build` | ✅ 19.9 s, static export. `/office` first-load JS is 234 kB, shared 105 kB. `out/` is 5.6 MB, of which `offices/` is 3.2 MB and `_next/` 2.1 MB. One Tailwind warning about the ambiguous `duration-[600ms]`. |
| `pnpm --filter bit-office build` (tsup) | ✅ 459 KB ESM bundle. **tsup does not type-check**, so the two TS errors above ship anyway. |
| `cargo check` (`apps/desktop/src-tauri`) | ❌ on a fresh clone: `resource path sidecar/gateway.js doesn't exist`. ✅ after creating the placeholder sidecar files that `predev` creates. Windows and Linux were **not** tested. |
| Lint | Not run: no ESLint config (`next lint` would prompt) [U]. |
| Runtime smoke test | **Not run.** Starting the gateway triggers the interactive setup and process scanning, and a team immediately runs a paid Lead task. No agent CLI was started. |

Build artifacts left in the working tree (gitignored or untracked, not committed): `node_modules/`, `apps/web/out`, `apps/web/.next`, `apps/gateway/dist/`, `apps/desktop/src-tauri/target/`, and the sidecar placeholders.

---

## 4. Art and asset licensing audit

| Asset | Origin | Terms | Redistributable? | Evidence |
|---|---|---|---|---|
| `apps/web/public/assets/characters/char_0..5.png` | Byte-identical to pixel-agents (git blob SHAs match) [V]. Based on JIK-A-4 "Metro City" [V]. | pixel-agents: MIT, "Copyright (c) 2026 Pablo De Lucca". Metro City: CC0. | Yes, **if the MIT notice is kept** | github.com/pablodelucca/pixel-agents; jik-a-4.itch.io/metrocity-free-topdown-character-pack |
| `apps/web/public/assets/walls.png` | Byte-identical to pixel-agents `walls.png` [V] | MIT (De Lucca) | Yes, with notice | |
| `apps/web/src/components/office/sprites/spriteData.ts` | Adapted from pixel-agents v1.0.2 `spriteData.ts` (68 of about 1150 lines differ) [V] | MIT (De Lucca) | Yes, with notice | |
| `apps/web/public/pixel-agents-layout.json` | Near-identical to pixel-agents `default-layout.json` [V]. It references `ASSET_*` ids that map into the Donarg tileset. | Data, MIT | Yes | `sprites/assetLoader.ts:237-339` |
| `apps/web/public/Office Tileset/` (gitignored, never committed) [V] | Donarg "Office Interior Tileset (16x16)", a paid asset | **Must not be redistributed, even edited**; credit is required [V, itch page] | **No** | donarg.itch.io/officetileset; `.gitignore` |
| `apps/web/public/offices/*.zip` + `*.jpeg` (12 themes) | Each holds a 1024² `background.jpeg` and `room.json`. No credits, no metadata. They look AI-generated (off-grid pixels) [I]. Added in commits `cf2d3be`, `06c08b7`, `d60690c` with no source note [V]. | Unknown | **Unknown, so treat as no** | |
| Fonts: Inter, JetBrains Mono, Press Start 2P | Google Fonts CDN, not bundled [V] | SIL OFL [U, from known terms] | Yes. Self-host for offline/PWA use. | `app/layout.tsx:21` |
| Sounds | Synthesized with Web Audio [V] | Original | Yes | `lib/sound-manager.ts` |
| PWA icons | 1×1 placeholders [V] | n/a | Replace them | |
| Tauri icons / `app-icon.svg` | Generated from an in-repo SVG [I] | Repo MIT | Yes [I] | |

**Required actions (Phase 0):**
1. Add `THIRD_PARTY_NOTICES.md` with the pixel-agents MIT text and copyright line. Credit Metro City (CC0) as a courtesy.
2. Change the README from "inspired by" to "derived from".
3. Remove the Donarg tileset code path (`TILESET_FURNITURE` and its loader), or move it behind an explicit "bring your own tileset" plugin that never ships in releases.
4. Pull the 12 themed backgrounds from releases until their provenance is confirmed by upstream (longyangxi / marklong), or replace them.
5. For new art (rooms, Boss, furniture, documents), use CC0 sources whose license pages were verified: **Kenney** (kenney.nl/support, all CC0) and **Metro City** (CC0). The pixel-agents repo has since migrated to its own MIT "open-source assets" set (upstream PR #117), which is the natural next source because the art style matches. Do not use LPC unless share-alike (CC-BY-SA/GPL) is acceptable [U].

---

## 5. Gap analysis: current state vs vision

| # | Vision feature | Current state | Gap | Where |
|---|---|---|---|---|
| 1 | Separate rooms: Boss room, Dev room with lead area, furniture | One open-plan layout (pixel-agents default), or a single themed background image with a walk grid. There is a furniture editor, but no concept of rooms or zones. | **Large.** Needs zones/rooms in the layout schema and new art. | `layout/*`, `types.ts:143` |
| 2 | Boss = the human, as a character | No Boss or user avatar exists. The user is off-screen, typing into side panels. | **Missing** | — |
| 3 | Click Boss → type task | Tasks are typed into the per-agent/Lead chat pane (`AgentPane.tsx`) | **Missing** (UI entry point) | `app/office/page.tsx` |
| 4 | Boss walks to the Lead and hands over the task | Pathfinding exists (`tileMap.ts:51`), but characters only walk to their own seat or wander | **Missing**: no target-walk or hand-off choreography, and no adapter API for it | `SceneAdapter.ts`, `characters.ts` |
| 5 | Lead walks to an idle dev and hands off | Delegation is shown as a chat message plus a sound | **Missing** | `office-store.ts:887`, `useSoundEffects.ts` |
| 6 | Dispatch to *idle* devs | The Lead names a target with `@Name`. The target's private FIFO queues the work even when other devs are idle. | **Missing**: needs a Dispatcher and shared pool | `delegation.ts:185-300`, `agent-session.ts:310` |
| 7 | Lead waits when no dev is idle | Happens only by accident, via per-agent queues. Nothing is visible and there is no global wait state. | **Partial** | |
| 8 | Lead self-work or subagents only with Boss permission ("urgent") | The Lead is hard-locked to no tools (`agent-session.ts:463`, `prompt-templates.ts:59`). There is no urgent flag or policy. | **Missing** | |
| 9 | Lead = strong model, devs = mixed vendors | Per-member backend and model in `CREATE_TEAM` and agent defs. Nine CLI backends; only Claude and Codex are marked tested. | **Mostly present**; needs a role → vendor UX and cost display per vendor | `index.ts:592`, `backends.ts` |
| 10 | Antigravity and other vendors | Not supported | **Missing**: use ACP via acpx | — |
| 11 | Persistent sessions with prompt queueing | One process per task. Claude uses `--resume`; the other backends are stateless. | **Partial** | `agent-session.ts:488` |
| 12 | Attach to existing sessions (vs spawned) | `ps`/`lsof` scan every 7 s plus Claude JSONL tail. View and kill only. CPU heuristic. macOS/Linux only. | **Partial**: needs hooks-based status, and opt-in assignability for ACP sessions | `process-scanner.ts`, `external-output-reader.ts` |
| 13 | Reliable busy/waiting/idle | Spawned agents get status from process lifecycle (good). External agents use a CPU heuristic (poor). `waiting_approval` is never produced (`requestApproval` is unused). | **Partial** | |
| 14 | Lightweight: low idle CPU/GPU | Render-on-demand exists, but wander timers keep rAF alive about 100% of the time. Gateway polls `ps` every 7 s and `lsof` every 5 s per external agent. The desktop app bundles a full Node binary. | **Medium** | `officeState.ts:483`, `process-scanner.ts:120` |
| 15 | Small bundle | `/office` first-load is 234 kB. Zod, react-markdown, Radix and Ably are lazy-loaded. Themes add 3.2 MB to `out/`. | **Small–medium** | |
| 16 | Cross-platform desktop (Win/Linux) | macOS only. `libc::kill` is un-gated, PATH logic is macOS-centric, bundle targets are dmg/app. | **Large** | `main.rs`, `tauri.conf.json` |
| 17 | Cross-platform daemon | One Windows spawn fix (PR #16). Still POSIX-only: `which`, `process.kill(-pgid)`, `ps`/`lsof`, `cwd.split("/")` (`index.ts` scanner `onAdded`), `startsWith(root + "/")` path guards (`ws-server.ts:551`, preview at `:301`). The last one probably makes static serving return 403 on Windows [I]. | **Large** | |
| 18 | Mobile as remote viewer/controller | The PWA exists, but on a LAN IP over http it is not a secure context, so no service worker and no install [I]. Pairing is a 6-char code with no rate limit, and `/connect` bypasses it. Icons are placeholders. | **Medium + security** | `ws-server.ts`, `app/pair/page.tsx` |
| 19 | Self-hosted | Yes. Ably is optional (third-party). Fonts come from the Google CDN. | **Small** (self-host fonts, de-emphasize Ably) | |
| 20 | Open-source / community ready | No CI, failing typecheck and test, wrong README links, licensing gaps, no CONTRIBUTING / SECURITY / CoC | **Medium** | |

---

## 6. Phased roadmap

Sizes: **S** ≤ 1 day, **M** 2–5 days, **L** 1–3 weeks (one developer, AI-assisted).
Each task lists its goal, the files involved, the approach, acceptance criteria, risk and size.

### Phase 0 — Foundation, safety and hygiene (do first; about 1–1.5 weeks)

**P0.1 Close the remote-control hole (S–M, critical).**
- **Status: DONE.** Loopback bind (`--lan` opt-in), /connect = loopback socket + loopback Host (anti-rebinding) + absent/trusted Origin, CORS allowlist, WS Origin check, rate limits, 8-char pair codes, 7-day token expiry, `REVOKE_SESSIONS`; tests in `apps/gateway/src/__tests__/{security,ws-server,ws-server-lan}.test.ts`. Revoke has no UI button yet (terminal `r`, command only).
- *Goal:* No unauthenticated path can obtain an owner token.
- *Files:* `apps/gateway/src/ws-server.ts`, `apps/gateway/src/config.ts`, `apps/web/src/app/pair/page.tsx`, `apps/web/src/app/office/page.tsx:515-545`.
- *Approach:*
  1. Bind to `127.0.0.1` by default. Add `config.listenHost`, and require an explicit `--lan` flag or setting for `0.0.0.0`.
  2. `/connect` answers only when the socket's `remoteAddress` is loopback **and** the `Origin` header is absent or equals the gateway's own origin. Replace CORS `*` with an allowlist: the gateway origin, the Tauri origin and the dev server.
  3. Check `Origin` on the WebSocket upgrade.
  4. Rate-limit `/pair/validate` and `/share/validate` (for example 5 attempts per minute per IP, then lockout). Lengthen pair codes, or make them single-use with a TTL.
  5. Give session tokens an expiry. Add a "revoke all devices" command.
- *Acceptance:*
  - `curl http://<LAN-IP>:9090/connect` fails.
  - A page served from another origin cannot read `/connect`.
  - A WS upgrade with a foreign `Origin` is rejected.
  - Integration tests cover all of these.
- *Risk:* Breaks the existing quick-connect UX for remote users. Mitigate with QR pairing (P5.4).

**P0.2 Safer defaults for agent permissions (S).**
- **Status: DONE, replaced by §0.2.** Claude `--permission-mode auto`; non-auto backends wait for CEO approval (APPROVAL_NEEDED) before every spawn; bypass only via `office.backendPermissions[id] = "bypass"`; no root settings rewrite, `--allow-root` required; Telegram empty allowlist denies all. Per-spawn approval (no "approve for session" yet).
- *Files:* `apps/gateway/src/config.ts:181`, `apps/gateway/src/backends.ts:13-40`, `apps/gateway/src/setup.ts`.
- *Approach:*
  - Make the `sandboxMode` default `"safe"`, chosen explicitly in the setup wizard with a clear warning.
  - Remove the import-time rewrite of `~/.claude/settings.json` for root. Instead, refuse to run as root unless `--allow-root` is given.
  - Make the Telegram empty allowlist mean **deny all** (`telegram-channel.ts:29-30,248`).
- *Acceptance:* A fresh install never runs agents in bypass mode without an explicit opt-in. Running as root does not modify user files.
- *Risk:* Agents in safe mode will block on permission prompts in headless mode. Pair this with P2.3 (real approvals).

**P0.3 Isolate previews from the control origin (S).**
- **Status: DONE.** Separate preview port (OS-assigned, redirect from the control origin), CSP `sandbox` on every preview response, iframe `sandbox` without `allow-same-origin`; tunnel requests served in place under the same CSP. Root-relative asset paths of proxied apps still 404 (unchanged; follow-up).
- *Files:* `apps/web/src/components/office/ui/PreviewOverlay.tsx`, `ws-server.ts:286-400`.
- *Approach:*
  - Serve `/preview-static` and `/preview-app` on a **separate port**, so they get a different origin.
  - Add `sandbox="allow-scripts allow-forms"` without `allow-same-origin` to the preview iframe.
  - Today agent-generated HTML runs on the same origin as the UI and could read the owner token from `localStorage` [I].
- *Acceptance:* `document.cookie` and `localStorage` from inside a preview cannot reach the UI's storage.

**P0.4 Licensing and attribution (S).** As in §4: `THIRD_PARTY_NOTICES.md`, README credit, remove or gate the Donarg loader, quarantine the themed backgrounds, real PWA icons.
- **Status: DONE.** `THIRD_PARTY_NOTICES.md`, README credits, Donarg loader dev-only behind `NEXT_PUBLIC_BYO_TILESET=1` + build strip, themes quarantined in `apps/web/assets-quarantine/`, generated pixel icons. Upstream provenance question for the themes still open.

**P0.5 Rename and rebrand (S–M).**
- **Status: DONE.** Pixel Crew everywhere (packages `pixel-crew`, `@pixel-crew/*`; `~/.pixel-crew[-dev]` with rename + symlink migration; Tauri `dev.pixelcrew.app`); README/CLAUDE.md now say Canvas 2D. Cargo.lock edited by hand (not rebuilt here).
- *Files:* the root and package `package.json` files, workspace import names, `config.ts:12` (data dir; migrate `~/.open-office` → new dir), `tauri.conf.json` (`productName`, `identifier`), `manifest.json`, README, `CLAUDE.md`.
- *Acceptance:* `pnpm build` passes, and no "bit-office" / "OpenOffice" product strings remain except in attribution.
- *Risk:* Upstream sync becomes harder. Accept this (see §7.6).

**P0.6 Green baseline plus CI (S–M).**
- **Status: DONE locally; CI not yet observed on GitHub.** Both TS errors and the stale memory test fixed, root `typecheck`/`test`/`lint`, dead postinstall removed, gateway build runs tsc first, flat ESLint config (0 errors, warnings only), `.github/workflows/ci.yml` (Windows tests allowed to fail).
- *Files:*
  - `packages/orchestrator/src/prompt-templates.ts:406`;
  - `apps/gateway/src/telegram-channel.ts:391`;
  - `packages/memory/src/__tests__/memory.test.ts:64-78` (assert 30, or import the constant);
  - root `package.json` (add `typecheck`, `test`; delete the dead `postinstall`);
  - new `.github/workflows/ci.yml`;
  - ESLint flat config (`eslint.config.mjs`).
- *Approach:* Run CI on ubuntu, macOS and windows: install, typecheck, test, web build, gateway build. Make the gateway `build` run `tsc --noEmit` first.
- *Acceptance:* CI is green on all three OSes. Windows is allowed to fail its tests only until Phase 5, and that allowance is tracked.

**P0.7 Repo cleanup (S).** Delete `.next/` at the root, the nested `apps/desktop/src-tauri/apps/` placeholders, the tracked `workbox-*.js` (generated) and the empty `.gitmodules`. Fix README links. Move the legacy design docs from `docs/plans/2026-02-24-*` into `docs/archive/`.
- **Status: DONE.** Removed root `.next/`, nested sidecar placeholders, tracked Workbox bundle, empty `.gitmodules`; README links fixed. The `docs/plans/2026-02-24-*` docs were never committed in this clone, so there was nothing to archive.

**P0.8 Test harness for the orchestrator (M).**
- **Status: DONE.** `packages/orchestrator/fake-agent/fake-agent.mjs` + `createFakeBackend()` (`id: "fake"`), harness in `packages/orchestrator/src/__tests__/helpers/`; scripted Lead→Dev→Reviewer run passes in ~0.3 s; approval-gate tests use it too.
- *Files:* new `packages/orchestrator/src/__tests__/`, and a **fake backend** (a tiny Node script that emits scripted stream-json) registered as `id: "fake"`.
- *Goal:* Every later phase (dispatcher, queue, handoff) can be tested without spending tokens.
- *Acceptance:* A scripted Lead→dev→reviewer run passes in CI in under 10 s.

### Phase 1 — MVP: the Boss → Lead → Dev walking flow (about 2–3 weeks)

**P1.1 Work-item model and Dispatcher (L, core).**
- **Status: DONE (daemon).** `packages/orchestrator/src/{work-item,dispatcher}.ts`: §7.4 state machine, urgent-then-FIFO pool, idle devs only (preference > skill > least recently busy), `@Name!:` pins, `TASK:`/`TASK[skill]:`, zombie re-queue (exit without result or 10-min heartbeat, `maxAttempts` 2, then escalated to the Lead), pool in `team-state.json` (running → queued on restart). Reviews and direct fixes stay on `DelegationRouter`; delivered items wait `in_review` when the team has a reviewer.
- *Files:* new `packages/orchestrator/src/dispatcher.ts` and `work-item.ts`; changes to `delegation.ts`, `agent-session.ts`, `orchestrator.ts`, and `packages/shared/src/{commands,events,types}.ts`.
- *Approach:* see §7.4 for the semantics.
  - The daemon owns a `WorkItem { id, parentId, title, prompt, priority: "normal"|"urgent", requiredSkills?, preferredVendor?, state, assigneeId?, attempts, createdAt, heartbeatAt }`.
  - The Lead's output creates *unassigned* items. Keep backward compatibility: `@Name:` stays as a hint, and a new `TASK:` / `TASK[skill]:` line format means "any idle dev".
  - The Dispatcher assigns each item to the best idle dev: skill or vendor match first, then least-recently-busy. Agents stop owning private queues for delegated work. User-initiated direct tasks keep the old per-agent queue.
- *Acceptance (fake-backend tests):*
  - 3 sub-tasks and 2 idle devs: two start immediately, the third starts when the first dev frees up.
  - A busy named target and an idle peer: the work goes to the peer, unless the Lead pinned the name with `@Name!`.
  - Killing a dev mid-task requeues its item (zombie detection via heartbeat or process exit).
- *Risk:* The delegation code has many interacting counters (budget, depth, review loop). Keep `DelegationRouter` for review and result batching, and put the Dispatcher in front of `target.runTask`.

**P1.2 Boss permission model (M).**
- **Status: DONE (daemon).** `lead-policy.ts`: Lead runs with `--tools ""`; subagents → `--tools Agent`; self-work → default tools plus `--disallowedTools Agent,Task`. Per-task flags only narrow the config, except `urgent_only` (needs `urgent` + flag `true`). Flags checked with `claude --help` (2.1.319); the tool name `Agent` (alias `Task`) was read from the CLI bundle, not from a live run.
- *Files:* `packages/shared/src/commands.ts` (new `BOSS_ASSIGN`), `dispatcher.ts`, `agent-session.ts` (the `noTools` switch), `apps/gateway/src/backends.ts` (a disallowed-tools option for Claude).
- *Approach:* see §7.3. `BOSS_ASSIGN { prompt, urgent, allowLeadSelfWork, allowSubagents, budgetUsd? }`. Policy is enforced in the daemon:
  - The Lead runs tool-less by default.
  - It runs with tools only when `urgent && allowLeadSelfWork && no idle dev for waitMs`.
  - It may use subagents (e.g. Claude's `Task` tool) only when `allowSubagents`. Otherwise the tool is denied with a disallowed-tools flag [U: confirm the exact Claude Code flag name and its behaviour in `-p` mode].
- *Acceptance:* Tests show the Lead never gets tools without the flag, and that the flag plus no idle dev for `waitMs` produces a `LEAD_SELF_WORK` event.

**P1.3 Protocol events for choreography (S).**
- **Status: DONE.** `BOSS_ASSIGN`, `GET_OFFICE_CONFIG`/`SET_OFFICE_CONFIG` (owner-only, atomic write, broadcast) and `WORK_ITEM_UPDATED`, `HANDOFF` (with `durationMs`), `LEAD_WAITING`, `LEAD_SELF_WORK`, `LEAD_SUBAGENT_STARTED`, `OFFICE_CONFIG` in `packages/shared`; web client uses `parseGatewayEvent` (safeParse, unknown events dropped). Hand-off timing is daemon-owned (§0.4).
- *Files:* `packages/shared/src/events.ts`.
- *New events:*
  - `WORK_ITEM_UPDATED {item}`
  - `HANDOFF {handoffId, fromId, toId, workItemId, kind: "boss_to_lead"|"lead_to_dev"|"dev_to_lead"|"dev_to_reviewer", label}`
  - `LEAD_WAITING {queueLength, reason}`
  - `LEAD_SELF_WORK {workItemId}`
- The Boss is a pseudo-agent with id `boss`.
- *Acceptance:* Schemas are covered by unit tests. Old clients ignore the unknown events. Make the client use `safeParse` and drop unknown events instead of throwing.

**P1.4 Scene choreography API (M).**
- **Status: DONE.** `engine/choreography.ts` (WALK_TO / HANDOFF / RETURN, per-character queue, speed fitted to `durationMs` and clamped to 24–192 px/s with skip-ahead, instant bubble for 0 ms / hidden tab / reduced motion / no path, snap to seats on reconnect); `playHandoff`/`setBoss` on the adapters; the game loop now sleeps on timers instead of polling rAF (0 frames over 3 s when idle, measured in the browser).
- *Files:* `scene/SceneAdapter.ts` (add `playHandoff(fromId, toId, opts): Promise<void>` and `setBoss(info)`), `scene/PixelSceneAdapter.ts`, `engine/characters.ts`, `engine/officeState.ts`, `layout/tileMap.ts`, `scene/useSceneBridge.ts`.
- *Approach:*
  - Add character states `WALK_TO` (target = a walkable tile adjacent to the recipient's seat, found with BFS over neighbours), `HANDOFF` (about 600 ms: face each other, show a paper prop and a speech bubble with the label), and `RETURN` (walk back to own seat).
  - Keep a per-character action queue so concurrent hand-offs serialize.
  - If there is no path, or the tab is hidden, or reduced-motion is set, teleport and show a bubble instead.
  - Cap walking speed and total time at about 4 s, skipping ahead when it runs over.
- *Acceptance:*
  - Playwright/visual test: clicking the Boss and submitting a task makes the Boss walk to the Lead's desk and back.
  - A `lead_to_dev` HANDOFF makes the Lead walk to the dev.
  - With 0 active animations the loop sleeps (P4.1 check).
- *Risk:* Seat-blocked tiles (`blockedTiles`). Reuse the existing `findPath` with the target tile temporarily unblocked.

**P1.5 Boss character and task composer (M).**
- **Status: DONE.** Crowned Boss seated in a walled Boss office carved into the default layout (`boss-*` furniture; other layouts get a standing spot); `ui/BossComposer.tsx` sends `BOSS_ASSIGN`, with narrowing-only toggles and a one-line effective-policy summary (`bossflow/policy.ts`).
- *Files:* new `components/office/ui/BossComposer.tsx`; changes to `app/office/page.tsx`, `store/office-store.ts`, `engine/officeState.ts`.
- *Approach:*
  - The Boss is a local-only character with a distinct sprite, seated in the Boss room.
  - Clicking it opens a composer with the prompt, an "Urgent" toggle, "Allow Lead to work itself" and "Allow subagents". Defaults are off and persisted.
  - Submitting sends `BOSS_ASSIGN`, and the daemon emits `HANDOFF boss_to_lead`.
- *Acceptance:* A first-time user completes Boss → Lead → Dev without opening a side panel.

**P1.6 Lead waiting and queue visualization (S).** **Status: DONE.** Cork board with one paper per queued item beside the Lead (count derived from the replayed work items), click → `ui/TaskQueueDialog.tsx`; subagent mini-sprite and self-work bubble cues. When `LEAD_WAITING` fires, the Lead stands at a "task board" furniture item (or shows a clock bubble) holding N papers. Clicking the board lists the queued work items. *Acceptance:* the queue length on the board matches the daemon state.

**P1.7 Opt-out of the auto "greet" Lead run (S).** **Status: DONE** for `CREATE_TEAM` and `END_PROJECT` (`apps/gateway/src/project-commands.ts`, tested); restored pool items stay held until `RESUME_POOL` (UI prompt "Resume N queued tasks?"). `apps/gateway/src/index.ts:660`: creating a team should not spend tokens until the Boss assigns something.

**P1.8 Split the monoliths opportunistically (M).** **Status: DONE** for Phase 1: new code lives in `store/boss-flow-store.ts`, `components/office/bossflow/`, `ui/Boss*`/`TaskQueueDialog`/`OfficeSettingsPanel`; `page.tsx` +2 lines, `office-store.ts` +3 lines. Extract the hand-off and Boss features into their own modules instead of growing `app/office/page.tsx` (2675 lines) and `office-store.ts` (1172 lines). Don't do a big-bang refactor.

### Phase 2 — Multi-vendor: ACP, Antigravity, attach vs spawn (about 2–3 weeks)

**P2.1 `AgentDriver` abstraction (M).**
- *Files:* new `packages/orchestrator/src/drivers/{driver.ts,legacy-cli.ts}`; `agent-session.ts` becomes driver-agnostic; `ai-backend.ts`.
- *Interface:* `start(session) / prompt(text, opts) → AsyncIterable<DriverEvent> / cancel() / dispose() / capabilities {persistent, structuredOutput, approvals, resume}`.
- Move today's spawn-per-task code verbatim into `LegacyCliDriver`.
- *Acceptance:* All Phase 0/1 tests pass unchanged through `LegacyCliDriver`.

**P2.2 ACP driver via acpx (L).**
- *Files:* new `drivers/acp.ts`; `apps/gateway/src/backends.ts` (ACP-backed profiles); the setup wizard.
- *Approach:* Use the `acpx/runtime` library export, not shelling out per prompt. Use one persistent named session per hired agent (`<office>-<agentId>`), and queue prompts natively. Map ACP permission requests to `APPROVAL_NEEDED`, which revives the dead approval UI (`agent-session.ts:1154`). Profiles: `claude`, `codex`, `gemini`, `antigravity`, `copilot`, `cursor`, `opencode`, `qwen`, `goose`, and so on. acpx's README (fetched today) lists about 30, including Antigravity [V, page only].
- *Acceptance:*
  - The fake ACP server test passes in CI.
  - A manual test with one real vendor (owner-run, because it costs tokens) shows streaming, cancel and approvals.
- *Risk:*
  - acpx is "pre-1.0, interfaces evolving" [V] and needs Node ≥ 22.13 [V]. Pin the version and wrap it behind `drivers/acp.ts`.
  - Antigravity's ACP adapter maturity is **[U]**. Test it before advertising.

**P2.3 Real approvals (M).** With ACP, or with Claude in non-bypass mode, permission requests reach the UI. The Boss can approve them from the phone. A pixel cue shows the dev raising a hand, and the Boss's desk gets a notification bell.

**P2.4 Hooks-based status for attached Claude sessions (M).**
- *Files:* new `apps/gateway/src/hooks/` (an HTTP endpoint `/hooks/claude` on loopback with a per-install secret, plus an installer that writes a user-level Claude Code hooks entry, only with consent); `external-output-reader.ts` stays as the fallback.
- *Approach:* `PreToolUse` / `PostToolUse` mean working, `PermissionRequest` / `Notification` mean waiting, and `Stop` means idle [from prior research; confirm the hook names against current Claude Code docs, U]. Retire the CPU heuristic for Claude.
- *Acceptance:* An attached Claude session's status changes within 1 s of tool use.

**P2.5 Attach vs spawn semantics (M).**
- **Hired** agents are spawned and owned by the daemon. They are assignable and sit in the Dev room.
- **Visitors** are attached or discovered sessions. They are view-only by default, sit in a "co-working" corner, and get a different label color.
- A visitor becomes **assignable** only if it is an ACP session reachable through acpx's shared runtime (`createSharedAcpRuntime()` [V, README]). Never inject prompts into a human's interactive terminal session.
- *Acceptance:* The UI clearly distinguishes the three kinds, and assigning to a non-assignable visitor is impossible.

**P2.6 Vendor-aware team presets (S).** In presets (`packages/shared/src/presets.ts`): Lead = the strongest configured model (default Claude), devs round-robin across the detected vendors, and the per-agent model override (upstream PRs #17/#18 are a starting point). Show estimated cost per vendor in the hire dialog.

**P2.7 Process discovery abstraction (S–M).** Put `process-scanner.ts` behind a platform interface: `ps` on POSIX, PowerShell `Get-CimInstance Win32_Process` on Windows. Raise the interval to 15–30 s when hooks or ACP cover the same agents, and stop the scanner entirely when the "show external agents" setting is off.

### Phase 3 — Office layout, rooms and art (about 2–3 weeks, parallelizable)

**P3.1 Zones/rooms in the layout schema (M).**
- **Status: DONE.** Layout v2 adds an optional per-tile zone map (`boss_room`, `lead_area`, `dev_area`, `meeting`, `pantry`; v1 loads unchanged), `layout/zones.ts` seat rules (Boss → boss_room, Lead → first Lead-area desk, reviewer beside it, devs → dev desks in reading order), walks through two-tile doorways, a Zones tool in the (hidden) layout editor. New default plan in `layout/defaultOffice.ts`; phones get a 1.4× floor with sideways pan.
- *Files:* `components/office/types.ts` (`OfficeLayout`: add `zones: {id, kind: "boss"|"lead"|"dev"|"meeting"|"board"|"lounge", rect}`, plus door tiles), `layout/layoutSerializer.ts` (bump the version and migrate), the editor tools in `components/office/editor/*`.
- *Approach:* Seat assignment respects zones: the Boss goes in the boss zone, the Lead in the lead zone, devs in the dev zone, and visitors in the lounge. Pathfinding already treats doorways as walkable (`tileMap.ts:9`).
- *Acceptance:* A default layout with a Boss room and a Dev room (with a lead area); characters path through doors.

**P3.2 New CC0/MIT art set (L).** **Status: DONE** with original art drawn in code (`sprites/officeArt.ts`, Boss suit in `sprites/bossLook.ts`) plus reused pixel-agents MIT sprites; no Kenney download was needed; recorded in `THIRD_PARTY_NOTICES.md` (no separate `CREDITS.json`). Working agents type at ~7 fps with a glowing monitor; seated idle agents lean back with the screen off. Make a 16×16 tileset and furniture (desks, chairs, cabinets, document stacks, windows, task board, plants) from Kenney CC0 and/or pixel-agents' MIT open-source assets. Add a Boss sprite (suit/tie variant) and a "paper" hand-off prop. Record each asset's source in `THIRD_PARTY_NOTICES.md` and an `assets/CREDITS.json` manifest. *Acceptance:* The release build contains no asset without a recorded license.

**P3.3 Theme packs as optional downloads (S).** **Status: DONE** as data-only palette themes in `public/themes/` (Night Shift, Mint Studio), validated and fetched only when used (`layout/themes.ts`); the quarantined backgrounds still never ship. Move the `offices/*.zip` themes out of the core bundle and fetch them on demand from a versioned URL, or install them as add-ons. Only themes with verified provenance ship.

**P3.4 Ambient life without CPU cost (S).** **Status: NOT STARTED** (out of Phase 3 scope this round); the loop now sleeps right after a clean frame, 0 renders over 3 s when idle. Coffee machine, plants and window day/night tint are driven by event-time timers (see P4.1), not per-frame updates.

**Phase 1 leftovers fixed in Phase 3:**
- Demo hires 1 Lead, 4 devs and a reviewer into an empty office; the Lead fans four TASK: lines out to four devs, then hands the result to the reviewer (`apps/gateway/src/demo-mode.ts`). **DONE.**
- Empty right panel after a reload (also on upstream `5b0246c`, same code): selecting the Lead now switches to the Team tab. **DONE.**
- Raw internal prompts in the chat log: shown as one human line with a "show raw" toggle (`ui/promptDisplay.ts`). **DONE.**
- Working characters type again (shared ~7 fps beat, one redraw per frame however many type). **DONE.**

### Phase 4 — Performance and lightweight (about 1–2 weeks; measure first)

**P4.1 True sleep in the game loop (M).**
- **Status: DONE.** `engine/gameLoop.ts`: sleeps right after a frame when the next timer is far away (typing: 22 ticks / 22 renders per 3 s, was 44 / 22), 30 fps cap while walking (90 ticks per 3 s), full pause on `document.hidden` and off-screen canvas (IntersectionObserver); on resume no timer catches up, walks finish and working agents sit at their desks (`officeState.resumeAfterPause`), hand-offs while paused play instantly. Fake-clock tests in `engine/__tests__/gameLoop.test.ts`.
- *Files:* `engine/gameLoop.ts`, `engine/officeState.ts:408-491`.
- *Approach:*
  - Replace the "`needsTick` keeps rAF alive" approach with **next-deadline scheduling**: compute the earliest timer expiry (wander, seat, bubble) and `setTimeout` until then. Run rAF only while something is visually moving.
  - Cap animation at 30 FPS; the sprite animation is about 6–8 fps anyway.
  - Pause completely on `document.hidden` and when the canvas is off-screen (IntersectionObserver).
- *Acceptance:* With agents idle and wandering, Chrome Performance shows no rAF callbacks between wander moves, and main-thread CPU stays under 1% on an M-series Mac.

**P4.2 Static layer caching (S).** **Status: DONE.** `engine/staticLayer.ts`: floor, walls, furniture and room names cached offscreen, keyed on layout, furniture state, theme colors, zoom, pan, canvas size and DPR; each frame blits it and redraws only the characters' areas. Pixel-identical to a full redraw at DPR 1/2/3 (fractional DPRs and the editor draw in full); render time about 0.6–1.0 ms vs 1.5–1.7 ms. Pre-render the floor, walls and static furniture into an offscreen canvas that is invalidated only on layout or zoom change. Per frame, draw characters, bubbles and dynamic props only.

**P4.3 Bundle diet (M).**
- **Status: DONE.** `/office` first load 242 → 158 kB: markdown and the confirm dialog load on first use, Zod is out of the client (`@pixel-crew/shared/client` + lint rule), Ably/JSZip/editor were already lazy. Fonts self-hosted and subset in `public/fonts` (OFL, `THIRD_PARTY_NOTICES.md`). CI size gate: `pnpm --filter web size` against `apps/web/perf-budget.json` (+5%). Left: sprite data and editor actions in the page chunk (~20 kB gzip).
- Keep Zod out of the client hot path: validate in dev only, or use hand-written guards generated from the schemas.
- Lazy-load react-markdown/remark-gfm, the editor, the theme loader (JSZip) and Ably.
- Self-host the three fonts (subset Press Start 2P).
- *Acceptance:* Meet the budgets in §9. Use `next build` output plus `source-map-explorer` in CI as a size gate.

**P4.4 Daemon idle cost (S–M).** **Status: DONE.** External-agent scanner only while a viewer is connected, never in demo mode, and switchable (`"externalAgents": false`, `PIXEL_CREW_EXTERNAL_AGENTS=0`); output reader debounces `fs.watch` bursts (100 ms) and polls every 10 s instead of 3 s when the watch works; `gateway.log` capped (`PIXEL_CREW_LOG_MAX_MB`, default 5) with two backups, startup rotation and 16 KB line cap. Demo daemon RSS 77.6 / 78.5 / 79.1 MB with 6 / 3 / 0 agents, CPU ≤ 0.03 %. No polling while no external-agents feature is enabled. Add a `fs.watch` debounce. Log rotation in `file-logger.ts` (cap the size). Measure RSS with 0, 3 and 8 agents.

**P4.5 Event-stream efficiency (S).** **Status: DONE.** `apps/gateway/src/log-stream.ts`: LOG_APPEND batched per agent/task/stream over 100 ms (other events flush first); `SUBSCRIBE_LOGS {agentIds, previews?}`: full logs only for open panes, one-line previews otherwise, none for phones (`previews: false`) and spectators; catch-up as one `replace: true` event when a pane opens mid-task. Older clients that never subscribe get everything as before. Coalesce `LOG_APPEND` chunks server-side (for example 100 ms batches), and let clients subscribe only to logs for the agent pane that is open. Mobile spectators get status events only.

### Phase 5 — Cross-platform builds and mobile remote (about 2–4 weeks)

**P5.1 Windows/Linux daemon correctness (M–L).**
- *Files:* `agent-session.ts` (`which` at `:475`, process-group kills at `:735/:1061/:1107`), `backends.ts`, `process-scanner.ts`, `external-output-reader.ts:93` (Claude project-key derivation on Windows paths [U: confirm Claude's Windows key format]), `index.ts` (`cwd.split("/")`), `ws-server.ts:301,551` (path guards with `path.relative`), `worktree.ts` (paths and git invocation).
- *Approach:*
  - Use `cross-spawn` or `shell: true` with safe quoting for `.cmd` shims. Since CVE-2024-27980, Node refuses to spawn `.cmd` without a shell [U for the exact failure on these installs].
  - Use `tree-kill` / `taskkill /T /F` on Windows.
  - Do the `PATH` + `PATHEXT` lookup in-process.
  - Replace bash build scripts with Node scripts.
- *Acceptance:* CI on `windows-latest` and `ubuntu-latest` runs the fake-backend end-to-end test. A manual smoke test on Windows 11 with one real CLI (owner-run).

**P5.2 Desktop: thin tray shell for macOS, Windows and Linux (M–L).**
- *Files:* `apps/desktop/src-tauri/src/main.rs` (gate `libc` behind `#[cfg(unix)]`, add a Windows kill path, non-macOS PATH logic), `tauri.conf.json` (targets `dmg, app, nsis/msi, deb, appimage`), `capabilities/default.json` (drop `shell:allow-execute` and `shell:allow-stdin-write` from the webview; scope spawn to the sidecar only), CSP (drop `'unsafe-eval'` if Next allows it [U]).
- *Approach for Node:* see §7.5. Default to **system Node** (detected), with a download-on-first-run fallback, rather than bundling a 57 MB+ binary. Alternative: Node SEA.
- *Acceptance:* `tauri-action` builds artifacts for all three OSes on tag. Installer size is at or under the §9 budget.
- *Risk:* Code signing and notarization (Apple and Windows certificates cost money). Ship unsigned for hobby use and document it.

**P5.3 Mobile PWA remote (M).**
- *Approach:*
  - Spectator and controller mode on phones: status, Boss composer, approvals and the office view (with reduced FPS).
  - Secure contexts: a LAN `http://192.168…` origin is not a secure context, so there is no service worker and no install [I]. Document three supported paths:
    1. LAN http, as a plain web page with no install;
    2. **Tailscale `serve`**, which gives HTTPS on a tailnet name (recommended) [U: verify current Tailscale HTTPS cert behaviour];
    3. the existing Cloudflare tunnel with Access.
- *Acceptance:* An iOS Safari and Android Chrome manual test shows the office, assigns a task and approves a permission.

**P5.4 Pairing v2 (M).**
- *Files:* `ws-server.ts`, `app/pair/page.tsx`.
- *Approach:*
  - The desktop or CLI shows a **QR code** encoding `https://host:port/pair#<one-time 128-bit token>`, valid for 2 minutes and single use.
  - Exchanging it yields a device-bound session token with an expiry.
  - A devices list allows revocation. Roles (owner / collaborator / spectator) are kept.
- *Acceptance:* Tokens can be revoked, expire, and are not replayable; P0.1's tests still pass.

**P5.5 Decide native mobile (S, decision only).** Recommendation: **no Tauri mobile app** for now. Revisit only if push notifications on iOS are required; web push works on iOS 16.4+ for installed PWAs [U].

### Phase 6 — Community and open-source polish (about 1 week, rolling)

- **P6.1 (S).** Docs: README with a GIF of the walking flow, quick start (`npx <new-name>`), architecture diagram, and a "how to add a vendor (ACP profile)" guide. Add `CONTRIBUTING.md`, `SECURITY.md` (threat model from §8, private disclosure path) and `CODE_OF_CONDUCT.md`.
- **P6.2 (S).** Release automation: changesets or release-please, npm publish with provenance, Tauri artifacts on GitHub Releases.
- **P6.3 (M).** Plugin points: scene adapters (already pluggable), driver profiles, theme packs and role packs (`packages/orchestrator/agents/*.md`). Revisit the unimplemented `docs/specs/2026-03-24-plugin-architecture-*` only where it fits.
- **P6.4 (S).** Demo mode without tokens: promote the scripted timeline in `app/office/page.tsx:98-125` to a "watch a demo" button driven by the fake backend, so people can try the office without any CLI installed.
- **P6.5 (S).** Telemetry: none by default. Document this.

---

## 7. Key design decisions

### 7.1 Web stack: keep Next.js (static export) vs switch to Vite
- **Today:** Next is already `output: "export"` (`next.config.ts:47`), served as static files by the gateway, with no server runtime. First-load JS for `/office` is 234 kB, of which 105 kB is shared framework [V].
- **Recommendation:** **keep Next through Phase 4**, then decide on measurements. The big costs today are the always-on rAF, the polling and the bundled Node binary, not the framework.
- **Alternative:** Vite + React (or Preact via `preact/compat`) SPA.
  - *Pros:* about 40–60 kB less framework JS [U, estimate]; faster dev; no Next-specific PWA plugin (use `vite-plugin-pwa`); simpler static output.
  - *Cons:* 1–2 weeks of migration (routing for `/office`, `/pair`, `/join`; env injection; `transpilePackages`); churn while the core features are still moving.
- **Trigger to switch:** if P4.3 cannot get `/office` under 170 kB gzip with Next.

### 7.2 Rendering: Canvas 2D (keep) vs PixiJS
The code is Canvas 2D with sprite caching. For 16×16 pixel art and fewer than about 30 characters, Canvas 2D is lighter than shipping a WebGL engine (PixiJS v8 is about 100 kB+ gzip [U]). **Keep Canvas 2D**, and fix the README claim.

### 7.3 The Lead's self-work permission model
- **Recommendation:** a daemon-enforced policy per work item:
  ```
  leadPolicy = {
    selfWork: "never" | "urgent_only" | "when_no_dev_after_wait",   // default "never"
    subagents: "never" | "urgent_only" | "allowed",                  // default "never"
    waitMs: 120000,           // how long an urgent item waits for an idle dev first
    maxSelfWorkPerTeam: 1,    // budget guard
  }
  ```
  - `BOSS_ASSIGN.urgent` + `allowLeadSelfWork` + `allowSubagents` opt in **per task**.
  - The Lead normally runs tool-less (today's `noTools`).
  - Self-work restarts the Lead session in a "worker" mode with tools enabled, for that item only, and the scene shows the Lead sitting down to type.
  - Subagent tools are denied by CLI flags unless allowed (Claude: a disallowed-tools flag [U]; other vendors: ACP permission denial).
- **Why in the daemon, not the prompt:** prompts are advisory and models ignore them. The current "You CANNOT…" works only because tools are actually stripped.
- **Alternatives:**
  - (a) Always let the Lead work. This is simple but expensive and against the vision.
  - (b) A separate cheap "assistant lead" that does the work. Possible later as a "secretary" character.

### 7.4 Queue semantics
- **State machine per work item:**
  `queued → assigned → handing_off → running → (in_review → running…) → done | failed | cancelled`.
- **Rules:**
  - The **shared pool** is ordered by `priority` (urgent first), then FIFO.
  - Assignment considers only **idle, hired, assignable** devs. Score: skill match > vendor preference > least recently busy (spreads load across vendors).
  - `@Name:` is a *preference*; `@Name!:` is a hard pin. Pins wait for that dev.
  - When no dev is idle: emit `LEAD_WAITING`; for urgent items start the `waitMs` timer for the self-work policy.
  - **Zombie re-queue** (ORCH-style): an item in `running` whose process exited without a result, or whose heartbeat (last stdout or ACP event) is older than the timeout, returns to `queued` with `attempts++`. Fail at `maxAttempts` (2) and escalate to the Lead.
  - **Hand-off timing:** `handing_off` lasts `max(animationAck, handoffDelayMs)`. The default `handoffDelayMs` is 1200 so it's fun to watch; set it to 0 in "fast mode". The daemon never waits for a client acknowledgement, because headless or phone clients may be absent.
  - Keep the existing safety ceilings (depth, total delegations, review rounds) in `CONFIG.delegation`.
- **Persistence:** store the pool in `team-state.json` so a daemon restart resumes queued items. Running items become `queued` on restart.

### 7.5 Agent integration: ACP vs per-CLI adapters
- **Recommendation: hybrid behind `AgentDriver`.**
  - ACP (via acpx's runtime) is the default for vendors with ACP adapters, Antigravity included. It brings persistent sessions, native prompt queueing, structured events and permission requests through one protocol.
  - Keep `LegacyCliDriver` for Aider, Sapling and anything without ACP, and as a fallback while acpx is pre-1.0.
  - Keep the Claude hooks observer for **attached** sessions.
- **Alternative:** maintain nine hand-written adapters (status quo). This is brittle: every CLI flag change breaks it (see upstream #11, #4).
- **Desktop Node runtime** (related): prefer system Node ≥ 22 (acpx needs 22.13+ [V]). Alternatives:
  - bundling (today, about 57 MB here) [V];
  - Node SEA single binary (about the same size, but one file) [U];
  - Bun `--compile` (smaller startup; ESM/CJS compatibility with `ws`/`ably` unverified [U]).

### 7.6 Keeping in sync with upstream
Upstream has been dormant since 2026-08-05 [V]: 12 issues, 7 PRs, 3 of them open from contributors (#17 #18 #19, model overrides and an agent edit cog). After Phase 0 (rename) and Phase 1 (dispatcher), merges will conflict heavily. **Recommendation:**
- keep the `upstream` remote;
- run `git fetch upstream` monthly;
- **cherry-pick** relevant fixes (Windows, backend arguments) and never merge;
- track picked commits in the PR description.

Consider offering the security fix (P0.1) to upstream as a PR, since it affects every existing user. Note that upstream open PRs #17–#19 overlap with P2.6 and can be adapted with credit.

### 7.7 Visual choreography is cosmetic, not authoritative
All business state lives in the daemon. The scene reconstructs from `AGENTS_SYNC` + `WORK_ITEM_UPDATED` on reconnect: characters snap to their seats, and in-flight hand-offs are skipped. Several viewers (desktop and phone) see consistent state without coordinating animations.

---

## 8. Security notes

Findings ordered by severity. Each one comes from reading code; none was exploited live.

1. **Critical — unauthenticated owner token via `/connect`.**
   - `ws-server.ts:117-135` returns a fresh owner `sessionToken` to any request that has no Cloudflare headers, when Ably is not configured.
   - The server listens on all interfaces (`httpServer.listen(port)`, `:411`) and sets `Access-Control-Allow-Origin: *` (`:105`). The WebSocket has no `Origin` check.
   - Consequences:
     - (a) Anyone on the LAN can GET `/connect` and control the agents.
     - (b) Any website the user visits can `fetch("http://localhost:9090/connect")`, read the token (CORS `*`), open the WebSocket and send `RUN_TASK`.
   - Default agents run with permission bypass (`backends.ts:58`, `config.ts:181`), so this is **remote code execution**. Fix: P0.1.
2. **High — preview content shares the control origin.** `/preview-static` and `/preview-app` are served by the same origin as the UI. The preview iframe has no `sandbox`, and the owner token lives in `localStorage` (`lib/storage.ts:13-17`). Agent-generated or prompt-injected HTML can read it. Fix: P0.3.
3. **High — permission bypass by default.**
   - `sandboxMode: "full"` is the default.
   - Claude runs with `--dangerously-skip-permissions`, Codex with `--dangerously-bypass-approvals-and-sandbox`, Gemini with `--yolo`, Aider with `--yes`.
   - As root, the gateway silently rewrites `~/.claude/settings.json` to `bypassPermissions` (`backends.ts:13-40`).
   - Fix: P0.2 + P2.3.
4. **Medium — Telegram**: an empty allowlist means *everyone* can control the bot (`telegram-channel.ts:29-30,248`). Fix: deny by default.
5. **Medium — pairing:** a 6-character code (`index.ts:74`) with no rate limit on `/pair/validate` or `/share/validate`. Session tokens are persisted forever in `session-tokens.json`, with no expiry or revocation. Fix: P0.1 + P5.4.
6. **Medium — Tauri:** the webview has `shell:allow-spawn` / `allow-execute` / `allow-stdin-write`, plus `withGlobalTauri: true` and CSP `'unsafe-eval'`. Any XSS in the UI is closer to native execution. Fix: P5.2. Exact exploitability depends on shell scopes [U].
7. **Low — third-party relay:** Ably routes commands through a cloud provider. Keep it optional and off by default, and document it.
8. **Low — logs:** the gateway logs full commands, including prompts, to `gateway.log` (`index.ts:424`). Redact, and rotate.

**Operating guidance to document in `SECURITY.md`:**
- Default to loopback.
- Remote access is via Tailscale or a tunnel with auth, never with a raw port forward.
- Run agents in worktrees with sandbox or approval mode.
- Treat the repo being worked on as untrusted input, because of prompt injection through files.
- Keep API keys in the vendor CLIs' own stores, never in the office config.

---

## 9. Performance budget (targets; measure in CI where possible)

| Metric | Today | Target |
|---|---|---|
| Web `/office` first-load JS | 242 kB before Phase 4 → **158 kB** (Next report; 184 kB with the root layout's chunks) [V] | ≤ 170 kB with Next ✓, ≤ 120 kB if moved to Vite/Preact; CI gate at budget + 5% |
| Shared framework JS | 106 kB [V] | unchanged with Next |
| `out/` total | 2.7 MB [V] (2.5 MB + 160 KB self-hosted fonts; themes are data-only JSON) | ≤ 2.5 MB core; themes downloaded on demand |
| Idle render (agents idle) | 0 renders / 0 ticks per 3 s [V] | 0 rAF between events ✓; next-deadline timers ✓; < 1% main-thread CPU |
| Active render | typing 22 renders / 22 ticks per 3 s; walking 30 fps cap; 0 when hidden or off-screen [V] | ≤ 30 FPS cap ✓; 15 FPS on mobile / battery saver; 0 when hidden ✓ |
| Frame render time | 0.6–1.0 ms with the static layer vs 1.5–1.7 ms full redraw (M-series, Chromium) [V] | — |
| Daemon idle CPU (0 running agents) | 0.02–0.03 % in demo mode [V]; `ps` scanner only while a viewer is connected, off with `externalAgents: false` | < 0.5% avg ✓; no polling when external discovery is off ✓ |
| Daemon RSS (0 / 3 / 6 agents, demo) | 79.1 / 78.5 / 77.6 MB [V] | ≤ 120 MB / ≤ 200 MB (excluding the agent CLIs themselves) ✓ |
| WS traffic, idle | not measured [U]; logs only for open panes (P4.5) | ≤ 1 msg / 30 s (keepalive) |
| Desktop installer | ≥ 57 MB of bundled Node alone [V] + Tauri (~10 MB) [U] | ≤ 20 MB with system Node; ≤ 80 MB with bundled runtime |
| Time to interactive (local) | not measured | < 1.5 s on a 2020 laptop |

---

## 10. Open questions for the owner

1. **Name.** Do you want to rename (recommended), and do you have a preference? Should the npm package be published under your personal scope?
2. **Default safety.** OK to switch the default to "safe" (approvals required) even though agents will pause for approvals more often? Or keep "full" but loopback-only?
3. **Lead self-work.** Should the default stay "never", or "when urgent and no dev free after 2 min"? Should subagents be allowed at all?
4. **Hand-off delay.** Should the walking animation really delay dispatch (about 1.2 s, fun), or be purely visual with zero delay (fast)? Or should this be a user setting, which is my recommendation?
5. **Vendor priorities.** Which vendors must work for v1: Claude + Codex + Gemini + Antigravity? Do you already have Antigravity working through ACP on your machine (I could not verify)?
6. **Attached sessions.** Is view-only acceptable for sessions you start yourself in a terminal, with assignment only for ACP-shared sessions? Or do you need to push tasks into existing interactive Claude sessions (riskier)?
7. **Remote access.** Is Tailscale acceptable as the recommended way to reach the PWA from phones? Do you want to keep Ably and Telegram, or drop them to cut weight and attack surface?
8. **Desktop.** Is "daemon + browser" acceptable as the primary experience, with Tauri as an optional tray app? Is shipping unsigned Windows/macOS builds acceptable for a hobby project?
9. **Art.** Should we contact upstream about the provenance of the 12 themed backgrounds, or drop them? Do you want the Kenney CC0 style, or to stay close to the pixel-agents look?
10. **Upstream.** Should we offer the `/connect` security fix to longyangxi/OpenOffice as a PR, given that it affects existing users?
11. **Scope cuts.** Keep or remove the worktree auto-merge, preview server, 4-layer memory and 18 role presets? They add weight; the vision does not require them all.
