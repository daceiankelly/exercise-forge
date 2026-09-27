"use strict";
// Rules-based adjudication. The numbers (combat power, force ratio, dice roll, losses, supply use) come from
// transparent tables that EXCON can edit per exercise and a seeded roll that anyone can re-check; the AI only
// narrates the result. Tables are planning-level figures for training, not a validated combat model.

const Rules = (() => {
  const T = (cv, move) => ({ cv, move });
  const DEFAULTS = {
    // Combat value of a company-sized unit at full strength, and cross-country movement in km/h.
    types: {
      infantry: T(4, 4), armour: T(8, 20), mechanized: T(6, 15), artillery: T(5, 12), reconnaissance: T(2, 25),
      engineer: T(2, 8), headquarters: T(1, 10), logistics: T(0.5, 15), medical: T(0, 15), air_defence: T(1, 10),
      aviation: T(6, 120), signals: T(0.5, 15), special_forces: T(3, 4), militia: T(2, 4), naval: T(6, 25), civilian: T(0, 5),
    },
    // Size relative to a company.
    echelons: { team: 0.05, squad: 0.1, section: 0.1, platoon: 0.3, company: 1, battalion: 3, regiment: 6, brigade: 9, division: 27 },
    // Multiplier on a unit's combat power for its current status.
    status: { active: 1, moving: 0.8, engaged: 1, defending: 1, combat_ineffective: 0.3, withdrawn: 0.5, destroyed: 0 },
    // Multipliers on the defender's power.
    terrain: { open: 1, mixed: 1.2, close: 1.5, urban: 2, river: 1.75 },
    posture: { hasty: 1, prepared: 1.5, fortified: 2 },
    // Low supply or morale reduces a side's combat power.
    condition: { low: 50, lowMod: 0.85, critical: 25, criticalMod: 0.7 },
    // Combat results table: from this force ratio up, the attacker's chance of success and base losses (% strength per hour).
    crt: [
      { ratio: 0, success: 5, atkLoss: 20, defLoss: 5 },
      { ratio: 1, success: 20, atkLoss: 15, defLoss: 8 },
      { ratio: 1.5, success: 35, atkLoss: 12, defLoss: 10 },
      { ratio: 2, success: 50, atkLoss: 10, defLoss: 12 },
      { ratio: 3, success: 70, atkLoss: 8, defLoss: 15 },
      { ratio: 4, success: 85, atkLoss: 6, defLoss: 20 },
      { ratio: 6, success: 95, atkLoss: 4, defLoss: 25 },
    ],
    thresholds: { ineffective: 30, destroyed: 10 },
    effects: { winMorale: 5, loseMorale: -5, supply: -3 },
    // Supply used per hour of exercise time, by what the side is doing (off by default).
    consumption: { enabled: false, idle: 1, moving: 2, engaged: 5 },
  };

  const OUTCOMES = {
    decisive: { label: "Decisive: the defence breaks", atk: 0.75, def: 1.5, atkStatus: "active", defStatus: "withdrawn" },
    success: { label: "Attack succeeds: the defender is forced back", atk: 1, def: 1.25, atkStatus: "engaged", defStatus: "withdrawn" },
    stalled: { label: "Attack stalls: both sides stay in contact", atk: 1, def: 1, atkStatus: "engaged", defStatus: "engaged" },
    repulsed: { label: "Attack repulsed", atk: 1.5, def: 0.5, atkStatus: "withdrawn", defStatus: "defending" },
  };

  const copy = (o) => JSON.parse(JSON.stringify(o));
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  function merge(base, over) {
    for (const [k, v] of Object.entries(over || {})) base[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : copy(v);
    return base;
  }
  const tables = (ex) => merge(copy(DEFAULTS), ex?.rules?.tables);
  const round1 = (n) => Math.round(n * 10) / 10;
  const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Seeded dice: the same seed and key always give the same roll, so a result can be re-checked later.
  function hash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function d100(seed, key) {
    let a = hash(`${seed}|${key}`);
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return 1 + Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 100);
  }
  const newSeed = () => Math.random().toString(36).slice(2, 10).toUpperCase();

  const condMod = (v, t) => v == null ? 1 : v < t.condition.critical ? t.condition.criticalMod : v < t.condition.low ? t.condition.lowMod : 1;

  function unitPower(u, t, w) {
    const type = t.types[u.type] || { cv: 1 };
    const ech = t.echelons[u.echelon] ?? 1;
    const st = t.status[u.status || "active"] ?? 1;
    const side = w.sides?.[u.side] || {};
    const sup = condMod(side.supply, t), mor = condMod(side.morale, t);
    const power = type.cv * ech * (u.strength / 100) * st * sup * mor;
    const parts = [`${type.cv} ${u.type.replace(/_/g, " ")}`, `×${ech} ${u.echelon}`, `×${u.strength}%`];
    if (st !== 1) parts.push(`×${st} ${(u.status || "").replace(/_/g, " ")}`);
    if (sup !== 1) parts.push(`×${sup} low supply`);
    if (mor !== 1) parts.push(`×${mor} low morale`);
    return { id: u.id, name: u.name, side: u.side, strength: u.strength, power: round1(power), parts };
  }

  // Resolve one engagement. key identifies it (the action's log id) and fixes the dice.
  function resolve(ex, { attackers = [], defenders = [], terrain = "open", posture = "hasty", minutes = 60, key }) {
    const t = tables(ex), w = ex.world || {};
    const units = w.units || [];
    const pick = (ids) => ids.map((id) => units.find((u) => u.id === id)).filter((u) => u && u.status !== "destroyed");
    const A = pick(attackers), D = pick(defenders);
    if (!A.length || !D.length) throw new Error("Pick at least one attacking and one defending unit.");
    if (A.some((a) => D.includes(a))) throw new Error("A unit can't attack and defend in the same engagement.");
    const aP = A.map((u) => unitPower(u, t, w)), dP = D.map((u) => unitPower(u, t, w));
    const atk = round1(aP.reduce((s, u) => s + u.power, 0));
    const defBase = round1(dP.reduce((s, u) => s + u.power, 0));
    const terr = t.terrain[terrain] ?? 1, post = t.posture[posture] ?? 1;
    const def = round1(defBase * terr * post);
    const ratio = def > 0 ? round1(atk / def) : 99;
    const crt = [...t.crt].sort((a, b) => a.ratio - b.ratio);
    const band = crt.filter((b) => ratio >= b.ratio).pop() || crt[0];

    const seed = ex.rules?.seed || "UNSEEDED";
    const roll = d100(seed, `${key}:outcome`), lossRoll = d100(seed, `${key}:losses`);
    const variance = round1(0.75 + (lossRoll - 1) / 198);
    const dur = round1(clampN((+minutes || 60) / 60, 0.5, 2));
    const s = band.success;
    const result = roll <= Math.floor(s / 3) ? "decisive" : roll <= s ? "success" : roll <= s + Math.ceil((100 - s) / 2) ? "stalled" : "repulsed";
    const o = OUTCOMES[result];
    const atkLoss = Math.round(band.atkLoss * o.atk * variance * dur);
    const defLoss = Math.round(band.defLoss * o.def * variance * dur);

    const after = (u, loss, status) => {
      const strength = clampN(u.strength - loss, 0, 100);
      const st = strength <= t.thresholds.destroyed ? "destroyed" : strength <= t.thresholds.ineffective ? "combat_ineffective" : status;
      return { id: u.id, name: u.name, side: u.side, from: u.strength, to: strength, status: st };
    };
    const unitResults = [...A.map((u) => after(u, atkLoss, o.atkStatus)), ...D.map((u) => after(u, defLoss, o.defStatus))];

    const atkSide = A[0].side, defSide = D[0].side;
    const fighting = (s) => s === "blue" || s === "red";
    const won = result === "decisive" || result === "success" ? atkSide : result === "repulsed" ? defSide : null;
    const lost = won === atkSide ? defSide : won === defSide ? atkSide : null;
    const sideChanges = {};
    const bump = (side, supply, morale) => {
      if (!fighting(side)) return;
      const c = sideChanges[side] ??= { side, supply_change: 0, morale_change: 0 };
      c.supply_change += supply; c.morale_change += morale;
    };
    bump(atkSide, t.effects.supply, 0);
    if (defSide !== atkSide) bump(defSide, t.effects.supply, 0);
    if (won) bump(won, 0, t.effects.winMorale);
    if (lost && lost !== won) bump(lost, 0, t.effects.loseMorale);

    const detections = [];
    for (const [seen, by] of [[D, A], [A, D]]) {
      const obs = by[0].side;
      if (!fighting(obs)) continue;
      for (const u of seen) if (u.side !== obs) detections.push({ observer_side: obs, unit_id: u.id, confidence: "high" });
    }

    const world_changes = {
      unit_updates: unitResults.map((r) => ({ unit_id: r.id, lat: null, lng: null, strength_change: r.to - r.from, status: r.status, task: null })),
      detections,
      side_changes: Object.values(sideChanges),
      civil_stability_change: 0,
      summary: `${o.label}. Attacker losses ${atkLoss}%, defender losses ${defLoss}%.`,
    };

    const explain = [
      `Attack power ${atk}: ${aP.map((u) => `${u.id} ${u.power} (${u.parts.join(" ")})`).join("; ")}`,
      `Defence power ${defBase}${terr !== 1 ? ` ×${terr} ${terrain} terrain` : ""}${post !== 1 ? ` ×${post} ${posture} position` : ""} = ${def}: ${dP.map((u) => `${u.id} ${u.power} (${u.parts.join(" ")})`).join("; ")}`,
      `Force ratio ${ratio}:1 → table row from ${band.ratio}:1: ${s}% chance of success, base losses attacker ${band.atkLoss}%, defender ${band.defLoss}% per hour`,
      `Outcome roll ${roll} on d100: decisive ≤ ${Math.floor(s / 3)}, success ≤ ${s}, stall ≤ ${s + Math.ceil((100 - s) / 2)}, otherwise repulsed → ${result}`,
      `Losses: base × ${o.atk} (attacker) / ${o.def} (defender) × ${variance} (loss roll ${lossRoll}) × ${dur} (${minutes} min) → attacker ${atkLoss}%, defender ${defLoss}%`,
      `Below ${t.thresholds.ineffective}% a unit is combat ineffective; at ${t.thresholds.destroyed}% or less it is destroyed`,
    ];

    return {
      key, seed, attackers: aP, defenders: dP, terrain, posture, minutes: +minutes || 60,
      atk, defBase, def, ratio, band: { ...band }, roll, lossRoll, variance, result, label: o.label,
      atkLoss, defLoss, units: unitResults, world_changes, explain,
    };
  }

  // Text for the AI: the result is binding, the AI only describes it.
  function promptText(r, ex) {
    const n = (id) => ex.world?.units?.find((u) => u.id === id)?.name || id;
    return `RULES RESULT (binding: computed from the exercise's combat tables and a dice roll; do not change it):
Attackers: ${r.attackers.map((u) => `${u.id} ${n(u.id)}`).join(", ")}
Defenders: ${r.defenders.map((u) => `${u.id} ${n(u.id)}`).join(", ")} (${r.terrain} terrain, ${r.posture} position, ${r.minutes} min of fighting)
Force ratio ${r.ratio}:1, ${r.band.success}% chance of success, roll ${r.roll} → ${r.label}.
Losses: attackers ${r.atkLoss}%, defenders ${r.defLoss}%.
Unit results: ${r.units.map((u) => `${u.id} ${u.from}% → ${u.to}% ${u.status.replace(/_/g, " ")}`).join("; ")}.
Write the outcome, effects and rationale so they describe this result. Don't alter who won, the losses or the unit statuses; put only
movement, new tasks, detections of other units and civil effects in world_changes (the losses above are applied from the rules).`;
  }

  // The AI's world changes for the units in the engagement are replaced by the rules' strength and status.
  function mergeWorld(ai, r) {
    const wc = ai || { unit_updates: [], detections: [], side_changes: [], civil_stability_change: 0, summary: "" };
    const involved = new Set(r.units.map((u) => u.id));
    const updates = (wc.unit_updates || []).filter((u) => !involved.has(u.unit_id));
    for (const ru of r.world_changes.unit_updates) {
      const aiU = (wc.unit_updates || []).find((u) => u.unit_id === ru.unit_id);
      updates.push({ ...ru, lat: aiU?.lat ?? null, lng: aiU?.lng ?? null, task: aiU?.task ?? null });
    }
    const det = [...(wc.detections || [])];
    for (const d of r.world_changes.detections) if (!det.some((x) => x.observer_side === d.observer_side && x.unit_id === d.unit_id)) det.push(d);
    return {
      unit_updates: updates,
      detections: det,
      side_changes: r.world_changes.side_changes,
      civil_stability_change: wc.civil_stability_change || 0,
      summary: [r.world_changes.summary, wc.summary].filter(Boolean).join(" "),
    };
  }

  // ---- movement and supply

  function distanceKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function moveInfo(ex, u, lat, lng) {
    const km = distanceKm(u, { lat, lng });
    const rate = tables(ex).types[u.type]?.move || 5;
    return { km: round1(km), rate, minutes: Math.round(km / rate * 60) };
  }
  const fmtMin = (m) => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
  const moveText = (m) => `${m.km} km, about ${fmtMin(m.minutes)} at ${m.rate} km/h`;

  // Supply used as exercise time passes. Fractions carry over so small clock steps still add up.
  function consume(x, minutes) {
    const t = tables(x);
    if (!t.consumption.enabled || !x.world?.units?.length || minutes <= 0) return [];
    x.rules ??= {};
    const carry = x.rules.carry ??= { blue: 0, red: 0 };
    const lines = [];
    for (const side of ["blue", "red"]) {
      const us = x.world.units.filter((u) => u.side === side && u.status !== "destroyed");
      if (!us.length) continue;
      const activity = us.some((u) => u.status === "engaged") ? "engaged" : us.some((u) => u.status === "moving") ? "moving" : "idle";
      carry[side] = (carry[side] || 0) + t.consumption[activity] * minutes / 60;
      const whole = Math.floor(carry[side]);
      if (!whole) continue;
      carry[side] = round1(carry[side] - whole);
      const s = x.world.sides[side] ??= { supply: 80, morale: 80 };
      s.supply = clampN(Math.round(s.supply - whole), 0, 100);
      lines.push(`${side.toUpperCase()} −${whole}% (${activity}) → ${s.supply}%`);
    }
    return lines;
  }

  return { DEFAULTS, OUTCOMES, tables, d100, newSeed, unitPower, resolve, promptText, mergeWorld, distanceKm, moveInfo, moveText, fmtMin, consume };
})();

