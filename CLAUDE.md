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
- `pnpm dev:demo` - Start gateway in demo mode (scripted fake agents, no tokens)
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

## Team Execution Flow
Phases: CREATE → DESIGN → EXECUTE → COMPLETE → (loop or END).
Execute: Leader → Dev (build+self-fix) → Reviewer (VERDICT) → Fix loop (max 3 reviews).
Roles: Developer (ENTRY_FILE or PREVIEW_CMD+PORT), Code Reviewer (VERDICT PASS/FAIL), Team Lead (delegates only).
Preview: static HTML (npx serve:9100), build output (dist/index.html), or command (PREVIEW_CMD on PREVIEW_PORT).
Project dir: unique per session, all members share it. Created on APPROVE_PLAN.
