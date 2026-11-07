# Pixel Crew

Fork of longyangxi/OpenOffice (bit-office), MIT. Workspace packages: `pixel-crew` (gateway/CLI), `@pixel-crew/shared`, `@pixel-crew/orchestrator`, `@pixel-crew/memory`.

## Project Structure
- `apps/web` - Next.js 15 PWA (static export, served by the gateway)
- `apps/gateway` - Node.js daemon (multi-channel + AI CLI control), npm/bin name `pixel-crew`
- `packages/shared` - Shared event protocol (Zod schemas)
- `packages/orchestrator` - Multi-agent engine (worktree, delegation, phases)
- `packages/memory` - Persistent agent memory (sessions, facts, shared knowledge)

## Git
- All git commit messages MUST be in English.

## Key Commands
- `pnpm dev:web` - Start web dev server
- `pnpm dev:gateway` - Start gateway
- `pnpm demo` - Build the web UI if stale, then run the demo office on :9090 (scripted fake agents, no tokens)
- `pnpm dev:demo` - Start gateway in demo mode with reload (:9099)
- `pnpm typecheck` / `pnpm test` / `pnpm lint` - Checks (CI runs them on ubuntu, macOS, windows)
- Tests use the fake backend (`id: "fake"`); never start a real AI CLI in tests

## Architecture
- **Channels**: WebSocket (always), Ably (optional), Telegram (optional)
- **UI**: Canvas 2D pixel office (ported from pixel-agents; no PixiJS) + Key Node Mode agent cards

## Data Directory
- Dev: `~/.pixel-crew-dev/`, Release: `~/.pixel-crew/` (`PIXEL_CREW_HOME` overrides)
- Legacy `~/.open-office[-dev]/` is moved here on first run and left as a symlink
- `config.json` — global config (`office` section is zod-validated and hot-reloaded)
- `data/instances/<id>/` — per-gateway state (logs, sessions, memory)
- `data/agents.json` — agent definitions
- `projects/` — default agent workspace (team projects created here)
- `worktrees/<repo-hash>/<agentId>/` — centralized worktree isolation

## Worktree Isolation
- One agent = one worktree = one branch (keyed by agentId, not taskId)
- Worktrees stored outside repo at `~/.pixel-crew[-dev]/worktrees/` to prevent path traversal
- On task:done: auto-merge to main (default), with per-agent toggle + undo merge
- Before each task: auto-rebase onto latest main, conflicts auto-resolved
- Cleanup: on fire agent only (no startup GC)
- Full docs: `packages/orchestrator/README.md` → "Worktree Isolation"

## Key Node Mode
Only 4 key events shown in UI: TASK_STARTED, APPROVAL_NEEDED, TASK_DONE, TASK_FAILED.
Agent states: idle, working, waiting_approval, done, error.
TASK_DONE includes structured result (changedFiles, diffStat, testResult).

## Boss flow (Phase 1)
- Protocol (`packages/shared`): `BOSS_ASSIGN {prompt, urgent, allowLeadSelfWork?, allowSubagents?}` (flags only narrow `office.lead`, except `urgent_only` + urgent + `true`), `GET/SET_OFFICE_CONFIG` (owner-only; `null` resets a key), `RESUME_POOL`, `CANCEL_WORK_ITEM`; events `WORK_ITEM_UPDATED`, `HANDOFF` (Boss id `"boss"`, daemon-owned `durationMs`), `LEAD_WAITING`, `LEAD_SELF_WORK`, `LEAD_SUBAGENT_STARTED`, `OFFICE_CONFIG`, `GATEWAY_INFO {demo}`.
- Daemon: `packages/orchestrator/src/{dispatcher,work-item,lead-policy}.ts`; restored pool items are `held` until `RESUME_POOL`.
- UI: `apps/web/src/store/boss-flow-store.ts`, `components/office/bossflow/`, `engine/choreography.ts` (walks), `engine/bossFlowRenderer.ts`, `ui/BossFlowLayer.tsx` (+ `BossComposer`, `TaskQueueDialog`, `OfficeSettingsPanel`). Keep new features out of `app/office/page.tsx` and `office-store.ts`.
- Demo mode: `pnpm dev:demo` (or `--demo` / `PIXEL_CREW_DEMO=1`): every agent is the scripted fake backend (`apps/gateway/src/demo-mode.ts`), data dir `~/.pixel-crew-demo` unless `PIXEL_CREW_HOME` is set, DEMO badge in the UI. Never enabled from config.json.

## Office layout (Phase 3)
- Layout v2 = v1 + optional per-tile `zones` (`boss_room | lead_area | dev_area | meeting | pantry`); seat rules in `components/office/layout/zones.ts`, default plan in `layout/defaultOffice.ts`.
- Art is drawn in code (`sprites/officeArt.ts`, `sprites/bossLook.ts`); only CC0/MIT/own assets, each recorded in `THIRD_PARTY_NOTICES.md`.
- Extra themes are data-only palette JSON in `apps/web/public/themes/` (`layout/themes.ts`).
- Render budget: 0 renders when nobody works; working agents tick at ~7 fps (`TYPE_FRAME_DURATION_SEC`).

