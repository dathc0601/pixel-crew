//! Finding the user's tools from a GUI app: the full PATH and a Node.js runtime.
//!
//! Apps started from Finder, the Start menu or a desktop launcher get a minimal
//! environment, so the PATH is rebuilt here (login shell on macOS/Linux, inherited on
//! Windows, plus well-known tool folders). The gateway then runs on the first system
//! Node.js >= 22 found; a bundled binary is only a fallback for builds made with
//! PIXEL_CREW_BUNDLE_NODE=1.

use std::collections::HashSet;
use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Oldest Node.js major version the gateway supports.
pub const MIN_NODE_MAJOR: u32 = 22;

/// Windows: start console programs without flashing a console window.
#[cfg(windows)]
pub fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub fn hide_console(_cmd: &mut Command) {}

fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

fn env_dir(var: &str) -> Option<PathBuf> {
    std::env::var_os(var)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// Run a command; its stdout when it exits successfully within `timeout`.
fn output_with_timeout(mut cmd: Command, timeout: Duration) -> Option<String> {
    hide_console(&mut cmd);
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = cmd.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.read_to_string(&mut out);
        out
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let out = reader.join().ok()?;
                return status.success().then_some(out);
            }
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// "v22.13.1" → 22
pub fn parse_node_major(version: &str) -> Option<u32> {
    let v = version.trim();
    let v = v.strip_prefix('v').unwrap_or(v);
    v.split('.').next()?.parse().ok()
}

/// "v22.13.1" → [22, 13, 1] (for sorting version folders, newest first)
fn version_key(name: &str) -> Vec<u32> {
    name.trim_start_matches('v')
        .split('.')
        .map(|p| p.parse().unwrap_or(0))
        .collect()
}

/// `<versions_dir>/<vX.Y.Z>/<suffix>` for every installed version, newest first.
fn versioned_dirs(versions_dir: &Path, suffix: &str) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(versions_dir) else { return Vec::new() };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.starts_with('v'))
        .collect();
    names.sort_by_key(|n| std::cmp::Reverse(version_key(n)));
    names
        .into_iter()
        .map(|n| {
            let dir = versions_dir.join(n);
            if suffix.is_empty() { dir } else { dir.join(suffix) }
        })
        .collect()
}

/// Folders where version managers and installers put `node` (tried after PATH).
pub fn node_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let home = home_dir();
    if cfg!(windows) {
        if let Some(d) = env_dir("NVM_SYMLINK") { dirs.push(d); } // nvm-windows
        if let Some(d) = env_dir("ProgramFiles") { dirs.push(d.join("nodejs")); }
        if let Some(d) = env_dir("LOCALAPPDATA") {
            dirs.push(d.join("Volta").join("bin"));
            dirs.push(d.join("Programs").join("nodejs"));
        }
        if let Some(d) = env_dir("APPDATA") { dirs.push(d.join("fnm").join("aliases").join("default")); }
        if let Some(nvm) = env_dir("NVM_HOME") { dirs.extend(versioned_dirs(&nvm, "")); }
    } else {
        if let Some(h) = &home {
            let nvm = env_dir("NVM_DIR").unwrap_or_else(|| h.join(".nvm"));
            dirs.extend(versioned_dirs(&nvm.join("versions").join("node"), "bin"));
            dirs.push(h.join(".volta").join("bin"));
            if let Some(fnm) = env_dir("FNM_DIR") { dirs.push(fnm.join("aliases").join("default").join("bin")); }
            dirs.push(h.join(".local/share/fnm/aliases/default/bin"));
            dirs.push(h.join("Library/Application Support/fnm/aliases/default/bin"));
            dirs.push(h.join(".asdf/shims"));
            dirs.push(h.join(".local/share/mise/shims"));
        }
        for d in [
            "/opt/homebrew/bin",
            "/opt/homebrew/opt/node@22/bin",
            "/usr/local/bin",
            "/usr/local/opt/node@22/bin",
            "/usr/bin",
        ] {
            dirs.push(PathBuf::from(d));
        }
    }
    dirs
}

/// Tool folders that interactive shell profiles often add but a login shell may miss.
fn extra_tool_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let home = home_dir();
    if cfg!(windows) {
        if let Some(d) = env_dir("APPDATA") { dirs.push(d.join("npm")); }
        if let Some(d) = env_dir("LOCALAPPDATA") { dirs.push(d.join("pnpm")); }
        if let Some(h) = &home {
            dirs.push(h.join(".local").join("bin")); // claude native installer
            dirs.push(h.join(".bun").join("bin"));
            dirs.push(h.join(".cargo").join("bin"));
        }
    } else {
        if let Some(h) = &home {
            dirs.push(h.join(".local/bin")); // claude, pipx
            dirs.push(h.join(".local/share/pnpm"));
            dirs.push(h.join("Library/pnpm"));
            dirs.push(h.join(".npm-global/bin"));
            dirs.push(h.join(".bun/bin"));
            dirs.push(h.join(".cargo/bin"));
        }
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
    }
    dirs
}

