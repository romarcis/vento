# Vento

App Windows portable per gestire le ventole del PC: curve ventola/temperatura, sensori live, profili, tray e avvio con Windows. Tauri 2 + UI web.

**Stato:** l'interfaccia funziona con un simulatore (badge "Dati simulati"). Non c'è ancora un backend hardware: leggere i sensori e pilotare le ventole su Windows richiede un driver/libreria (es. LibreHardwareMonitor), da integrare.

## Build
Servono Node, Rust e Visual Studio Build Tools.

    npm install
    npm run build      # -> src-tauri/target/release/vento.exe

L'exe è portable: nessun installer, il profilo WebView2 e le impostazioni stanno in `vento-data/` accanto all'exe. Richiede WebView2 (incluso in Windows 11).
`npm run web` serve la sola UI nel browser.