// ------------------------------------------------------------------ rules UI: engagement picker, result card, tables editor

const Engage = { atk: new Set(), def: new Set(), terrain: "open", posture: "hasty", minutes: 60 };

function adjMode() { return $("#adjForm").elements.mode?.value || "ai"; }

function renderEngage() {
  const panel = $("#engagePanel");
  if (!panel || !state.ex) return;
  const units = (state.ex.world?.units || []).filter((u) => u.status !== "destroyed" && u.side !== "civil");
  const rulesOn = adjMode() === "rules";
  $("#adjModeHint").textContent = units.length ? "" : "Place forces on the map to use the combat rules.";
  $("#adjForm").querySelector('input[value="rules"]').disabled = !units.length;
  panel.classList.toggle("hidden", !rulesOn || !units.length);
  if (!rulesOn || !units.length) return;
  for (const set of [Engage.atk, Engage.def]) for (const id of [...set]) if (!units.some((u) => u.id === id)) set.delete(id);
  const chips = (role) => units.map((u) => `<label class="chip filter side-${esc(u.side)}"><input type="checkbox" data-eg="${role}" value="${esc(u.id)}" ${Engage[role].has(u.id) ? "checked" : ""}><span class="ms check">check</span><span class="mono">${esc(u.id)}</span>${esc(u.name)}</label>`).join("");
  const t = Rules.tables(state.ex);
  const opts = (obj, cur) => Object.keys(obj).map((k) => `<option value="${esc(k)}" ${k === cur ? "selected" : ""}>${esc(cap(k))} (×${obj[k]})</option>`).join("");
  panel.innerHTML = `
    <div class="engage-side"><div class="label-medium">${icon("swords")}Attacking</div><div class="chip-set">${chips("atk")}</div></div>
    <div class="engage-side"><div class="label-medium">${icon("shield")}Defending</div><div class="chip-set">${chips("def")}</div></div>
    <div class="engage-opts">
      <div class="field select"><select id="eg-terrain" data-eg-opt="terrain">${opts(t.terrain, Engage.terrain)}</select><label for="eg-terrain">Terrain</label></div>
      <div class="field select"><select id="eg-posture" data-eg-opt="posture">${opts(t.posture, Engage.posture)}</select><label for="eg-posture">Defender</label></div>
      <div class="field"><input id="eg-min" type="number" min="10" max="240" step="10" data-eg-opt="minutes" value="${Engage.minutes}" placeholder=" "><label for="eg-min">Minutes</label></div>
    </div>
    <div id="engagePreview" class="engage-preview"></div>
    <div class="row"><button type="button" id="rulesTablesBtn" class="btn sm text">${icon("table_chart")}Rules tables</button></div>`;
  renderEngagePreview();
}