## Performance (Phase 4)
- Game loop (`engine/gameLoop.ts`): ticks only for timers or motion, 30 fps cap, paused when the tab is hidden or the canvas is off-screen; counters in `window.__pixelCrewLoop`.
- Static layer (`engine/staticLayer.ts`): floor/walls/furniture cached offscreen; `window.__pixelCrewDebug.staticCache = false` + `redraw()` draws in full for comparisons.
- Web code imports runtime values from `@pixel-crew/shared/client` (no Zod in the bundle; lint-enforced). Heavy UI (markdown, dialogs, editor) stays behind `next/dynamic`.
- CI size gate: `pnpm --filter web size` vs `apps/web/perf-budget.json` (+5%). Source maps for analysis: `PIXEL_CREW_SOURCE_MAPS=1 pnpm --filter web build`.
- Logs: LOG_APPEND batched ~100 ms (`apps/gateway/src/log-stream.ts`); clients send `SUBSCRIBE_LOGS` for open panes. Measurements: `docs/perf/`.

## Cross-platform, mobile and pairing (Phase 5)
- Spawning/killing: always `packages/orchestrator/src/proc.ts` (`spawnPortable`, `killTree`, `resolveCommand`); never `which`, `lsof` for logic, `process.kill(-pid)` or shell-string git (`worktree.ts` uses `execFileSync("git", args)`). Path guards: `isPathInside` (`apps/gateway/src/security.ts`). CI runs ubuntu, macOS and windows, all required.
- E2E: `pnpm --filter pixel-crew test:e2e` (real gateway in demo mode; `PIXEL_CREW_DEMO_DELAY_SCALE` shortens the script).
- Pairing v2: `…/pair#<token>` one-time links (`PairingTokenStore`), `/pair/exchange`, device-bound sessions (`SessionTokenStore`, hashed on disk), owner-only `CREATE_PAIR_LINK` / `LIST_DEVICES` / `REVOKE_DEVICE` (`rbac.ts`); QR in `ui/DevicesSection.tsx` and the terminal (`q`). `publicUrl` = Tailscale serve / proxy address. `/connect` refuses proxied requests.
- Phone UI: office view always on mobile, `ui/ApprovalsTray.tsx`, 44 px targets under `@media (pointer: coarse)` in `styles/global.css`, 15 fps cap (`deviceMaxFps`). Docs: `docs/mobile.md`, `docs/desktop.md`.
- Desktop: Tauri tray shell on system Node 22+; installers built by `.github/workflows/release.yml` (unsigned; attached to the GitHub release for a tag, artifacts otherwise).

## Community and releases (Phase 6)
- Docs: `README.md` + `README.vi.md` (keep both in step), `CONTRIBUTING.md` (incl. release steps), `SECURITY.md` (threat model, no telemetry), `docs/extending.md`, `docs/adding-a-vendor.md`. Media in `docs/media/` (record from demo mode, never show absolute home paths).
- Versions: one version for root `package.json` (UI label), `apps/gateway`, `apps/desktop`, `tauri.conf.json`, `Cargo.toml`; owned by release-please (`release-please-config.json`, `.github/workflows/release-please.yml`). Don't bump by hand; commit types drive it. npm publish (`npm-publish.yml`) runs only with an `NPM_TOKEN` secret.
- Extension points: theme packs (`apps/web/public/themes/`, `parseThemeIndex`/`parsePaletteTheme`, tested), role packs (`packages/orchestrator/agents/*.md`, `parseRolePack`, tested), scene adapters (`scene/SceneAdapter.ts`). Phones fit the map between overlays registered with `useSceneInset` (`scene/sceneInsets.ts`); new floating UI over the canvas should register too.
- No telemetry: no analytics, beacons, update checks or third-party requests.
- v1 is Claude Code only; multi-vendor (Phase 2) is deferred.

## Attach Claude sessions (Phase 2a)
- Owner-only `ATTACH_EXTERNAL {agentId, role?: "dev", mode?: "fork"|"live"}` / `DETACH_AGENT`, reply `ATTACH_RESULT`; `AGENT_CREATED` carries `attached`, `attachMode`, `attachNote`, `attachOptions` (externals). Docs and research: `docs/attach-sessions.md`.
- Drivers: `packages/orchestrator/src/drivers/` (`claude-fork.ts` = `claude -p --resume <id> --fork-session` in the session's cwd, team project via `--add-dir`; `claude-live.ts` = cross-session inbox socket + transcript as a virtual run). Attached sessions: no worktree, no own resume, `worker-attached` prompt.
- Gateway: `apps/gateway/src/attach/` (`attach-manager.ts`, `attach-commands.ts`, `claude-sessions.ts` reads `<CLAUDE_CONFIG_DIR|~/.claude>/sessions/<pid>.json` read-only, `demo-external.ts`, `claude-attachable.ts` launcher); state in `data/instances/<id>/attachments.json`. Never write to the user's Claude config.
- UI: `components/office/attach/`, `store/attach-store.ts`. Fakes: `packages/orchestrator/fake-agent/fake-claude-session.mjs` (`startFakeClaudeSession`); demo mode runs one.

## Team Execution Flow
Phases: CREATE → DESIGN → EXECUTE → COMPLETE → (loop or END).
Execute: Leader → Dev (build+self-fix) → Reviewer (VERDICT) → Fix loop (max 3 reviews).
Roles: Developer (ENTRY_FILE or PREVIEW_CMD+PORT), Code Reviewer (VERDICT PASS/FAIL), Team Lead (delegates only).
Preview: static HTML (npx serve:9100), build output (dist/index.html), or command (PREVIEW_CMD on PREVIEW_PORT).
Project dir: unique per session, all members share it. Created on APPROVE_PLAN.