/// PATH as the user's login shell sees it (macOS/Linux).
#[cfg(unix)]
fn login_shell_path() -> Option<OsString> {
    let mut shells: Vec<String> = Vec::new();
    if let Ok(s) = std::env::var("SHELL") {
        if !s.is_empty() { shells.push(s); }
    }
    for s in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
        if !shells.iter().any(|x| x == s) { shells.push(s.to_string()); }
    }
    for sh in shells {
        if !Path::new(&sh).exists() { continue; }
        let mut cmd = Command::new(&sh);
        cmd.args(["-l", "-c", "printenv PATH"]);
        let Some(out) = output_with_timeout(cmd, Duration::from_secs(5)) else { continue };
        // Profiles may print banners: PATH is the last non-empty line
        if let Some(line) = out.lines().rev().map(str::trim).find(|l| !l.is_empty()) {
            return Some(OsString::from(line));
        }
    }
    None
}

/// Windows GUI apps inherit the full user + system PATH from Explorer.
#[cfg(not(unix))]
fn login_shell_path() -> Option<OsString> {
    None
}

/// `path` with `dirs` appended (existing folders only, no duplicates).
fn append_dirs(path: OsString, dirs: &[PathBuf]) -> OsString {
    let mut entries: Vec<PathBuf> = std::env::split_paths(&path).collect();
    for d in dirs {
        if d.is_dir() && !entries.iter().any(|e| e == d) { entries.push(d.clone()); }
    }
    std::env::join_paths(entries).unwrap_or(path)
}

/// `path` with `dir` moved to the front, so `node` and `#!/usr/bin/env node` scripts
/// started by the gateway (and its agents) use the same runtime as the gateway.
pub fn prepend_dir(path: &OsString, dir: &Path) -> OsString {
    let mut entries: Vec<PathBuf> = std::env::split_paths(path).filter(|e| e != dir).collect();
    entries.insert(0, dir.to_path_buf());
    std::env::join_paths(entries).unwrap_or_else(|_| path.clone())
}

/// The PATH the gateway (and the agent CLIs it starts) should run with.
pub fn resolve_path() -> OsString {
    let base = login_shell_path()
        .or_else(|| std::env::var_os("PATH"))
        .unwrap_or_default();
    append_dirs(base, &extra_tool_dirs())
}

pub struct NodeRuntime {
    pub path: PathBuf,
    pub version: String,
}

fn node_version(node: &Path) -> Option<String> {
    let mut cmd = Command::new(node);
    cmd.arg("--version");
    output_with_timeout(cmd, Duration::from_secs(5)).map(|v| v.trim().to_string())
}

/// PIXEL_CREW_NODE=<path to node> picks the runtime explicitly (it must be >= 22);
/// otherwise the first `node` >= MIN_NODE_MAJOR on `path`, then in the version-manager folders.
pub fn find_system_node(path: &OsString) -> Option<NodeRuntime> {
    if let Some(explicit) = env_dir("PIXEL_CREW_NODE") {
        let version = node_version(&explicit)?;
        return parse_node_major(&version)
            .is_some_and(|m| m >= MIN_NODE_MAJOR)
            .then_some(NodeRuntime { path: explicit, version });
    }
    let exe = if cfg!(windows) { "node.exe" } else { "node" };
    let mut seen = HashSet::new();
    for dir in std::env::split_paths(path).chain(node_dirs()) {
        let candidate = dir.join(exe);
        if !candidate.is_file() || !seen.insert(candidate.clone()) { continue; }
        match node_version(&candidate) {
            Some(version) if parse_node_major(&version).is_some_and(|m| m >= MIN_NODE_MAJOR) => {
                return Some(NodeRuntime { path: candidate, version });
            }
            Some(version) => println!("[desktop] Skipping {} ({version}, need >= {MIN_NODE_MAJOR})", candidate.display()),
            None => println!("[desktop] Skipping {} (no version)", candidate.display()),
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_node_versions() {
        assert_eq!(parse_node_major("v22.13.1\n"), Some(22));
        assert_eq!(parse_node_major("v18.20.4"), Some(18));
        assert_eq!(parse_node_major("24.0.0"), Some(24));
        assert_eq!(parse_node_major("garbage"), None);
        assert_eq!(parse_node_major(""), None);
    }

    #[test]
    fn sorts_versions_numerically() {
        let mut v = vec!["v9.0.0", "v22.1.0", "v22.13.1", "v18.20.4"];
        v.sort_by_key(|n| std::cmp::Reverse(version_key(n)));
        assert_eq!(v, vec!["v22.13.1", "v22.1.0", "v18.20.4", "v9.0.0"]);
    }

    #[test]
    fn prepend_moves_dir_to_front() {
        let a = PathBuf::from(if cfg!(windows) { "C:\\a" } else { "/a" });
        let b = PathBuf::from(if cfg!(windows) { "C:\\b" } else { "/b" });
        let path = std::env::join_paths([&a, &b]).unwrap();
        let out: Vec<PathBuf> = std::env::split_paths(&prepend_dir(&path, &b)).collect();
        assert_eq!(out, vec![b, a]);
    }
}
