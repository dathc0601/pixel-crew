#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::PageLoadEvent,
    AppHandle, Emitter, Manager,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_notification::NotificationExt as _;
use tauri_plugin_shell::{process::CommandChild, ShellExt};

#[tauri::command]
fn bounce_dock(window: tauri::Window) {
    let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
}

/// Returns gateway connection info (port + gatewayId) if sidecar is ready, or null.
/// Frontend polls this to handle the race where GATEWAY_READY emits before listen() is registered.
#[tauri::command]
fn get_gateway_info(state: tauri::State<'_, Mutex<GatewayInfo>>) -> Option<serde_json::Value> {
    state.lock().unwrap().ready_payload.clone()
}

struct GatewayState {
    child: Option<CommandChild>,
    pid: Option<u32>,
    /// Set when the sidecar process has terminated (works on every OS, unlike kill(pid, 0)).
    exited: Arc<AtomicBool>,
}

struct GatewayInfo {
    ready_payload: Option<serde_json::Value>,
}

/// A problem that keeps the office from starting (no Node.js, no gateway bundle).
/// Shown over the window on every page load until the app restarts.
struct StartupError(Mutex<Option<String>>);

const NODE_MISSING: &str = "Pixel Crew needs Node.js 22 or newer.\n\n\
Install it from https://nodejs.org (or with nvm, fnm, Volta or Homebrew), \
then quit Pixel Crew from the tray icon and open it again. \
To use a specific Node.js, set PIXEL_CREW_NODE to its path.";

/// Quit: let the gateway shut down cleanly (it stops agent CLIs and saves state),
/// then force-kill its process tree if it is still running after 3 seconds.
fn kill_gateway(app: &AppHandle) {
    let state = app.state::<Mutex<GatewayState>>();
    let mut guard = state.lock().unwrap();
    let Some(pid) = guard.pid.take() else { return };
    let exited = guard.exited.clone();
    // Dropping the child handle closes the gateway's stdin; started with
    // PIXEL_CREW_EXIT_ON_STDIN_EOF=1 it shuts down on EOF (the graceful path on Windows).
    drop(guard.child.take());
    drop(guard);
    if exited.load(Ordering::SeqCst) {
        return;
    }
    request_graceful_exit(pid);
    for _ in 0..30 {
        std::thread::sleep(Duration::from_millis(100));
        if exited.load(Ordering::SeqCst) {
            println!("[desktop] Gateway exited gracefully");
            return;
        }
    }
    force_kill_tree(pid);
    println!("[desktop] Gateway force-killed (pid={pid})");
}

#[cfg(unix)]
fn request_graceful_exit(pid: u32) {
    // SIGTERM runs the gateway's cleanup (stops agent CLIs, saves state)
    unsafe {
        libc::kill(pid as libc::pid_t, libc::SIGTERM);
    }
}

#[cfg(not(unix))]
fn request_graceful_exit(_pid: u32) {
    // Windows has no SIGTERM for console programs: the closed stdin above is the signal
}

#[cfg(unix)]
fn force_kill_tree(pid: u32) {
    // Agent CLIs run in their own process groups and are stopped by the gateway itself
    unsafe {
        libc::kill(pid as libc::pid_t, libc::SIGKILL);
    }
}

#[cfg(windows)]
fn force_kill_tree(pid: u32) {
    let mut cmd = std::process::Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    runtime::hide_console(&mut cmd);
    let _ = cmd.status();
}

/// Script that lays a full-window message over whatever page is showing.
fn overlay_script(message: &str) -> String {
    let msg = serde_json::to_string(message).unwrap_or_else(|_| "\"\"".into());
    format!(
        "(function(){{var m={msg};function show(){{var d=document.getElementById('pixel-crew-startup-error');\
if(!d){{d=document.createElement('div');d.id='pixel-crew-startup-error';d.setAttribute('role','alert');\
d.style.cssText='position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;\
padding:32px;background:#16161d;color:#f2f2f2;font:16px/1.6 system-ui,sans-serif;white-space:pre-wrap;text-align:center';\
var t=document.createElement('div');t.style.maxWidth='36em';d.appendChild(t);document.body.appendChild(d);}}d.firstChild.textContent=m;}}\
if(document.body)show();else document.addEventListener('DOMContentLoaded',show);}})();"
    )
}

fn show_startup_error(app: &AppHandle, message: &str) {
    eprintln!("[desktop] {message}");
    *app.state::<StartupError>().0.lock().unwrap() = Some(message.to_string());
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(overlay_script(message));
        let _ = w.show();
        let _ = w.set_focus();
    }
    let _ = app.notification().builder().title("Pixel Crew").body(message).show();
}

fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// Working directory for the gateway: the filesystem root, which the gateway reads as
/// "no project folder given" and answers with ~/.pixel-crew/projects.
fn root_dir() -> PathBuf {
    if cfg!(windows) {
        let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        PathBuf::from(format!("{drive}\\"))
    } else {
        PathBuf::from("/")
    }
}

