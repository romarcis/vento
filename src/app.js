// Vento: fan-curve editor. Data comes from a simulator until a hardware backend exists.
// ponytail: simulator is the only DataSource; swap `readSensors` for a Tauri invoke when a backend lands.

const SVGNS = "http://www.w3.org/2000/svg";
const T_MIN = 20, T_MAX = 100, D_MIN = 0, D_MAX = 100;
const MIN_DUTY = 20; // below this most fans stall
const TICK_MS = 1000;
const TRAIL_S = 60;

const SIM_SENSORS = [
  { id: "cpu", name: "CPU Package", warn: 80, crit: 90, max: 100 },
  { id: "gpu", name: "GPU Core", warn: 78, crit: 88, max: 100 },
  { id: "vrm", name: "VRM", warn: 85, crit: 100, max: 120 },
  { id: "ssd", name: "SSD NVMe", warn: 65, crit: 75, max: 90 },
  { id: "case", name: "Aria case", warn: 45, crit: 55, max: 70 },
  { id: "wtr", name: "Liquido", warn: 42, crit: 50, max: 60 },
];
const SIM_FANS = [
  { id: "cpu", name: "CPU Fan", sensor: "cpu", maxRpm: 2200 },
  { id: "gpu", name: "GPU Fan", sensor: "gpu", maxRpm: 3100 },
  { id: "front", name: "Frontale ×2", sensor: "case", maxRpm: 1500 },
  { id: "rear", name: "Posteriore", sensor: "case", maxRpm: 1500 },
  { id: "pump", name: "Pompa AIO", sensor: "wtr", maxRpm: 3000 },
];
let SENSORS = SIM_SENSORS, FANS = SIM_FANS;
let real = false; // true once the hardware sidecar delivers data
const PRESETS = {
  silent: [[30, 20], [50, 25], [65, 40], [78, 65], [90, 100]],
  balanced: [[30, 25], [45, 35], [60, 55], [75, 80], [88, 100]],
  perf: [[30, 40], [45, 55], [58, 75], [70, 95], [80, 100]],
  flat: [[30, 50], [90, 50]],
};
const PROFILE_NAMES = { silent: "Silenzioso", balanced: "Bilanciato", perf: "Performance" };

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clone = (o) => JSON.parse(JSON.stringify(o));
const el = (name, attrs = {}, parent) => {
  const n = document.createElementNS(SVGNS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  parent?.appendChild(n);
  return n;
};

/* ---------- state ---------- */
const store = {
  load() { try { return JSON.parse(localStorage.getItem("vento") || "null"); } catch { return null; } },
  save(s) { try { localStorage.setItem("vento", JSON.stringify(s)); } catch {} },
};
// Fill in curves for any fan a profile does not know yet (new hardware, first run).
function ensureProfiles() {
  for (const k in PROFILE_NAMES) {
    state.profiles[k] ??= {};
    for (const f of FANS) state.profiles[k][f.id] ??= { sensor: f.sensor, points: clone(PRESETS[k]) };
  }
  state.draft ??= clone(applied());
  for (const f of FANS) state.draft[f.id] ??= clone(applied()[f.id]);
}
const saved = store.load();
const state = {
  profiles: saved?.profiles ?? {},
  active: saved?.active ?? "balanced",
  fan: FANS[0].id,
  sel: 0,
  draft: null, // working copy of the active profile
  autostart: saved?.autostart ?? false,
  control: saved?.control ?? false, // opt-in: drive the real fans
  seenFans: new Set(saved?.seenFans ?? []), // headers that have ever spun; empty headers stay hidden
};
const applied = () => state.profiles[state.active];
const isDirty = (id) => JSON.stringify(state.draft[id]) !== JSON.stringify(applied()[id]);
const anyDirty = () => FANS.some((f) => isDirty(f.id));
const persist = () => store.save({ profiles: state.profiles, active: state.active, autostart: state.autostart, control: state.control, seenFans: [...state.seenFans] });

/* ---------- curves ---------- */
function dutyAt(points, t) {
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, d1] = points[i];
    if (t <= t1) {
      const [t0, d0] = points[i - 1];
      return t1 === t0 ? d1 : d0 + ((d1 - d0) * (t - t0)) / (t1 - t0);
    }
  }
  return points[points.length - 1][1];
}
function unsafe(points) {
  if (dutyAt(points, 80) < 70) return "Curva non sicura: sopra 80 °C la ventola resta sotto il 70%.";
  if (points.some((p) => p[1] < MIN_DUTY)) return `Sotto il ${MIN_DUTY}% molte ventole si fermano.`;
  return "";
}