function renderEngagePreview() {
  const el = $("#engagePreview");
  if (!el) return;
  if (!Engage.atk.size || !Engage.def.size) { el.innerHTML = `<span class="body-small variant">Pick the attacking and defending units.</span>`; return; }
  try {
    const r = Rules.resolve(state.ex, { attackers: [...Engage.atk], defenders: [...Engage.def], terrain: Engage.terrain, posture: Engage.posture, minutes: Engage.minutes, key: "preview" });
    el.innerHTML = `<span class="ratio mono">${r.ratio}:1</span><span class="body-medium">Attack ${r.atk} vs defence ${r.def} → <strong>${r.band.success}%</strong> chance of success. The dice are rolled when you adjudicate.</span>`;
  } catch (e) { el.innerHTML = `<span class="body-small" style="color:var(--md-error)">${esc(e.message)}</span>`; }
}

$("#adjForm").addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.name === "mode") return renderEngage();
  if (t.dataset.eg) {
    const set = Engage[t.dataset.eg], other = Engage[t.dataset.eg === "atk" ? "def" : "atk"];
    if (t.checked) { set.add(t.value); if (other.delete(t.value)) renderEngage(); } else set.delete(t.value);
    return renderEngagePreview();
  }
  if (t.dataset.egOpt) {
    Engage[t.dataset.egOpt] = t.dataset.egOpt === "minutes" ? Math.min(240, Math.max(10, +t.value || 60)) : t.value;
    renderEngagePreview();
  }
});
$("#adjForm").addEventListener("click", (ev) => { if (ev.target.closest("#rulesTablesBtn")) openRulesDlg(); });

