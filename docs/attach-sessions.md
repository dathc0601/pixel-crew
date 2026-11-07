# Attach your own Claude Code sessions to the team

> **Status: Phase 2a (branch `phase-2a-attach-claude`).** This covers Claude Code only. It is built and tested with fakes. The owner's run against a real Claude Code session is still to do (see [Manual test with a real session](#manual-test-with-a-real-session)).

Pixel Crew notices the Claude Code sessions you open in your own terminals and shows each one in the office as a view-only **external** character. With Phase 2a you can click one and press **Join team**. From then on it is a developer on the team:
- the Lead walks over and hands it sub-tasks;
- the queue, the hand-off timing, the Lead policy and the zombie rules apply to it like any hired dev.

**Leave team** takes it off again. Your session keeps running either way: Pixel Crew never kills a session it attached.

## How a task reaches the session

There are two modes. You pick one when you press Join team.

| Mode | What happens | Your terminal | Needs |
|---|---|---|---|
| **Fork** (default) | Each task runs headless in a *fork* of your session: `claude -p … --resume <id> --fork-session`. It runs in the session's own folder and starts from its full conversation. | Untouched. You can keep working in it. | Nothing. Works for any detected session. |
| **Live in terminal** | The task is posted to the session's cross-session inbox. Claude starts a turn in your terminal and does the work there. | The task and the work show up in it. | Claude Code 2.1.224 or later (inbox socket). If the session bypasses permission prompts, accept each task in that terminal, or start it with `pixel-crew claude-attachable`. |

The pane under the character says which one applies, for example: "Work runs in a fork of this session; your terminal is not touched."

## Research: what can deliver a task to a running interactive session

All of this was checked on 2026-11-07 against Claude Code **2.1.319**, using `claude --help`, the official docs at code.claude.com/docs and strings in the CLI binary. No real session was started.

- **[V]** verified: seen in the docs, the `--help` text or the binary.
- **[U]** unverified: inferred, or the interface is not documented.

| Option | Verdict | Findings |
|---|---|---|
| **A0. `claude -p --resume <id>` without a fork** | Rejected | "If you resume the same session in two terminals without forking, messages from both interleave into one transcript" [V, docs `sessions`]. That is unsafe while the terminal is open. |
| **A. `claude -p --resume <id> --fork-session --output-format stream-json`** | **Default** | `--fork-session`: "create a new session ID instead of reusing the original" [V, help]. A fork copies the whole conversation, gets its own id and transcript, and leaves the original "unchanged on disk" [V, docs `sessions`]. A fork in another process does not inherit the original's "Allow for this session" grants [V]. `--resume <id>` looks in the current project first, then every other project [V]. `--permission-mode auto` is a valid choice [V, help]. `--add-dir` gives access to extra folders [V, help]. Whether the forked id appears in `system/init` [U]; Pixel Crew doesn't need it. |
| **B1. Channels** (MCP server pushing `notifications/claude/channel`) | Not used | The session must be *started* with `--channels plugin:…` (allowlisted plugins) or `--dangerously-load-development-channels server:<name>` [V, docs `channels`]. It is a research preview, needs claude.ai or Console auth, and Team/Enterprise orgs need `channelsEnabled` [V]. It cannot reach a session you already opened, and neither flag is in `--help`. |
| **B2. Remote Control** | Not usable | It controls local sessions "from claude.ai/code … or the Claude mobile app" through Anthropic's servers [V, `claude remote-control --help`]. It has no local API. |
| **B3. Hooks** | Not used | No hook can inject a user prompt: `UserPromptSubmit` only adds context [V, docs `hooks`]. `asyncRewake` can wake an idle session, but only from a hook that is already configured [V]. `Stop` carries `last_assistant_message` and would be a clean completion signal. Using it means installing a hook into your settings, so it is left as a possible opt-in. |
| **B4. IDE / SDK bridges** | Not usable | `--input-format stream-json` "only works with --print" [V, help]. Nothing types into a running TTY session. |
| **B5. Cross-session inbox socket** | **Live mode** | Every session (v2.1.224+ on macOS/Linux) binds a per-user Unix socket. The docs cover "a script or hook to post into a session". An idle session "starts a new turn with the message". The auth line is optional on macOS and Linux [V, docs `cross-session-messaging`]. The receiving session's rules apply: a session that bypasses permission prompts holds the message for approval for 5 minutes by default, and `crossSessionInbound: "refuse"` drops it [V]. The message line `{"type":"user","message":{"role":"user","content":…}}` comes from the CLI's own debug hint in the binary, not from the docs [U]. |
| **B5b. Session registry `~/.claude/sessions/<pid>.json`** | Used for discovery | It maps pid → `sessionId`, `cwd`, `status` (`idle`/`busy`/…) and `messagingSocketPath` [U: seen on disk for 2.1.316–2.1.319, not documented]. The documented alternative is `claude agents --json` [V, help]; it was not used because it spawns the CLI on every poll. When there is no registry entry, Pixel Crew falls back to the newest transcript in the folder (fork mode only). |
| **B6. Agent teams mailboxes, background sessions (`--bg`)** | Not usable | A team mailbox is scoped to one session's own team [V, docs `agent-teams`]. `claude --resume <bg-id> "prompt"` refuses piped output [V, docs `sessions`]. |
| **C. tmux `send-keys`** | Not built | It works only when the session runs in tmux, and it races with whatever you type. B5 replaces it for 2.1.224+. It is kept as a reserved `attachMode: "tmux"`, which the gateway refuses today. |

