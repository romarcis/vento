#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry, WindowEvent,
};

const NO_WINDOW: u32 = 0x0800_0000;

/// Whether closing the window can hide to the tray: some icon must be left to come back with.
static MAIN_TRAY: AtomicBool = AtomicBool::new(true);
static TEMP_TRAYS: AtomicUsize = AtomicUsize::new(0);

#[link(name = "shell32")]
extern "system" {
    fn IsUserAnAdmin() -> i32;
}

/// stdin of the sensor sidecar; commands are "set <id> <pct>", "default <id>", "defaultall", "amdcurve ...", "amddefault".
struct Sidecar(Mutex<Option<ChildStdin>>);

#[tauri::command]
fn fan_cmd(state: tauri::State<Sidecar>, line: String) {
    // Only the verbs the sidecar understands, one line each.
    let ok = ["set ", "default ", "amdcurve "].iter().any(|v| line.starts_with(v)) || line == "defaultall" || line == "amddefault";
    if !ok || line.contains('\n') { return; }
    if let Some(w) = state.0.lock().unwrap().as_mut() {
        let _ = writeln!(w, "{line}");
        let _ = w.flush();
    }
}

#[tauri::command]
fn set_tray_tooltip(app: AppHandle, text: String) {
    if let Some(t) = app.tray_by_id("main") {
        let _ = t.set_tooltip(Some(text));
    }
}

#[tauri::command]
fn set_main_tray(app: AppHandle, visible: bool) {
    MAIN_TRAY.store(visible, Ordering::SeqCst);
    if let Some(t) = app.tray_by_id("main") {
        let _ = t.set_visible(visible);
    }
}

/// One extra tray icon per fan: the UI draws the temperature (RGBA, size x size) and we show it.
#[tauri::command]
fn set_temp_tray(app: AppHandle, id: String, rgba: Vec<u8>, size: u32, tooltip: String) -> Result<(), String> {
    if rgba.len() != (size * size * 4) as usize { return Err("bad icon size".into()); }
    let img = tauri::image::Image::new_owned(rgba, size, size);
    let tid = format!("temp-{id}");
    if let Some(t) = app.tray_by_id(&tid) {
        t.set_icon(Some(img)).map_err(|e| e.to_string())?;
        t.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())?;
    } else {
        tray(&app, TrayIconBuilder::with_id(tid).icon(img).tooltip(tooltip)).map_err(|e| e.to_string())?;
        TEMP_TRAYS.fetch_add(1, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
fn remove_temp_tray(app: AppHandle, id: String) {
    if app.remove_tray_by_id(&format!("temp-{id}")).is_some() {
        TEMP_TRAYS.fetch_sub(1, Ordering::SeqCst);
    }
}

#[tauri::command]
fn is_elevated() -> bool {
    unsafe { IsUserAnAdmin() != 0 }
}

#[tauri::command]
fn restart_as_admin(app: AppHandle) {
    if let Ok(exe) = std::env::current_exe() {
        let ok = Command::new("powershell")
            .creation_flags(NO_WINDOW)
            .args(["-NoProfile", "-Command", &format!("Start-Process -FilePath '{}' -Verb RunAs", exe.display())])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok { quit(&app); } // UAC declined: keep running as we are
    }
}

/// Which of the given process names (e.g. "fancontrol.exe") are running right now.
#[tauri::command]
fn running_processes(names: Vec<String>) -> Vec<String> {
    let out = Command::new("tasklist").creation_flags(NO_WINDOW).args(["/fo", "csv", "/nh"]).output();
    let list = out.map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase()).unwrap_or_default();
    names.into_iter().filter(|n| list.contains(&format!("\"{}\"", n.to_lowercase()))).collect()
}

/// Runs the LibreHardwareMonitor sidecar and forwards each JSON line to the UI as a "sensors" event.
fn spawn_sensors(app: AppHandle) {
    let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) else { return };
    // Portable layout: sidecar next to the exe. Dev layout: project/sidecar/bin.
    let exe = [dir.join("sidecar"), dir.join("../../../sidecar/bin")]
        .into_iter()
        .map(|d| d.join("vento-sensors.exe"))
        .find(|p| p.exists());
    let Some(exe) = exe else { return };
    std::thread::spawn(move || loop {
        let child = Command::new(&exe).current_dir(exe.parent().unwrap()).creation_flags(NO_WINDOW).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn();
        if let Ok(mut child) = child {
            *app.state::<Sidecar>().0.lock().unwrap() = child.stdin.take();
            if let Some(out) = child.stdout.take() {
                for line in BufReader::new(out).lines().map_while(Result::ok) {
                    let _ = app.emit("sensors", line);
                }
            }
            let _ = child.wait();
            *app.state::<Sidecar>().0.lock().unwrap() = None;
        }
        std::thread::sleep(std::time::Duration::from_secs(5)); // sidecar died or failed: retry
    });
}

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Closing the sidecar's stdin makes it hand every fan back to automatic control before we go.
fn quit(app: &AppHandle) {
    app.state::<Sidecar>().0.lock().unwrap().take();
    app.exit(0);
}

/// Every Vento tray icon (app and per-fan temperatures) shares the same menu and click behaviour.
fn tray(app: &AppHandle, b: TrayIconBuilder<Wry>) -> tauri::Result<TrayIcon> {
    let open = MenuItem::with_id(app, "open", "Apri Vento", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "quit", "Esci", true, None::<&str>)?;
    b.menu(&Menu::with_items(app, &[&open, &exit])?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show(app),
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|t, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show(t.app_handle());
            }
        })
        .build(app)
}

fn main() {
    // Portable: keep WebView2 profile (localStorage = settings) next to the exe.
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("vento-data"))) {
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir);
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![])))
        .invoke_handler(tauri::generate_handler![
            set_tray_tooltip, set_main_tray, restart_as_admin, is_elevated, running_processes,
            fan_cmd, set_temp_tray, remove_temp_tray
        ])
        .setup(|app| {
            app.manage(Sidecar(Mutex::new(None)));
            tray(app.handle(), TrayIconBuilder::with_id("main").icon(app.default_window_icon().unwrap().clone()).tooltip("Vento"))?;
            spawn_sensors(app.handle().clone());
            Ok(())
        })
        .on_window_event(|w, e| {
            // Close hides to the tray while an icon is there to come back with; otherwise Vento quits.
            if let WindowEvent::CloseRequested { api, .. } = e {
                if MAIN_TRAY.load(Ordering::SeqCst) || TEMP_TRAYS.load(Ordering::SeqCst) > 0 {
                    api.prevent_close();
                    let _ = w.hide();
                } else {
                    api.prevent_close();
                    quit(w.app_handle());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("errore avvio Vento");
}