// The engagement to resolve, or null when the AI decides alone.
function engagementFromForm() {
  if (adjMode() !== "rules") return null;
  if (!Engage.atk.size || !Engage.def.size) throw new Error("Pick at least one attacking and one defending unit.");
  return { attackers: [...Engage.atk], defenders: [...Engage.def], terrain: Engage.terrain, posture: Engage.posture, minutes: Engage.minutes };
}

const RESULT_ICON = { decisive: "military_tech", success: "trending_up", stalled: "horizontal_rule", repulsed: "undo" };

function rulesHtml(r) {
  if (!r) return "";
  return `<div class="rules-card ${esc(r.result)}">
    <div class="row between"><span class="title-small row">${icon("casino")}Combat rules</span>
      <span class="row body-small variant"><span class="mono">${esc(r.ratio)}:1</span>· ${esc(r.band.success)}% · roll <span class="mono">${esc(r.roll)}</span></span></div>
    <div class="rules-result">${icon(RESULT_ICON[r.result] || "casino")}<span class="title-medium">${esc(r.label)}</span></div>
    <div class="rules-units">${r.units.map((u) => `<div class="rules-unit side-${esc(u.side)}"><span class="mono">${esc(u.id)}</span><span>${esc(u.name)}</span>
      <span class="mono">${u.from}% → ${u.to}%</span><span class="tag">${esc(u.status.replace(/_/g, " "))}</span></div>`).join("")}</div>
    <details><summary class="label-large">How it was calculated</summary>
      <ol class="explain body-small">${r.explain.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>
      <div class="body-small variant">Seed <span class="mono">${esc(r.seed)}</span> · key <span class="mono">${esc(r.key)}</span>. The same seed and key always give the same rolls.</div>
    </details></div>`;
}

