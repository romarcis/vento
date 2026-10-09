# Vento

Vento is a portable fan control application for Windows. It reads temperature and fan speed sensors, drives each fan along a user-defined temperature curve, and runs in the background from the notification area. It is built with Tauri 2 and a web-based user interface.

## Features

- **Fan curves.** Each fan follows its own temperature-to-speed curve, edited by dragging points on a chart, with the arrow keys, or by entering exact values. Changes are previewed against the applied curve and take effect only when applied.
- **Live monitoring.** The fan list shows the current temperature of each fan's sensor, its speed in RPM, and its thermal state (normal, high, critical).
- **Presets.** Built-in curves (Silent, Balanced, Performance, Fixed 50%) and named custom presets saved per fan. The preset currently in use is shown under the fan name.
- **Fan management.** Fans can be renamed, coloured, reordered, hidden, and temporarily stopped from the context menu to identify them.
- **Notification area.** An application icon and optional per-fan temperature icons, drawn in the fan's colour and updated every second.
- **Safety.** Fan speed never drops below 20% under curve control; a fan is set to 100% when its sensor reaches the critical temperature; stopped fans restart automatically when temperatures rise; when Vento exits, every fan is returned to its previous or automatic state.
- **Start-up integration.** Optional start with Windows through a scheduled task with highest privileges, so that Vento starts elevated at sign-in without a confirmation prompt, in the same way as Fan Control.
- **Conflict warning.** At start-up Vento lists other fan control programs and highlights those that are running.
- **Themes and languages.** Light, dark, or automatic theme. The interface follows the Windows display language, with translations for English, Italian, German, French, and Spanish; any other language falls back to English.

## Hardware support

Sensors are read and fans are controlled through [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor), which runs in a separate helper process (`sidecar/`).

- **Motherboard fans and CPU temperature** require administrator rights. Vento can restart itself elevated, or start elevated at sign-in.
- **AMD Radeon RX 5000 series and later** ignore the fan control interface used by LibreHardwareMonitor. For these cards Vento writes the curve directly to the driver through the AMD Overdrive8 interface. The driver accepts five curve points, so the curve is resampled to five points, and the card applies it using its own temperature sensor.
- **Fan headers without a fan attached** are hidden by default; any header can be shown from the "Visible fans" list.
- If the helper process is unavailable, Vento runs on simulated data and labels it as such.

Vento must not be used at the same time as other fan control software (for example Fan Control, MSI Afterburner, or the fan tuning in Radeon Software). The programs overwrite each other's settings; Vento detects this and displays a warning.

## Requirements

- Windows 10 or Windows 11 (64-bit)
- Microsoft Edge WebView2 Runtime (included with Windows 11)
- .NET Framework 4.7.2 or later (included with Windows 10 and later)

## Installation

Vento requires no installation. Download the archive from the [Releases](../../releases) page, extract it to a folder of your choice, and run `Vento.exe`. The `sidecar` folder must remain next to the executable.

Settings, presets, and fan names are stored in the `vento-data` folder next to the executable. If the folder is moved and start with Windows is enabled, the option should be disabled and enabled again so that the scheduled task points to the new location.

## Building from source

Building requires Node.js, Rust, and the Visual Studio Build Tools (C++ workload).

```
npm install
npm run portable
```

The portable build is written to `dist-portable/` (`Vento.exe` and the `sidecar` folder). `npm run web` serves the user interface alone in a browser, running on simulated data.

The helper process is compiled with the .NET Framework compiler included in Windows:

```
%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe -target:exe -out:sidecar/bin/vento-sensors.exe -r:sidecar/bin/LibreHardwareMonitorLib.dll sidecar/VentoSensors.cs sidecar/AmdOd8.cs
```

The libraries in `sidecar/bin` are LibreHardwareMonitorLib and its dependencies, distributed under the Mozilla Public License 2.0 and their respective licences.

## Releases

Each tag matching `v*` triggers the workflow in `.github/workflows/release.yml`, which builds the application on Windows and publishes the portable archive as a GitHub release:

```
git tag v0.2.0
git push origin v0.2.0
```

## Project structure

| Path | Contents |
|---|---|
| `src/` | User interface (HTML, CSS, JavaScript) and translations (`i18n.js`) |
| `src-tauri/` | Tauri application: window, notification area, scheduled task, helper process management |
| `sidecar/` | Sensor reader and fan controller based on LibreHardwareMonitor, including the AMD Overdrive8 support |
| `scripts/portable.mjs` | Assembles the portable build |
