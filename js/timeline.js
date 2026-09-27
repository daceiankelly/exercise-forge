"use strict";
// MSEL timeline: a drag-to-reschedule view of the injects, dependencies and branches ("release 14 when 12 is
// acknowledged", "release 15 only if 12 was skipped"), release conditions EXCON (or the AI) checks at the time,
// automatic release on the exercise clock, a running clock, and objective coverage with AI gap filling.
//
// Inject fields used here (all optional):
//   depends_on: { id, on: "released" | "acknowledged" | "skipped", delay_min }
//   condition:  text EXCON must confirm before release (never auto-released)
//   auto:       false to keep an inject out of auto-release

// ------------------------------------------------------------------ timing rules

const TRIGGER_TEXT = { released: "is released", acknowledged: "is acknowledged", skipped: "is skipped" };

function triggerClock(dep, on) {
  if (on === "released") return dep.status !== "pending" && dep.status !== "skipped" ? dep.released_clock : undefined;
  if (on === "acknowledged") return dep.ack?.clock;
  if (on === "skipped") return dep.status === "skipped" ? dep.skipped_clock ?? 0 : undefined;
  return undefined;
}

// When an inject is due: { state: "time" | "ready" | "waiting" | "blocked", due, reason }
function injectTiming(ex, inj) {
  const d = inj.depends_on;
  const dep = d?.id && ex.scenario.msel.find((i) => i.id === d.id);
  if (!dep) return { state: "time", due: inj.time_offset_min };
  const at = triggerClock(dep, d.on);
  if (at != null) return { state: "ready", due: at + (+d.delay_min || 0) };
  if (d.on === "skipped" && dep.status !== "pending") return { state: "blocked", due: null, reason: `Branch not taken: ${dep.id} was released` };
  if (d.on !== "skipped" && dep.status === "skipped") return { state: "blocked", due: null, reason: `${dep.id} was skipped` };
  return { state: "waiting", due: null, reason: `Waiting until ${dep.id} ${TRIGGER_TEXT[d.on]}` };
}

function isDue(ex, inj) {
  if (inj.status !== "pending") return false;
  const t = injectTiming(ex, inj);
  return t.due != null && t.due <= ex.clock_min;
}

const depText = (inj) => {
  const d = inj.depends_on;
  return d?.id ? `After ${d.id} ${TRIGGER_TEXT[d.on] || d.on}${+d.delay_min ? ` + ${d.delay_min} min` : ""}` : "";
};

// Release everything that's due, has no condition and isn't held back; repeat for chains with no delay.
function autoRelease(x) {
  if (!x.autoRelease || x.phase !== "running") return [];
  const done = [];
  for (let pass = 0; pass < 25; pass++) {
    const due = x.scenario.msel.filter((i) => isDue(x, i) && !i.condition && i.auto !== false);
    if (!due.length) break;
    for (const i of due) { applyInjectStatus(x, i, "released"); i.auto_released = true; done.push(i.id); }
  }
  if (done.length) Ex.log(x, "system", "EXCON", `Auto-released on time: ${done.join(", ")}`);
  return done;
}

// Move the exercise clock: supply use (if the rules turn it on) and auto-release follow.
function setClock(x, minutes) {
  const delta = minutes - x.clock_min;
  x.clock_min = Math.max(0, minutes);
  if (delta > 0 && typeof Rules !== "undefined") {
    const lines = Rules.consume(x, delta);
    if (lines.length) Ex.log(x, "system", "Rules", `Supply used over ${delta} min: ${lines.join("; ")}`);
  }
  autoRelease(x);
}

// ------------------------------------------------------------------ running clock
// One EXCON screen (the one that started it) moves the clock; if that screen goes quiet, another takes over.

const CLIENT_ID = (() => {
  try {
    let id = sessionStorage.getItem("exforge.client");
    if (!id) sessionStorage.setItem("exforge.client", id = newId());
    return id;
  } catch { return newId(); }
})();