/* ---------- simulator ---------- */
const sim = {
  load: 0.35, loadT: 0.35, t: {}, rpm: {}, hist: {}, tick: 0, lost: null,
};
sim.duty = {};
function initStores() {
  for (const s of SENSORS) { sim.t[s.id] ??= 38; sim.hist[s.id] ??= []; }
  for (const f of FANS) sim.rpm[f.id] ??= f.maxRpm * 0.3;
}
function simStep() {
  if (real) return;
  sim.tick++;
  if (sim.tick % 12 === 1) sim.loadT = Math.random() < 0.3 ? 0.9 : 0.15 + Math.random() * 0.5;
  sim.load += (sim.loadT - sim.load) * 0.12;
  const duty = (fid) => dutyAt(applied()[fid].points, sim.t[applied()[fid].sensor]);
  const cool = (sid) => {
    const fs = FANS.filter((f) => applied()[f.id].sensor === sid);
    if (!fs.length) return 0.25;
    return 0.25 + 0.75 * (fs.reduce((a, f) => a + duty(f.id), 0) / fs.length) / 100;
  };
  const target = {
    cpu: 30 + sim.load * 70 / (0.35 + cool("cpu")),
    gpu: 30 + sim.load * 80 / (0.35 + cool("gpu")) * 0.9,
    vrm: 35 + sim.load * 45,
    ssd: 36 + sim.load * 22,
    case: 26 + sim.load * 20 / (0.4 + cool("case")),
    wtr: 28 + sim.load * 22 / (0.4 + cool("wtr")),
  };
  for (const s of SENSORS) {
    sim.t[s.id] += (target[s.id] - sim.t[s.id]) * 0.18 + (Math.random() - 0.5) * 0.4;
    const h = sim.hist[s.id]; h.push(sim.t[s.id]); if (h.length > TRAIL_S) h.shift();
  }
  for (const f of FANS) {
    const want = f.maxRpm * duty(f.id) / 100;
    sim.rpm[f.id] += (want - sim.rpm[f.id]) * 0.35 + (Math.random() - 0.5) * 8;
  }
}

/* ---------- header / profiles ---------- */
function renderProfiles() {
  const box = $("profiles"); box.textContent = "";
  for (const k in PROFILE_NAMES) {
    const b = document.createElement("button");
    b.type = "button"; b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(k === state.active));
    b.textContent = PROFILE_NAMES[k];
    b.onclick = () => {
      if (anyDirty() && !confirmDiscard()) return;
      state.active = k; state.draft = clone(applied()); state.sel = 0; persist(); renderAll();
    };
    box.appendChild(b);
  }
}
function confirmDiscard() { return window.confirm("Ci sono modifiche non applicate. Scartarle?"); }
function renderActions() {
  const d = anyDirty();
  $("apply").disabled = !d; $("revert").disabled = !d;
  $("dirty").textContent = d ? "Modifiche non applicate" : "";
}
$("apply").onclick = () => {
  state.profiles[state.active] = clone(state.draft); persist(); renderAll();
};
$("revert").onclick = () => { state.draft = clone(applied()); state.sel = 0; renderAll(); };

/* ---------- sensors strip ---------- */
function buildSensors() {
  const box = $("sensors"); box.textContent = "";
  for (const s of SENSORS.slice(0, 8)) {
    const d = document.createElement("div"); d.className = "sensor"; d.id = "s-" + s.id;
    d.innerHTML = `<span class="name"></span><span class="val"><span class="v">--</span><small>°C</small></span><span class="scale"><i></i></span><span class="tag"></span>`;
    d.querySelector(".name").textContent = s.name;
    box.appendChild(d);
  }
}
function updateSensors() {
  for (const s of SENSORS.slice(0, 8)) {
    const v = sim.t[s.id], d = $("s-" + s.id);
    if (!(v > 0)) { // a driver-gated sensor reads 0 without admin rights
      d.dataset.state = "off"; d.querySelector(".v").textContent = "--";
      d.querySelector("i").style.width = "0"; d.querySelector(".tag").textContent = "Serve admin"; continue;
    }
    const st = v >= s.crit ? "crit" : v >= s.warn ? "warn" : "ok";
    d.dataset.state = st;
    d.querySelector(".v").textContent = v.toFixed(0);
    d.querySelector("i").style.width = clamp((v / s.max) * 100, 0, 100) + "%";
    d.querySelector(".tag").textContent = st === "crit" ? "Critico" : st === "warn" ? "Alto" : "Normale";
  }
}

