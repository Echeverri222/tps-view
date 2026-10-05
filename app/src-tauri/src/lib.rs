use std::path::Path;
use std::sync::Mutex;

use tauri::Manager;

/// .tps files the OS asked us to open (Finder double-click / "Open With", or argv on
/// Windows/Linux) that the frontend hasn't picked up yet.
#[derive(Default)]
struct PendingOpen(Mutex<Vec<String>>);

/// Reads a text file. TPS files written on Windows are sometimes CP1252/Latin-1 rather than
/// UTF-8 (accented specimen names, paths), so fall back to a byte-per-char decode.
#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
    Ok(match String::from_utf8(bytes) {
        Ok(s) => s,
        Err(e) => e.into_bytes().iter().map(|&b| b as char).collect(),
    })
}

/// Writes via a temporary file + rename so a crash never leaves a half-written .tps.
#[tauri::command]
fn write_text(path: String, contents: String) -> Result<(), String> {
    let tmp = format!("{path}.tpsview-tmp");
    std::fs::write(&tmp, contents).map_err(|e| format!("{path}: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{path}: {e}")
    })
}

/// Raw bytes (images) returned as a binary IPC response instead of a JSON number array.
#[tauri::command]
fn read_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("{path}: {e}"))
}

/// First path in the list that is an existing file (image path resolution in one round-trip).
#[tauri::command]
fn first_existing(paths: Vec<String>) -> Option<String> {
    paths.into_iter().find(|p| Path::new(p).is_file())
}

/// File names (not paths) in a directory; empty if it can't be read.
#[tauri::command]
fn list_dir(path: String) -> Vec<String> {
    std::fs::read_dir(&path)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
fn take_pending_open(state: tauri::State<PendingOpen>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

fn is_tps(p: &str) -> bool {
    p.to_lowercase().ends_with(".tps")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingOpen::default())
        .setup(|app| {
            // Windows/Linux pass files opened from the file manager as arguments.
            let args: Vec<String> = std::env::args().skip(1).filter(|a| is_tps(a)).collect();
            app.state::<PendingOpen>().0.lock().unwrap().extend(args);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            read_bytes,
            first_existing,
            list_dir,
            take_pending_open
        ])
        .build(tauri::generate_context!())
        .expect("error while building TPS View")
        .run(|_app, _event| {
            // macOS delivers Finder "open" requests as an event, possibly before the UI is ready,
            // so queue them and let the frontend drain the queue.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                use tauri::Emitter;
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .filter(|p| is_tps(p))
                    .collect();
                if !paths.is_empty() {
                    _app.state::<PendingOpen>().0.lock().unwrap().extend(paths);
                    let _ = _app.emit("open-files-pending", ());
                }
            }
        });
}
