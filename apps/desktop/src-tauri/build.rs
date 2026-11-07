use std::path::Path;

fn main() {
    // tauri.conf.json bundles the "sidecar/" folder as a resource, and tauri-build fails
    // when it is missing. Give fresh clones (cargo check, tauri dev, CI) an empty
    // placeholder; scripts/build-desktop.mjs fills the folder before a real build, and the
    // app refuses to start an empty gateway.js with a clear message.
    let sidecar = Path::new(env!("CARGO_MANIFEST_DIR")).join("sidecar");
    let gateway = sidecar.join("gateway.js");
    if !gateway.exists() {
        let _ = std::fs::create_dir_all(&sidecar);
        let _ = std::fs::write(&gateway, "");
    }
    tauri_build::build()
}