/* ---------- fan rail ---------- */
function buildFans() {
  const ul = $("fans"); ul.textContent = "";
  for (const f of FANS) {
    const li = document.createElement("li");
    const b = document.createElement("button"); b.type = "button"; b.className = "fan"; b.id = "f-" + f.id;
    b.innerHTML = `<span class="n"></span><span class="rpm"><span class="r">0</span><small>RPM</small></span><span class="meta"></span><span class="duty"></span>`;
    b.onclick = () => { state.fan = f.id; state.sel = 0; renderAll(); };
    li.appendChild(b); ul.appendChild(li);
  }
}
function updateFans() {
  for (const f of FANS) {
    const b = $("f-" + f.id), cfg = state.draft[f.id];
    b.setAttribute("aria-current", String(f.id === state.fan));
    b.dataset.state = isDirty(f.id) ? "dirty" : "";
    b.querySelector(".n").textContent = f.name;
    b.querySelector(".r").textContent = Math.round(sim.rpm[f.id] / 10) * 10;
    b.querySelector(".meta").textContent = SENSORS.find((s) => s.id === applied()[f.id].sensor)?.name ?? "Nessun sensore";
    b.querySelector(".duty").textContent = Math.round(real ? (sim.duty[f.id] ?? (sim.rpm[f.id] / f.maxRpm) * 100) : dutyAt(applied()[f.id].points, sim.t[applied()[f.id].sensor])) + "%";
  }
}

/* ---------- chart ---------- */
const chart = $("chart");
const M = { l: 52, r: 24, t: 20, b: 40 };
let W = 800, H = 360;
const X = (t) => M.l + ((t - T_MIN) / (T_MAX - T_MIN)) * (W - M.l - M.r);
const Y = (d) => H - M.b - ((d - D_MIN) / (D_MAX - D_MIN)) * (H - M.t - M.b);
const unX = (px) => T_MIN + ((px - M.l) / (W - M.l - M.r)) * (T_MAX - T_MIN);
const unY = (py) => D_MIN + ((H - M.b - py) / (H - M.t - M.b)) * (D_MAX - D_MIN);
const path = (pts) => pts.map(([t, d], i) => (i ? "L" : "M") + X(t) + " " + Y(d)).join(" ");