// ---- tables editor

let rulesDraft = null;

function openRulesDlg() {
  rulesDraft = Rules.tables(state.ex);
  renderRulesDlg();
  $("#rulesDlg").showModal();
}

function renderRulesDlg() {
  const t = rulesDraft;
  const num = (path, v, step = "any") => `<input type="number" step="${step}" data-rt="${esc(path)}" value="${esc(v)}" aria-label="${esc(path)}">`;
  const grid = (title, key, note) => `<div class="subsection"><span class="title-small">${title}</span>${note ? `<span class="body-small variant">${note}</span>` : ""}
    <div class="rt-grid">${Object.entries(t[key]).map(([k, v]) => `<label class="rt-cell"><span class="body-small">${esc(cap(k.replace(/_/g, " ")))}</span>${num(`${key}.${k}`, v)}</label>`).join("")}</div></div>`;
  $("#rulesBody").innerHTML = `
    <div class="subsection"><span class="title-small">Unit types</span><span class="body-small variant">Combat value of a full-strength company, and cross-country speed.</span>
      <div class="table-wrap"><table class="data rt-table"><thead><tr><th>Type</th><th>Combat value</th><th>Speed km/h</th></tr></thead><tbody>
      ${Object.entries(t.types).map(([k, v]) => `<tr><td>${esc(cap(k.replace(/_/g, " ")))}</td><td>${num(`types.${k}.cv`, v.cv)}</td><td>${num(`types.${k}.move`, v.move)}</td></tr>`).join("")}
      </tbody></table></div></div>
    ${grid("Echelon size", "echelons", "Relative to a company.")}
    ${grid("Status", "status", "Multiplier on a unit's power.")}
    ${grid("Terrain", "terrain", "Multiplier on the defender's power.")}
    ${grid("Defender's position", "posture")}
    <div class="subsection"><span class="title-small">Combat results table</span><span class="body-small variant">Each row applies from its force ratio upwards. Losses are % strength per hour of fighting.</span>
      <div class="table-wrap"><table class="data rt-table"><thead><tr><th>From ratio</th><th>Success %</th><th>Attacker loss %</th><th>Defender loss %</th><th></th></tr></thead><tbody>
      ${t.crt.map((b, i) => `<tr><td>${num(`crt.${i}.ratio`, b.ratio)}</td><td>${num(`crt.${i}.success`, b.success, 1)}</td><td>${num(`crt.${i}.atkLoss`, b.atkLoss)}</td><td>${num(`crt.${i}.defLoss`, b.defLoss)}</td>
        <td><button type="button" class="icon-btn" data-crt-del="${i}" aria-label="Remove row">${icon("close")}</button></td></tr>`).join("")}
      </tbody></table></div>
      <div><button type="button" class="btn sm text" data-crt-add>${icon("add")}Add row</button></div></div>
    ${grid("Thresholds (% strength)", "thresholds")}
    ${grid("After an engagement", "effects", "Morale for the winner and loser; supply used by both sides.")}
    ${grid("Low supply or morale", "condition", "Below “low” power is multiplied by the low modifier; below “critical” by the critical modifier.")}
    <div class="subsection"><span class="title-small">Supply use over time</span>
      <label class="switch"><span class="label-large">Use supply as the clock advances</span><input type="checkbox" data-rt-bool="consumption.enabled" ${t.consumption.enabled ? "checked" : ""}><span class="track"></span></label>
      <div class="rt-grid">${["idle", "moving", "engaged"].map((k) => `<label class="rt-cell"><span class="body-small">${cap(k)} (%/h)</span>${num(`consumption.${k}`, t.consumption[k])}</label>`).join("")}</div></div>
    <div class="subsection"><span class="title-small">Dice</span>
      <div class="row body-medium">Seed <span class="mono" id="rulesSeed">${esc(state.ex.rules?.seed || "set on first use")}</span></div>
      <span class="body-small variant">Each engagement's rolls come from this seed and the action's log id, so anyone can re-check a result.</span></div>`;
}

