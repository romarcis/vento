# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Tauri desktop app for Windows with a web UI (HTML/CSS/JS frontend, Rust backend for hardware access). Chosen by the user. Mobile web is out of scope; the UI is a desktop window plus a Windows system-tray presence.

## Users

PC enthusiasts and overclockers who tune cooling by hand. They sit at their own machine, often while gaming, benchmarking or stress-testing, and want exact control over fan behavior and live feedback on temperatures and fan speeds.

## Product Purpose

Vento ("wind" in Italian) is a Windows app for managing PC fans. It lets the user shape fan curves against temperature and watch live temperature and fan-speed readings, including from the system tray. Success: the user trusts it to hold their cooling setup running in the background without opening the window.

## Positioning

Not yet defined beyond the above. Open decision: what sets Vento apart from existing fan-control tools.

## Operating Context

Runs on Windows, starts with the system and keeps working in the background. The tray icon is a primary surface: live temperature and fan RPM are visible there. The full window is for configuration (curves, profiles).

## Capabilities and Constraints

Nothing is built yet. Planned scope, confirmed by the user, is a complete app:
- fan curves (fan speed vs temperature) for PC fans
- live temperature and fan-speed sensors, shown in the Windows tray
- profiles
- auto-start with Windows
- background operation

Open: which hardware and sensors are supported, and how fans are driven (not decided).

## Evidence on Hand

None. The project directory is empty. No logo, name assets, or real hardware data exist; do not fabricate sensor values, supported-hardware claims or benchmarks.

## Product Principles

- Live readings are trustworthy: show real sensor data, never decorative numbers.
- Precision for experts: curves are edited exactly, not approximated by presets.
- Works without the window: the tray and background behavior are first-class.
- Safe by default: cooling changes should never leave hardware at risk.
