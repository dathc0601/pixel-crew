# Pixel Crew desktop app

The desktop app is an optional tray shell around the same gateway you get with the CLI.
It starts the gateway in the background, shows the office in a window, and keeps
running in the tray (menu bar on macOS) when you close the window.

- macOS: `.dmg` (Apple Silicon and Intel builds)
- Windows: NSIS installer (`*-setup.exe`, per-user install, no admin rights needed)
- Linux: `.deb` and `.AppImage`

## Requirements: Node.js 22 or newer

The app does **not** ship its own Node.js, which keeps the installers small
(about 9 MB for the macOS `.dmg`). On start it looks for Node.js 22+ in this order:

1. `PIXEL_CREW_NODE`, if set: the path to a `node` binary. Nothing else is tried.
2. Your `PATH` (on macOS and Linux, the PATH of your login shell).
3. Common install folders: nvm, fnm, Volta, asdf, mise, Homebrew (`node@22` too),
   `/usr/local/bin`, `/usr/bin`; on Windows `Program Files\nodejs`, nvm-windows,
   Volta and fnm.

The first Node.js 22+ it finds runs the gateway. Its folder is put first on the
gateway's PATH, so agent CLIs written in Node (and `npx`) use the same runtime.

If no suitable Node.js is found, the window shows "Pixel Crew needs Node.js 22 or
newer" and nothing else starts. Install Node.js from <https://nodejs.org> (or with a
version manager), then quit Pixel Crew from the tray and open it again.

### Bundling Node.js (fallback build)

For machines where installing Node.js is not an option, build the app with Node.js
inside it:

```sh
PIXEL_CREW_BUNDLE_NODE=1 pnpm --filter pixel-crew-desktop build
# Windows PowerShell: $env:PIXEL_CREW_BUNDLE_NODE = "1"; pnpm --filter pixel-crew-desktop build
```

This copies the Node.js binary that runs the build (it must be 22+) into the app. It
adds roughly 60 to 120 MB, depending on the platform. A system Node.js 22+ is still
preferred when one is installed; the bundled one is only used when none is found.

## The builds are unsigned

Pixel Crew is a hobby project, so the installers are not code-signed or notarized
(Apple and Windows signing certificates cost money). Your OS will warn you the first
time you open the app.

### macOS (Gatekeeper)

1. Open the `.dmg` and drag Pixel Crew to Applications.
2. In Applications, **right-click (or Control-click) Pixel Crew and choose Open**, then
   click **Open** in the dialog. You only need to do this once.
3. If macOS only offers "Move to Trash": open **System Settings → Privacy & Security**,
   scroll to the message about Pixel Crew and click **Open Anyway**, then confirm.
4. Last resort, if the app is reported as "damaged" (quarantine flag on a download):

   ```sh
   xattr -dr com.apple.quarantine "/Applications/Pixel Crew.app"
   ```

### Windows (SmartScreen)

Running the installer shows "Windows protected your PC". Click **More info**, then
**Run anyway**. The installer puts the app in your user profile and adds a Start menu
entry; no administrator rights are needed.

### Linux

- `.deb`: `sudo apt install ./Pixel*Crew*_amd64.deb`
- `.AppImage`: `chmod +x Pixel*Crew*.AppImage` and run it. Some distributions need
  `libfuse2` to run AppImages.
- The tray icon needs an AppIndicator-capable desktop (on GNOME, the AppIndicator
  extension). Because a tray icon is not guaranteed on Linux, **closing the window
  quits the app** there; on macOS and Windows it hides to the tray.

## Building it yourself

```sh
pnpm install
pnpm --filter pixel-crew-desktop build   # web + gateway bundle + installer for this OS
pnpm build:desktop                        # same, bumps the patch version; on macOS installs to /Applications
```

You need Rust (stable, via rustup) and the Tauri system dependencies for your OS
(<https://tauri.app/start/prerequisites/>). `scripts/build-desktop.mjs` is the Tauri
`beforeBuildCommand`: it builds the web UI and the standalone gateway bundle and fills
`apps/desktop/src-tauri/sidecar/`. `--skip-build` reuses an existing
`apps/gateway/dist` built with `BUNDLE_ALL=1`.

`pnpm dev:desktop` runs the gateway dev server (port 9099), the Next.js dev server and
the Tauri window; in dev mode the app does not start its own gateway.

CI: `.github/workflows/release.yml` builds unsigned installers for all three OSes on
`v*` tags and on manual runs, and uploads them as workflow artifacts (it never creates
a GitHub release).

## Sizes (local build, macOS arm64, 2026-11-07)

| Artifact | Size |
|---|---|
| `Pixel Crew_<version>_aarch64.dmg` | 8.9 MB |
| `Pixel Crew.app` (installed) | 19 MB (12 MB binary, 6 MB gateway bundle and web UI) |

Windows and Linux sizes: see the "Installer sizes" step of the `Desktop builds`
workflow.

## Security notes

- The webview has no shell permissions: the gateway is started from Rust, and the
  webview cannot spawn processes or write to the gateway's stdin.
- The content security policy has no `'unsafe-eval'`, and `withGlobalTauri` is off.
  The page may connect only to the app itself and to the gateway on `localhost` /
  `127.0.0.1`.
- The gateway listens on loopback only, as with the CLI. Phones pair through the
  options in `docs/mobile.md`.
- Quitting asks the gateway to shut down cleanly (it stops agent CLIs and saves
  state); after 3 seconds it is force-killed (`taskkill /T /F` on Windows).