const ClockRun = {
  anchor(x, now = Date.now()) { x.clockRun = x.phase === "running" && x.clockRate ? { at: now, base: x.clock_min, by: CLIENT_ID } : null; },
  target(x, now) { const r = x.clockRun; return r ? r.base + Math.floor((now - r.at) / 60000 * x.clockRate) : x.clock_min; },
  tick(now = Date.now()) {
    const ex = state.ex;
    if (!ex || state.view !== "excon" || ex.phase !== "running" || !ex.clockRate || !ex.clockRun) return;
    if (backend().kind === "gitlab" && GitLabBackend.role(ex.id) !== "excon") return;
    const target = this.target(ex, now);
    const stale = target - ex.clock_min > 2 * ex.clockRate + 1;
    if (target <= ex.clock_min || (ex.clockRun.by !== CLIENT_ID && !stale)) return;
    mutate((x) => {
      if (!x.clockRun || x.phase !== "running") return;
      const t = ClockRun.target(x, now);
      if (t <= x.clock_min) return;
      if (x.clockRun.by !== CLIENT_ID) x.clockRun = { ...x.clockRun, by: CLIENT_ID };
      setClock(x, t);
    });
  },
};
setInterval(() => ClockRun.tick(), 5000);

$("#clockRate").addEventListener("change", (ev) => {
  const rate = +ev.target.value;
  mutate((x) => {
    x.clockRate = rate;
    ClockRun.anchor(x);
    Ex.log(x, "system", "EXCON", rate ? `Clock running at ${rate === 1 ? "real time" : `${rate}× real time`}` : "Clock set to manual");
  });
});

$("#autoRelease").addEventListener("change", (ev) => {
  const on = ev.target.checked;
  mutate((x) => { x.autoRelease = on; Ex.log(x, "system", "EXCON", on ? "Auto-release on time turned on" : "Auto-release turned off"); autoRelease(x); });
});

// ------------------------------------------------------------------ timeline view

const TL = { view: Store.read("exforge.mselview") || "table", group: Store.read("exforge.mselgroup") || "cell", proposals: null, focus: null, drag: null };
const TL_ROW = 34, TL_CHIP = 150;

function showMselView(v) {
  TL.view = v;
  Store.write("exforge.mselview", v);
  renderTimeline();
}
$$("[data-msel-view]").forEach((b) => b.addEventListener("click", () => showMselView(b.dataset.mselView)));

function tlSpan(ex) {
  return Math.max(+ex.params.duration_min || 240, ...ex.scenario.msel.map((i) => (i.time_offset_min || 0) + 30), ex.clock_min + 30);
}

function tlLanes(ex) {
  const msel = ex.scenario.msel;
  if (TL.group === "objective") {
    const lanes = ex.scenario.objectives.map((o) => ({ key: o.id, label: o.id, sub: o.text, items: msel.filter((i) => i.objective_ids.includes(o.id)) }));
    const none = msel.filter((i) => !i.objective_ids.length);
    if (none.length) lanes.push({ key: "none", label: "No objective", sub: "", items: none });
    return lanes;
  }
  if (TL.group === "sender") {
    const names = [...new Set(msel.map((i) => i.from_role))];
    return names.map((n) => ({ key: n, label: n, sub: "", items: msel.filter((i) => i.from_role === n) }));
  }
  return ["blue", "red", "excon"].map((c) => ({ key: c, label: c === "excon" ? "EXCON only" : `${c.toUpperCase()} cell`, sub: "", items: msel.filter((i) => (i.cell ?? "blue") === c) }))
    .filter((l) => l.items.length || l.key !== "excon");
}

// Per objective: how many live injects test it and when, and what's missing.
function coverage(ex) {
  const span = Math.max(+ex.params.duration_min || 240, 1);
  return ex.scenario.objectives.map((o) => {
    const injs = ex.scenario.msel.filter((i) => i.objective_ids.includes(o.id) && i.status !== "skipped");
    const bins = [0, 0, 0, 0];
    for (const i of injs) bins[Math.min(3, Math.max(0, Math.floor(i.time_offset_min / span * 4)))]++;
    const gaps = [];
    if (!injs.length) gaps.push("no injects");
    else {
      if (injs.length < 2) gaps.push("only one inject");
      if (!bins[2] && !bins[3]) gaps.push("nothing in the second half");
    }
    return { o, count: injs.length, bins, gaps };
  });
}

