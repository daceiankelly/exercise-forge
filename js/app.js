"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtT = (m) => `T+${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const nowIso = () => new Date().toISOString().slice(0, 19) + "Z";
const newId = () => Math.random().toString(16).slice(2, 12);
const icon = (name, cls = "") => `<span class="ms ${cls}">${name}</span>`;
const initials = (name) => name.split(/\s+/).filter((w) => w && !/^(of|the|and|for|de|la)$/i.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
const hue = (s) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 5;   // stable avatar colour per name

const state = { ex: null, tab: "scenario", role: null, streaming: false, view: "excon", cell: null, ctab: "situation" };

function toast(msg, ok = false) {
  const t = $("#toast");
  $("#toastText").textContent = msg;
  $("#toastIcon").textContent = ok ? "check_circle" : "error";
  t.classList.toggle("error", !ok);
  t.classList.remove("hidden");
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), ok ? 3500 : 7000);
}

async function busy(el, btn, fn) {
  el.classList.remove("hidden");
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { toast(e.message); console.error(e); }
  finally { el.classList.add("hidden"); if (btn) btn.disabled = false; }
}

// ------------------------------------------------------------------ Material behaviours

// Ripple on press for interactive components.
document.addEventListener("pointerdown", (ev) => {
  const el = ev.target.closest(".btn, .icon-btn, .fab, .nav-item, .tab-btn, .chip.filter, .seg-btn, .list-item");
  if (!el || el.disabled) return;
  const r = el.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2;
  const span = document.createElement("span");
  span.className = "ripple";
  Object.assign(span.style, { width: `${size}px`, height: `${size}px`, left: `${ev.clientX - r.left - size / 2}px`, top: `${ev.clientY - r.top - size / 2}px` });
  el.append(span);
  setTimeout(() => span.remove(), 600);
});

// Top app bar tints when content scrolls under it (M3 "on scroll" container colour).
addEventListener("scroll", () => $("#appBar").classList.toggle("scrolled", scrollY > 4), { passive: true });

// Hide icon glyphs if the Material Symbols font can't load (e.g. offline).
if (document.fonts?.load) {
  Promise.race([
    document.fonts.load('24px "Material Symbols Rounded"', "home"),
    new Promise((r) => setTimeout(() => r([]), 4000)),
  ]).then((f) => { if (!f.length) document.documentElement.classList.add("no-icons"); })
    .catch(() => document.documentElement.classList.add("no-icons"));
}

// Theme: system → light → dark.
const THEMES = { system: "brightness_auto", light: "light_mode", dark: "dark_mode" };
function applyTheme(t) {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  $("#themeIcon").textContent = THEMES[t];
  $("#themeBtn").dataset.tip = `Theme: ${t}`;
  try { localStorage.setItem("exforge.theme", t); } catch {}
}
$("#themeBtn").addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme || "system";
  applyTheme({ system: "light", light: "dark", dark: "system" }[cur]);
});

// Modal navigation drawer on small screens.
const closeDrawer = () => { $("#drawer").classList.remove("open"); $("#scrim").classList.remove("open"); };
$("#drawerBtn").addEventListener("click", () => { $("#drawer").classList.add("open"); $("#scrim").classList.add("open"); });
$("#scrim").addEventListener("click", closeDrawer);

// ------------------------------------------------------------------ exercise model

const Ex = {
  // Log ids are random so entries written at the same moment on different computers never clash.
  log(ex, kind, actor, text, data) {
    const entry = { id: `E${Math.random().toString(36).slice(2, 8).toUpperCase()}`, ts: nowIso(), game_time_min: ex.clock_min, kind, actor, text };
    if (data !== undefined) entry.data = data;
    ex.log.push(entry);
    return entry;
  },

  // Apply fn through the active backend (local: re-read, change, save; GitLab: change set posted in the background)
  // and re-render if it's the open exercise.
  mutate(id, fn) {
    // Any change to the map adds a snapshot for the AAR replay.
    const withHistory = (x) => {
      const before = x.world && typeof worldCore === "function" ? clone(worldCore(x.world)) : null;
      fn(x);
      if (x.world && typeof worldCore === "function" && JSON.stringify(worldCore(x.world)) !== JSON.stringify(before)) recordSnapshot(x, before);
    };
    const ex = backend().mutate(id, withHistory);
    if (state.ex?.id === id) { state.ex = ex; render(); renderSync(); }
    Sync.soon();
    return ex;
  },

  async create(params, scenario) {
    for (const inj of scenario.msel) { inj.status = "pending"; inj.cell ??= "blue"; }
    const ex = { id: newId(), created: nowIso(), phase: "planning", params, scenario, clock_min: 0, log: [], roleplay: {}, aar: null };
    Ex.log(ex, "system", "EXCON", `Exercise designed: ${scenario.title} (${scenario.msel.length} injects, ${scenario.objectives.length} objectives) via ${LLM.label()}`);
    return backend().create(ex);
  },

  validate(ex) {
    const ok = ex && typeof ex === "object" && ex.id && ex.params && ex.scenario &&
      Array.isArray(ex.scenario.msel) && Array.isArray(ex.log);
    if (!ok) throw new Error("That file isn't an ExerciseForge export.");
    ex.roleplay ??= {};
    ex.aar ??= null;
    return ex;
  },
};

// ------------------------------------------------------------------ navigation drawer

const TYPE_ICON = { TTX: "table_restaurant", CPX: "hub", FTX: "forest", Wargame: "strategy", "Staff Ride": "hiking" };

let listCache = [];

async function loadList() {
  try {
    listCache = await backend().list();
    drawList();
  } catch (e) {
    $("#exList").innerHTML = `<li class="nav-empty body-medium">${icon("cloud_off")} ${esc(e.message)}</li>`;
  }
}

function drawList() {
  const alerted = new Set(Safety.records.map((n) => n.exerciseId).filter(Boolean));
  const siteWide = Safety.records.some((n) => n.scope === "site" && Safety.siteMatch(n));
  $("#exList").innerHTML = listCache.map((e) => `
    <li><button class="nav-item ${state.ex?.id === e.id ? "active" : ""}" data-id="${esc(e.id)}">
      ${icon(TYPE_ICON[e.type] || "description")}
      <span class="text"><strong>${esc(e.title)}</strong><small>${esc(e.type)}${e.type ? " · " : ""}${esc(e.phase)} · ${esc(e.created.slice(0, 10))}</small></span>
      ${alerted.has(e.id) || siteWide ? `<span class="tag hostile" style="margin-left:auto">${icon("emergency_home")}NO DUFF</span>` : ""}
    </button></li>`).join("") || `<li class="nav-empty body-medium">No exercises yet</li>`;
}

async function openExercise(id) {
  try {
    if (id.startsWith("glc-")) {
      const ch = await GitLabBackend.openChannel(id);
      state.ex = null;
      state.cell = { source: "channel", channel: ch, cell: ch.brief.cell, masterId: ch.brief.masterId };
      state.view = ch.brief.cell;
      render();
    } else {
      const ex = await backend().open(id);
      if (!ex) return toast("Exercise not found");
      setExercise(ex);
    }
    drawList();
    closeDrawer();
    renderSync();
  } catch (e) { toast(e.message); }
}

$("#exList").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-id]");
  if (b) openExercise(b.dataset.id);
});

$("#newBtn").addEventListener("click", () => { showDesign(); closeDrawer(); });
function showDesign() {
  state.ex = null;
  state.cell = null;
  $("#designView").classList.remove("hidden");
  $("#exView").classList.add("hidden");
  $("#cellView").classList.add("hidden");
  renderSafety();
  renderSync();
  loadList();
}

$("#importBtn").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  try {
    let ex = Ex.validate(JSON.parse(await file.text()));
    if (backend().kind === "local") {
      if (Store.get(ex.id) && !confirm(`"${ex.scenario.title}" already exists here. Replace it?`)) return;
      Store.save(ex);
    } else {
      toast("Creating the exercise in GitLab…", true);
      ex = await backend().create({ ...ex, id: newId() });
    }
    setExercise(ex);
    loadList();
    closeDrawer();
    toast("Exercise imported", true);
  } catch (e) { toast(e.message.startsWith("That") ? e.message : `Import failed: ${e.message}`); }
});

// ------------------------------------------------------------------ settings

function renderStatus() {
  const s = Settings.get(), st = $("#status");
  st.classList.toggle("demo", s.provider === "demo");
  st.innerHTML = s.provider === "demo"
    ? `${icon("science")}<span class="txt">Demo mode</span>`
    : `${icon(s.provider === "openai" ? "hub" : "psychology")}<span class="txt">${esc(LLM.label())}</span>`;
}

// Unsaved edits to the parts of settings that aren't plain form fields.
const draft = { headers: [], cert: null, certNotes: [] };

function openSettings(tab = "ai") {
  const s = Settings.get(), f = $("#settingsForm");
  for (const [k, v] of Object.entries(s)) {
    const el = f.elements[k];
    if (!el || (v !== null && typeof v === "object")) continue;
    if (el.type === "checkbox") el.checked = !!v; else el.value = v ?? "";
  }
  draft.headers = (s.openaiHeaders || []).map((h) => ({ ...h }));
  draft.cert = s.openaiCert;
  draft.certNotes = [];
  settingsError("");
  renderHeaderRows();
  renderCert();
  $("#oauthRedirect").textContent = OAuth.redirectUri();
  renderOAuthStatus();
  $("#glTestResult").innerHTML = "";
  $("#glCreateSafety").classList.add("hidden");
  showSettingsTab(tab);
  syncProviderFields();
  $("#settingsDlg").showModal();
}

function showSettingsTab(tab) {
  $$("[data-stab]").forEach((b) => b.classList.toggle("active", b.dataset.stab === tab));
  $$("[data-stab-panel]").forEach((p) => p.classList.toggle("hidden", p.dataset.stabPanel !== tab));
}
$$("[data-stab]").forEach((b) => b.addEventListener("click", () => showSettingsTab(b.dataset.stab)));

function syncProviderFields() {
  const f = $("#settingsForm");
  const p = f.elements.provider.value, c = f.elements.openaiCertMode.value;
  const st = f.elements.storage.value, au = f.elements.gitlabAuth.value;
  $$("[data-provider]").forEach((el) => el.classList.toggle("hidden", el.dataset.provider !== p));
  $$("[data-cert]").forEach((el) => el.classList.toggle("hidden", el.dataset.cert !== c));
  $$("[data-storage]").forEach((el) => el.classList.toggle("hidden", el.dataset.storage !== st));
  $$("[data-auth]").forEach((el) => el.classList.toggle("hidden", el.dataset.auth !== au));
}

function renderOAuthStatus() {
  const o = Settings.get().gitlabOAuth;
  $("#oauthStatus").textContent = !OAuth.usable() ? "Needs the app served over https (e.g. GitLab Pages)."
    : o?.access ? `Signed in${o.exp ? ` · token renews after ${new Date(o.exp).toLocaleTimeString()}` : ""}` : "Not signed in";
}

// Settings entered in the dialog, without saving them yet (used by Test and Sign in).
function formSettings() {
  const f = $("#settingsForm"), next = { ...Settings.get() };
  for (const k of [...Object.keys(Settings.DEFAULTS), "anthropicKey", "openaiKey", "gitlabToken"]) {
    const el = f.elements[k];
    if (!el) continue;
    next[k] = el.type === "checkbox" ? el.checked : String(el.value).trim();
  }
  next.gitlabPollSec = Math.min(300, Math.max(5, +next.gitlabPollSec || 15));
  return next;
}

// Temporarily apply the dialog's GitLab fields so the API client can use them.
async function withFormSettings(fn) {
  const saved = Settings.get();
  Settings.set({ ...formSettings(), openaiHeaders: saved.openaiHeaders, openaiCert: saved.openaiCert });
  GitLabBackend.resetIds();
  try { return await fn(); }
  finally { Settings.set(saved); GitLabBackend.resetIds(); }
}

$("#glTestBtn").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget, out = $("#glTestResult");
  btn.disabled = true;
  out.innerHTML = `<span class="progress"><span class="linear"></span><span class="body-small">Contacting GitLab…</span></span>`;
  try {
    const r = await withFormSettings(() => GitLabBackend.test());
    const line = (ok, text) => `<div class="row body-medium">${icon(ok ? "check_circle" : "error", ok ? "ok-ic" : "err-ic")}${text}</div>`;
    out.innerHTML = `<div class="stack" style="gap:6px">
      ${line(true, `Signed in as <strong>${esc(r.user.name)}</strong> (@${esc(r.user.username)})`)}
      ${line(!!r.group, r.group ? `Exercise group <span class="mono">${esc(r.group)}</span>` : `Exercise group: ${esc(r.groupError)}`)}
      ${line(!!r.safety, r.safety ? `Safety project <span class="mono">${esc(r.safety)}</span>` : `Safety project: ${esc(r.safetyError)}`)}
    </div>`;
    $("#glCreateSafety").classList.toggle("hidden", !(r.group && !r.safety));
  } catch (e) {
    out.innerHTML = `<div class="row body-medium">${icon("error", "err-ic")}${esc(e.message)}</div>`;
  } finally { btn.disabled = false; }
});

$("#glCreateSafety").addEventListener("click", async () => {
  try {
    const path = await withFormSettings(() => GitLabBackend.createSafetyProject());
    $("#settingsForm").elements.gitlabSafety.value = path;
    $("#glCreateSafety").classList.add("hidden");
    $("#glTestResult").innerHTML = `<div class="row body-medium">${icon("check_circle", "ok-ic")}Created <span class="mono">${esc(path)}</span>. Give every participant at least Reporter access to it.</div>`;
  } catch (e) { settingsError(e.message); }
});