**Choice:** fork by default, because it needs zero setup and never touches your terminal. Live is the opt-in for when you want to watch the work happen in the session itself.

## What Pixel Crew does

### Daemon

- **Protocol** (`packages/shared`):
  - owner-only commands `ATTACH_EXTERNAL {agentId, role?: "dev", mode?: "fork"|"live"}` and `DETACH_AGENT {agentId}`;
  - an `ATTACH_RESULT` reply to the caller;
  - on `AGENT_CREATED`: `attached`, `attachMode`, `attachNote`, and for external sessions `attachOptions`.

  Other roles get `ATTACH_RESULT {ok: false}` and nothing changes.
- **Drivers** (`packages/orchestrator/src/drivers/`). This is a deliberately small `AgentDriver` (plan §7.5): a driver starts one run and returns something that looks like a child process emitting Claude stream-json. `AgentSession` keeps prompts, parsing and the run lifecycle.
  - `claude-fork.ts`: `buildClaudeForkArgs()` builds the exact argv.
  - `claude-live.ts`: posts the task to the inbox socket, then reads the transcript as a virtual process. The run counts as delivered when a record with the task marker `[pixel-crew task <id>]` appears, and as finished at the next `end_turn` / `turn_duration`.
- **Attached members** (`apps/gateway/src/attach/attach-manager.ts`):
  - The session keeps its agent id (`ext-claude-<pid>`) and joins the team as a dev. Its name comes from its folder, so `@Name:` works.
  - It always runs in its own folder and never gets a worktree. Pixel Crew never creates branches in your checkout.
  - It uses the persona-free `worker-attached` prompt, so it keeps its own context. It never resumes a Pixel Crew session id.
  - Every task forks the session **as it is now**. Forks don't chain.
- **Permissions:**
  - Fork runs follow the office policy for Claude: `office.permissionMode`, default `--permission-mode auto`. `--dangerously-skip-permissions` is used only with an explicit `backendPermissions.claude: "bypass"` opt-in.
  - The team project folder, when there is one, is passed with `--add-dir`.
  - A live task runs under the session's own permission mode, which Pixel Crew can't change.
- **Busy, idle and done:**
  - Fork: from the run's stream-json.
  - Live: from the transcript.
  - While you are mid-turn in that terminal (registry `status` ≠ `idle`), the member counts as busy and gets no new work. The pool is re-checked when it goes idle.
