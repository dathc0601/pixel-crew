# Adding an AI vendor

> **Status: planned (Phase 2).** v1 of Pixel Crew supports **Claude Code only**. This guide describes where multi-vendor support is going and what to read before working on it. It also explains how today's adapter table works, in case you need a stopgap.

The full plan is in [`docs/plans/2026-11-07-fork-improvement-plan.md`](plans/2026-11-07-fork-improvement-plan.md): §6 Phase 2, §7.5, and the owner decisions in §0.

## Today: one `AIBackend` entry per CLI

Every CLI is an entry in `apps/gateway/src/backends.ts`. The type is `AIBackend`, defined in `packages/orchestrator/src/ai-backend.ts`. An entry holds:

- `id`, `name` and `command` (the binary looked up on `PATH`; `detectBackends()` resolves it);
- `buildArgs(prompt, opts)`, which turns one task into a full command line. `opts` (`BuildArgsOpts`) carries:
  - the permission mode;
  - the tool policy (`noTools`, `tools`, `disallowedTools`);
  - resume, model, `agentType` and worktree settings;
- capability flags: `supportsResume`, `supportsStructuredOutput`, `supportsAutoPermission`, `supportsAgentType`, `supportsNativeWorktree`, `supportsStdin`;
- `instructionPath`: where the CLI reads project instructions (`.claude/CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, …).

`AgentSession` (`packages/orchestrator/src/agent-session.ts`) starts **one CLI process per task** through `spawnPortable` in `proc.ts` and parses its output. It reads stream-json when the CLI supports it and plain text otherwise.

The upstream fork still ships entries for Codex, Gemini, Copilot, Cursor, Aider, OpenCode, Pi and Sapling. **They are untested in Pixel Crew.** The Boss flow depends on details only verified for Claude Code:
- the Lead policy maps to `--tools`, `--disallowedTools` and the `Agent` tool;
- permissions use `--permission-mode auto`;
- the Dispatcher's zombie detection needs structured output.

### Rules every backend must follow (enforced today)

These come from the owner decisions in plan §0 and the threat model in [SECURITY.md](../SECURITY.md):

1. **Permissions.** Use the CLI's own *auto* mode if it has one, and set `supportsAutoPermission: true`. A CLI without one gets `permissionMode: "default"`, and the gateway asks the Boss to approve **before** each spawn (`APPROVAL_NEEDED`). Never add a skip-all flag (`--yolo`, `--dangerously-…`) unless `opts.permissionMode === "bypass"`, which only an explicit `backendPermissions` opt-in in `config.json` can produce.
2. **The lead policy must be enforceable.** The Lead runs tool-less (`opts.noTools`). If a CLI cannot run without tools, it cannot be the Lead: say so in the profile and keep it a developer.
3. **Cross-platform spawning.** Go through `proc.ts` (`resolveCommand`, `spawnPortable`, `killTree`). Never use `which`, shell strings or `process.kill(-pid)`.
4. **Tests use fakes.** Add a fake for the CLI's output format next to `packages/orchestrator/fake-agent/`. Never run the real CLI in tests or CI.

## Next: the `AgentDriver` layer

Hand-written argument builders break whenever a CLI changes its flags, and spawning a process per task loses the session between tasks. Phase 2 moves vendor support behind a driver interface. Most vendors would then be reached through the **Agent Client Protocol (ACP)** instead of a custom adapter each.

```ts
// packages/orchestrator/src/drivers/driver.ts (planned, not in the code yet)
export interface AgentDriver {
  readonly capabilities: {
    persistent: boolean;        // one long-lived session per hired agent
    structuredOutput: boolean;  // tool calls, results and usage as events
    approvals: boolean;         // permission requests can reach the Boss
    resume: boolean;
  };
  start(session: DriverSession): Promise<void>;
  prompt(text: string, opts: PromptOptions): AsyncIterable<DriverEvent>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}
```

Planned implementations:

| Driver | Covers | Notes |
|---|---|---|
| `LegacyCliDriver` | Today's spawn-per-task code, moved over unchanged | Every Phase 0/1 test must pass through it untouched (P2.1). It stays for CLIs without ACP and as a fallback. |
| `AcpDriver` | Claude, Codex, Gemini, Antigravity, Copilot, Cursor, OpenCode, Qwen, Goose, … | Built on the `acpx/runtime` library export, not by shelling out per prompt. One named session per hired agent (`<office>-<agentId>`). ACP permission requests map to `APPROVAL_NEEDED`, which brings back real approvals in the UI (P2.2, P2.3). |
| `ClaudeHooksObserver` | Claude Code sessions you started yourself | A loopback `/hooks/claude` endpoint, with a per-install secret, replaces the `ps` CPU heuristic for status (P2.4). It observes only. |

**Already built (Phase 2a, Claude only):** a small first cut of this layer in `packages/orchestrator/src/drivers/` (`driver.ts`, `claude-fork.ts`, `claude-live.ts`). The owner can attach a Claude session they started themselves to the team (owner decision, 2026-11-07). Work then runs in a fork of that session by default, or, on the owner's explicit choice, through the session's documented cross-session inbox. See [attach-sessions.md](attach-sessions.md).

A **driver profile** is then mostly data:
- which driver to use;
- how to start the vendor's ACP adapter;
- its capabilities, and whether it may be the Lead;
- its permission mapping.

Adding a vendor becomes: write the profile, add a fake-server test, and do one manual run with the real CLI. The project owner does that run, because it spends tokens.

### Things to get right

- **acpx is pre-1.0** and needs Node ≥ 22.13. Pin its version and keep every acpx import inside `drivers/acp.ts`.
- **Antigravity's ACP adapter** is unverified. Test it before listing it as supported.
- **Visitors vs hired agents** (P2.5): hired agents, ACP sessions reachable through acpx's shared runtime, and Claude sessions the owner attached (Phase 2a) can be given work. Other discovered sessions stay view-only.
- **Choreography stays cosmetic.** A driver emits events. The Dispatcher and the `HANDOFF` timing do not change per vendor.
- **Team presets** (P2.6): the Lead is the strongest configured model (Claude by default), and developers round-robin across the vendors you have installed.

## Port from these projects, and credit them

Owner decision §0.5: when Phase 2 starts, port logic from projects that already integrate these CLIs instead of rediscovering it. Credit them in the commit, in the code (a header comment naming the source and its license) and in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) when code is copied. Check each project's license before copying anything.

| Project | What to take from it |
|---|---|
| **pixtuoid** | A pixel-office take on the same idea: vendor adapters and session status display |
| [openclaw/acpx](https://github.com/openclaw/acpx) | The ACP runtime library (`acpx/runtime`, `createSharedAcpRuntime()`), persistent named sessions, and the list of about 30 ACP-capable agents |
| [Enderfga/claw-orchestrator](https://github.com/Enderfga/claw-orchestrator) | Multi-CLI orchestration and how it maps each vendor's flags and output |
| [oxgeneral/ORCH](https://github.com/oxgeneral/ORCH) | Work-queue semantics: zombie detection and re-queue by heartbeat. The Dispatcher already follows its approach. |

The `AIBackend` metadata fields were themselves inspired by [Overstory](https://github.com/jayminwest/overstory)'s `AgentRuntime` pattern, credited in `ai-backend.ts`.

## Checklist for a vendor pull request

- [ ] A profile or backend entry following the four rules above
- [ ] A fake that emits the vendor's real output format, plus orchestrator tests that use it
- [ ] Detection that cannot misfire on an ambiguous binary name (see `VERSION_PROBES` in `backends.ts`)
- [ ] A permission mapping reviewed against [SECURITY.md](../SECURITY.md)
- [ ] Docs: the README roadmap and platform notes, and this file
- [ ] Credit for any ported code
- [ ] One manual run with the real CLI, done by the maintainer: streaming, cancel and an approval