$("#oauthBtn").addEventListener("click", async () => {
  try {
    const next = formSettings();
    Settings.set({ ...Settings.get(), ...next, gitlabAuth: "oauth" });   // keep settings across the redirect
    await OAuth.start();
  } catch (e) { settingsError(e.message); }
});

// The snackbar sits under the modal's backdrop, so settings errors show inside the dialog.
function settingsError(msg) {
  let el = $("#settingsError");
  if (!el) {
    el = Object.assign(document.createElement("div"), { id: "settingsError", className: "note", role: "alert" });
    el.style.cssText = "background:var(--md-error-container);color:var(--md-on-error-container)";
    $("#settingsForm .actions.end").before(el);
  }
  el.innerHTML = msg ? `${icon("error")}<span class="body-medium">${esc(msg)}</span>` : "";
  el.classList.toggle("hidden", !msg);
  if (msg) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ---- custom headers

function readHeaderRows() {
  draft.headers = $$("#headerRows .header-row").map((r) => ({
    name: r.querySelector("[data-h=name]").value.trim(),
    value: r.querySelector("[data-h=value]").value,
  }));
}

function renderHeaderRows() {
  $("#headerRows").innerHTML = draft.headers.map((h, i) => `
    <div class="header-row">
      <div class="field"><input data-h="name" id="hn${i}" value="${esc(h.name)}" placeholder="e.g. api-key" autocomplete="off"><label for="hn${i}">Header name</label></div>
      <div class="field"><input data-h="value" id="hv${i}" type="password" value="${esc(h.value)}" placeholder=" " autocomplete="off"><label for="hv${i}">Value</label></div>
      <button type="button" class="icon-btn" data-remove-header="${i}" aria-label="Remove header"><span class="ms">close</span></button>
    </div>`).join("") || `<div class="header-empty">No custom headers.</div>`;
}

$("#addHeaderBtn").addEventListener("click", () => {
  readHeaderRows();
  draft.headers.push({ name: "", value: "" });
  renderHeaderRows();
  $(`#hn${draft.headers.length - 1}`).focus();
});
$("#headerRows").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-remove-header]");
  if (!b) return;
  readHeaderRows();
  draft.headers.splice(+b.dataset.removeHeader, 1);
  renderHeaderRows();
});

// Browsers silently drop these on fetch, so reject them up front.
const FORBIDDEN_HEADER = /^(accept-charset|accept-encoding|access-control-.*|connection|content-length|cookie2?|date|dnt|expect|host|keep-alive|origin|referer|te|trailer|transfer-encoding|upgrade|via|proxy-.*|sec-.*)$/i;
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
function headerProblem(name, value) {
  if (!TOKEN.test(name)) return `“${name}” isn't a valid header name (letters, digits and - only).`;
  if (FORBIDDEN_HEADER.test(name)) return `Browsers don't allow scripts to set the “${name}” header.`;
  if (/[\r\n]/.test(value) || /[^\t\x20-\xff]/.test(value)) return `The value for “${name}” contains characters that can't be sent in a header.`;
  return "";
}

// ---- client certificate

function renderCert() {
  const c = draft.cert;
  $("#certRemoveBtn").classList.toggle("hidden", !c);
  if (!c) { $("#certCard").innerHTML = `<div class="header-empty">No certificate loaded.</div>`; return; }
  const expired = new Date(c.notAfter) < new Date();
  $("#certCard").innerHTML = `
    <div class="cert-card ${expired ? "expired" : ""}">
      ${icon(expired ? "gpp_bad" : "verified_user")}
      <div style="min-width:0">
        <div class="title-small">${esc(c.subject || c.name)}</div>
        <div class="body-small variant">Issuer: ${esc(c.issuer || "unknown")} · ${expired ? "Expired" : "Expires"} ${esc(c.notAfter.slice(0, 10))} · ${esc(c.name)}</div>
        <div class="fp">SHA-256 ${esc(c.fingerprint)}</div>
        ${draft.certNotes.map((w) => `<div class="body-small" style="color:var(--md-warning);margin-top:4px">${esc(w)}</div>`).join("")}
      </div>
    </div>`;
}

$("#certLoadBtn").addEventListener("click", () => $("#certFile").click());
$("#certRemoveBtn").addEventListener("click", () => { draft.cert = null; draft.certNotes = []; renderCert(); });
$("#certFile").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const { warnings, ...cert } = await Cert.load(file);
    draft.cert = cert;
    draft.certNotes = warnings;
    settingsError("");
  } catch (e) { settingsError(e.message); }
  renderCert();
});

$("#settingsBtn").addEventListener("click", () => openSettings());
$("#settingsForm").addEventListener("change", (ev) => {
  if (["provider", "openaiCertMode", "storage", "gitlabAuth"].includes(ev.target.name)) syncProviderFields();
});
$("#settingsCancel").addEventListener("click", () => $("#settingsDlg").close());
$("#settingsForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const before = Settings.get();
  const next = formSettings();
  if (next.storage === "gitlab") {
    if (!/^https?:\/\/\S+$/.test(next.gitlabUrl)) { showSettingsTab("collab"); return settingsError("Enter the GitLab URL, e.g. https://gitlab.example.org"); }
    if (!next.gitlabGroup) { showSettingsTab("collab"); return settingsError("Enter the exercise group path."); }
    if (!next.gitlabSafety) { showSettingsTab("collab"); return settingsError("Enter the Safety project path (or use Test connection → Create Safety project)."); }
  }
  readHeaderRows();
  next.openaiHeaders = draft.headers.filter((h) => h.name || h.value);
  for (const h of next.openaiHeaders) {
    const problem = h.name ? headerProblem(h.name, h.value) : "Every custom header needs a name.";
    if (problem) return settingsError(problem);
  }
  next.openaiCert = draft.cert;
  if (next.openaiCertMode === "header") {
    if (!draft.cert) return settingsError("Load a certificate, or choose another client certificate option.");
    next.openaiCertHeader ||= "X-Client-Cert";
    const problem = headerProblem(next.openaiCertHeader, "");
    if (problem) return settingsError(problem);
  }
  try { Settings.set(next); } catch (e) { return settingsError(e.message); }
  $("#settingsDlg").close();
  renderStatus();
  GitLabBackend.resetIds();
  const workspaceChanged = ["storage", "gitlabUrl", "gitlabGroup", "gitlabSafety", "gitlabToken", "gitlabAuth"].some((k) => before[k] !== next[k]);
  if (workspaceChanged) { Safety.reset(); showDesign(); }
  if (next.storage === "gitlab" && "Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});   // lets NO DUFF alerts reach you when this tab is in the background
  }
  Sync.restart();
  toast("Settings saved", true);
});

// ------------------------------------------------------------------ design

$("#designForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target, fd = new FormData(f);
  const params = Object.fromEntries(fd.entries());
  params.domains = fd.getAll("domains");
  params.duration_min = Math.min(4320, Math.max(30, +params.duration_min || 240));
  params.inject_count = Math.min(40, Math.max(3, +params.inject_count || 12));
  const ex = await busy($("#designBusy"), $("button[type=submit]", f), async () => Ex.create(params, await LLM.design(params)));
  if (ex) { setExercise(ex); loadList(); scrollTo({ top: 0 }); }
});

// ------------------------------------------------------------------ exercise

function setExercise(ex) {
  const same = state.ex?.id === ex.id;
  state.ex = ex;
  state.cell = null;
  if (!same || !allowedViews().includes(state.view)) state.view = allowedViews()[0];
  if (!ex.scenario.roles.some((r) => r.name === state.role)) state.role = ex.scenario.roles[0]?.name ?? null;
  render();
  renderSync();
  Safety.reconcile();
}

function mutate(fn) {
  try { return Ex.mutate(state.ex.id, fn); }
  catch (e) { toast(e.message); }
}

const PHASE_ICON = { planning: "edit_note", running: "play_circle", paused: "pause_circle", ended: "flag" };

function render() {
  applyLock();
  $("#designView").classList.add("hidden");
  const cellView = state.view === "blue" || state.view === "red";
  $("#exView").classList.toggle("hidden", cellView);
  $("#cellView").classList.toggle("hidden", !cellView);
  if (cellView) { renderCell(); renderSafety(); return; }
  const ex = state.ex, s = ex.scenario, p = ex.params;
  const observer = state.view === "observer";
  $("#exView").classList.toggle("readonly", observer);
  if (observer && ["cells"].includes(state.tab)) showTab("scenario");
  renderViewSwitch($("#viewSwitch"));
  $("#exTitle").textContent = s.title;
  $("#exMeta").innerHTML = [
    `<span class="tag ${esc(ex.phase)}">${icon(PHASE_ICON[ex.phase])}${esc(ex.phase)}</span>`,
    `<span class="tag outline">${icon(TYPE_ICON[p.exercise_type] || "description")}${esc(p.exercise_type)}</span>`,
    `<span class="tag outline">${icon("groups")}${esc(p.echelon)}</span>`,
    ...(p.domains || []).map((d) => `<span class="tag outline">${esc(d)}</span>`),
    `<span class="tag outline">${icon("schedule")}${esc(p.duration_min)} min</span>`,
  ].join("");
  $("#clock").textContent = fmtT(ex.clock_min);
  $("#clockRate").value = String(ex.clockRate || 0);
  const [pIcon, pText] = ex.phase === "running" ? ["pause", "Pause"] : ex.phase === "planning" ? ["play_arrow", "STARTEX"]
    : ex.phase === "ended" ? ["replay", "Reopen"] : ["play_arrow", "Resume"];
  $("#phaseBtn").innerHTML = `${icon(pIcon)}${pText}`;
  $("#phaseBtn").className = `btn ${ex.phase === "running" ? "tonal" : "filled"}`;
  $("#endBtn").classList.toggle("hidden", ex.phase === "ended" || ex.phase === "planning");
  renderScenario(); renderMsel(); renderAdjudications(); renderEngage(); renderRoles(); renderLog(); renderAar();
  renderCellsTab(); renderObs();
  if (typeof renderMapTab === "function") renderMapTab();
  if (typeof renderReplay === "function") renderReplay();
  renderSafety();
}

// ------------------------------------------------------------------ NO DUFF (real-world emergency)
// NO DUFF records are kept apart from exercises so one alert can span several. A record is
// { id, scope: "exercise" | "site", exerciseId, exerciseTitle, site, nature, location, instructions, raisedBy, at, clock }.
// Full-screen alert: whole-site NO DUFFs at this site, and any for the open exercise. Other exercises: a red banner.

function alarm() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, .45, .9].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square"; o.frequency.value = 880;
      g.gain.setValueAtTime(.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(.25, ctx.currentTime + t + .02);
      g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + t + .35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + .4);
    });
    setTimeout(() => ctx.close(), 2000);
  } catch { /* audio blocked; the visual alert still shows */ }
}

// System notification so the alert is seen even when this tab is behind other windows.
function notifyOS(recs) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    for (const n of recs) new Notification(`NO DUFF — ${n.nature}`, { body: `${n.location}${n.instructions ? `\n${n.instructions}` : ""}`, requireInteraction: true, tag: n.id });
  } catch { /* not supported here */ }
}

const Safety = {
  records: [],             // active NO DUFFs (plus any still being broadcast from this screen)
  seen: new Set(),         // ids this screen has already alarmed for
  mine: new Set(),         // ids declared or stood down from this screen: their log entries are written at once
  firstSeen: new Map(),    // id → when this screen first saw it
  tracked: new Map(),      // id → record, for NO DUFFs that affected the open exercise (to log the stand-down)

  reset() { this.records = []; this.seen.clear(); this.firstSeen.clear(); this.tracked.clear(); renderSafety(); },

  siteMatch(n) {
    const here = backend().kind === "gitlab" ? Settings.get().gitlabSite : "";
    return !n.site || !here || slugify(n.site) === slugify(here);
  },
  isFull(n) { return n.scope === "site" ? this.siteMatch(n) : !!openExerciseId() && n.exerciseId === openExerciseId(); },
  affectsOpen(n) { return !n.pending && !!state.ex && (n.scope === "site" ? this.siteMatch(n) : n.exerciseId === state.ex.id); },

  async refresh() { this.set(await backend().noDuffs()); },

  set(recs) {
    const unsent = this.records.filter((n) => n.pending && !recs.some((r) => r.id === n.id));
    this.records = [...recs, ...unsent];
    const fresh = this.records.filter((n) => !this.seen.has(n.id));
    for (const n of fresh) { this.seen.add(n.id); if (!this.firstSeen.has(n.id)) this.firstSeen.set(n.id, Date.now()); }
    renderSafety();
    drawList();
    if (fresh.some((n) => !n.pending || this.mine.has(n.id))) { alarm(); notifyOS(fresh.filter((n) => !this.mine.has(n.id))); }
    this.reconcile();
  },

  // Other screens wait this long before writing a NO DUFF into the log, so the declaring screen's entry
  // normally arrives first and only one copy lands.
  grace() { return backend().kind === "gitlab" ? Settings.get().gitlabPollSec * 1500 : 2500; },
  later() { clearTimeout(this._t); this._t = setTimeout(() => this.reconcile(), 1000); },

  // Pause the open exercise and log the declaration once; log the stand-down once it clears.
  async reconcile() {
    const ex = state.ex;
    if (!ex) return;
    const logged = (log, id, event) => log.some((e) => e.kind === "noduff" && e.data?.noDuffId === id && e.data?.event === event);
    for (const n of this.records.filter((r) => this.affectsOpen(r))) {
      this.tracked.set(n.id, { ...n, exId: ex.id });
      if (logged(ex.log, n.id, "declared")) continue;
      if (!this.mine.has(n.id) && Date.now() - (this.firstSeen.get(n.id) ?? 0) < this.grace()) { this.later(); continue; }
      mutate((x) => {
        if (logged(x.log, n.id, "declared")) return;
        if (x.phase === "running") x.phase = "paused";
        Ex.log(x, "noduff", n.raisedBy || "EXCON", `NO DUFF declared (${n.scope === "site" ? "whole site" : "this exercise"}): ${n.nature} at ${n.location}${n.instructions ? `. ${n.instructions}` : ""}`, { noDuffId: n.id, event: "declared" });
      });
    }
    const active = new Set(this.records.map((n) => n.id));
    for (const [id, t] of this.tracked) {
      if (active.has(id)) continue;
      if (t.exId !== state.ex?.id) { this.tracked.delete(id); continue; }
      if (logged(state.ex.log, id, "cleared") || !logged(state.ex.log, id, "declared")) { this.tracked.delete(id); continue; }
      t.goneAt ??= Date.now();
      if (!this.mine.has(id) && Date.now() - t.goneAt < this.grace()) { this.later(); continue; }
      this.tracked.delete(id);
      let info = null;
      try { info = await backend().noDuffInfo(id); } catch { /* log without the details */ }
      mutate((x) => {
        if (logged(x.log, id, "cleared")) return;
        const mins = Math.round((Date.now() - Date.parse(t.at)) / 60000);
        Ex.log(x, "noduff", info?.clearedBy || "EXCON", `NO DUFF stood down after ${mins} min${info?.outcome ? ` (${info.outcome})` : ""}. Exercise remains paused until EXCON resumes.`, { noDuffId: id, event: "cleared" });
      });
    }
  },
};

