// Assemble dist-portable/: Vento.exe + sidecar/ (sensor reader).
import { cpSync, mkdirSync, rmSync } from "node:fs";
rmSync("dist-portable/sidecar", { recursive: true, force: true });
mkdirSync("dist-portable", { recursive: true });
cpSync("src-tauri/target/release/vento.exe", "dist-portable/Vento.exe");
cpSync("sidecar/bin", "dist-portable/sidecar", { recursive: true });