/// Start the gateway sidecar on system Node.js (or the bundled fallback).
fn start_gateway(app: &AppHandle) -> Result<(), String> {
    let sidecar_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot find the app resources: {e}"))?
        .join("sidecar");
    let gateway_js = sidecar_dir.join("gateway.js");
    let web_dir = sidecar_dir.join("web");
    if file_len(&gateway_js) == 0 {
        return Err("This build of Pixel Crew has no gateway bundle (sidecar/gateway.js is empty).\n\n\
Build the app with `pnpm build:desktop`."
            .into());
    }

    let path = runtime::resolve_path();
    let bundled = sidecar_dir.join(if cfg!(windows) { "node.exe" } else { "node" });
    let node = if let Some(n) = runtime::find_system_node(&path) {
        println!("[desktop] Using system Node.js {} at {}", n.version, n.path.display());
        n.path
    } else if std::env::var_os("PIXEL_CREW_NODE").is_none() && file_len(&bundled) > 0 {
        println!("[desktop] No system Node.js >= {}; using the bundled runtime", runtime::MIN_NODE_MAJOR);
        bundled
    } else {
        return Err(NODE_MISSING.into());
    };
    let path = match node.parent() {
        Some(dir) => runtime::prepend_dir(&path, dir),
        None => path,
    };

    let mut command = app
        .shell()
        .command(&node)
        .args([gateway_js.as_os_str()])
        .current_dir(root_dir())
        .env("PATH", &path)
        .env("WEB_DIR", web_dir.as_os_str())
        .env("NO_OPEN", "1")
        .env("GATEWAY_ID", "desktop")
        .env("NODE_ENV", "production")
        .env("PIXEL_CREW_EXIT_ON_STDIN_EOF", "1");
    if let Some(home) = std::env::var_os("HOME").filter(|h| !h.is_empty()) {
        command = command.env("HOME", home);
    }
    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("Could not start the Pixel Crew gateway: {e}"))?;

    let exited = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<Mutex<GatewayState>>();
        let mut guard = state.lock().unwrap();
        guard.pid = Some(child.pid());
        guard.child = Some(child);
        guard.exited = exited.clone();
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    println!("[gateway] {}", text.trim_end());
                    // GATEWAY_READY {"port":..,"gatewayId":..}: store it (get_gateway_info) and emit it
                    if let Some(json_str) = text.strip_prefix("GATEWAY_READY ") {
                        if let Ok(value) = serde_json::from_str::<serde_json::Value>(json_str.trim()) {
                            println!("[desktop] Gateway ready: {value}");
                            app_handle.state::<Mutex<GatewayInfo>>().lock().unwrap().ready_payload = Some(value.clone());
                            let _ = app_handle.emit("gateway-ready", value);
                        }
                    }
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[gateway] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Terminated(status) => {
                    println!("[gateway] exited: {status:?}");
                    exited.store(true, Ordering::SeqCst);
                    let never_ready = app_handle.state::<Mutex<GatewayInfo>>().lock().unwrap().ready_payload.is_none();
                    if never_ready {
                        show_startup_error(
                            &app_handle,
                            &format!("The Pixel Crew gateway stopped before it was ready (exit code {:?}).\n\n\
Another Pixel Crew may already be running, or its data folder may be unreadable.",
                                status.code),
                        );
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn main() {
    let is_dev = cfg!(debug_assertions);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_notification::init())
        .manage(Mutex::new(GatewayState { child: None, pid: None, exited: Arc::new(AtomicBool::new(false)) }))
        .manage(Mutex::new(GatewayInfo { ready_payload: None }))
        .manage(StartupError(Mutex::new(None)))
        .on_page_load(|webview, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let error = webview.app_handle().state::<StartupError>().0.lock().unwrap().clone();
            if let Some(message) = error {
                let _ = webview.eval(overlay_script(&message));
            }
        })
        .setup(move |app| {
            // -- System tray --
            let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let launch_at_login = app.autolaunch().is_enabled().unwrap_or(false);
            let autostart = CheckMenuItem::with_id(app, "autostart", "Launch at Login", true, launch_at_login, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &autostart, &separator, &quit])?;

            let autostart_item = autostart.clone();
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Pixel Crew")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "autostart" => {
                        let manager = app.autolaunch();
                        let enable = !manager.is_enabled().unwrap_or(false);
                        let result = if enable { manager.enable() } else { manager.disable() };
                        if let Err(e) = result {
                            eprintln!("[desktop] Could not change Launch at Login: {e}");
                        }
                        let _ = autostart_item.set_checked(manager.is_enabled().unwrap_or(false));
                    }
                    "quit" => {
                        kill_gateway(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // -- Gateway sidecar (production only) --
            if !is_dev {
                if let Err(message) = start_gateway(app.handle()) {
                    show_startup_error(app.handle(), &message);
                }
            } else {
                println!("[desktop] Dev mode — gateway sidecar skipped (`pnpm dev:desktop` starts the dev servers).");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if cfg!(target_os = "linux") {
                    // Tray icons are not shown on every Linux desktop: closing the window quits,
                    // so the app can never be left running with no way back to it.
                    kill_gateway(window.app_handle());
                    return;
                }
                // macOS and Windows: hide to the tray instead of quitting
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![bounce_dock, get_gateway_info])
        .build(tauri::generate_context!())
        .expect("error while building Pixel Crew")
        .run(|app, event| {
            match event {
                // Re-show window when Dock icon is clicked (macOS)
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { .. } => show_main_window(app),
                // Kill sidecar when app is actually exiting
                tauri::RunEvent::Exit => kill_gateway(app),
                _ => {}
            }
        });
}