// Local mode only: a whole-site NO DUFF pauses and logs every exercise in this browser, not just the open one.
function localSiteEffects(nd, event, by, outcome) {
  for (const e of Store.list()) {
    if (e.id === state.ex?.id) continue;
    const x = Store.get(e.id);
    const has = (ev) => x.log.some((l) => l.data?.noDuffId === nd.id && l.data?.event === ev);
    if (event === "declared" && !has("declared")) {
      if (x.phase === "running") x.phase = "paused";
      Ex.log(x, "noduff", nd.raisedBy, `NO DUFF declared (whole site): ${nd.nature} at ${nd.location}`, { noDuffId: nd.id, event });
      Store.save(x);
    } else if (event === "cleared" && has("declared") && !has("cleared")) {
      Ex.log(x, "noduff", by, `NO DUFF stood down${outcome ? ` (${outcome})` : ""}. Exercise remains paused until EXCON resumes.`, { noDuffId: nd.id, event });
      Store.save(x);
    }
  }
}

function renderSafety() {
  const full = Safety.records.filter((n) => Safety.isFull(n));
  $("#noDuffBtn").classList.toggle("hidden", full.length > 0);
  const ov = $("#noDuffOverlay");
  ov.classList.toggle("hidden", !full.length);
  // Make everything behind the alert unreachable by mouse and keyboard.
  for (const el of [$(".shell"), $("#appBar"), $("#alertBar")]) el.inert = full.length > 0;
  renderAlertBar();
  if (!full.length) return;
  const gl = backend().kind === "gitlab";
  const status = (nd) => nd.broadcastError
    ? `<div class="noduff-status fail">${icon("wifi_off")}<span><strong>NOT BROADCAST — declare NO DUFF by voice or radio now.</strong><br>${esc(nd.broadcastError)}</span>
       <button class="btn sm outlined" data-nd-retry="${esc(nd.id)}">${icon("refresh")}Retry</button></div>`
    : nd.pending ? `<div class="noduff-status">${icon("sync")}<span>Broadcasting…</span></div>`
    : gl ? `<div class="noduff-status ok">${icon("cell_tower")}<span>Broadcast via GitLab${nd.webUrl ? ` · <a href="${esc(nd.webUrl)}" target="_blank" rel="noopener">open issue</a>` : ""}. Screens update within ${Settings.get().gitlabPollSec} s.</span></div>`
    : `<div class="noduff-status">${icon("computer")}<span>Shown on this computer only (local mode). Use voice or radio to reach everyone else.</span></div>`;
  ov.innerHTML = full.map((nd, i) => `
    <div class="noduff-card">
      <div class="noduff-head">${icon("emergency_home")}
        <div><h1 ${i ? "" : 'id="ndTitle"'} class="noduff-title">NO DUFF</h1>
        <div class="noduff-sub">Real-world emergency — this is not part of the exercise</div></div></div>
      <div class="noduff-banner">ALL EXERCISE PLAY IS SUSPENDED. FOLLOW REAL-WORLD INSTRUCTIONS.</div>
      <dl class="noduff-grid">
        <dt>Nature</dt><dd>${esc(nd.nature)}</dd>
        <dt>Location</dt><dd>${esc(nd.location)}</dd>
        ${nd.instructions ? `<dt>Instructions</dt><dd>${esc(nd.instructions)}</dd>` : ""}
        <dt>Scope</dt><dd>${nd.scope === "site" ? `Whole site${nd.site ? `: ${esc(nd.site)}` : ""}` : `Exercise: ${esc(nd.exerciseTitle)}`}</dd>
        <dt>Declared by</dt><dd>${esc(nd.raisedBy)}</dd>
        <dt>Declared at</dt><dd>${esc(new Date(nd.at).toLocaleString())}${nd.clock != null ? ` · exercise time ${fmtT(nd.clock)}` : ""}</dd>
      </dl>
      ${status(nd)}
      <button class="btn outlined" data-nd-clear="${esc(nd.id)}">${icon("check_circle")}Stand down NO DUFF</button>
    </div>`).join("");
}

function renderAlertBar() {
  const bars = Safety.records.filter((n) => !Safety.isFull(n) && (n.scope !== "site" || Safety.siteMatch(n))).map((n) => `
    <div class="alert red">${icon("emergency_home")}<span><strong>NO DUFF</strong> in ${esc(n.exerciseTitle || "another exercise")}: ${esc(n.nature)} at ${esc(n.location)}</span>
      ${listCache.some((e) => e.id === n.exerciseId) ? `<button class="btn sm outlined" data-open-ex="${esc(n.exerciseId)}">Open</button>` : ""}</div>`);
  if (Sync.linkLost()) {
    bars.push(`<div class="alert amber">${icon("wifi_off")}<span><strong>Safety link lost.</strong> NO DUFF alerts may not reach this screen (last contact ${Sync.lastOkText()}). Use voice or radio.</span></div>`);
  }
  $("#alertBar").innerHTML = bars.join("");
}

$("#alertBar").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-open-ex]");
  if (b) openExercise(b.dataset.openEx);
});

$("#noDuffOverlay").addEventListener("click", (ev) => {
  const clear = ev.target.closest("[data-nd-clear]"), retry = ev.target.closest("[data-nd-retry]");
  if (clear) openStandDown(clear.dataset.ndClear);
  if (retry) broadcast(Safety.records.find((n) => n.id === retry.dataset.ndRetry));
});

$("#noDuffBtn").addEventListener("click", () => {
  const f = $("#noDuffForm");
  f.reset();
  f.elements.scope.value = openExerciseId() ? "exercise" : "site";
  $('#noDuffForm input[name=scope][value=exercise]').disabled = !openExerciseId();
  $("#noDuffDlg").showModal();
});

$("#noDuffForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const f = ev.target, v = (k) => f.elements[k].value.trim(), scope = f.elements.scope.value;
  $("#noDuffDlg").close();
  const s = Settings.get();
  const nd = {
    scope, exerciseId: scope === "exercise" ? openExerciseId() : null, exerciseTitle: state.ex?.scenario.title || state.cell?.channel?.brief.title || "",
    site: s.storage === "gitlab" ? s.gitlabSite : "", nature: v("nature"), location: v("location"),
    instructions: v("instructions"), raisedBy: v("raisedBy"), at: nowIso(), clock: state.ex?.clock_min ?? null,
  };
  // Show it here at once; the broadcast follows.
  const placeholder = { ...nd, id: `pending-${Date.now()}`, pending: true };
  Safety.mine.add(placeholder.id);
  Safety.set([...Safety.records.filter((n) => !n.pending), placeholder]);
  broadcast(placeholder);
});

async function broadcast(placeholder) {
  if (!placeholder) return;
  delete placeholder.broadcastError;
  renderSafety();
  const { id, pending, broadcastError, ...nd } = placeholder;
  try {
    const rec = await backend().declare(nd);
    Safety.mine.add(rec.id);
    Safety.seen.add(rec.id);
    Safety.records = Safety.records.filter((n) => n.id !== placeholder.id);
    Safety.set([...Safety.records.filter((n) => !n.pending), rec]);
    if (backend().kind === "local" && rec.scope === "site") localSiteEffects(rec, "declared");
    drawList();
    Sync.soon();
  } catch (e) {
    placeholder.broadcastError = e.message;
    renderSafety();
  }
}

function openStandDown(id) {
  const nd = Safety.records.find((n) => n.id === id);
  if (!nd) return;
  const f = $("#standDownForm");
  f.reset();
  f.elements.nd.value = id;
  f.elements.by.value = nd.raisedBy || "EXCON";
  $("#standDownSummary").textContent = `${nd.nature} at ${nd.location}. Confirm the real-world emergency is resolved. Exercises stay paused until EXCON presses Resume.`;
  $("#standDownDlg").showModal();
}

$("#standDownForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target, by = f.elements.by.value.trim(), note = f.elements.note.value.trim();
  const nd = Safety.records.find((n) => n.id === f.elements.nd.value);
  $("#standDownDlg").close();
  if (!nd) return;
  if (nd.pending) {                      // never broadcast: just remove it here
    Safety.records = Safety.records.filter((n) => n.id !== nd.id);
    renderSafety();
    return;
  }
  try { await backend().standDown(nd, by, note); }
  catch (e) { return toast(`Stand-down not sent: ${e.message}`); }
  Safety.mine.add(nd.id);
  if (backend().kind === "local" && nd.scope === "site") localSiteEffects(nd, "cleared", by, note);
  Safety.set(Safety.records.filter((n) => n.id !== nd.id));
  Sync.soon();
  toast("NO DUFF stood down. Exercises stay paused until EXCON presses Resume.", true);
});

// ------------------------------------------------------------------ GitLab sync loop
// Every gitlabPollSec (default 15 s), and straight after a save, on focus and on reconnect: send queued
// changes, pull other people's changes to the open exercise, and check for NO DUFFs.

