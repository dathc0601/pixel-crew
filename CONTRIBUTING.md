# Contributing to Pixel Crew

Thanks for helping. Bug reports, small fixes, theme packs, role packs and docs are all welcome. Before you build a large feature, please open an issue first, so we can agree on the approach before you spend the time.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as described in [SECURITY.md](SECURITY.md), not in issues.

## Set up

You need Node.js 22+, pnpm 9 and git. Rust is only needed for the desktop app.

```bash
git clone https://github.com/dathc0601/pixel-crew.git
cd pixel-crew
pnpm install
pnpm demo        # scripted office, no AI CLI, no tokens: http://localhost:9090
```

| Command | What it runs |
|---|---|
| `pnpm demo` | Builds the web UI if needed and starts the gateway in demo mode |
| `pnpm dev:demo` | Gateway in demo mode with reload (port 9099); pair it with `pnpm dev:web` |
| `pnpm dev` | Gateway + web dev server, for a real office (needs Claude Code) |
| `pnpm dev:desktop` | The Tauri app in dev mode |

**Never spend tokens in tests.** Tests and CI use the fake backend (`id: "fake"`) or demo mode, and must not start a real AI CLI. `PIXEL_CREW_HOME=/some/temp/dir` keeps a dev or demo run away from your real data.

## Before you open a pull request

CI runs these on Ubuntu, macOS and Windows, and all of them must pass:

```bash
pnpm typecheck
pnpm lint                              # 0 errors (warnings are OK)
pnpm test
pnpm --filter pixel-crew test:e2e      # real gateway in demo mode
pnpm --filter web build
pnpm --filter web size                 # /office first-load JS within 5% of apps/web/perf-budget.json
pnpm --filter pixel-crew build
```

Some UI changes cannot be checked by tests alone. For those, run `pnpm demo`, hand the Lead a task, and watch it on a desktop width and on a phone width (390×844 in the browser's device mode).

## Guidelines

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(web): …`, `fix(gateway): …`, `docs: …`, `perf: …`, `ci: …`. Write them in English. The release changelog is generated from them: `feat` and `fix` show up in it and set the next version, while `build`, `ci`, `chore`, `test` and `refactor` stay hidden.
- **Keep pull requests small**: one logical change each, with tests for behavior changes.
- **Security-sensitive areas** need a test with every change: `apps/gateway/src/{ws-server,security,rbac}.ts`, pairing, CORS and origin checks, previews, and the lead policy. Read the threat model in [SECURITY.md](SECURITY.md) first.
- **Cross-platform**: start processes only through `packages/orchestrator/src/proc.ts` (`spawnPortable`, `killTree`, `resolveCommand`), and check paths with `isPathInside`. Never use shell strings for git.
- **Web bundle**: import runtime values from `@pixel-crew/shared/client`; the lint rule keeps Zod out of the browser. Load heavy UI with `next/dynamic`. New features go in their own modules, not into `app/office/page.tsx` or `office-store.ts`.
- **Art and assets**: only CC0, MIT or your own work. Record every asset in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **No telemetry**: no analytics, beacons or third-party requests from the UI or the gateway.
- **Extending**: theme packs, role packs and scene adapters are covered in [docs/extending.md](docs/extending.md). Adding an AI vendor is covered in [docs/adding-a-vendor.md](docs/adding-a-vendor.md).

`CLAUDE.md` holds the project notes for AI coding assistants. It is also a compact map of the codebase.

## Releases (maintainers)

Versions and the changelog are managed by [release-please](https://github.com/googleapis/release-please). Every package file shares one version: the root `package.json` (shown in the UI), `apps/gateway`, `apps/desktop` and the Tauri config and crate.

1. **Merge to `master` as usual.** The **Release** workflow (`.github/workflows/release-please.yml`) keeps a pull request named `chore: release x.y.z` up to date. That pull request bumps the versions and writes `CHANGELOG.md`.
   - While the version is below 1.0, `feat` bumps the minor version, `fix` bumps the patch version, and a breaking change bumps the minor version.
   - To force a version, add a `Release-As: x.y.z` line to a commit body.
2. **Review and merge the release pull request.** release-please then creates the `vX.Y.Z` tag and publishes the GitHub release. The same workflow then:
   - runs **Desktop builds** (`release.yml`), which builds the unsigned macOS, Windows and Linux installers and attaches them to the release. This takes about 15 to 25 minutes.
   - runs **npm publish** (`npm-publish.yml`), which publishes `pixel-crew` to npm with provenance, **only if the `NPM_TOKEN` secret exists**. Otherwise the job is skipped with a notice.
3. **Check the release page.** It should list the `.dmg`, `*-setup.exe`, `.deb` and `.AppImage` files. Edit the notes if needed.

One-time repository setup:
- Settings → Actions → General → Workflow permissions: allow GitHub Actions to **create and approve pull requests**. Without it, release-please cannot open its pull request.
- Optional: a fine-grained token with contents and pull requests read/write access, saved as the `RELEASE_PLEASE_TOKEN` secret. Pull requests opened with the default token do not trigger CI.
- To publish to npm, save an npm automation token, or a granular token with publish rights for `pixel-crew`, as the `NPM_TOKEN` secret.

Other ways to run the workflows:
- **Desktop builds** → *Run workflow* with no tag only uploads the installers as workflow artifacts. With an existing tag, it attaches them to that release.
- Pushing a `v*` tag by hand also builds the installers. If no release exists for the tag, it creates a **draft** release, so nothing is published by accident. Prefer the release pull request, which keeps the versions and the changelog in step.
- **npm publish** → *Run workflow* with an existing tag publishes that version. It checks that `apps/gateway/package.json` matches the tag first.

Local desktop builds (`pnpm build:desktop`) never change the version.