let live = {}; // dynamic nodes
function drawChart() {
  const r = chart.getBoundingClientRect();
  W = Math.max(400, r.width); H = Math.max(240, r.height);
  chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
  chart.textContent = "";
  // critical zone: hot and slow
  el("rect", { class: "zone-crit", x: X(80), y: Y(70), width: X(T_MAX) - X(80), height: Y(0) - Y(70) }, chart);
  for (let t = T_MIN; t <= T_MAX; t += 10) {
    el("line", { class: "grid major", x1: X(t), x2: X(t), y1: Y(D_MAX), y2: Y(D_MIN) }, chart);
    el("text", { x: X(t), y: H - M.b + 16, "text-anchor": "middle" }, chart).textContent = t;
  }
  for (let d = 0; d <= 100; d += 20) {
    el("line", { class: "grid major", x1: X(T_MIN), x2: X(T_MAX), y1: Y(d), y2: Y(d) }, chart);
    el("text", { x: M.l - 8, y: Y(d) + 4, "text-anchor": "end" }, chart).textContent = d;
  }
  el("text", { class: "axis-label", x: (M.l + W - M.r) / 2, y: H - 6, "text-anchor": "middle" }, chart).textContent = "Temperatura °C";
  const yl = el("text", { class: "axis-label", transform: `translate(12 ${(M.t + H - M.b) / 2}) rotate(-90)`, "text-anchor": "middle" }, chart);
  yl.textContent = "Velocità %";

  live.band = el("rect", { class: "band", y: Y(D_MAX), height: Y(D_MIN) - Y(D_MAX) }, chart);
  live.applied = el("path", { class: "applied" }, chart);
  live.draft = el("path", { class: "draft" }, chart);
  live.cross = el("line", { class: "cross", y1: Y(D_MAX), y2: Y(D_MIN) }, chart);
  live.op = el("circle", { class: "op", r: 6 }, chart);
  live.opl = el("text", { class: "op-label" }, chart);
  live.pts = [];
  updateChart();
}
function updateChart() {
  if (!live.draft) return;
  const f = FANS.find((x) => x.id === state.fan), cfg = state.draft[f.id], ap = applied()[f.id];
  const pts = cfg.points;
  const ext = (p) => [[T_MIN, p[0][1]], ...p, [T_MAX, p[p.length - 1][1]]];
  live.applied.setAttribute("d", path(ext(ap.points)));
  live.draft.setAttribute("d", path(ext(pts)));
  // handles
  while (live.pts.length > pts.length) live.pts.pop().remove();
  while (live.pts.length < pts.length) {
    const i = live.pts.length;
    const c = el("circle", { class: "pt", r: 6, tabindex: 0, role: "slider" }, chart);
    c.addEventListener("pointerdown", (e) => startDrag(e, c));
    c.addEventListener("keydown", (e) => keyMove(e, c));
    c.addEventListener("focus", () => { state.sel = +c.dataset.i; syncPointFields(); markSel(); });
    live.pts.push(c);
  }
  pts.forEach(([t, d], i) => {
    const c = live.pts[i];
    c.dataset.i = i; c.setAttribute("cx", X(t)); c.setAttribute("cy", Y(d));
    c.setAttribute("aria-label", `Punto ${i + 1}: ${t} °C, ${d}%`);
    c.setAttribute("aria-valuetext", `${t} °C, ${d}%`);
    chart.appendChild(c); // keep handles on top
  });
  markSel();
  // live marker
  const temp = sim.t[ap.sensor], duty = dutyAt(ap.points, temp);
  const hist = sim.hist[ap.sensor] ?? [];
  const valid = temp > 0;
  for (const n of [live.cross, live.op, live.opl, live.band]) n.style.display = valid ? "" : "none";
  if (valid && hist.length) {
    const lo = Math.min(...hist), hi = Math.max(...hist);
    live.band.setAttribute("x", X(clamp(lo, T_MIN, T_MAX))); live.band.setAttribute("width", Math.max(2, X(clamp(hi, T_MIN, T_MAX)) - X(clamp(lo, T_MIN, T_MAX))));
  }
  const tx = X(clamp(temp, T_MIN, T_MAX));
  live.cross.setAttribute("x1", tx); live.cross.setAttribute("x2", tx);
  live.op.setAttribute("cx", tx); live.op.setAttribute("cy", Y(duty));
  live.opl.setAttribute("x", tx + (tx > W - 140 ? -16 : 16)); live.opl.setAttribute("text-anchor", tx > W - 140 ? "end" : "start");
  live.opl.setAttribute("y", Y(duty) - 18);
  live.opl.textContent = `${temp.toFixed(0)} °C → ${duty.toFixed(0)}%`;
  const w = unsafe(pts);
  $("warn").hidden = !w; $("warn").textContent = w;
}
function markSel() { live.pts.forEach((c, i) => c.classList.toggle("sel", i === state.sel)); }

function movePoint(i, t, d) {
  const pts = state.draft[state.fan].points;
  const lo = i > 0 ? pts[i - 1][0] + 1 : T_MIN, hi = i < pts.length - 1 ? pts[i + 1][0] - 1 : T_MAX;
  pts[i] = [clamp(Math.round(t), lo, hi), clamp(Math.round(d), D_MIN, D_MAX)];
  afterEdit();
}
function startDrag(e, c) {
  e.preventDefault(); c.focus(); c.setPointerCapture(e.pointerId);
  const i = +c.dataset.i; state.sel = i;
  const move = (ev) => {
    const r = chart.getBoundingClientRect();
    movePoint(i, unX(((ev.clientX - r.left) / r.width) * W), unY(((ev.clientY - r.top) / r.height) * H));
  };
  c.addEventListener("pointermove", move);
  const up = () => { c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", up); };
  c.addEventListener("pointerup", up);
}
function keyMove(e, c) {
  const i = +c.dataset.i, [t, d] = state.draft[state.fan].points[i], s = e.shiftKey ? 5 : 1;
  const m = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] }[e.key];
  if (!m) return;
  e.preventDefault(); movePoint(i, t + m[0], d + m[1]);
}
function afterEdit() { syncPointFields(); updateChart(); updateFans(); renderActions(); }