const fmtAgo = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`; };

const Sync = {
  ticker: null, failures: 0, lastOk: 0, busy: false, n: 0, error: "",

  restart() {
    this.ticker?.stop();
    this.ticker = null;
    this.failures = 0;
    this.error = "";
    if (backend().kind === "gitlab") {
      this.ticker = makeTicker(Settings.get().gitlabPollSec * 1000, () => this.tick());
      this.tick();
    } else {
      Safety.refresh().catch(() => {});
    }
    renderSync();
  },

  soon() {
    if (backend().kind !== "gitlab") return;
    clearTimeout(this._soon);
    this._soon = setTimeout(() => this.tick(), 800);
  },

  async tick() {
    if (backend().kind !== "gitlab" || this.busy) return;
    this.busy = true;
    renderSync();
    try {
      if (state.cell?.source === "channel") {
        await GitLabBackend.channelPull(state.cell.channel);
        renderCell();
      } else if (state.ex) {
        const fresh = await GitLabBackend.pull(state.ex.id);
        if (fresh && state.ex?.id === fresh.id) { state.ex = fresh; if (!state.streaming) render(); }
        await syncCells();
      }
      await Safety.refresh();
      if (this.n++ % 4 === 0) await loadList();
      this.failures = 0;
      this.lastOk = Date.now();
      this.error = "";
    } catch (e) {
      this.failures++;
      this.error = e.message;
    } finally {
      this.busy = false;
      renderSync();
      renderAlertBar();
    }
  },

  linkLost() { return backend().kind === "gitlab" && this.failures >= 3; },
  lastOkText() { return this.lastOk ? `${fmtAgo(Date.now() - this.lastOk)} ago` : "never"; },
};

function renderSync() {
  const chip = $("#syncChip");
  if (backend().kind !== "gitlab") { chip.classList.add("hidden"); return; }
  const pending = state.ex ? GitLabBackend.pending(state.ex.id) : 0;
  const [ic, text, cls] = Sync.failures ? ["cloud_off", `Offline${pending ? ` · ${pending} to send` : ""}`, "warn"]
    : Sync.busy ? ["sync", "Syncing…", ""]
    : pending ? ["cloud_upload", `${pending} to send`, ""]
    : Sync.lastOk ? ["cloud_done", `Synced ${fmtAgo(Date.now() - Sync.lastOk)} ago`, ""]
    : ["cloud", "Connecting…", ""];
  chip.className = `chip assist sync ${cls}`;
  chip.title = Sync.error || "GitLab sync";
  chip.innerHTML = `${icon(ic)}<span class="txt">${esc(text)}</span>`;
}

addEventListener("focus", () => Sync.soon());
addEventListener("online", () => Sync.soon());
document.addEventListener("visibilitychange", () => { if (!document.hidden) Sync.soon(); });
setInterval(renderSync, 5000);

const PHASE_LABELS = { running: "STARTEX / resumed", paused: "Exercise paused", ended: "ENDEX", planning: "Returned to planning" };
function setPhase(phase) {
  mutate((ex) => { ex.phase = phase; ClockRun.anchor(ex); Ex.log(ex, "system", "EXCON", PHASE_LABELS[phase]); autoRelease(ex); });
  loadList();
}

$("#phaseBtn").addEventListener("click", () => setPhase(state.ex.phase === "running" ? "paused" : "running"));
$("#endBtn").addEventListener("click", () => { if (confirm("Declare ENDEX?")) setPhase("ended"); });
$$("[data-clock]").forEach((b) => b.addEventListener("click", () =>
  mutate((ex) => { setClock(ex, Math.max(0, ex.clock_min + +b.dataset.clock)); if (ex.clockRun) ClockRun.anchor(ex); })));

$("#exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state.ex, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `${state.ex.scenario.title.replace(/[^\w-]+/g, "_")}.json`,
  });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$("#deleteBtn").addEventListener("click", async () => {
  const gl = backend().kind === "gitlab", title = state.ex.scenario.title;
  const msg = gl ? `Archive "${title}"? It leaves the list for everyone. The GitLab project and its full history are kept.`
    : `Delete "${title}" from this browser? Export it first if you want a copy.`;
  if (!confirm(msg)) return;
  try { await backend().remove(state.ex.id); } catch (e) { return toast(e.message); }
  showDesign();
});

function showTab(tab) {
  state.tab = tab;
  $$("#exView .tabs .tab-btn").forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
  $$("#exView .tab").forEach((t) => t.classList.toggle("hidden", t.id !== `tab-${tab}`));
  if (tab === "map" && typeof renderMapTab === "function") setTimeout(() => { renderMapTab(); initMapClicks(); }, 0);
  if (tab === "aar" && typeof renderReplay === "function") setTimeout(renderReplay, 0);
}
$$("#exView .tabs .tab-btn").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

const empty = (ic, text) => `<div class="empty">${icon(ic)}<div class="body-large">${text}</div></div>`;
const bullets = (xs) => `<ul class="bullets">${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;

// ------------------------------------------------------------------ scenario

const KIND_LABEL = { state: "State", non_state: "Non-state", civil_authority: "Civil authority", ngo: "NGO",
  media: "Media", coalition: "Coalition", other: "Other" };
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const DISPO_ICON = { friendly: "shield", hostile: "crisis_alert", neutral: "remove_moderator", unknown: "help" };

function renderScenario() {
  const s = state.ex.scenario;
  $("#tab-scenario").innerHTML = `
    <div class="section">
      <div class="card lg filled">
        <p class="body-large">${esc(s.summary)}</p>
        <div class="row variant">${icon("location_on")}<span class="body-medium">${esc(s.setting.region_description)}</span></div>
      </div>
    </div>
    <div class="section"><h2 class="section-title title-medium">${icon("diversity_3")}Actors</h2>
      <div class="cards">${s.setting.actors.map((a) => `
        <div class="card outlined">
          <div class="card-head"><div class="avatar c${hue(a.name)}">${esc(initials(a.name))}</div>
            <div><div class="title-medium">${esc(a.name)}</div>
            <div class="row" style="margin-top:4px"><span class="tag ${esc(a.disposition)}">${icon(DISPO_ICON[a.disposition] || "help")}${esc(a.disposition)}</span><span class="tag">${esc(KIND_LABEL[a.kind] || a.kind)}</span></div></div></div>
          <div class="body-medium variant">${esc(a.description)}</div>
        </div>`).join("")}</div></div>
    <div class="section cards" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <div class="card">
        <h2 class="section-title title-medium">${icon("timeline")}Road to crisis</h2>
        <ol class="timeline">${s.road_to_crisis.map((r) => `<li class="body-medium">${esc(r)}</li>`).join("")}</ol>
      </div>
      <div class="stack">
        <div class="card"><h2 class="section-title title-medium">${icon("shield")}BLUE situation</h2><div class="body-medium">${esc(s.blue_situation)}</div></div>
        <div class="card"><h2 class="section-title title-medium">${icon("crisis_alert")}RED situation</h2><div class="body-medium">${esc(s.red_situation)}</div></div>
      </div>
    </div>
    <div class="section"><h2 class="section-title title-medium">${icon("flag")}Training objectives</h2>
      <div class="cards">${s.objectives.map((o) => `
        <div class="card outlined"><div><span class="tag primary mono">${esc(o.id)}</span></div>
          <div class="title-medium">${esc(o.text)}</div>
          <div class="body-medium variant">${bullets(o.measures)}</div></div>`).join("")}</div></div>
    <div class="section"><h2 class="section-title title-medium">${icon("tips_and_updates")}Controller guidance</h2>
      <div class="note"><span class="ms">info</span><span class="body-medium">${esc(s.controller_guidance)}</span></div></div>`;
}

// ------------------------------------------------------------------ MSEL

const METHOD_ICON = { radio: "radio", email: "mail", phone: "call", sitrep: "summarize", intel_report: "policy",
  media: "newspaper", face_to_face: "record_voice_over", observed_event: "visibility" };
const STATUS_ICON = { pending: "schedule", released: "send", acknowledged: "mark_email_read", actioned: "task_alt", skipped: "block" };
const OPEN = new Set(["pending", "released", "acknowledged"]);

// Inject lifecycle: pending → released → acknowledged → actioned (or skipped).
// Acknowledgement timing is measured in real (wall-clock) time, because that's the staff's actual reaction time.
const ackLimitMin = (ex) => ex.ackLimitMin ?? 5;
const sinceRelease = (i) => i.released_at ? (Date.now() - Date.parse(i.released_at)) / 1000 : 0;
const isOverdue = (ex, i) => i.status === "released" && sinceRelease(i) > ackLimitMin(ex) * 60;
function fmtDur(s) {
  s = Math.max(0, Math.round(s));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`;
}

function ackInfo(i) {
  const lines = [];
  if (i.released_at) lines.push(`${icon("send")}Released ${fmtT(i.released_clock ?? 0)} · ${new Date(i.released_at).toLocaleTimeString()}`);
  if (i.ack) lines.push(`${icon("mark_email_read")}Ack'd by <strong>${esc(i.ack.by)}</strong> after ${fmtDur(i.ack.delay_s)}${i.ack.note ? ` — ${esc(i.ack.note)}` : ""}`);
  else if (i.status === "released") lines.push(`${icon("hourglass_top")}Awaiting acknowledgement · ${fmtDur(sinceRelease(i))}`);
  return lines.length ? `<div class="ack-info">${lines.map((l) => `<span>${l}</span>`).join("")}</div>` : "";
}

function renderMsel() {
  const ex = state.ex, showDone = $("#showDone").checked;
  $("#ackLimit").value = ackLimitMin(ex);
  $("#autoRelease").checked = !!ex.autoRelease;
  const rows = ex.scenario.msel.filter((i) => showDone || OPEN.has(i.status));
  $("#mselBody").innerHTML = rows.map((i) => {
    const due = isDue(ex, i);
    const blocked = i.status === "pending" && injectTiming(ex, i).state === "blocked";
    const overdue = isOverdue(ex, i);
    const done = i.status === "actioned" || i.status === "skipped";
    const st = overdue ? `<span class="tag overdue">${icon("alarm")}ack overdue</span>`
      : due ? `<span class="tag due">${icon("notifications_active")}${i.condition ? "decide" : "due"}</span>`
      : blocked ? `<span class="tag skipped">${icon("block")}blocked</span>`
      : `<span class="tag ${esc(i.status)}">${icon(STATUS_ICON[i.status])}${esc(i.status)}</span>`;
    const btn = (s, cls, ic, label) => `<button class="btn sm ${cls}" data-inj="${esc(i.id)}" data-st="${s}">${ic ? icon(ic) : ""}${label}</button>`;
    return `<tr class="${due ? "due" : ""} ${overdue ? "overdue" : ""} ${done ? "done" : ""}">
      <td><span class="tag mono">${esc(i.id)}</span></td>
      <td class="when">${fmtT(i.time_offset_min)}</td>
      <td><div class="inj-title">${esc(i.title)}<span class="tag outline">${icon(METHOD_ICON[i.method] || "chat")}${esc(cap(i.method.replace(/_/g, " ")))}</span></div>
        <div class="desc body-medium">${esc(i.description)}</div>
        <div class="exp">${icon("target")}<span><strong>Expected:</strong> ${esc(i.expected_action)}</span></div>
        ${timingHtml(ex, i)}${ackInfo(i)}</td>
      <td><div class="route body-medium"><span>${esc(i.from_role)}</span>${icon("south")}<span class="variant">${esc(i.to_audience)}</span>
        ${i.status === "pending"
          ? `<select class="cell-select" data-cell-for="${esc(i.id)}" aria-label="Deliver to">${["blue", "red", "excon"].map((c) =>
              `<option value="${c}" ${(i.cell ?? "blue") === c ? "selected" : ""}>${c === "excon" ? "EXCON only" : `→ ${c.toUpperCase()} cell`}</option>`).join("")}</select>`
          : `<span class="cell-badge sm ${esc(i.cell ?? "blue")}">${esc((i.cell ?? "blue") === "excon" ? "EXCON" : (i.cell ?? "blue").toUpperCase())}</span>`}</div></td>
      <td><div class="tags">${i.objective_ids.map((o) => `<span class="tag primary mono">${esc(o)}</span>`).join("")}</div></td>
      <td>${st}</td>
      <td><div class="row-actions">${i.status === "pending"
        ? `<button class="icon-btn excon-only" data-edit-inj="${esc(i.id)}" aria-label="Edit ${esc(i.id)}" data-tip="Edit">${icon("edit")}</button>` + btn("skipped", "text", "", "Skip") + btn("released", "filled", "send", "Release")
        : i.status === "released" ? btn("pending", "text", "undo", "Recall") + btn("acknowledged", "filled", "mark_email_read", "Acknowledge")
        : i.status === "acknowledged" ? btn("actioned", "tonal", "task_alt", "Actioned")
        : btn("pending", "text", "undo", "Reset")}</div></td>
    </tr>`;
  }).join("") || `<tr><td colspan="7">${empty("event_available", "No open injects. Toggle “Show completed” to see the rest.")}</td></tr>`;
  renderAckBadge();
  renderTimeline();
}

function renderAckBadge() {
  const ex = state.ex;
  const waiting = ex.scenario.msel.filter((i) => i.status === "released").length;
  const overdue = ex.scenario.msel.filter((i) => isOverdue(ex, i)).length;
  const b = $("#ackBadge");
  b.textContent = overdue || waiting;
  b.classList.toggle("hidden", !waiting);
  b.style.background = overdue ? "" : "var(--md-secondary)";
  b.style.color = overdue ? "" : "var(--md-on-secondary)";
  b.title = `${waiting} awaiting acknowledgement${overdue ? `, ${overdue} overdue` : ""}`;
}

function applyInjectStatus(ex, inj, status, ack) {
  const prev = inj.status;
  inj.status = status;
  if (status === "released") {
    inj.released_at = nowIso();
    inj.released_clock = ex.clock_min;
    delete inj.ack;
    Ex.log(ex, "inject", inj.from_role, `${inj.id} ${inj.title}: ${inj.description}`);
  } else if (status === "acknowledged") {
    inj.ack = { ...ack, at: nowIso(), clock: ex.clock_min, delay_s: Math.round(sinceRelease(inj)) };
    Ex.log(ex, "ack", ack.by, `${inj.id} acknowledged after ${fmtDur(inj.ack.delay_s)}${ack.note ? `: ${ack.note}` : ""}`);
  } else if (status === "pending") {
    delete inj.released_at; delete inj.released_clock; delete inj.ack; delete inj.skipped_clock; delete inj.auto_released;
    Ex.log(ex, "system", "EXCON", `${inj.id} ${prev === "released" ? "recalled" : "reset"} to pending`);
  } else {
    if (status === "skipped") inj.skipped_clock = ex.clock_min;
    Ex.log(ex, "system", "EXCON", `${inj.id} marked ${status}`);
  }
}

function setInjectStatus(injId, status, ack) {
  mutate((ex) => {
    const inj = ex.scenario.msel.find((i) => i.id === injId);
    if (!inj) return;
    applyInjectStatus(ex, inj, status, ack);
    if (typeof autoRelease === "function") autoRelease(ex);    // dependants with no delay
  });
}

$("#showDone").addEventListener("change", renderMsel);
$("#ackLimit").addEventListener("change", (ev) => {
  const v = Math.min(120, Math.max(1, +ev.target.value || 5));
  mutate((ex) => { ex.ackLimitMin = v; });
});
$("#mselBody").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-inj]");
  if (!b) return;
  if (b.dataset.st === "acknowledged") return openAck(b.dataset.inj);
  setInjectStatus(b.dataset.inj, b.dataset.st);
});