- **Gone sessions.** Every 3 s the attach manager checks the session's pid and registry entry. If the session is gone, the member is removed and its running item is re-queued: zombie rules, `maxAttempts` 2, then escalated to the Lead. A live run also fails at once if the session dies, and gives up if the message isn't delivered within 6 minutes (held, refused, or messaging off).
- **External list.** An attached session is left out of the external list. Leave team (or firing it, or `FIRE_TEAM`) shows it as external again instead of removing it.
- **Restarts.** Attachments are saved in `data/instances/<id>/attachments.json`. On restart one is restored only if the same session still runs (same pid, same registry start time). Otherwise it is dropped.
- **Read-only.** Pixel Crew only reads the Claude config dir (`CLAUDE_CONFIG_DIR` or `~/.claude`). It never writes there.

### Office UI

- The external character's pane shows a **TEAM** row: a mode picker when both modes are possible, the one-line explanation, and **Join team** (owner only).
- On join the character keeps its sprite, gets a purple name tag with a chain-link badge, and walks to a free dev desk. The pane shows `ATTACHED · FORK` (or `LIVE`) and **Leave team**.
- Code: `apps/web/src/components/office/attach/` and `apps/web/src/store/attach-store.ts`. `page.tsx` grows by 2 lines.

### Demo mode

`pnpm demo` also runs one simulated terminal session, `packages/orchestrator/fake-agent/fake-claude-session.mjs`. It has a registry entry, a transcript and an inbox socket in `<demo data dir>/demo-claude/`, so you can watch the whole flow without tokens: Join team → walk → Boss task → the Lead hands it the `TASK[claude]` part → done → Leave team. Fork runs in demo mode are the scripted fake agent.

### Tests (fakes only)

- `packages/orchestrator/src/__tests__/attach-session.test.ts`:
  - the exact fork argv;
  - dispatch, walk and completion in both modes;
  - an owner who is mid-turn holds work back;
  - removal mid-task re-queues;
  - a dying session re-queues;
  - no inbox fails fast.
- `apps/gateway/src/__tests__/attach-sessions.test.ts`:
  - attach options;
  - attach → dispatch → done;
  - owner-only;
  - no team, and a gone session;
  - detach;
  - session death mid-task;
  - restart persistence;
  - the launcher argv.
- `apps/gateway/src/__tests__/e2e-attach.test.ts`: a real gateway in demo mode, fork and live, over WebSocket.
- `apps/web/src/store/__tests__/attach.test.ts`: store transitions.

## `pixel-crew claude-attachable`

```bash
pixel-crew claude-attachable [any claude flags]      # from source: pnpm --filter pixel-crew exec tsx src/index.ts claude-attachable
```

This starts an interactive `claude` with `--settings <tmp file>` containing `{"crossSessionInbound":"accept"}`, **for that session only**. The docs recommend this for unattended receivers. It is useful when you normally run with `--dangerously-skip-permissions`, because such sessions otherwise hold each live task for approval.

The trade-off: that session accepts cross-session messages from every local session and script of your OS user without asking. Nothing is written to `~/.claude`, and nothing is installed. Without the launcher, live mode still works for sessions that prompt for permissions (`default`, `auto`, `acceptEdits`, …). Add `--dry-run` to print the command instead of running it.

## Limits and risks

- **Fork divergence.** A fork starts from your session as it is at that moment. What it does stays in the fork: your terminal won't know about it, and the next task forks your session again. The Lead gets the fork's result, as with any dev. Each fork leaves a transcript next to your session's (`~/.claude/projects/<folder>/<new id>.jsonl`), and it shows up in `/resume`.
- **Same folder.** A fork works in your real checkout, with no worktree. If you edit the same files in the terminal at the same time, you can collide. Pixel Crew holds new work only while your session is mid-turn; it can't see you typing in an editor.
- **Live mode is in your conversation.** The task text and Pixel Crew's report format land in your transcript. A message that arrives while you are mid-turn is read between tool calls. Pixel Crew only sends when the session is idle, but you can start typing at the same moment.
- **Live mode cancel.** Pixel Crew can stop *waiting*, but it can't interrupt the turn in your terminal. Press Esc there.
- **Bypass sessions in live mode.** Each task waits for your approval in that terminal. If nobody accepts within 5 minutes, the task is re-queued after the 6-minute delivery timeout.
- **Undocumented pieces** [U]: the session registry, the inbox message line, and the transcript records (`end_turn`, `system/turn_duration`) can change in any Claude Code release. The live driver fails safe: no delivery or no turn end means the item is re-queued, never silently lost.
- **Platforms.** Discovery uses `ps`/`lsof`, so it is off on Windows (as before). The drivers themselves are portable, but live mode on native Windows needs the auth token, which Pixel Crew does not have [U].