function coverageHtml(ex) {
  const cov = coverage(ex), gaps = cov.filter((c) => c.gaps.length).length;
  const quarter = ["1st", "2nd", "3rd", "4th"];
  return `<div class="card coverage">
    <div class="row between"><h3 class="title-small row">${icon("flag")}Objective coverage</h3>
      <div class="row excon-only">
        <span id="gapBusy" class="progress hidden"><span class="linear"></span><span class="body-small">Drafting injects…</span></span>
        <button type="button" id="gapBtn" class="btn sm tonal" ${gaps ? "" : "disabled"}>${icon("auto_awesome")}Suggest injects for gaps</button></div></div>
    <div class="cov-rows">${cov.map((c) => `
      <div class="cov-row ${c.gaps.length ? "gap" : ""}">
        <span class="tag primary mono">${esc(c.o.id)}</span>
        <span class="body-small cov-text" title="${esc(c.o.text)}">${esc(c.o.text)}</span>
        <span class="cov-bins" aria-label="Injects per quarter">${c.bins.map((n, q) => `<i class="l${Math.min(3, n)}" title="${quarter[q]} quarter: ${n}"></i>`).join("")}</span>
        <span class="body-small mono">${c.count}</span>
        <span class="cov-gaps">${c.gaps.map((g) => `<span class="tag overdue">${icon("warning")}${esc(g)}</span>`).join("") || `<span class="tag primary">${icon("done")}covered</span>`}</span>
      </div>`).join("")}</div>
    ${TL.proposals ? proposalsHtml() : ""}
  </div>`;
}

function proposalsHtml() {
  const p = TL.proposals;
  return `<div class="stack gap-proposals" style="gap:8px">
    <div class="note"><span class="ms">auto_awesome</span><span class="body-medium">${esc(p.assessment)}</span></div>
    ${p.injects.map((r, n) => `<div class="rec ${r.added ? "added" : ""}">
      <div class="row between"><span class="title-small">${esc(r.title)}</span><span class="row body-small variant">${fmtT(r.time_offset_min)} · ${esc(r.from_role)} → ${r.cell === "excon" ? "EXCON" : esc(r.cell.toUpperCase())}</span></div>
      <div class="body-medium">${esc(r.description)}</div>
      <div class="body-small variant"><strong>Expected:</strong> ${esc(r.expected_action)}</div>
      <div class="row"><span class="tags">${r.objective_ids.map((o) => `<span class="tag primary mono">${esc(o)}</span>`).join("")}</span>
        <span class="body-small variant">${esc(r.rationale)}</span></div>
      <div>${r.added ? `<span class="tag primary">${icon("done")}Added as ${esc(r.added)}</span>` : `<button type="button" class="btn sm tonal" data-gap-add="${n}">${icon("playlist_add")}Add to MSEL</button>`}</div>
    </div>`).join("")}
    ${p.library?.length ? referencesHtml(p) : ""}
  </div>`;
}