/* ---------- editor chrome ---------- */
function buildEditorControls() {
  $("sensor-select").innerHTML = SENSORS.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  $("sensor-select").onchange = (e) => { state.draft[state.fan].sensor = e.target.value; afterEdit(); };
  $("preset-select").onchange = (e) => {
    if (!e.target.value) return;
    state.draft[state.fan].points = clone(PRESETS[e.target.value]); state.sel = 0; e.target.value = ""; afterEdit(); renderEditor();
  };
  $("pt-select").onchange = (e) => { state.sel = +e.target.value; syncPointFields(); markSel(); };
  const num = () => movePoint(state.sel, +$("pt-temp").value, +$("pt-duty").value);
  $("pt-temp").onchange = num; $("pt-duty").onchange = num;
  $("pt-add").onclick = () => {
    const pts = state.draft[state.fan].points;
    let gi = 0, gap = 0;
    for (let i = 0; i < pts.length - 1; i++) if (pts[i + 1][0] - pts[i][0] > gap) { gap = pts[i + 1][0] - pts[i][0]; gi = i; }
    if (gap < 2) return;
    const t = Math.round((pts[gi][0] + pts[gi + 1][0]) / 2);
    pts.splice(gi + 1, 0, [t, Math.round(dutyAt(pts, t))]); state.sel = gi + 1; afterEdit(); renderEditor();
  };
  $("pt-del").onclick = () => {
    const pts = state.draft[state.fan].points; if (pts.length <= 2) return;
    pts.splice(state.sel, 1); state.sel = clamp(state.sel, 0, pts.length - 1); afterEdit(); renderEditor();
  };
}
function syncPointFields() {
  const pts = state.draft[state.fan].points, p = pts[state.sel] ?? pts[0];
  $("pt-select").value = String(state.sel);
  $("pt-temp").value = p[0]; $("pt-duty").value = p[1];
  $("pt-del").disabled = pts.length <= 2;
}
function renderEditor() {
  const f = FANS.find((x) => x.id === state.fan);
  if (!f) { $("fan-title").textContent = "Nessuna ventola rilevata"; chart.textContent = ""; return; }
  $("sensor-select").innerHTML = SENSORS.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  $("fan-title").textContent = f.name;
  $("sensor-select").value = state.draft[f.id].sensor;
  // An AMD Overdrive8 GPU runs the curve in its own driver, on its own temperature.
  $("sensor-select").disabled = isAmdOd8(f);
  $("sensor-select").title = isAmdOd8(f) ? "La GPU applica la curva da sola, sulla propria temperatura" : "";
  const pts = state.draft[f.id].points;
  $("pt-select").innerHTML = pts.map((_, i) => `<option value="${i}">${i + 1}</option>`).join("");
  state.sel = clamp(state.sel, 0, pts.length - 1);
  syncPointFields();
  drawChart();
}
function renderAll() { if (!FANS.some((f) => f.id === state.fan)) state.fan = FANS[0]?.id; renderProfiles(); renderActions(); updateSensors(); updateFans(); renderEditor(); }

/* ---------- tray / autostart (Tauri, optional) ---------- */
const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;
function pushTray() {
  if (!invoke) return;
  const hot = SENSORS.filter((s) => sim.t[s.id] > 0).slice(0, 2).map((s) => `${s.name.split(" ")[0]} ${sim.t[s.id].toFixed(0)}°C`).join(" · ");
  const rpm = FANS.slice(0, 3).map((f) => `${f.name.split(" ")[0]} ${Math.round(sim.rpm[f.id])}`).join(" · ");
  invoke("set_tray_tooltip", { text: `Vento · ${PROFILE_NAMES[state.active]}\n${hot}\n${rpm} RPM` }).catch(() => {});
}
$("control").checked = state.control;
$("control").onchange = (e) => {
  state.control = e.target.checked; persist(); setSource(); controlTick();
  if (!state.control) { send("defaultall"); hw.amdKey = null; }
};
$("autostart").checked = state.autostart;
$("autostart").onchange = async (e) => {
  state.autostart = e.target.checked; persist();
  try { await invoke?.("plugin:autostart|" + (state.autostart ? "enable" : "disable")); } catch {}
};

