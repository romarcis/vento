// Applies the saved theme before first paint to avoid a dark/light flash.
try { document.documentElement.dataset.theme = JSON.parse(localStorage.getItem("vento") || "{}").theme || "auto"; } catch {}