function openAck(injId) {
  const inj = state.ex.scenario.msel.find((i) => i.id === injId);
  const f = $("#ackForm");
  f.reset();
  f.elements.inj.value = injId;
  f.elements.by.value = inj.to_audience || "";
  $("#ackSummary").textContent = `${inj.id} · ${inj.title} — released ${fmtDur(sinceRelease(inj))} ago`;
  $("#ackDlg").showModal();
}
$("#ackForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const f = ev.target, by = f.elements.by.value.trim(), note = f.elements.note.value.trim();
  $("#ackDlg").close();
  if (f.dataset.mode === "cell") { cellName(by); cellAck(f.elements.inj.value, by, note); }
  else setInjectStatus(f.elements.inj.value, "acknowledged", { by, note });
  delete f.dataset.mode;
});
$$("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

// Keep "awaiting / overdue" timers live.
setInterval(() => {
  if (!state.ex || !state.ex.scenario.msel.some((i) => i.status === "released")) return;
  if (state.tab === "control") renderMsel(); else renderAckBadge();
}, 15000);

function addInject(rec) {
  mutate((ex) => {
    const msel = ex.scenario.msel;
    const n = Math.max(0, ...msel.map((i) => parseInt(i.id.split("-").pop(), 10)).filter(Number.isFinite)) + 1;
    const inj = {
      id: `INJ-${String(n).padStart(3, "0")}`, time_offset_min: ex.clock_min, title: rec.title,
      from_role: rec.from_role || "EXCON", to_audience: ex.params.training_audience, method: rec.method || "sitrep", cell: rec.cell || "blue",
      description: rec.description, expected_action: rec.expected_action || "", objective_ids: rec.objective_ids || [],
      status: "pending",
    };
    msel.push(inj);
    msel.sort((a, b) => a.time_offset_min - b.time_offset_min);
    Ex.log(ex, "system", "EXCON", `Dynamic inject added: ${inj.id} ${inj.title}`);
  });
}

// ------------------------------------------------------------------ adjudication

const CONF = { low: 1, medium: 2, high: 3 };

function renderAdjudications() {
  const adj = state.ex.log.filter((e) => e.kind === "adjudication").reverse();
  $("#adjResults").innerHTML = adj.map((e) => {
    const d = e.data, action = state.ex.log.slice(0, state.ex.log.indexOf(e)).reverse().find((x) => x.kind === "action");
    return `<div class="card lg elevated adj">
      <div class="row between">
        <div class="row"><span class="tag mono">${esc(e.id)}</span><span class="tag outline">${icon("schedule")}${fmtT(e.game_time_min)}</span></div>
        <div class="row label-medium variant">Confidence <span class="meter">${[1, 2, 3].map((n) => `<i class="${n <= (CONF[d.confidence] || 0) ? "on" : ""}"></i>`).join("")}</span>${esc(d.confidence)}</div>
      </div>
      ${action ? `<div class="body-medium variant">${icon("person_raised_hand", "sm")} ${esc(action.text)}</div>` : ""}
      ${rulesHtml(d.rules)}
      <div class="outcome">${esc(d.outcome)}</div>
      <div class="kv">
        <div><div class="label-medium">${icon("bolt")}Effects</div>${bullets(d.effects)}</div>
        <div><div class="label-medium">${icon("sync_alt")}State changes</div>${bullets(d.state_changes)}</div>
      </div>
      ${worldChangesHtml(e)}
      <div class="body-medium"><strong>Rationale.</strong> <span class="variant">${esc(d.rationale)}</span></div>
      ${referencesHtml(d)}
      <div class="note"><span class="ms">sticky_note_2</span><span class="body-medium">${esc(d.controller_notes)}</span></div>
      ${d.recommended_injects.length ? `<div class="stack" style="gap:8px"><div class="title-small">Recommended follow-up injects</div>
        ${d.recommended_injects.map((r, n) => `<div class="rec">
          <div class="row between"><span class="title-small">${esc(r.title)}</span><span class="body-small variant">from ${esc(r.from_role)}</span></div>
          <div class="body-medium">${esc(r.description)}</div>
          <div class="body-small variant"><strong>Expected:</strong> ${esc(r.expected_action)}</div>
          <div><button class="btn sm tonal" data-add="${esc(e.id)}:${n}">${icon("playlist_add")}Add to MSEL</button></div>
        </div>`).join("")}</div>` : ""}
      <div class="actions excon-only">${["blue", "red"].map((c) => {
        const sent = state.ex.log.some((l) => l.kind === "message" && l.data?.to === c && l.data?.outcomeOf === e.id);
        return `<button class="btn sm ${sent ? "text" : "outlined"}" data-send-outcome="${esc(e.id)}:${c}" ${sent ? "disabled" : ""}>${icon(sent ? "done" : "forward_to_inbox")}${sent ? `Sent to ${c.toUpperCase()}` : `Send outcome to ${c.toUpperCase()}`}</button>`;
      }).join("")}</div>
    </div>`;
  }).join("") || `<div class="card">${empty("gavel", "Adjudications appear here.<br><span class='body-medium'>The white cell's calls are advisory: you decide what stands.</span>")}</div>`;
}

$("#adjForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target, actor = f.elements["actor"].value, action = f.elements["action"].value.trim();
  if (!action) return;
  let engagement;
  try { engagement = engagementFromForm(); } catch (e) { return toast(e.message); }
  const id = state.ex.id, reportId = f.dataset.report;
  delete f.dataset.report;
  let key = reportId;
  const ex = mutate((ex) => {
    if (reportId) { const r = ex.log.find((e) => e.id === reportId); if (r) r.data = { ...r.data, handled: true }; }
    else key = Ex.log(ex, "action", actor, action).id;
    if (engagement) { ex.rules ??= {}; ex.rules.seed ??= Rules.newSeed(); }
  });
  if (!ex) return;
  f.elements["action"].value = "";
  await busy($("#adjBusy"), $("button.filled", f), async () => {
    // Combat rules first: the numbers are fixed before the AI sees them.
    const rules = engagement ? Rules.resolve(ex, { ...engagement, key }) : null;
    const result = await LLM.adjudicate(ex, action, { rules });
    if (rules) { result.world_changes = Rules.mergeWorld(result.world_changes, rules); result.rules = rules; }
    const by = rules ? "White Cell (combat rules + AI, pending controller review)" : "White Cell (AI, pending controller review)";
    Ex.mutate(id, (ex) => Ex.log(ex, "adjudication", by, result.outcome, result));
  });
});

$("#logOnlyBtn").addEventListener("click", () => {
  const f = $("#adjForm"), text = f.elements["action"].value.trim();
  if (!text) return;
  mutate((ex) => Ex.log(ex, "action", f.elements["actor"].value, text));
  f.elements["action"].value = "";
  toast("Action logged", true);
});

// "moves 6.2 km, about 1 h 33 min at 4 km/h" from the rules' movement rates (only while the move is still a proposal).
function moveNote(up) {
  const u = state.ex.world?.units?.find((v) => v.id === up.unit_id);
  return u && up.lat != null && up.lng != null && (u.lat !== up.lat || u.lng !== up.lng) ? `moves ${esc(Rules.moveText(Rules.moveInfo(state.ex, u, up.lat, up.lng)))}` : "moves";
}

// Proposed changes to units on the map, applied only when EXCON says so.
function worldChangesHtml(e) {
  const wc = e.data.world_changes, w = state.ex.world;
  if (!wc || !w?.units?.length) return "";
  const n = (id) => w.units.find((u) => u.id === id)?.name || id;
  const items = [
    ...(wc.unit_updates || []).map((u) => `${esc(n(u.unit_id))}: ${[u.lat != null ? moveNote(u) : "", u.strength_change ? `strength ${u.strength_change > 0 ? "+" : ""}${u.strength_change}%` : "", u.status ? esc(u.status.replace(/_/g, " ")) : "", u.task ? `task “${esc(u.task)}”` : ""].filter(Boolean).join(", ")}`),
    ...(wc.detections || []).map((d) => `${d.observer_side.toUpperCase()} detects ${esc(n(d.unit_id))} (${esc(d.confidence)})`),
    ...(wc.side_changes || []).filter((c) => c.supply_change || c.morale_change).map((c) => `${c.side.toUpperCase()}: supply ${c.supply_change > 0 ? "+" : ""}${c.supply_change}, morale ${c.morale_change > 0 ? "+" : ""}${c.morale_change}`),
    ...(wc.civil_stability_change ? [`Civil stability ${wc.civil_stability_change > 0 ? "+" : ""}${wc.civil_stability_change}`] : []),
  ];
  if (!items.length) return "";
  return `<div class="rec"><div class="row between"><span class="title-small row">${icon("map")}Map changes</span>
      ${e.data.world_applied ? `<span class="tag primary">${icon("done")}Applied</span>` : `<button class="btn sm tonal excon-only" data-apply-world="${esc(e.id)}">${icon("check")}Apply to map</button>`}</div>
    ${wc.summary ? `<div class="body-small variant">${esc(wc.summary)}</div>` : ""}${bullets(items.map((i) => i))}</div>`;
}

$("#adjResults").addEventListener("click", (ev) => {
  const aw = ev.target.closest("button[data-apply-world]");
  if (aw) {
    mutate((x) => {
      const adj = x.log.find((l) => l.id === aw.dataset.applyWorld);
      if (!adj || adj.data.world_applied) return;
      const lines = applyWorldChanges(x, adj.data.world_changes);
      adj.data = { ...adj.data, world_applied: true };
      if (lines.length) Ex.log(x, "system", "EXCON", `Map updated from adjudication: ${lines.join("; ")}`);
    });
    return toast("Map updated", true);
  }
  const so = ev.target.closest("button[data-send-outcome]");
  if (so) {
    const [logId, cell] = so.dataset.sendOutcome.split(":");
    const adj = state.ex.log.find((e) => e.id === logId);
    sendToCell(cell, "White Cell", `${adj.data.outcome}${adj.data.effects?.length ? `\n• ${adj.data.effects.join("\n• ")}` : ""}`, { outcomeOf: logId });
    return toast(`Outcome sent to ${cell.toUpperCase()}`, true);
  }
  const b = ev.target.closest("button[data-add]");
  if (!b) return;
  const [logId, n] = b.dataset.add.split(":");
  addInject(state.ex.log.find((e) => e.id === logId).data.recommended_injects[+n]);
  toast("Inject added to the MSEL at the current time", true);
});

// ------------------------------------------------------------------ role-play

function renderRoles() {
  const s = state.ex.scenario;
  $("#roleList").innerHTML = s.roles.map((r) => `
    <li class="list-item ${r.name === state.role ? "active" : ""}" data-role="${esc(r.name)}" tabindex="0">
      <div class="avatar c${hue(r.name)}">${esc(initials(r.name))}</div>
      <div class="text"><strong>${esc(r.name)}</strong><small>${esc(r.persona)}</small></div></li>`).join("");
  const role = s.roles.find((r) => r.name === state.role);
  $("#rpHeader").innerHTML = role
    ? `<div class="avatar c${hue(role.name)}">${esc(initials(role.name))}</div>
       <div><div class="title-medium">${esc(role.name)}</div><div class="body-medium variant">${esc(role.persona)}</div>
       <div class="body-small variant" style="margin-top:4px"><strong>Goals:</strong> ${esc(role.goals)}</div></div>`
    : `<div class="body-medium variant">No role-players defined.</div>`;
  if (state.streaming) return;   // don't wipe a reply that's still streaming in
  const thread = state.ex.roleplay[state.role] || [];
  $("#chatLog").innerHTML = thread.map((m) => `<div class="msg ${m.role}">${esc(m.content)}</div>`).join("")
    || empty("forum", `Start the conversation with ${esc(role?.name || "a role-player")}.`);
  $("#chatLog").scrollTop = 1e9;
}

function pickRole(li) {
  if (li && !state.streaming) { state.role = li.dataset.role; renderRoles(); }
}
$("#roleList").addEventListener("click", (ev) => pickRole(ev.target.closest("[data-role]")));
$("#roleList").addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pickRole(ev.target.closest("[data-role]")); } });

const chatInput = $("#chatForm").elements["message"];
chatInput.addEventListener("input", () => { chatInput.style.height = "auto"; chatInput.style.height = `${chatInput.scrollHeight}px`; });
chatInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); $("#chatForm").requestSubmit(); }
});

$("#chatForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target, message = chatInput.value.trim();
  if (!message || !state.role || state.streaming) return;
  const id = state.ex.id, roleName = state.role;
  const role = state.ex.scenario.roles.find((r) => r.name === roleName);
  const ex = mutate((ex) => { (ex.roleplay[roleName] ??= []).push({ role: "user", content: message }); });
  if (!ex) return;
  chatInput.value = "";
  chatInput.style.height = "auto";
  const btn = $("button", f), log = $("#chatLog");
  btn.disabled = true;
  state.streaming = true;
  log.insertAdjacentHTML("beforeend", `<div class="msg assistant"><span class="linear" style="display:block;width:48px;margin:8px 0"></span></div>`);
  const out = log.lastElementChild;
  log.scrollTop = 1e9;
  let text = "";
  try {
    const reply = await LLM.roleplay(ex, role, ex.roleplay[roleName],
      (chunk) => { text += chunk; out.textContent = text; log.scrollTop = 1e9; },
      () => { text = ""; });
    state.streaming = false;
    Ex.mutate(id, (ex) => {
      ex.roleplay[roleName].push({ role: "assistant", content: reply });
      Ex.log(ex, "roleplay", roleName, reply);
    });
  } catch (e) {
    state.streaming = false;
    // Drop the unanswered user turn so the thread keeps alternating user/assistant.
    Ex.mutate(id, (ex) => { ex.roleplay[roleName].pop(); });
    toast(e.message);
  } finally {
    state.streaming = false;
    btn.disabled = false;
  }
});

// ------------------------------------------------------------------ log