/* ---------- boot ---------- */
/* ---------- fan control ---------- */
// Drives each controllable fan from its APPLIED curve (never the draft). Safety rules:
// duty never below MIN_DUTY, 100% at the sensor's critical temperature, back to automatic
// control when the sensor is unreadable, when control is switched off, or when Vento exits.
const sent = {}; // fan id -> { duty, at }
const hw = { od8: false, od8Overridden: false, amdKey: null }; // AMD Overdrive8 GPU: curve lives in the driver
const isAmdOd8 = (f) => hw.od8 && f.id.startsWith("/gpu-amd");
// The driver takes exactly 5 points: resample the applied curve across its own temperature span.
function amdCurve(points) {
  const t0 = clamp(points[0][0], 25, 95), t1 = clamp(points[points.length - 1][0], t0 + 4, 100);
  const out = [];
  for (let i = 0; i < 5; i++) {
    const t = Math.round(t0 + ((t1 - t0) * i) / 4);
    out.push(t, clamp(Math.round(dutyAt(points, t)), MIN_DUTY, 100));
  }
  return out.join(" ");
}
const noResponse = new Set();
const send = (line) => invoke?.("fan_cmd", { line }).catch(() => {});
function controlTick() {
  if (!real || !invoke) return;
  for (const f of FANS) {
    if (isAmdOd8(f)) {
      const key = state.control ? amdCurve(applied()[f.id].points) : null;
      if (key !== hw.amdKey) { send(key ? `amdcurve ${key}` : "amddefault"); hw.amdKey = key; }
      noResponse[state.control && hw.od8Overridden ? "add" : "delete"](f.id);
      continue;
    }
    if (!f.ctrl) continue;
    const ap = applied()[f.id], s = SENSORS.find((q) => q.id === ap.sensor), t = sim.t[ap.sensor];
    if (!state.control || !(t > 0)) {
      if (sent[f.id]) { send(`default ${f.ctrl}`); delete sent[f.id]; noResponse.delete(f.id); }
      continue;
    }
    const duty = t >= s.crit ? 100 : clamp(Math.round(dutyAt(ap.points, t)), MIN_DUTY, 100);
    const last = sent[f.id];
    if (!last || last.duty !== duty) { send(`set ${f.ctrl} ${duty}`); sent[f.id] = { duty, at: Date.now() }; }
    // The fan reports its own duty back: if it ignores us for 6 s, say so instead of pretending.
    const reported = sim.duty[f.id];
    if (reported != null && Date.now() - sent[f.id].at > 6000) {
      noResponse[Math.abs(reported - sent[f.id].duty) > 8 ? "add" : "delete"](f.id);
    }
  }
}
function setSource() {
  const b = $("sim");
  b.dataset.real = String(real);
  $("foot-note").textContent = !real ? "Chiudendo la finestra Vento resta nella tray e continua ad applicare il profilo."
    : state.control ? "Controllo attivo: la ventola segue la curva applicata. Chiudendo la finestra Vento resta nella tray."
    : "Controllo spento: le ventole restano in automatico. Attivalo per farle seguire le curve.";
  b.textContent = real ? (state.control ? "Sensori reali · controllo attivo" : "Sensori reali · sola lettura") : "Dati simulati";
}
// Real hardware (Tauri sidecar). First message defines the sensor/fan lists; later ones update values.
const guessRpmMax = (rpm) => Math.max(1000, Math.ceil((rpm * 1.4) / 100) * 100);
const shortHw = (hw) => hw.replace(/^(AMD|Intel\(R\)|Intel|NVIDIA)\s+/i, "").replace(/^(Radeon RX|Radeon|GeForce RTX|GeForce GTX|Ryzen \d|Core i\d|Core Ultra \d)\s*/i, "");
const limits = (id, hw) => /nvme|hdd|ssd|storage/i.test(id + hw) ? { warn: 65, crit: 75, max: 90 } : /vrm|chipset|motherboard/i.test(id + hw) ? { warn: 85, crit: 100, max: 120 } : { warn: 80, crit: 90, max: 100 };
function onHardware(list) {
  const temps = list.filter((x) => x.type === "temp");
  let fans = list.filter((x) => x.type === "fan" && x.value >= 0);
  // A Super I/O chip reports every header on the board; show only the ones a fan is plugged into.
  for (const x of fans) if (x.value > 0 && !state.seenFans.has(x.id)) { state.seenFans.add(x.id); persist(); }
  fans = fans.filter((x) => state.seenFans.has(x.id) || x.id.includes("/gpu"));
  const known = new Set(SENSORS.map((s) => s.id) );
  if (!real || temps.some((x) => !known.has(x.id)) || fans.some((x) => !FANS.some((f) => f.id === x.id))) {
    SENSORS = temps.map((x) => ({ id: x.id, name: `${shortHw(x.hw)} ${x.name}`, ...limits(x.id, x.hw) }));
    const prefix = (id) => id.split("/").slice(0, 3).join("/");
    FANS = fans.map((x) => {
      const same = SENSORS.find((s) => prefix(s.id) === prefix(x.id)) ?? SENSORS[0];
      const ctrl = list.find((q) => q.type === "ctrl" && q.hw === x.hw && q.name === x.name);
      return { id: x.id, name: `${x.hw.split(" ").slice(-2).join(" ")} ${x.name}`, sensor: same?.id, maxRpm: guessRpmMax(x.value), ctrl: ctrl?.id };
    });
    real = true; sim.t = {}; sim.hist = {}; sim.rpm = {}; initStores(); ensureProfiles(); setSource();
    state.fan = FANS[0]?.id; buildSensors(); buildFans(); renderAll();
  }
  for (const x of list) {
    if (x.type === "temp") { sim.t[x.id] = x.value; const h = sim.hist[x.id]; if (h) { h.push(x.value); if (h.length > TRAIL_S) h.shift(); } }
    else if (x.type === "fan") { sim.rpm[x.id] = x.value; const f = FANS.find((q) => q.id === x.id); if (f && x.value > f.maxRpm) f.maxRpm = guessRpmMax(x.value); }
    else if (x.type === "ctrl") { const fan = list.find((q) => q.type === "fan" && q.hw === x.hw && q.name === x.name); if (fan) sim.duty[fan.id] = x.value; }
  }
}
window.__TAURI__?.event?.listen("sensors", (e) => {
  try {
    const m = JSON.parse(e.payload);
    hw.od8 = !!m.od8; hw.od8Overridden = !!m.od8Overridden;
    onHardware(m.sensors);
  } catch {}
});