## Manual test with a real session

This spends tokens. Only the owner runs it. Use a throwaway repo.

**Setup**

1. `mkdir -p ~/scratch/attach-demo && cd ~/scratch/attach-demo && git init && echo "# demo" > README.md`
2. In terminal A, run `claude --permission-mode auto`. Ask it one thing, for example "read README.md and remember it", so the session has a transcript.
3. In terminal B, from the repo, run `pnpm start` (or `pixel-crew`). Open the office.
4. Hire a team: the Hire team button, or `CREATE_TEAM` with any preset.

**Fork mode**

5. Within about 7 s, a blue-tagged character labelled with A's PID appears. Click it. Expect the pane to show **TEAM: Fork | Live in terminal** and "Work runs in a fork of this session; your terminal is not touched."
6. Press **Join team**. Expect:
   - the character gets a purple tag with a link badge and walks to a dev desk;
   - the gateway log (`~/.pixel-crew/data/instances/<id>/gateway.log`) shows `[Attach] AttachDemo (ext-claude-<pid>, pid <pid>) joined the team in fork mode; session <uuid>`.
7. Click the Boss and assign "Add a CONTRIBUTING.md to attach-demo with three short rules". Watch the Lead walk a paper to the attached character. Expect in the log:
   - `[Agent AttachDemo] Attached (fork): claude -p [Pixel Crew] The owner added this Claude Code session…`. Its arguments include `--resume <uuid> --fork-session --output-format stream-json --verbose --permission-mode auto`.
   - `CWD=…/scratch/attach-demo` and `addDir=<team project>`.
   - `[Agent ext-claude-<pid>] Claude Code exited: code=0`.
8. Check:
   - terminal A shows nothing new;
   - `ls ~/.claude/projects/*attach-demo*/` has one extra `.jsonl` (the fork);
   - A's own transcript did not grow during the run: `wc -c` before and after.
9. Press **Leave team**. The character turns blue again, and the log shows `[Attach] AttachDemo (…) left the team (the owner)`. Terminal A keeps running.

**Live mode**

10. Click the character again, pick **Live in terminal**, and press **Join team**. Assign another Boss task. Expect:
    - the log shows `Attached (live): inbox:/tmp/cc-socks/<pid>.sock …`;
    - terminal A shows `› Message from …` with the task, and Claude works on it there;
    - when that turn ends, the item turns done in the office within about a second, and the log shows `exited: code=0`.
11. Optional, bypass session: start terminal A with `claude --dangerously-skip-permissions` instead. In live mode, A shows an approval dialog for each task. With `pixel-crew claude-attachable --dangerously-skip-permissions`, it shows no dialog.

**Zombie and restart checks**

12. Start a task in fork mode, then close terminal A mid-task. Within about 3 s:
    - the log shows `[Attach] … left the team (session ended)`;
    - the fork is killed;
    - the item goes back to the queue (`Re-queued … the process exited without a result`, or "Assignee left the team").
13. Attach a session, then restart the gateway with A still open. The log shows `[Attach] Restored AttachDemo (ext-claude-<pid>, fork mode)`. Close A, restart again: the log shows `Dropping saved attachment … session ended`.

Report back anything that differs, especially in step 10 (inbox line format, turn-end detection) and step 8 (fork transcript location).