const KIND_ICON = { inject: "campaign", ack: "mark_email_read", noduff: "emergency_home", red: "crisis_alert", action: "bolt", adjudication: "gavel", roleplay: "forum",
  note: "sticky_note_2", observation: "visibility", system: "settings_suggest" };

function renderLog() {
  $("#logList").innerHTML = [...state.ex.log].reverse().map((e) => `
    <li><div class="lead k-${esc(e.kind)}">${icon(KIND_ICON[e.kind] || "circle")}</div>
      <div><div class="who">${esc(e.actor)}<span class="tag">${esc(e.kind)}</span></div>
        <div class="what body-medium variant">${esc(e.text)}</div></div>
      <div class="when">${fmtT(e.game_time_min)}<br>${esc(e.id)}</div></li>`).join("");
}

$("#noteForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const f = ev.target, text = f.elements["text"].value.trim();
  if (!text) return;
  mutate((ex) => Ex.log(ex, f.elements["kind"].value, f.elements["actor"].value || "EXCON", text));
  f.elements["text"].value = "";
});

// ------------------------------------------------------------------ AAR

const RATING_LABEL = { T: "Trained", P: "Partially trained", U: "Untrained" };

function renderAar() {
  const a = state.ex.aar;
  $("#aarBtn").innerHTML = `${icon(a ? "refresh" : "assessment")}${a ? "Regenerate review" : "Generate review"}`;
  if (!a) {
    $("#aarBody").innerHTML = `<div class="card">${empty("assessment", "No after action review yet.<br><span class='body-medium'>Run it after ENDEX. Log player actions and observations as you go, because the review only uses what's in the log.</span>")}</div>`;
    return;
  }
  const objs = Object.fromEntries(state.ex.scenario.objectives.map((o) => [o.id, o.text]));
  const count = (r) => a.objective_assessments.filter((o) => o.rating === r).length;
  $("#aarBody").innerHTML = `
    <div class="section summary-strip">${["T", "P", "U"].map((r) => `
      <div class="stat ${r}"><span class="n">${count(r)}</span><span class="title-medium">${RATING_LABEL[r]}</span></div>`).join("")}</div>
    <div class="section"><div class="card lg filled">
      <div class="row between"><h2 class="section-title title-medium" style="margin:0">${icon("summarize")}Executive summary</h2>
        <span class="body-small variant">${esc(a.generated)}${a.provider ? ` · ${esc(a.provider)}` : ""}</span></div>
      <p class="body-large">${esc(a.executive_summary)}</p>
      <div class="row excon-only">${a.libraryDoc ? `<span class="tag primary">${icon("menu_book")}Saved to the doctrine library</span>`
        : `<button type="button" id="aarLibBtn" class="btn sm tonal">${icon("library_add")}Save lessons to the library</button>`}</div></div></div>
    <div class="section"><h2 class="section-title title-medium">${icon("flag")}Objective assessment</h2>
      <div class="cards">${a.objective_assessments.map((o) => `
        <div class="card outlined">
          <div class="card-head"><div class="rating ${esc(o.rating)}">${esc(o.rating)}</div>
            <div><span class="tag primary mono">${esc(o.objective_id)}</span><div class="label-medium variant" style="margin-top:4px">${RATING_LABEL[o.rating] || ""}</div></div></div>
          <div class="title-medium">${esc(objs[o.objective_id] || "")}</div>
          <div class="body-medium"><strong>Evidence.</strong> ${esc(o.evidence)}</div>
          <div class="body-medium variant"><strong>Gaps.</strong> ${esc(o.gaps)}</div></div>`).join("")}</div></div>
    <div class="section cards" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <div class="card"><h2 class="section-title title-medium">${icon("thumb_up")}Sustain</h2><div class="body-medium">${bullets(a.sustains)}</div></div>
      <div class="card"><h2 class="section-title title-medium">${icon("trending_up")}Improve</h2><div class="body-medium">${bullets(a.improves)}</div></div>
    </div>
    <div class="section"><h2 class="section-title title-medium">${icon("lightbulb")}Lessons identified</h2>
      <div class="stack">${a.lessons.map((l) => `
        <div class="card outlined lesson">
          <div><div class="label-medium">Observation</div><div class="body-medium">${esc(l.observation)}</div></div>
          <div><div class="label-medium">Discussion</div><div class="body-medium">${esc(l.discussion)}</div></div>
          <div><div class="label-medium">Recommendation</div><div class="body-medium">${esc(l.recommendation)}</div></div>
        </div>`).join("")}</div></div>
    ${referencesHtml(a) ? `<div class="section card">${referencesHtml(a)}</div>` : ""}`;
}

$("#aarBody").addEventListener("click", (ev) => {
  if (ev.target.closest("#aarLibBtn")) aarToLibrary().catch((e) => toast(e.message));
});

$("#aarBtn").addEventListener("click", async () => {
  const id = state.ex.id, ex = state.ex;
  await busy($("#aarBusy"), $("#aarBtn"), async () => {
    const result = await LLM.aar(ex);
    Ex.mutate(id, (ex) => { ex.aar = { generated: nowIso(), provider: LLM.label(), ...result }; });
  });
});

// ------------------------------------------------------------------ cell views: EXCON, BLUE, RED, observers
// EXCON runs everything. BLUE and RED see only their own brief, what EXCON has released to them and their own
// reports. Observers see everything read-only and record rated observations.
// This browser: the views are filters over one exercise, and a browser can be PIN-locked to one cell.
// GitLab: each cell has its own private project ("channel"); players are members of their cell's project only,
// so GitLab permissions keep the traffic apart. EXCON's screen delivers into the channels and imports replies.

const CELL_INFO = {
  excon: { label: "EXCON", icon: "shield_person" },
  blue: { label: "BLUE", icon: "shield" },
  red: { label: "RED", icon: "crisis_alert" },
  observer: { label: "Observer", icon: "visibility" },
};
const REPORT_LABEL = { action: "Decision", message: "Message", rfi: "RFI" };

const openExerciseId = () => state.ex?.id ?? state.cell?.masterId ?? null;

// ---- PIN lock (this-browser mode only)
async function sha256hex(t) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const Lock = {
  KEY: "exforge.celllock",
  get() { return backend().kind === "local" ? Store.json(this.KEY, null) : null; },
  async set(cell, pin) {
    const salt = Math.random().toString(36).slice(2, 10);
    Store.write(this.KEY, JSON.stringify({ cell, salt, hash: await sha256hex(salt + pin) }));
  },
  async check(pin) { const l = this.get(); return !!l && (await sha256hex(l.salt + pin)) === l.hash; },
  clear() { Store.remove(this.KEY); },
};

function allowedViews() {
  if (state.cell?.source === "channel") return [state.cell.cell];
  const lock = Lock.get();
  if (lock) return [lock.cell];
  if (backend().kind === "gitlab" && state.ex && GitLabBackend.role(state.ex.id) !== "excon") return ["observer", "blue", "red"];
  return ["excon", "blue", "red", "observer"];
}

function applyLock() {
  const l = Lock.get();
  document.body.classList.toggle("locked", !!l);
  const chip = $("#lockChip");
  chip.classList.toggle("hidden", !l);
  if (l) chip.innerHTML = `${icon("lock")}<span class="txt">${CELL_INFO[l.cell].label} terminal</span>`;
  let hint = $("#lockedHint");
  if (!hint) {
    hint = Object.assign(document.createElement("div"), { id: "lockedHint", className: "card lg" });
    hint.innerHTML = empty("lock", "This terminal is locked to a cell.<br><span class='body-medium'>Choose your exercise from the list.</span>");
    $("#designView").prepend(hint);
  }
  hint.classList.toggle("hidden", !l);
}

$("#lockChip").addEventListener("click", () => {
  const f = $("#pinForm");
  f.reset();
  $("#pinError").classList.add("hidden");
  $("#pinTitle").textContent = "Unlock this terminal";
  $("#pinText").textContent = "Enter the PIN EXCON set when locking this browser.";
  $("#pinDlg").showModal();
});
$("#pinForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!(await Lock.check(ev.target.elements.pin.value))) {
    $("#pinError").textContent = "Wrong PIN.";
    $("#pinError").classList.remove("hidden");
    return;
  }
  Lock.clear();
  $("#pinDlg").close();
  state.view = allowedViews()[0];
  if (state.ex) render(); else showDesign();
  applyLock();
  toast("Terminal unlocked", true);
});

function renderViewSwitch(el) {
  const views = allowedViews();
  el.classList.toggle("hidden", views.length < 2);
  el.innerHTML = views.map((v) => `<button type="button" class="seg-btn ${v === state.view ? "active" : ""}" data-view="${v}">${icon(CELL_INFO[v].icon)}${CELL_INFO[v].label}</button>`).join("");
}
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-view]");
  if (!b || !allowedViews().includes(b.dataset.view)) return;
  state.view = b.dataset.view;
  render();
  scrollTo({ top: 0 });
});

// ---- what a cell can see
function briefFor(ex, cell) {
  const s = ex.scenario;
  return {
    title: s.title, summary: s.summary, region: s.setting.region_description, road: s.road_to_crisis,
    situation: cell === "red" ? s.red_situation : s.blue_situation, actors: s.setting.actors, roles: s.roles.map((r) => r.name),
  };
}

// Injects released to the cell and EXCON messages addressed to it. No expected actions, objectives or MSEL timing.
function masterItemsFor(ex, cell) {
  const items = ex.scenario.msel
    .filter((i) => (i.cell ?? "blue") === cell && i.released_at && !["pending", "skipped"].includes(i.status))
    .map((i) => ({ type: "inject", ref: i.id, title: i.title, from: i.from_role, method: i.method, text: i.description, clock: i.released_clock ?? 0, at: i.released_at }));
  for (const e of ex.log) {
    if (e.kind === "message" && e.data?.to === cell && !e.data?.fromCell) {
      items.push({ type: "message", ref: e.id, title: "", from: e.actor, method: "message", text: e.text, clock: e.game_time_min, at: e.ts });
    }
  }
  return items;
}

function feedFromMaster(ex, cell) {
  const items = masterItemsFor(ex, cell).map((it) => {
    const inj = it.type === "inject" ? ex.scenario.msel.find((i) => i.id === it.ref) : null;
    return { ...it, ack: inj?.ack ? { by: inj.ack.by, note: inj.ack.note, at: inj.ack.at } : null };
  });
  const reports = ex.log.filter((e) => e.data?.reportKind && e.data.fromCell === cell)
    .map((e) => ({ id: e.data.rid || e.id, kind: e.data.reportKind, to: e.data.to, text: e.text, by: e.actor, at: e.ts, clock: e.game_time_min }));
  return { cell, title: ex.scenario.title, brief: briefFor(ex, cell), clock: ex.clock_min, phase: ex.phase, items, reports,
    world: typeof cellWorld === "function" ? cellWorld(ex, cell) : null };
}

function feedFromChannel(ch) {
  const items = new Map(), reports = new Map();
  for (const e of ch.events) if (e.type === "deliver" && e.item) items.set(e.ref, { ...e.item, ref: e.ref, ack: null });
  for (const e of ch.events) if (e.type === "ack" && items.has(e.ref) && !items.get(e.ref).ack) items.get(e.ref).ack = { by: e.by, note: e.note, at: e.at };
  for (const e of ch.events) if (e.type === "report" && !reports.has(e.rid)) reports.set(e.rid, { id: e.rid, kind: e.kind, to: e.to, text: e.text, by: e.by, at: e.at, clock: e.clock });
  const status = [...ch.events].reverse().find((e) => e.type === "status");
  const world = [...ch.events].reverse().find((e) => e.type === "world");
  return { cell: ch.brief.cell, title: ch.brief.title, brief: ch.brief, clock: status?.clock ?? 0, phase: status?.phase ?? "planning",
    items: [...items.values()], reports: [...reports.values()], world: world?.view || null };
}

const currentFeed = () => state.cell?.source === "channel" ? feedFromChannel(state.cell.channel)
  : state.ex && (state.view === "blue" || state.view === "red") ? feedFromMaster(state.ex, state.view) : null;

function cellName(set) {
  const key = `exforge.cellname.${state.view}`;
  if (set) { Store.write(key, set); return set; }
  return Store.read(key) || `${CELL_INFO[state.view]?.label || ""} HQ`;
}

// ---- cell actions
async function postToChannel(ev) {
  const ch = state.cell.channel;
  const local = { ...ev, local: true };
  ch.events.push(local);
  renderCell();
  try { await GitLabBackend.channelPost(ch, ev); Sync.soon(); return true; }
  catch (e) {
    ch.events = ch.events.filter((x) => x !== local);
    renderCell();
    toast(`Not sent: ${e.message}`);
    return false;
  }
}

function cellAck(ref, by, note) {
  if (state.cell?.source === "channel") return postToChannel({ type: "ack", ref, by, note, at: nowIso() });
  setInjectStatus(ref, "acknowledged", { by, note, cell: state.view });
}

