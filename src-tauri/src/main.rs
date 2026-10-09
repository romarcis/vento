#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Write};
use std::sync::Mutex;
use std::os::windows::process::CommandExt;
use std::process::{ChildStdin, Command, Stdio};
use tauri::{Emitter, 
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};

#[tauri::command]
fn set_tray_tooltip(app: AppHandle, text: String) {
    if let Some(t) = app.tray_by_id("main") {
        let _ = t.set_tooltip(Some(text));
    }
}

/// stdin of the sensor sidecar; commands are "set <id> <pct>", "default <id>", "defaultall".
struct Sidecar(Mutex<Option<ChildStdin>>);

#[tauri::command]
fn fan_cmd(state: tauri::State<Sidecar>, line: String) {
    // Only the three verbs the sidecar understands, one line each.
    let ok = ["set ", "default "].iter().any(|v| line.starts_with(v)) || line == "defaultall";
    if !ok || line.contains('\n') { return; }
    if let Some(w) = state.0.lock().unwrap().as_mut() {
        let _ = writeln!(w, "{line}");
        let _ = w.flush();
    }
}

#[tauri::command]
fn restart_as_admin(app: AppHandle) {
    if let Ok(exe) = std::env::current_exe() {
        let ok = Command::new("powershell")
            .creation_flags(0x0800_0000)
            .args(["-NoProfile", "-Command", &format!("Start-Process -FilePath '{}' -Verb RunAs", exe.display())])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok { app.exit(0); }
    }
}

/// Runs the LibreHardwareMonitor sidecar and forwards each JSON line to the UI as a "sensors" event.
fn spawn_sensors(app: AppHandle) {
    let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) else { return };
    // Portable layout: sidecar\ next to the exe. Dev layout: project\sidecarin.
    let exe = [dir.join("sidecar"), dir.join("../../../sidecar/bin")]
        .into_iter()
        .map(|d| d.join("vento-sensors.exe"))
        .find(|p| p.exists());
    let Some(exe) = exe else { return };
    std::thread::spawn(move || loop {
        let child = Command::new(&exe).current_dir(exe.parent().unwrap()).creation_flags(0x0800_0000).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn();
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

fn main() {
    // Portable: keep WebView2 profile (localStorage = settings) next to the exe.
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("vento-data"))) {
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir);
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![])))
        .invoke_handler(tauri::generate_handler![set_tray_tooltip, restart_as_admin, fan_cmd])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Apri Vento", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Esci", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Vento")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => show(app),
                    "quit" => { app.state::<Sidecar>().0.lock().unwrap().take(); app.exit(0) } // closing stdin makes the sidecar restore automatic fan control
                    _ => {}
                })
                .on_tray_icon_event(|t, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show(t.app_handle());
                    }
                })
                .build(app)?;
            app.manage(Sidecar(Mutex::new(None)));
            spawn_sensors(app.handle().clone());
            Ok(())
        })
        .on_window_event(|w, e| {
            // Close = hide to tray; the app keeps running.
            if let WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close();
                let _ = w.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("errore avvio Vento");
}