function readRulesDlg() {
  for (const el of $$("#rulesBody [data-rt]")) {
    const path = el.dataset.rt.split(".");
    let o = rulesDraft;
    for (const k of path.slice(0, -1)) o = o[k];
    const v = parseFloat(el.value);
    if (Number.isFinite(v)) o[path.at(-1)] = v;
  }
  for (const el of $$("#rulesBody [data-rt-bool]")) {
    const [a, b] = el.dataset.rtBool.split(".");
    rulesDraft[a][b] = el.checked;
  }
}

$("#rulesBody").addEventListener("click", (ev) => {
  const del = ev.target.closest("[data-crt-del]"), add = ev.target.closest("[data-crt-add]");
  if (!del && !add) return;
  readRulesDlg();
  if (del && rulesDraft.crt.length > 1) rulesDraft.crt.splice(+del.dataset.crtDel, 1);
  if (add) { const last = rulesDraft.crt.at(-1); rulesDraft.crt.push({ ...last, ratio: last.ratio + 1 }); }
  renderRulesDlg();
});
$("#rulesReset").addEventListener("click", () => { rulesDraft = JSON.parse(JSON.stringify(Rules.DEFAULTS)); renderRulesDlg(); });
$("#rulesForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  readRulesDlg();
  rulesDraft.crt.sort((a, b) => a.ratio - b.ratio);
  const tablesNow = rulesDraft;
  mutate((x) => {
    x.rules ??= {};
    x.rules.seed ??= Rules.newSeed();
    x.rules.tables = tablesNow;
    Ex.log(x, "system", "EXCON", "Combat rules tables updated");
  });
  $("#rulesDlg").close();
  toast("Rules tables saved", true);
});