function renderTimeline() {
  const ex = state.ex;
  if (!ex) return;
  const tl = TL.view === "timeline";
  $$("[data-msel-view]").forEach((b) => b.classList.toggle("active", b.dataset.mselView === TL.view));
  $("#mselTableCard").classList.toggle("hidden", tl);
  const box = $("#mselTimeline");
  box.classList.toggle("hidden", !tl);
  if (!tl) return;
  if (TL.drag) return;          // don't redraw under the pointer
  const span = tlSpan(ex), lanes = tlLanes(ex);
  const width = Math.max(900, span * 3);
  const pct = (m) => `${(m / span) * 100}%`;
  const step = span <= 360 ? 30 : span <= 1440 ? 120 : 360;
  const ticks = [];
  for (let m = 0; m <= span; m += step) ticks.push(m);
  const canEdit = state.view === "excon";

  const laneHtml = lanes.map((l) => {
    // Stack chips that would overlap into rows.
    const rows = [];
    const placed = [...l.items].sort((a, b) => a.time_offset_min - b.time_offset_min).map((i) => {
      const x = i.time_offset_min / span * width;
      let r = rows.findIndex((end) => end <= x);
      if (r < 0) { r = rows.length; rows.push(0); }
      rows[r] = x + TL_CHIP + 6;
      return { i, r };
    });
    const h = Math.max(1, rows.length) * TL_ROW + 8;
    return `<div class="tl-lane">
      <div class="tl-label"><span class="title-small">${esc(l.label)}</span>${l.sub ? `<span class="body-small variant">${esc(l.sub)}</span>` : ""}</div>
      <div class="tl-track" style="height:${h}px">${placed.map(({ i, r }) => {
        const t = injectTiming(ex, i), due = isDue(ex, i);
        const cls = [`st-${i.status}`, due ? "due" : "", t.state === "blocked" ? "blocked" : "", i.condition ? "cond" : "", canEdit && i.status === "pending" ? "movable" : ""].join(" ");
        const tip = [`${i.id} ${fmtT(i.time_offset_min)} ${i.title}`, depText(i), i.condition ? `Condition: ${i.condition}` : "", t.reason || "", i.status].filter(Boolean).join("\n");
        return `<button type="button" class="tl-chip ${cls}" data-tl="${esc(i.id)}" data-lane="${esc(l.key)}" style="left:${pct(i.time_offset_min)};top:${4 + r * TL_ROW}px" title="${esc(tip)}">
          ${i.depends_on?.id ? icon("subdirectory_arrow_right") : ""}${i.condition ? icon("help") : ""}<span class="mono">${esc(i.id.replace(/^INJ-/, ""))}</span><span class="tl-title">${esc(i.title)}</span></button>`;
      }).join("")}</div></div>`;
  }).join("");

  box.innerHTML = `
    <div class="card tl-card">
      <div class="row between tl-head">
        <div class="field select compact-select"><select id="tlGroup" aria-label="Lanes">${[["cell", "Lanes: cell"], ["sender", "Lanes: sender"], ["objective", "Lanes: objective"]].map(([v, t]) => `<option value="${v}" ${TL.group === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="tl-legend body-small variant">
          <span><i class="lg pending"></i>Pending</span><span><i class="lg due"></i>Due</span><span><i class="lg released"></i>Released</span>
          <span><i class="lg acknowledged"></i>Acknowledged</span><span><i class="lg done"></i>Done / skipped</span>
          ${canEdit ? `<span>${icon("drag_pan")}Drag pending injects to reschedule; arrow keys move 5 min</span>` : ""}</div>
      </div>
      <div class="tl-scroll"><div class="tl" style="--tl-w:${width}px">
        <div class="tl-axis"><div class="tl-label"></div><div class="tl-track">${ticks.map((m) => `<span class="tl-tick" style="left:${pct(m)}">${fmtT(m)}</span>`).join("")}</div></div>
        <div class="tl-lanes">${laneHtml}
          <svg class="tl-links" aria-hidden="true"></svg>
          <div class="tl-now" style="left:calc(var(--tl-lab) + (100% - var(--tl-lab)) * ${ex.clock_min / span})"><span>${fmtT(ex.clock_min)}</span></div>
        </div>
      </div></div>
    </div>
    ${coverageHtml(ex)}`;
  setTimeout(drawLinks, 0);
  if (TL.focus) { box.querySelector(`[data-tl="${CSS.escape(TL.focus)}"]`)?.focus(); TL.focus = null; }
}

// Dependency arrows between chips (first chip of each inject).
function drawLinks() {
  const lanes = $("#mselTimeline .tl-lanes"), svg = lanes?.querySelector(".tl-links");
  if (!svg || !state.ex) return;
  const box = lanes.getBoundingClientRect();
  svg.setAttribute("width", box.width); svg.setAttribute("height", box.height);
  const chip = (id) => lanes.querySelector(`.tl-chip[data-tl="${CSS.escape(id)}"]`);
  let paths = "";
  for (const i of state.ex.scenario.msel) {
    const d = i.depends_on;
    if (!d?.id) continue;
    const a = chip(d.id), b = chip(i.id);
    if (!a || !b) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    // Elbow from the parent's lower (or upper) edge to the dependant's left side.
    const below = rb.top >= ra.top;
    const x1 = ra.left - box.left + 12, y1 = (below ? ra.bottom : ra.top) - box.top;
    const x2 = rb.left - box.left, y2 = rb.top - box.top + rb.height / 2;
    paths += `<path class="tl-link ${esc(d.on)}" d="M${x1},${y1} V${y2} H${x2 - 3}"/><path class="tl-arrow ${esc(d.on)}" d="M${x2 - 9},${y2 - 4} L${x2 - 3},${y2} L${x2 - 9},${y2 + 4}"/>`;
  }
  svg.innerHTML = paths;
}

// ---- rescheduling

function shiftDependents(x, inj, seen = new Set([inj.id])) {
  for (const i of x.scenario.msel) {
    if (i.depends_on?.id !== inj.id || seen.has(i.id) || i.status !== "pending") continue;
    seen.add(i.id);
    i.time_offset_min = inj.time_offset_min + (+i.depends_on.delay_min || 0);
    shiftDependents(x, i, seen);
  }
}

function moveInject(id, minutes) {
  mutate((x) => {
    const inj = x.scenario.msel.find((i) => i.id === id);
    if (!inj || inj.status !== "pending") return;
    let t = Math.max(0, Math.round(minutes / 5) * 5);
    const dep = inj.depends_on?.id && x.scenario.msel.find((i) => i.id === inj.depends_on.id);
    if (dep) { inj.depends_on.delay_min = Math.max(0, t - dep.time_offset_min); t = dep.time_offset_min + inj.depends_on.delay_min; }
    if (t === inj.time_offset_min) return;
    inj.time_offset_min = t;
    shiftDependents(x, inj);
    x.scenario.msel.sort((a, b) => a.time_offset_min - b.time_offset_min);
    Ex.log(x, "system", "EXCON", `${inj.id} rescheduled to ${fmtT(t)}${dep ? ` (${depText(inj)})` : ""}`);
    autoRelease(x);
  });
}

$("#mselTimeline").addEventListener("pointerdown", (ev) => {
  const c = ev.target.closest(".tl-chip.movable");
  if (!c || ev.button !== 0) return;
  const track = c.parentElement, inj = state.ex.scenario.msel.find((i) => i.id === c.dataset.tl);
  TL.drag = { id: inj.id, el: c, x0: ev.clientX, t0: inj.time_offset_min, t: inj.time_offset_min, pxPerMin: track.getBoundingClientRect().width / tlSpan(state.ex), moved: false };
  try { c.setPointerCapture(ev.pointerId); } catch { /* synthetic or already-released pointer */ }
});
$("#mselTimeline").addEventListener("pointermove", (ev) => {
  const d = TL.drag;
  if (!d) return;
  const dx = ev.clientX - d.x0;
  if (Math.abs(dx) > 3) d.moved = true;
  if (!d.moved) return;
  d.t = Math.max(0, Math.round((d.t0 + dx / d.pxPerMin) / 5) * 5);
  d.el.style.left = `${(d.t / tlSpan(state.ex)) * 100}%`;
  d.el.classList.add("dragging");
  d.el.dataset.when = fmtT(d.t);
});
function endDrag(ev) {
  const d = TL.drag;
  if (!d) return;
  TL.drag = null;
  if (d.moved) { if (d.t !== d.t0) { TL.focus = d.id; moveInject(d.id, d.t); } else renderTimeline(); }
  else if (ev.type === "pointerup") openInjectEditor(d.id);
}
$("#mselTimeline").addEventListener("pointerup", endDrag);
$("#mselTimeline").addEventListener("pointercancel", endDrag);
$("#mselTimeline").addEventListener("keydown", (ev) => {
  const c = ev.target.closest(".tl-chip");
  if (!c) return;
  if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && c.classList.contains("movable")) {
    ev.preventDefault();
    const inj = state.ex.scenario.msel.find((i) => i.id === c.dataset.tl);
    TL.focus = inj.id;
    moveInject(inj.id, inj.time_offset_min + (ev.key === "ArrowRight" ? 5 : -5));
  } else if (ev.key === "Enter" && c.classList.contains("movable")) { ev.preventDefault(); openInjectEditor(c.dataset.tl); }
});
$("#mselTimeline").addEventListener("change", (ev) => {
  if (ev.target.id === "tlGroup") { TL.group = ev.target.value; Store.write("exforge.mselgroup", TL.group); renderTimeline(); }
});
$("#mselTimeline").addEventListener("click", async (ev) => {
  if (ev.target.closest("#gapBtn")) return suggestGapInjects(ev.target.closest("#gapBtn"));
  const add = ev.target.closest("[data-gap-add]");
  if (add) {
    const r = TL.proposals.injects[+add.dataset.gapAdd];
    r.added = addPlannedInject(r);
    renderTimeline();
    toast(`Added ${r.added} at ${fmtT(r.time_offset_min)}`, true);
  }
});
addEventListener("resize", () => { if (TL.view === "timeline" && state.tab === "control") setTimeout(drawLinks, 0); });

// ---- AI gap filling

async function suggestGapInjects(btn) {
  const ex = state.ex;
  const gaps = coverage(ex).filter((c) => c.gaps.length).map((c) => ({ objective_id: c.o.id, objective: c.o.text, problem: c.gaps.join(", "), injects: c.count }));
  if (!gaps.length) return;
  await busy($("#gapBusy"), btn, async () => {
    const res = await LLM.mselGaps(ex, gaps);
    const ids = new Set(ex.scenario.objectives.map((o) => o.id));
    const span = +ex.params.duration_min || 240;
    res.injects = res.injects.map((r) => ({ ...r, time_offset_min: Math.max(0, Math.min(span, Math.round(r.time_offset_min / 5) * 5)), objective_ids: r.objective_ids.filter((o) => ids.has(o)) }));
    TL.proposals = res;
    renderTimeline();
  });
}

function nextInjectId(msel) {
  const n = Math.max(0, ...msel.map((i) => parseInt(i.id.split("-").pop(), 10)).filter(Number.isFinite)) + 1;
  return `INJ-${String(n).padStart(3, "0")}`;
}

function addPlannedInject(rec) {
  let id;
  mutate((x) => {
    const msel = x.scenario.msel;
    id = nextInjectId(msel);
    msel.push({
      id, time_offset_min: rec.time_offset_min, title: rec.title, from_role: rec.from_role || "EXCON", to_audience: rec.to_audience || x.params.training_audience,
      method: rec.method || "sitrep", cell: rec.cell || "blue", description: rec.description, expected_action: rec.expected_action || "",
      objective_ids: rec.objective_ids || [], status: "pending",
    });
    msel.sort((a, b) => a.time_offset_min - b.time_offset_min);
    Ex.log(x, "system", "EXCON", `Inject added from AI gap review: ${id} ${rec.title}`);
  });
  return id;
}

// ------------------------------------------------------------------ inject editor

const METHODS = ["radio", "email", "phone", "sitrep", "intel_report", "media", "face_to_face", "observed_event"];

function openInjectEditor(id = null) {
  const ex = state.ex, f = $("#injForm");
  const inj = id ? ex.scenario.msel.find((i) => i.id === id) : null;
  if (inj && inj.status !== "pending") return toast("Only pending injects can be edited");
  f.reset();
  f.dataset.id = id || "";
  $("#injDlgTitle").textContent = inj ? `Edit ${inj.id}` : "New inject";
  $("#injDelete").classList.toggle("hidden", !inj);
  const v = inj || { time_offset_min: ex.clock_min, from_role: "EXCON", to_audience: ex.params.training_audience, method: "sitrep", cell: "blue", objective_ids: [], title: "", description: "", expected_action: "" };
  f.elements.title.value = v.title;
  f.elements.time.value = v.time_offset_min;
  f.elements.from_role.value = v.from_role;
  f.elements.to_audience.value = v.to_audience || "";
  f.elements.method.innerHTML = METHODS.map((m) => `<option value="${m}" ${m === v.method ? "selected" : ""}>${cap(m.replace(/_/g, " "))}</option>`).join("");
  f.elements.cell.value = v.cell ?? "blue";
  f.elements.description.value = v.description;
  f.elements.expected_action.value = v.expected_action;
  f.elements.condition.value = v.condition || "";
  f.elements.auto.checked = v.auto !== false;
  $("#roleNames").innerHTML = ["EXCON", ...ex.scenario.roles.map((r) => r.name)].map((n) => `<option value="${esc(n)}">`).join("");
  $("#injObjectives").innerHTML = ex.scenario.objectives.map((o) => `<label class="chip filter" title="${esc(o.text)}"><input type="checkbox" name="objective" value="${esc(o.id)}" ${v.objective_ids.includes(o.id) ? "checked" : ""}><span class="ms check">check</span>${esc(o.id)}</label>`).join("");
  const others = ex.scenario.msel.filter((i) => i.id !== id && !(id && dependsOn(ex, i.id, id)));
  f.elements.dep.innerHTML = `<option value="">None: release at the time above</option>` + others.map((i) => `<option value="${esc(i.id)}" ${v.depends_on?.id === i.id ? "selected" : ""}>${esc(i.id)} ${fmtT(i.time_offset_min)} · ${esc(i.title.length > 48 ? `${i.title.slice(0, 48)}…` : i.title)}</option>`).join("");
  f.elements.on.value = v.depends_on?.on || "released";
  f.elements.delay.value = v.depends_on?.delay_min ?? 0;
  syncInjDep();
  injError("");
  $("#injDlg").showModal();
}

// Does inj (by id) depend, directly or through a chain, on target?
function dependsOn(ex, id, target, seen = new Set()) {
  const i = ex.scenario.msel.find((x) => x.id === id);
  const d = i?.depends_on?.id;
  if (!d || seen.has(d)) return false;
  if (d === target) return true;
  seen.add(d);
  return dependsOn(ex, d, target, seen);
}

function syncInjDep() {
  const f = $("#injForm"), dep = f.elements.dep.value;
  $("#injDepFields").classList.toggle("hidden", !dep);
  f.elements.time.disabled = !!dep;
  if (dep) {
    const d = state.ex.scenario.msel.find((i) => i.id === dep);
    f.elements.time.value = (d?.time_offset_min ?? 0) + (+f.elements.delay.value || 0);
  }
}

function injError(msg) {
  const el = $("#injError");
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

$("#injForm").addEventListener("input", (ev) => { if (["dep", "delay"].includes(ev.target.name)) syncInjDep(); });
$("#injForm").addEventListener("change", (ev) => { if (["dep", "delay"].includes(ev.target.name)) syncInjDep(); });
$("#newInjBtn").addEventListener("click", () => openInjectEditor());

$("#injForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const f = ev.target, id = f.dataset.id || null;
  const title = f.elements.title.value.trim(), description = f.elements.description.value.trim();
  if (!title || !description) return injError("Give the inject a title and a description.");
  const dep = f.elements.dep.value;
  const rec = {
    title, description, expected_action: f.elements.expected_action.value.trim(),
    from_role: f.elements.from_role.value.trim() || "EXCON", to_audience: f.elements.to_audience.value.trim(),
    method: f.elements.method.value, cell: f.elements.cell.value,
    objective_ids: $$('#injObjectives input:checked').map((c) => c.value),
    time_offset_min: Math.max(0, Math.round(+f.elements.time.value || 0)),
    depends_on: dep ? { id: dep, on: f.elements.on.value, delay_min: Math.max(0, Math.round(+f.elements.delay.value || 0)) } : null,
    condition: f.elements.condition.value.trim(),
    auto: f.elements.auto.checked,
  };
  let savedId = id;
  mutate((x) => {
    const msel = x.scenario.msel;
    let inj = id && msel.find((i) => i.id === id);
    if (id && (!inj || inj.status !== "pending")) return;
    if (!inj) { inj = { id: savedId = nextInjectId(msel), status: "pending" }; msel.push(inj); }
    const oldTime = inj.time_offset_min;
    Object.assign(inj, rec);
    if (rec.depends_on) {
      const d = msel.find((i) => i.id === rec.depends_on.id);
      inj.time_offset_min = (d?.time_offset_min ?? 0) + rec.depends_on.delay_min;
    } else delete inj.depends_on;
    if (!rec.condition) delete inj.condition;
    if (rec.auto) delete inj.auto;
    if (oldTime !== inj.time_offset_min) shiftDependents(x, inj);
    msel.sort((a, b) => a.time_offset_min - b.time_offset_min);
    Ex.log(x, "system", "EXCON", `${id ? "Inject edited" : "Inject added"}: ${inj.id} ${inj.title}${inj.depends_on ? ` (${depText(inj)})` : ` at ${fmtT(inj.time_offset_min)}`}`);
    autoRelease(x);
  });
  $("#injDlg").close();
  toast(id ? `${id} saved` : `${savedId} added`, true);
});

$("#injDelete").addEventListener("click", () => {
  const id = $("#injForm").dataset.id;
  const dependents = state.ex.scenario.msel.filter((i) => i.depends_on?.id === id).map((i) => i.id);
  if (!confirm(`Delete ${id}?${dependents.length ? ` ${dependents.join(", ")} depend on it and will go back to their own times.` : ""}`)) return;
  mutate((x) => {
    x.scenario.msel = x.scenario.msel.filter((i) => i.id !== id);
    for (const i of x.scenario.msel) if (i.depends_on?.id === id) delete i.depends_on;
    Ex.log(x, "system", "EXCON", `Inject deleted: ${id}`);
  });
  $("#injDlg").close();
});

// ------------------------------------------------------------------ release conditions checked by the AI

async function checkCondition(id, btn) {
  const ex = state.ex, inj = ex.scenario.msel.find((i) => i.id === id);
  if (!inj?.condition) return;
  btn.disabled = true;
  try {
    const r = await LLM.checkCondition(ex, inj);
    mutate((x) => {
      const i = x.scenario.msel.find((y) => y.id === id);
      if (i) i.condition_check = { ...r, at: nowIso(), clock: x.clock_min, provider: LLM.label() };
    });
  } catch (e) { toast(e.message); btn.disabled = false; }
}

$("#mselBody").addEventListener("click", (ev) => {
  const e = ev.target.closest("[data-edit-inj]");
  if (e) return openInjectEditor(e.dataset.editInj);
  const c = ev.target.closest("[data-cond-check]");
  if (c) checkCondition(c.dataset.condCheck, c);
});

function timingHtml(ex, i) {
  const t = injectTiming(ex, i), lines = [];
  if (i.depends_on?.id) lines.push(`${icon("subdirectory_arrow_right")}${esc(depText(i))}${t.state === "ready" && i.status === "pending" ? ` → due ${fmtT(t.due)}` : ""}`);
  if (i.status === "pending" && (t.state === "waiting" || t.state === "blocked")) lines.push(`${icon(t.state === "blocked" ? "block" : "hourglass_empty")}${esc(t.reason)}`);
  if (i.condition) {
    const cc = i.condition_check;
    lines.push(`${icon("help")}<span><strong>Condition:</strong> ${esc(i.condition)}${cc ? ` <span class="tag ${cc.met ? "primary" : "hostile"}">${cc.met ? "AI: condition met" : "AI: not met"} (${esc(cc.confidence)})</span> <span class="variant">${esc(cc.reasoning)}</span>` : ""}
      ${i.status === "pending" ? `<button class="btn sm text excon-only" data-cond-check="${esc(i.id)}">${icon("auto_awesome")}Check with AI</button>` : ""}</span>`);
  }
  if (i.auto === false) lines.push(`${icon("pan_tool")}Released by hand only`);
  if (i.auto_released) lines.push(`${icon("schedule_send")}Auto-released on time`);
  return lines.length ? `<div class="timing">${lines.map((l) => `<span>${l}</span>`).join("")}</div>` : "";
}