function cellReport(kind, to, text, by) {
  const rid = `r-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  if (state.cell?.source === "channel") return postToChannel({ type: "report", rid, kind, to, text, by, clock: currentFeed().clock, at: nowIso() });
  mutate((ex) => Ex.log(ex, kind === "action" ? "action" : "message", by, text, { fromCell: state.view, to, reportKind: kind, rid }));
}

function sendToCell(cell, from, text, extra = {}) {
  mutate((ex) => Ex.log(ex, "message", from, text, { to: cell, ...extra }));
}

// ---- BLUE / RED view
function showCtab(t) {
  state.ctab = t;
  $$("[data-ctab]").forEach((b) => b.classList.toggle("active", b.dataset.ctab === t));
  $$(".ctab").forEach((p) => p.classList.toggle("hidden", p.id !== `cell-${t}`));
  if (t === "map" && typeof renderCellMap === "function") setTimeout(renderCellMap, 0);
}
$$("[data-ctab]").forEach((b) => b.addEventListener("click", () => showCtab(b.dataset.ctab)));

const when = (at, clock) => `${clock != null ? `${fmtT(clock)} · ` : ""}${at ? new Date(at).toLocaleTimeString() : ""}`;

function renderCell() {
  const f = currentFeed();
  if (!f) return;
  const info = CELL_INFO[f.cell], b = f.brief;
  $("#cellTitle").textContent = f.title;
  $("#cellBadge").className = `cell-badge ${f.cell}`;
  $("#cellBadge").innerHTML = `${icon(info.icon)}${info.label} cell`;
  $("#cellPhase").className = `tag ${esc(f.phase)}`;
  $("#cellPhase").innerHTML = `${icon(PHASE_ICON[f.phase] || "schedule")}${esc(f.phase)}`;
  $("#cellClock").textContent = fmtT(f.clock);
  renderViewSwitch($("#cellViewSwitch"));
  const unacked = f.items.filter((i) => i.type === "inject" && !i.ack).length;
  $("#inboxBadge").textContent = unacked;
  $("#inboxBadge").classList.toggle("hidden", !unacked);
  showCtab(state.ctab);

  $("#cell-situation").innerHTML = `
    <div class="section"><div class="card lg filled">
      <p class="body-large">${esc(b.summary)}</p>
      <div class="row variant">${icon("location_on")}<span class="body-medium">${esc(b.region)}</span></div>
    </div></div>
    <div class="section cards" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <div class="card"><h2 class="section-title title-medium">${icon(info.icon)}Your situation</h2><div class="body-medium">${esc(b.situation)}</div></div>
      <div class="card"><h2 class="section-title title-medium">${icon("timeline")}Road to crisis</h2>
        <ol class="timeline">${(b.road || []).map((r) => `<li class="body-medium">${esc(r)}</li>`).join("")}</ol></div>
    </div>
    ${f.world?.plan ? `<div class="section"><div class="card"><h2 class="section-title title-medium">${icon("crisis_alert")}RED plan (from EXCON)</h2>${redPlanHtml(f.world.plan)}</div></div>` : ""}
    <div class="section"><h2 class="section-title title-medium">${icon("diversity_3")}Actors</h2>
      <div class="cards">${(b.actors || []).map((a) => `
        <div class="card outlined"><div class="card-head"><div class="avatar c${hue(a.name)}">${esc(initials(a.name))}</div>
          <div><div class="title-medium">${esc(a.name)}</div><div class="row" style="margin-top:4px"><span class="tag ${esc(a.disposition)}">${esc(a.disposition)}</span><span class="tag">${esc(KIND_LABEL[a.kind] || a.kind)}</span></div></div></div>
          <div class="body-medium variant">${esc(a.description)}</div></div>`).join("")}</div></div>`;

  const items = [...f.items].sort((x, y) => String(y.at).localeCompare(String(x.at)));
  $("#cell-inbox").innerHTML = items.map((i) => `
    <div class="card outlined inbox-item ${i.type === "inject" && !i.ack ? "unread" : ""}">
      <div class="row between">
        <div class="row">${icon(i.type === "message" ? "mail" : METHOD_ICON[i.method] || "campaign")}<span class="title-medium">${esc(i.title || "Message")}</span>
          ${i.type === "inject" ? `<span class="tag outline">${esc(cap(String(i.method).replace(/_/g, " ")))}</span>` : ""}</div>
        <span class="body-small variant">${when(i.at, i.clock)}</span>
      </div>
      <div class="body-small variant">From <strong>${esc(i.from)}</strong></div>
      <div class="body-medium" style="white-space:pre-wrap">${esc(i.text)}</div>
      ${i.type !== "inject" ? "" : i.ack
        ? `<div class="ack-info"><span>${icon("mark_email_read")}Acknowledged by <strong>${esc(i.ack.by)}</strong> · ${esc(new Date(i.ack.at).toLocaleTimeString())}${i.ack.note ? ` — ${esc(i.ack.note)}` : ""}</span></div>`
        : `<div><button class="btn sm filled" data-cack="${esc(i.ref)}">${icon("mark_email_read")}Acknowledge</button></div>`}
    </div>`).join("") || `<div class="card">${empty("inbox", "Nothing received yet.<br><span class='body-medium'>Injects and messages from EXCON appear here.</span>")}</div>`;

  const rf = $("#reportForm"), to = rf.elements.to, keep = to.value;
  to.innerHTML = ["EXCON", ...(b.roles || [])].map((n) => `<option>${esc(n)}</option>`).join("");
  if (keep) to.value = keep;
  if (!rf.elements.by.value) rf.elements.by.value = cellName();
  const reports = [...f.reports].sort((x, y) => String(y.at).localeCompare(String(x.at)));
  $("#reportList").innerHTML = reports.map((r) => `
    <div class="card outlined">
      <div class="row between"><div class="row"><span class="tag primary">${esc(REPORT_LABEL[r.kind] || r.kind)}</span><span class="body-small variant">to <strong>${esc(r.to)}</strong> from ${esc(r.by)}</span></div>
        <span class="body-small variant">${when(r.at, r.clock)}</span></div>
      <div class="body-medium" style="white-space:pre-wrap">${esc(r.text)}</div>
    </div>`).join("") || `<div class="card">${empty("outgoing_mail", "Nothing sent yet.")}</div>`;

  const log = [
    ...f.items.map((i) => ({ at: i.at, clock: i.clock, kind: i.type === "inject" ? "inject" : "message", who: i.from, text: `${i.title ? `${i.title}: ` : ""}${i.text}` })),
    ...f.items.filter((i) => i.ack).map((i) => ({ at: i.ack.at, kind: "ack", who: i.ack.by, text: `Acknowledged ${i.title || "message"}` })),
    ...f.reports.map((r) => ({ at: r.at, clock: r.clock, kind: "action", who: r.by, text: `${REPORT_LABEL[r.kind] || r.kind} to ${r.to}: ${r.text}` })),
  ].sort((x, y) => String(y.at).localeCompare(String(x.at)));
  $("#cellLogList").innerHTML = log.map((e) => `
    <li><div class="lead k-${e.kind}">${icon(KIND_ICON[e.kind] || "circle")}</div>
      <div><div class="who">${esc(e.who)}<span class="tag">${esc(e.kind)}</span></div><div class="what body-medium variant">${esc(e.text)}</div></div>
      <div class="when">${e.clock != null ? fmtT(e.clock) : ""}<br>${e.at ? esc(new Date(e.at).toLocaleTimeString()) : ""}</div></li>`).join("")
    || `<li>${empty("history", "Nothing yet.")}</li>`;
  if (state.ctab === "map" && typeof renderCellMap === "function") renderCellMap();
}

$("#cell-inbox").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-cack]");
  if (!b) return;
  const item = currentFeed().items.find((i) => i.ref === b.dataset.cack);
  const f = $("#ackForm");
  f.reset();
  f.dataset.mode = "cell";
  f.elements.inj.value = item.ref;
  f.elements.by.value = cellName();
  $("#ackSummary").textContent = `${item.title} — from ${item.from}`;
  $("#ackDlg").showModal();
});

$("#reportForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const f = ev.target, text = f.elements.text.value.trim(), by = f.elements.by.value.trim();
  if (!text) return;
  cellName(by);
  cellReport(f.elements.kind.value, f.elements.to.value, text, by);
  f.elements.text.value = "";
  toast(`Sent to ${f.elements.to.value}`, true);
});

// ---- EXCON: Cells tab
function reportCard(e) {
  const c = e.data.fromCell, k = e.data.reportKind;
  return `<div class="card outlined ${e.data.handled ? "handled" : ""}">
    <div class="row between"><div class="row"><span class="cell-badge sm ${esc(c)}">${esc(CELL_INFO[c]?.label || c)}</span>
      <span class="tag primary">${esc(REPORT_LABEL[k] || k)}</span><span class="body-small variant">to <strong>${esc(e.data.to)}</strong> from ${esc(e.actor)}</span></div>
      <span class="body-small variant">${when(e.ts, e.game_time_min)}</span></div>
    <div class="body-medium" style="white-space:pre-wrap">${esc(e.text)}</div>
    <div class="actions">
      ${k === "action" && !e.data.handled ? `<button class="btn sm filled" data-adjudicate="${esc(e.id)}">${icon("gavel")}Adjudicate</button>` : ""}
      <button class="btn sm tonal" data-reply="${esc(e.id)}">${icon("reply")}Reply</button>
      <button class="btn sm text" data-handled="${esc(e.id)}">${icon(e.data.handled ? "undo" : "done")}${e.data.handled ? "Reopen" : "Mark handled"}</button>
    </div></div>`;
}

function renderCellsTab() {
  if (!state.ex) return;
  if (!$("#msgForm")) {
    $("#tab-cells").innerHTML = `
      <div class="two-col">
        <div class="stack">
          <form id="msgForm" class="card lg">
            <div class="card-head"><div class="avatar c0">${icon("forward_to_inbox")}</div>
              <div><h3 class="title-medium">Message a cell</h3><div class="body-small variant">Appears in the cell's Inbox</div></div></div>
            <div class="segmented choice" role="radiogroup">
              <label class="seg-btn"><input type="radio" name="to" value="blue" checked><span class="ms check">check</span>${icon("shield", "icon")}BLUE</label>
              <label class="seg-btn"><input type="radio" name="to" value="red"><span class="ms check">check</span>${icon("crisis_alert", "icon")}RED</label>
            </div>
            <div class="field select"><select name="from" id="m-from"></select><label for="m-from">From</label></div>
            <div class="field"><textarea name="text" id="m-text" rows="4" required placeholder=" "></textarea><label for="m-text">Message</label></div>
            <div class="actions"><button class="btn filled">${icon("send")}Send</button></div>
          </form>
          <div id="cellSetup" class="card lg"></div>
        </div>
        <div class="stack"><h2 class="section-title title-medium">${icon("move_to_inbox")}From the cells</h2><div id="incoming" class="stack"></div></div>
      </div>`;
  }
  const from = $("#m-from"), keep = from.value;
  from.innerHTML = ["EXCON", "White Cell", ...state.ex.scenario.roles.map((r) => r.name)].map((n) => `<option>${esc(n)}</option>`).join("");
  if (keep) from.value = keep;
  const reports = state.ex.log.filter((e) => e.data?.reportKind && e.data.fromCell).reverse();
  $("#incoming").innerHTML = reports.map(reportCard).join("") || `<div class="card">${empty("move_to_inbox", "Nothing from the cells yet.<br><span class='body-medium'>Decisions, messages and RFIs from BLUE and RED land here.</span>")}</div>`;
  const open = reports.filter((r) => !r.data.handled).length;
  $("#cellsBadge").textContent = open;
  $("#cellsBadge").classList.toggle("hidden", !open);
  renderCellSetup();
}

function memberRows(list, cell, removable) {
  if (!list) return `<div class="body-small variant">Loading members…</div>`;
  const rows = list.map((m) => `<div class="member-row"><div class="avatar c${hue(m.username)}" style="width:32px;height:32px;font-size:13px">${esc(initials(m.name || m.username))}</div>
    <div class="text"><strong>${esc(m.name)}</strong><small>@${esc(m.username)} · ${m.access_level >= 30 ? "EXCON" : "member"}</small></div>
    ${removable && m.access_level < 30 ? `<button type="button" class="icon-btn" data-rm="${esc(cell)}:${m.id}" aria-label="Remove">${icon("person_remove")}</button>` : ""}</div>`).join("");
  return (rows || `<div class="body-small variant">No members yet.</div>`) + `
    <div class="add-member"><div class="field compact grow"><input data-add-user="${esc(cell)}" placeholder=" "><label>GitLab username</label></div>
      <button type="button" class="btn sm tonal" data-add-member="${esc(cell)}">${icon("person_add")}Add</button></div>`;
}

function renderCellSetup() {
  const el = $("#cellSetup"), ex = state.ex, gl = backend().kind === "gitlab";
  const key = JSON.stringify([gl, ex.id, ex.cellChannels, state.members?.exId === ex.id ? state.members : null]);
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  const head = (title, sub) => `<div class="card-head"><div class="avatar c1">${icon("hub")}</div><div><h3 class="title-medium">${title}</h3><div class="body-small variant">${sub}</div></div></div>`;
  const previews = `<div class="actions">${["blue", "red", "observer"].map((v) => `<button type="button" class="btn sm tonal" data-view="${v}">${icon(CELL_INFO[v].icon)}View as ${CELL_INFO[v].label}</button>`).join("")}</div>`;
  if (!gl) {
    el.innerHTML = `${head("Cell views on this computer", "Everything stays in this browser")}
      <div class="body-medium variant">BLUE and RED see only their own brief, what you release to them and their own reports.
        Observers see everything read-only and record rated observations.</div>
      ${previews}
      <div class="subsection">
        <span class="title-small">Lock this browser to one cell</span>
        <span class="body-small variant">For player terminals. Hides EXCON controls and view switching until the PIN is entered. It stops casual switching,
          but it isn't a security boundary: use GitLab mode when cells must not be able to see each other's traffic.</span>
        <div class="grid-2">
          <div class="field select"><select id="lockCell"><option value="blue">BLUE</option><option value="red">RED</option><option value="observer">Observer</option></select><label for="lockCell">Cell</label></div>
          <div class="field"><input id="lockPin" type="password" inputmode="numeric" autocomplete="off" placeholder=" "><label for="lockPin">PIN (4+ digits)</label></div>
        </div>
        <div class="actions"><button type="button" class="btn outlined sm" id="lockBtn">${icon("lock")}Lock browser</button></div>
      </div>`;
    return;
  }
  if (!ex.cellChannels?.blue || !ex.cellChannels?.red) {
    el.innerHTML = `${head("Cell channels", "Real separation through GitLab permissions")}
      <div class="body-medium variant">Creates a private GitLab project for BLUE and one for RED. Players join only their cell's project, so they can't
        see the other cell or the EXCON exercise. Your screen delivers released injects and messages to them and brings their replies back.</div>
      <div class="actions"><button type="button" class="btn filled" id="setupChannels">${icon("add_link")}Create BLUE and RED channels</button></div>
      ${previews}`;
    return;
  }
  const m = state.members?.exId === ex.id ? state.members : null;
  if (!m) setTimeout(loadMembers, 0);
  el.innerHTML = `${head("Cell membership", "GitLab projects control who sees what")}
    ${m?.error ? `<div class="note" style="background:var(--md-error-container);color:var(--md-on-error-container)">${icon("error")}<span class="body-medium">${esc(m.error)}</span></div>` : ""}
    ${["blue", "red"].map((c) => `<div class="subsection"><span class="title-small row">${icon(CELL_INFO[c].icon)}${CELL_INFO[c].label} cell</span>
      ${memberRows(m?.[c], c, true)}</div>`).join("")}
    <div class="subsection"><span class="title-small row">${icon("visibility")}Observers</span>
      <span class="body-small variant">Read-only on the exercise project: they see everything and can only add observations.</span>
      ${memberRows(m?.observer, "observer", true)}</div>
    <div class="note">${icon("info")}<span class="body-small">EXCON staff need Developer or higher on the exercise project; manage that in GitLab.
      Everyone, players included, needs Reporter on the Safety project to receive NO DUFF alerts.</span></div>
    ${previews}`;
}

async function loadMembers() {
  const ex = state.ex;
  if (backend().kind !== "gitlab" || !ex?.cellChannels?.blue) return;
  const out = { exId: ex.id };
  try {
    for (const c of ["blue", "red"]) out[c] = await GitLabBackend.members(ex.cellChannels[c].projectId);
    out.observer = (await GitLabBackend.members(GitLabBackend.projectOf(ex.id))).filter((u) => u.access_level < 30);
  } catch (e) { out.error = e.message; }
  if (state.ex?.id !== ex.id) return;
  state.members = out;
  renderCellsTab();
}

async function setupChannels(btn) {
  btn.disabled = true;
  try {
    const ex = state.ex, out = { ...(ex.cellChannels || {}) };
    for (const c of ["blue", "red"]) out[c] ??= await GitLabBackend.createCellChannel(ex.id, c, briefFor(ex, c));
    mutate((x) => { x.cellChannels = out; });
    toast("Cell channels created. Add each cell's members.", true);
    loadMembers();
    Sync.soon();
  } catch (e) { toast(e.message); btn.disabled = false; }
}

$("#tab-cells").addEventListener("submit", (ev) => {
  if (ev.target.id !== "msgForm") return;
  ev.preventDefault();
  const f = ev.target, text = f.elements.text.value.trim();
  if (!text) return;
  sendToCell(f.elements.to.value, f.elements.from.value, text);
  f.elements.text.value = "";
  toast(`Sent to ${f.elements.to.value.toUpperCase()}`, true);
});

$("#tab-cells").addEventListener("click", async (ev) => {
  const t = (sel) => ev.target.closest(sel);
  let b;
  if ((b = t("#lockBtn"))) {
    const pin = $("#lockPin").value, cell = $("#lockCell").value;
    if (!/^\d{4,}$/.test(pin)) return toast("Use a PIN of at least 4 digits.");
    await Lock.set(cell, pin);
    state.view = cell;
    render();
    toast(`This browser is now a ${CELL_INFO[cell].label} terminal`, true);
  } else if ((b = t("#setupChannels"))) {
    setupChannels(b);
  } else if ((b = t("[data-add-member]"))) {
    const cell = b.dataset.addMember, input = $(`[data-add-user="${cell}"]`), user = input.value.trim();
    if (!user) return;
    const pid = cell === "observer" ? GitLabBackend.projectOf(state.ex.id) : state.ex.cellChannels[cell].projectId;
    try { await GitLabBackend.addMember(pid, user, 20); input.value = ""; toast(`${user} added to ${CELL_INFO[cell].label}`, true); }
    catch (e) { return toast(e.message); }
    state.members = null;
    loadMembers();
  } else if ((b = t("[data-rm]"))) {
    const [cell, uid] = b.dataset.rm.split(":");
    const pid = cell === "observer" ? GitLabBackend.projectOf(state.ex.id) : state.ex.cellChannels[cell].projectId;
    try { await GitLabBackend.removeMember(pid, +uid); } catch (e) { return toast(e.message); }
    state.members = null;
    loadMembers();
  } else if ((b = t("[data-adjudicate]"))) {
    const r = state.ex.log.find((e) => e.id === b.dataset.adjudicate), f = $("#adjForm");
    f.elements.actor.value = `${CELL_INFO[r.data.fromCell].label} — ${r.actor}`;
    f.elements.action.value = r.text;
    f.dataset.report = r.id;
    showTab("adjudicate");
    f.elements.action.focus();
  } else if ((b = t("[data-reply]"))) {
    const r = state.ex.log.find((e) => e.id === b.dataset.reply), f = $("#msgForm");
    f.elements.to.value = r.data.fromCell;
    if ([...f.elements.from.options].some((o) => o.value === r.data.to)) f.elements.from.value = r.data.to;
    f.elements.text.focus();
  } else if ((b = t("[data-handled]"))) {
    mutate((ex) => { const r = ex.log.find((e) => e.id === b.dataset.handled); if (r) r.data = { ...r.data, handled: !r.data.handled }; });
  }
});
$('#exView [data-tab="cells"]').addEventListener("click", () => { state.members = null; loadMembers(); });

$("#mselBody").addEventListener("change", (ev) => {
  const sel = ev.target.closest("[data-cell-for]");
  if (!sel) return;
  mutate((ex) => { const i = ex.scenario.msel.find((x) => x.id === sel.dataset.cellFor); if (i) i.cell = sel.value; });
});

// ---- Observations
const RATING_TEXT = { T: "Trained", P: "Partly trained", U: "Untrained" };

function renderObs() {
  const ex = state.ex, f = $("#obsForm"), sel = f.elements.objective, keep = sel.value;
  sel.innerHTML = [...ex.scenario.objectives.map((o) => `<option value="${esc(o.id)}">${esc(o.id)} · ${esc(o.text.length > 60 ? `${o.text.slice(0, 60)}…` : o.text)}</option>`),
    `<option value="general">General</option>`].join("");
  if (keep) sel.value = keep;
  if (!f.elements.by.value) f.elements.by.value = Store.read("exforge.observer") || "Observer";
  const obs = ex.log.filter((e) => e.kind === "observation");
  const groups = [...ex.scenario.objectives.map((o) => ({ id: o.id, text: o.text })), { id: "general", text: "General observations" }]
    .map((g) => ({ ...g, items: obs.filter((e) => (e.data?.objective || "general") === g.id) })).filter((g) => g.items.length);
  $("#obsList").innerHTML = groups.map((g) => {
    const count = (r) => g.items.filter((e) => e.data?.rating === r).length;
    return `<div class="card outlined">
      <div class="row between"><div class="row"><span class="tag primary mono">${esc(g.id === "general" ? "GEN" : g.id)}</span><span class="title-small">${esc(g.text)}</span></div>
        <div class="row">${["T", "P", "U"].filter(count).map((r) => `<span class="rating-chip ${r}">${r} ${count(r)}</span>`).join("")}</div></div>
      ${[...g.items].reverse().map((e) => `<div class="obs-item">
        <div class="row">${e.data?.rating ? `<span class="rating-chip ${esc(e.data.rating)}">${esc(RATING_TEXT[e.data.rating])}</span>` : ""}
          ${e.data?.cellObserved ? `<span class="cell-badge sm ${esc(e.data.cellObserved)}">${esc(CELL_INFO[e.data.cellObserved]?.label || e.data.cellObserved)}</span>` : ""}
          <span class="body-small variant">${esc(e.actor)} · ${when(e.ts, e.game_time_min)}</span></div>
        <div class="body-medium">${esc(e.text)}</div></div>`).join("")}
    </div>`;
  }).join("") || `<div class="card">${empty("visibility", "No observations yet.<br><span class='body-medium'>They feed straight into the after action review.</span>")}</div>`;
}

$("#obsForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const f = ev.target, text = f.elements.text.value.trim(), by = f.elements.by.value.trim();
  if (!text) return;
  Store.write("exforge.observer", by);
  mutate((ex) => Ex.log(ex, "observation", by, text, { objective: f.elements.objective.value, rating: f.elements.rating.value, cellObserved: f.elements.cellObserved.value }));
  f.elements.text.value = "";
  toast("Observation recorded", true);
});

// ---- GitLab: EXCON's screen keeps the cell channels in step with the exercise
function cellEventImported(ex, e) {
  if (e.type === "ack") return ex.scenario.msel.find((i) => i.id === e.ref)?.status !== "released";
  return ex.log.some((l) => l.id === `C${e.noteId}` || (e.rid && l.data?.rid === e.rid));
}

// Log ids come from the GitLab comment id, so two EXCON screens importing the same reply produce the same entry.
function importCellEvent(x, cell, e) {
  if (e.type === "ack") {
    const inj = x.scenario.msel.find((i) => i.id === e.ref);
    if (!inj || inj.status !== "released") return;
    inj.status = "acknowledged";
    inj.ack = { by: e.by, note: e.note || "", at: e.at, clock: x.clock_min, delay_s: Math.max(0, Math.round((Date.parse(e.at) - Date.parse(inj.released_at)) / 1000)), cell };
    x.log.push({ id: `C${e.noteId}`, ts: e.at, game_time_min: x.clock_min, kind: "ack", actor: e.by,
      text: `${inj.id} acknowledged by ${CELL_INFO[cell].label} after ${fmtDur(inj.ack.delay_s)}${e.note ? `: ${e.note}` : ""}`, data: { cell } });
  } else if (e.type === "report") {
    x.log.push({ id: `C${e.noteId}`, ts: e.at, game_time_min: x.clock_min, kind: e.kind === "action" ? "action" : "message", actor: e.by, text: e.text,
      data: { fromCell: cell, to: e.to, reportKind: e.kind, rid: e.rid } });
  }
}

async function syncCells() {
  const ex = state.ex;
  if (!ex?.cellChannels || backend().kind !== "gitlab" || GitLabBackend.role(ex.id) !== "excon") return;
  for (const [cell, ref] of Object.entries(ex.cellChannels)) {
    const events = await GitLabBackend.channelPull(ref);
    const todo = events.filter((e) => (e.type === "ack" || e.type === "report") && !e.local && !cellEventImported(state.ex, e));
    if (todo.length) mutate((x) => { for (const e of todo) if (!cellEventImported(x, e)) importCellEvent(x, cell, e); });
    const delivered = new Set(events.filter((e) => e.type === "deliver").map((e) => e.ref));
    for (const item of masterItemsFor(state.ex, cell)) {
      if (!delivered.has(item.ref)) await GitLabBackend.channelPost(ref, { type: "deliver", ref: item.ref, item, at: nowIso() });
    }
    const view = typeof cellWorld === "function" ? cellWorld(state.ex, cell) : null;
    const lastWorld = [...events].reverse().find((e) => e.type === "world");
    if (view && JSON.stringify(view) !== JSON.stringify(lastWorld?.view ?? null)) {
      await GitLabBackend.channelPost(ref, { type: "world", view, at: nowIso() });
    }
    const last = [...events].reverse().find((e) => e.type === "status");
    if (!last || last.clock !== state.ex.clock_min || last.phase !== state.ex.phase) {
      await GitLabBackend.channelPost(ref, { type: "status", clock: state.ex.clock_min, phase: state.ex.phase, at: nowIso() });
    }
  }
}

// ------------------------------------------------------------------ multi-window sync (local mode)
// Other tabs/windows on this computer (e.g. a projector screen) follow changes, including NO DUFF, as soon as they're saved.
addEventListener("storage", (ev) => {
  if (backend().kind !== "local") return;
  if (ev.key === LocalBackend.NODUFF_KEY) { Safety.refresh().catch(() => {}); return; }
  if (ev.key === "exforge.index") loadList();
  if (!state.ex || ev.key !== `exforge.ex.${state.ex.id}`) return;
  const fresh = Store.get(state.ex.id);
  if (!fresh) return showDesign();
  state.ex = fresh;
  if (!state.streaming) render(); else renderSafety();
  loadList();
});

// ------------------------------------------------------------------ init

applyTheme(document.documentElement.dataset.theme || "system");
renderStatus();
(async () => {
  try { if (await OAuth.complete()) { toast("Signed in to GitLab", true); openSettings("collab"); } }
  catch (e) { toast(e.message); }
  loadList();
  Sync.restart();
})();