initStores(); ensureProfiles(); setSource();
buildSensors(); buildFans(); buildEditorControls(); renderAll();
const nowEl = $("now");
setInterval(() => {
  simStep(); updateSensors(); updateFans(); updateChart();
  const ap = applied()[state.fan]; if (!ap) { nowEl.textContent = ""; return; }
  const t = sim.t[ap.sensor];
  nowEl.innerHTML = t > 0 ? `Ora: <b>${t.toFixed(1)} °C</b> → <b>${dutyAt(ap.points, t).toFixed(0)}%</b> · ${Math.round(sim.rpm[state.fan])} RPM` : "Sensore non leggibile (servono diritti di amministratore)";
  controlTick(); setSource();
  const bad = FANS.filter((f) => noResponse.has(f.id));
  $("warn-fan").hidden = !bad.length;
  $("warn-fan").textContent = bad.length ? `${bad.map((f) => f.name).join(", ")} non segue Vento: chiudi altri programmi che gestiscono le ventole (Fan Control, tuning ventole di Radeon Software) o prova "Riavvia come amministratore".` : "";
  pushTray();
  $("admin").hidden = !(real && SENSORS.slice(0, 8).some((s) => !(sim.t[s.id] > 0)));
}, TICK_MS);
$("admin").onclick = () => invoke?.("restart_as_admin");
for (let i = 0; i < 20; i++) simStep();
new ResizeObserver(() => drawChart()).observe(chart.parentElement);
