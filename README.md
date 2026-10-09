# Vento

App Windows portable per gestire le ventole del PC: curve ventola/temperatura, sensori live, profili, tray e avvio con Windows. Tauri 2 + UI web.

**Stato:** legge i sensori reali (temperature e RPM) tramite LibreHardwareMonitor in un piccolo processo accanto all'app (`sidecar/`). Senza diritti di amministratore CPU e schede madri restano illeggibili: il pulsante "Riavvia come amministratore" li abilita. Con "Pilota le ventole" attivo ogni ventola segue la curva applicata; spegnendolo, o chiudendo Vento, le ventole tornano allo stato precedente. Le GPU AMD RX 5000 e successive ricevono la curva direttamente nel driver (Overdrive8, 5 punti), perché ignorano il comando di LibreHardwareMonitor. Non usare Vento insieme ad altri programmi che gestiscono le ventole (Fan Control, tuning ventole di Radeon Software): si sovrascrivono a vicenda, e Vento lo segnala. Se il sidecar manca, l'app va in modalità simulata (badge "Dati simulati").

## Build
Servono Node, Rust e Visual Studio Build Tools.

    npm install
    npm run portable   # -> dist-portable/Vento.exe + dist-portable/sidecar/

Il sidecar si compila con il `csc.exe` di .NET Framework già presente in Windows (vedi `sidecar/VentoSensors.cs`; le DLL in `sidecar/bin` sono LibreHardwareMonitorLib e dipendenze, licenza MPL-2.0).
La cartella `dist-portable` è portable: nessun installer, il profilo WebView2 e le impostazioni stanno in `vento-data/` accanto all'exe. Richiede WebView2 (incluso in Windows 11).
`npm run web` serve la sola UI nel browser.

## Release
Ogni tag `v*` pubblica una release su GitHub con lo zip portable (workflow `.github/workflows/release.yml`):

    git tag v0.2.0
    git push origin v0.2.0
