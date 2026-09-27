"use strict";
// Map, world state and RED AI.
//   Map sources (all work offline): the built-in Natural Earth world outline; offline map packs you load once
//   (PMTiles or MBTiles raster files, kept in this browser's IndexedDB); a tile server on your network whose
//   tiles are kept as you view them; or a PMTiles file served over http (e.g. alongside the app on GitLab Pages).
//   World state (ex.world): units, features, supply/morale, civil stability and what each side knows. The AI
//   reads it and proposes changes; EXCON approves them. BLUE and RED only ever see their own units and what
//   they've detected.

// ------------------------------------------------------------------ offline storage (IndexedDB)

const MapDB = (() => {
  let dbp = null;
  const open = () => (dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("exforge-maps", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("packs", { keyPath: "id" }); r.result.createObjectStore("tiles"); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode), req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error || new Error("Storage error"));
      t.onabort = () => reject(t.error || new Error("Storage full or blocked"));
    });
  }
  return {
    packs: () => run("packs", "readonly", (s) => s.getAll()),
    putPack: (p) => run("packs", "readwrite", (s) => s.put(p)),
    delPack: (id) => run("packs", "readwrite", (s) => s.delete(id)),
    getTile: (k) => run("tiles", "readonly", (s) => s.get(k)),
    putTile: (k, blob) => run("tiles", "readwrite", (s) => s.put(blob, k)),
    tileCount: () => run("tiles", "readonly", (s) => s.count()),
    clearTiles: () => run("tiles", "readwrite", (s) => s.clear()),
  };
})();

// ------------------------------------------------------------------ tile providers: get(z, x, y) → Blob | null

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif" };

async function pmtilesProvider(source, name) {
  const pm = new pmtiles.PMTiles(source);
  const h = await pm.getHeader();
  const bounds = [[h.minLat, h.minLon], [h.maxLat, h.maxLon]];
  if (h.tileType === 1) {
    return { vector: true, minZoom: h.minZoom, maxZoom: h.maxZoom, bounds,
      async getRaw(z, x, y) { if (z < h.minZoom || z > h.maxZoom) return null; const r = await pm.getZxy(z, x, y); return r?.data ? new Uint8Array(r.data) : null; } };
  }
  const type = { 2: "image/png", 3: "image/jpeg", 4: "image/webp", 5: "image/avif" }[h.tileType] || "image/png";
  return {
    minZoom: h.minZoom, maxZoom: h.maxZoom,
    bounds,
    async get(z, x, y) { const r = await pm.getZxy(z, x, y); return r?.data ? new Blob([r.data], { type }) : null; },
  };
}

let sqlReady = null;
async function mbtilesProvider(blob, name) {
  sqlReady ??= initSqlJs({ wasmBinary: Uint8Array.from(atob(window.SQL_WASM_B64), (c) => c.charCodeAt(0)) });
  const SQL = await sqlReady;
  const db = new SQL.Database(new Uint8Array(await blob.arrayBuffer()));
  const meta = {};
  try { for (const [k, v] of db.exec("SELECT name, value FROM metadata")[0]?.values || []) meta[k] = v; } catch { /* optional table */ }
  const fmt = String(meta.format || "png").toLowerCase();
  const zr = db.exec("SELECT MIN(zoom_level), MAX(zoom_level) FROM tiles")[0]?.values[0] || [0, 18];
  const b = String(meta.bounds || "").split(",").map(Number);
  const stmt = db.prepare("SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?");
  const read = (z, x, y) => {
    stmt.bind([z, x, (1 << z) - 1 - y]);           // MBTiles rows count from the bottom (TMS)
    const data = stmt.step() ? stmt.get()[0] : null;
    stmt.reset();
    return data;
  };
  if (fmt === "pbf" || fmt === "mvt") {
    return { vector: true, minZoom: +(meta.minzoom ?? zr[0]), maxZoom: +(meta.maxzoom ?? zr[1]),
      bounds: b.length === 4 && b.every(Number.isFinite) ? [[b[1], b[0]], [b[3], b[2]]] : null,
      async getRaw(z, x, y) { const d = read(z, x, y); return d ? gunzipIfNeeded(d) : null; } };
  }
  return {
    minZoom: +(meta.minzoom ?? zr[0]), maxZoom: +(meta.maxzoom ?? zr[1]),
    bounds: b.length === 4 && b.every(Number.isFinite) ? [[b[1], b[0]], [b[3], b[2]]] : null,
    async get(z, x, y) { const data = read(z, x, y); return data ? new Blob([data], { type: MIME[fmt] || "image/png" }) : null; },
  };
}

// Tile server with an offline copy of every tile viewed (cache first, so it keeps working without a network).
// Addresses ending .pbf or .mvt are vector tiles (drawn up to zoom 14 from data, sharper beyond that).
function serverProvider(template, keep) {
  const key = (z, x, y) => `${template}|${z}/${x}/${y}`;
  const url = (z, x, y) => template.replace("{z}", z).replace("{x}", x).replace("{y}", y).replace("{s}", "abc"[(x + y) % 3]);
  const vector = /\.(pbf|mvt)(\?|$)/i.test(template);
  return {
    vector, minZoom: 0, maxZoom: vector ? 14 : 19, bounds: null,
    async getRaw(z, x, y) { const blob = await this.get(z, x, y); return blob ? gunzipIfNeeded(new Uint8Array(await blob.arrayBuffer())) : null; },
    async get(z, x, y) {
      try { const hit = await MapDB.getTile(key(z, x, y)); if (hit) return hit; } catch { /* storage blocked */ }
      try {
        const res = await fetch(url(z, x, y));
        if (!res.ok) return null;
        const blob = await res.blob();
        if (keep) MapDB.putTile(key(z, x, y), blob).catch(() => {});
        return blob;
      } catch { return null; }
    },
    key, url,
  };
}

const BlobTileLayer = L.GridLayer.extend({
  initialize(provider, options) {
    this.provider = provider;
    L.GridLayer.prototype.initialize.call(this, options);
  },
  createTile(c, done) {
    const img = document.createElement("img");
    img.alt = "";
    this.provider.get(c.z, c.x, c.y).then((blob) => {
      if (!blob) return done(null, img);
      const u = URL.createObjectURL(blob);
      img.onload = img.onerror = () => { URL.revokeObjectURL(u); done(null, img); };
      img.src = u;
    }).catch(() => done(null, img));
    return img;
  },
});

// ------------------------------------------------------------------ world outline + land test

const World = (() => {
  let countries = null, land = null;
  const load = () => {
    if (!countries) {
      countries = topojson.feature(WORLD_TOPO, WORLD_TOPO.objects.countries);
      land = topojson.feature(WORLD_TOPO, WORLD_TOPO.objects.land);
    }
  };
  function inRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // True if the point is on land at 1:50m detail (used to warn about AI placements in water).
  function onLand(lat, lng) {
    load();
    const polys = land.features.flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates));
    return polys.some((p) => inRing(lng, lat, p[0]) && !p.slice(1).some((hole) => inRing(lng, lat, hole)));
  }
  return { countries: () => (load(), countries), onLand };
})();

// ------------------------------------------------------------------ NATO-style symbols (simplified APP-6)

const SIDE_FRAME = {
  blue: { fill: "#80e0ff", shape: "rect" }, red: { fill: "#ff8080", shape: "diamond" },
  neutral: { fill: "#aaffaa", shape: "square" }, civil: { fill: "#e2b6ff", shape: "square" }, unknown: { fill: "#ffff80", shape: "circle" },
};
const ECHELON_MARK = { team: "Ø", squad: "•", section: "••", platoon: "•••", company: "I", battalion: "II", regiment: "III", brigade: "X", division: "XX" };
const TYPE_LABEL = {
  infantry: "Infantry", armour: "Armour", mechanized: "Mechanised infantry", artillery: "Artillery", reconnaissance: "Reconnaissance",
  engineer: "Engineers", headquarters: "Headquarters", logistics: "Logistics", medical: "Medical", air_defence: "Air defence",
  aviation: "Aviation", signals: "Signals", special_forces: "Special forces", militia: "Militia / irregular", naval: "Naval", civilian: "Civilian",
};

function unitSymbol(u, { ghost = false } = {}) {
  const f = SIDE_FRAME[u.side] || SIDE_FRAME.unknown;
  const box = { rect: [12, 30, 76, 46], diamond: [30, 30, 40, 40], square: [22, 22, 56, 56], circle: [26, 26, 48, 48] }[f.shape];
  const [bx, by, bw, bh] = box, cx = bx + bw / 2, cy = by + bh / 2;
  const frame = {
    rect: `<rect x="8" y="26" width="84" height="54"/>`,
    diamond: `<polygon points="50,4 96,50 50,96 4,50"/>`,
    square: `<rect x="16" y="16" width="68" height="68"/>`,
    circle: `<circle cx="50" cy="50" r="38"/>`,
  }[f.shape];
  const text = (t, s = 22) => `<text x="${cx}" y="${cy + s * 0.36}" font-size="${s}" text-anchor="middle" font-family="Roboto, sans-serif" font-weight="700" fill="#000" stroke="none">${t}</text>`;
  const X = `<path d="M${bx} ${by}L${bx + bw} ${by + bh}M${bx + bw} ${by}L${bx} ${by + bh}"/>`;
  const oval = `<ellipse cx="${cx}" cy="${cy}" rx="${bw * 0.34}" ry="${bh * 0.26}"/>`;
  const icon = {
    infantry: X, armour: oval, mechanized: X + oval,
    artillery: `<circle cx="${cx}" cy="${cy}" r="${Math.min(bw, bh) * 0.13}" fill="#000"/>`,
    reconnaissance: `<path d="M${bx} ${by + bh}L${bx + bw} ${by}"/>`,
    engineer: `<path d="M${cx - bw * 0.25} ${cy + bh * 0.15}v${-bh * 0.3}h${bw * 0.5}v${bh * 0.3}M${cx} ${cy - bh * 0.15}v${bh * 0.3}"/>`,
    headquarters: text("HQ", 20),
    logistics: `<path d="M${bx} ${by + bh * 0.72}H${bx + bw}"/>`,
    medical: `<path d="M${cx} ${cy - bh * 0.3}V${cy + bh * 0.3}M${cx - bh * 0.3} ${cy}H${cx + bh * 0.3}" stroke-width="5"/>`,
    air_defence: `<path d="M${bx} ${by + bh}Q${cx} ${by + bh * 0.3} ${bx + bw} ${by + bh}"/>`,
    aviation: `<path d="M${cx} ${cy}L${bx + bw * 0.12} ${cy - bh * 0.25}V${cy + bh * 0.25}Z M${cx} ${cy}L${bx + bw * 0.88} ${cy - bh * 0.25}V${cy + bh * 0.25}Z" fill="#000"/>`,
    signals: `<path d="M${bx} ${by}L${cx - 4} ${cy + 6}L${cx + 4} ${cy - 6}L${bx + bw} ${by + bh}"/>`,
    special_forces: text("SF"), militia: text("MIL", 17), naval: text("NAV", 17), civilian: text("CIV", 17),
  }[u.type] || "";
  const top = f.shape === "rect" ? 22 : f.shape === "diamond" ? 2 : f.shape === "square" ? 12 : 10;
  const ech = ECHELON_MARK[u.echelon] ? `<text x="50" y="${top}" font-size="15" text-anchor="middle" font-family="Roboto, sans-serif" font-weight="700" fill="#000" stroke="none">${ECHELON_MARK[u.echelon]}</text>` : "";
  const staff = u.type === "headquarters" && f.shape === "rect" ? `<path d="M8 80V104"/>` : "";
  const dead = u.status === "destroyed" ? `<path d="M4 4L96 96M96 4L4 96" stroke="#b00" stroke-width="6"/>` : "";
  return `<svg viewBox="0 -14 100 122" class="sym${ghost ? " ghost" : ""}" aria-hidden="true">
    <g fill="${f.fill}" stroke="#000" stroke-width="3.5" ${ghost ? 'stroke-dasharray="8 6" fill-opacity=".45"' : ""}>${frame}</g>
    <g fill="none" stroke="#000" stroke-width="3.5">${icon}${staff}</g>${ech}${dead}
    ${ghost ? `<text x="92" y="22" font-size="26" font-weight="700" fill="#000" stroke="none">?</text>` : ""}</svg>`;
}

// ------------------------------------------------------------------ world state helpers

const emptyWorld = () => ({ area: null, units: [], features: [], sides: { blue: { supply: 80, morale: 80 }, red: { supply: 80, morale: 80 } }, civil: 60, known: { blue: {}, red: {} } });
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)));
const newWorldId = (prefix) => `${prefix}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

function moveUnit(w, u, lat, lng, clock) {
  if (lat == null || lng == null || (u.lat === lat && u.lng === lng)) return;
  (u.trail ??= []).push({ lat: u.lat, lng: u.lng, clock });
  if (u.trail.length > 20) u.trail.shift();
  u.lat = +(+lat).toFixed(5);
  u.lng = +(+lng).toFixed(5);
}

// Record what a side has seen: the unit's current position at the current exercise time.
function detect(w, side, u, confidence, clock) {
  w.known ??= { blue: {}, red: {} };
  (w.known[side] ??= {})[u.id] = { lat: u.lat, lng: u.lng, clock, confidence, at: new Date().toISOString() };
}

function applyWorldChanges(x, wc) {
  const w = x.world ??= emptyWorld();
  const lines = [];
  for (const up of wc.unit_updates || []) {
    const u = w.units.find((v) => v.id === up.unit_id);
    if (!u) continue;
    const bits = [];
    if (up.lat != null && up.lng != null) { moveUnit(w, u, up.lat, up.lng, x.clock_min); bits.push("moved"); }
    if (up.strength_change) { u.strength = clamp(u.strength + up.strength_change); bits.push(`strength ${up.strength_change > 0 ? "+" : ""}${up.strength_change}% → ${u.strength}%`); }
    if (up.status) { u.status = up.status; bits.push(up.status.replace(/_/g, " ")); }
    if (up.task) { u.task = up.task; bits.push(`task: ${up.task}`); }
    if (bits.length) lines.push(`${u.name}: ${bits.join(", ")}`);
  }
  for (const d of wc.detections || []) {
    const u = w.units.find((v) => v.id === d.unit_id);
    if (u) { detect(w, d.observer_side, u, d.confidence, x.clock_min); lines.push(`${d.observer_side.toUpperCase()} detects ${u.name} (${d.confidence})`); }
  }
  for (const sc of wc.side_changes || []) {
    const s = w.sides[sc.side] ??= { supply: 80, morale: 80 };
    s.supply = clamp(s.supply + (sc.supply_change || 0));
    s.morale = clamp(s.morale + (sc.morale_change || 0));
    if (sc.supply_change || sc.morale_change) lines.push(`${sc.side.toUpperCase()} supply ${s.supply}%, morale ${s.morale}%`);
  }
  if (wc.civil_stability_change) { w.civil = clamp((w.civil ?? 60) + wc.civil_stability_change); lines.push(`Civil stability ${w.civil}%`); }
  return lines;
}

// What a cell may see: its own units, neutral/civil units, features for its side, and the last known
// position of enemy units it has detected (as "ghosts"). RED also gets the RED plan.
function cellWorld(ex, cell) {
  const w = ex.world;
  if (!w) return null;
  return { ...fogView(w, cell, { trails: false }), ...(cell === "red" && ex.redPlan ? { plan: ex.redPlan } : {}) };
}

// One side's picture of a world: own units, neutral/civil, its features, and "ghosts" where it last saw the enemy.
function fogView(w, cell, { trails = true } = {}) {
  const other = cell === "blue" ? "red" : "blue";
  const known = w.known?.[cell] || {};
  const ghosts = Object.entries(known).map(([id, k]) => {
    const u = w.units.find((v) => v.id === id && v.side === other);
    return u ? { id: u.id, name: u.name, side: u.side, type: u.type, echelon: u.echelon, lat: k.lat, lng: k.lng, ghost: true, seen: k.clock, confidence: k.confidence } : null;
  }).filter(Boolean);
  return {
    area: w.area,
    units: [...w.units.filter((u) => u.side === cell || u.side === "neutral" || u.side === "civil").map(({ trail, ...u }) => (trails ? { ...u, trail } : u)), ...ghosts],
    features: (w.features || []).filter((f) => f.side === cell || f.side === "neutral"),
    sides: { [cell]: w.sides?.[cell] },
  };
}

// ------------------------------------------------------------------ history for the AAR replay
// Every change to the map appends a compact snapshot to ex.worldHistory (append-only, so it merges cleanly
// in GitLab mode). The AAR replay steps through these.

function worldCore(w) {
  return {
    units: (w.units || []).map(({ id, name, side, type, echelon, lat, lng, strength, status }) => ({ id, name, side, type, echelon, lat, lng, strength, status })),
    features: w.features || [], known: w.known || { blue: {}, red: {} }, sides: w.sides, civil: w.civil,
  };
}

// Snapshots store only what changed since the previous one (the first is complete), keeping the history small
// enough for browser storage on long exercises. replaySnaps() rebuilds the full picture for each step.
function recordSnapshot(x, before) {
  const cur = clone(worldCore(x.world)), h = (x.worldHistory ??= []);
  const base = { at: nowIso(), clock: x.clock_min };
  if (!h.length || !before) { h.push({ ...base, full: true, ...cur }); return; }
  const prev = new Map(before.units.map((u) => [u.id, JSON.stringify(u)]));
  const snap = { ...base, units: cur.units.filter((u) => prev.get(u.id) !== JSON.stringify(u)), gone: before.units.map((u) => u.id).filter((id) => !cur.units.some((u) => u.id === id)) };
  for (const k of ["features", "known", "sides", "civil"]) if (JSON.stringify(cur[k]) !== JSON.stringify(before[k])) snap[k] = cur[k];
  h.push(snap);
}

const replayCache = { key: "", snaps: [] };
function expandHistory(h) {
  const out = [];
  let st = null;
  for (const d of h) {
    if (d.full || !st) st = { units: clone(d.units || []), features: clone(d.features || []), known: clone(d.known || {}), sides: clone(d.sides), civil: d.civil };
    else {
      const byId = new Map(st.units.map((u) => [u.id, u]));
      for (const u of d.units || []) byId.set(u.id, clone(u));
      for (const id of d.gone || []) byId.delete(id);
      st = { ...st, units: [...byId.values()] };
      for (const k of ["features", "known", "sides", "civil"]) if (k in d) st[k] = clone(d[k]);
    }
    out.push({ at: d.at, clock: d.clock, ...st });
  }
  return out;
}

// ------------------------------------------------------------------ map views

const MapState = { source: Store.read("exforge.mapsource") || "world", views: {}, packs: [], providers: new Map(), mode: "select", selected: null, lineDraft: null, areaDraft: null, redProposal: null };

async function refreshPacks() {
  try { MapState.packs = await MapDB.packs(); } catch { MapState.packs = []; }
  const s = Settings.get();
  if (s.mapPackUrl) MapState.packs.push({ id: "url", name: `Served map (${s.mapPackUrl.split("/").pop()})`, type: "pmtiles-url", url: s.mapPackUrl });
  if (s.mapTileUrl) MapState.packs.push({ id: "server", name: "Tile server", type: "server", url: s.mapTileUrl });
  return MapState.packs;
}

async function providerFor(id) {
  if (MapState.providers.has(id)) return MapState.providers.get(id);
  const p = MapState.packs.find((x) => x.id === id);
  if (!p) return null;
  let prov;
  if (p.type === "pmtiles") prov = await pmtilesProvider(new pmtiles.FileSource(p.file), p.name);
  else if (p.type === "pmtiles-url") prov = await pmtilesProvider(p.url, p.name);
  else if (p.type === "mbtiles") prov = await mbtilesProvider(p.file, p.name);
  else if (p.type === "server") prov = serverProvider(p.url, Settings.get().mapTileKeep !== false);
  MapState.providers.set(id, prov);
  return prov;
}

function makeView(el) {
  const map = L.map(el, { worldCopyJump: true, zoomSnap: 0.5, attributionControl: true, minZoom: 2 }).setView([50, 10], 4);
  map.attributionControl.setPrefix("");
  L.control.scale({ imperial: false }).addTo(map);
  const v = {
    map,
    outline: L.geoJSON(World.countries(), { style: () => ({ className: "map-land" }), interactive: false }).addTo(map),
    base: null, baseId: null,
    area: L.layerGroup().addTo(map), features: L.layerGroup().addTo(map), trails: L.layerGroup().addTo(map),
    units: L.layerGroup().addTo(map), proposals: L.layerGroup().addTo(map), draft: L.layerGroup().addTo(map),
    key: "", fitted: null,
  };
  map.attributionControl.addAttribution("Outline: Natural Earth");
  return v;
}

async function setBasemap(v, id) {
  if (v.baseId === id) return;
  if (v.base) { v.map.removeLayer(v.base); v.base = null; }
  v.baseId = id;
  if (id === "world") return;
  try {
    const prov = await providerFor(id);
    if (!prov || v.baseId !== id) return;
    v.base = prov.vector
      ? new VectorTileLayer(prov, { minZoom: prov.minZoom, maxZoom: 20, bounds: prov.bounds || undefined, className: "map-tiles map-vector" })
      : new BlobTileLayer(prov, { minZoom: 0, maxNativeZoom: prov.maxZoom, maxZoom: 20, bounds: prov.bounds || undefined, className: "map-tiles" });
    v.base.addTo(v.map);
    v.base.bringToFront();
    v.outline.bringToBack();
  } catch (e) {
    toast(`Map could not be opened: ${e.message}`);
    v.baseId = "world";
  }
}

const featureIcon = { objective: "flag", checkpoint: "where_to_vote", observation_post: "visibility", supply_point: "inventory_2", town: "location_city", area: "select_all", phase_line: "timeline", boundary: "border_style" };

function drawWorld(v, w, { editable = false, ghostOk = true } = {}) {
  const key = JSON.stringify([w, editable, MapState.selected, MapState.redProposal?.key]);
  if (key === v.key) return;
  v.key = key;
  for (const l of [v.area, v.features, v.trails, v.units, v.proposals]) l.clearLayers();
  if (!w) return;
  if (w.area) {
    L.rectangle([[w.area.south, w.area.west], [w.area.north, w.area.east]], { className: "map-area", interactive: false }).addTo(v.area);
    if (v.fitted !== JSON.stringify(w.area)) { v.fitted = JSON.stringify(w.area); v.map.fitBounds([[w.area.south, w.area.west], [w.area.north, w.area.east]], { padding: [20, 20] }); }
  }
  for (const f of w.features || []) {
    const ll = f.coords.map((c) => [c.lat, c.lng]);
    const cls = `map-feature ${f.side} ${MapState.selected === f.id ? "sel" : ""}`;
    let layer;
    if (ll.length === 1) {
      layer = L.marker(ll[0], { icon: L.divIcon({ className: "", html: `<div class="${cls} pt">${icon(featureIcon[f.kind] || "place")}<span>${esc(f.name)}</span></div>`, iconSize: [0, 0] }) });
    } else if (f.kind === "area" && ll.length > 2) {
      layer = L.polygon(ll, { className: cls });
    } else {
      layer = L.polyline(ll, { className: `${cls} ${f.kind}` });
      layer.bindTooltip(esc(f.name), { permanent: true, direction: "center", className: "map-line-label" });
    }
    if (editable) layer.on("click", (e) => { L.DomEvent.stopPropagation(e); selectItem(f.id); });
    layer.addTo(v.features);
  }
  for (const u of w.units || []) {
    if (u.trail?.length) L.polyline([...u.trail.map((t) => [t.lat, t.lng]), [u.lat, u.lng]], { className: `map-trail ${u.side}`, interactive: false }).addTo(v.trails);
    if (u.ghost && !ghostOk) continue;
    const html = `<div class="unit-mk ${MapState.selected === u.id ? "sel" : ""} ${u.status || ""}">${unitSymbol(u, { ghost: u.ghost })}
      ${u.ghost ? "" : `<div class="sbar"><i style="width:${clamp(u.strength ?? 100)}%"></i></div>`}
      <div class="ulabel">${esc(u.name)}${u.ghost ? ` · seen ${u.seen != null ? fmtT(u.seen) : ""}` : ""}</div></div>`;
    const m = L.marker([u.lat, u.lng], { icon: L.divIcon({ className: "", html, iconSize: [44, 54], iconAnchor: [22, 27] }), draggable: editable && !u.ghost, riseOnHover: true, title: `${u.name} — ${TYPE_LABEL[u.type] || u.type}` });
    if (editable) {
      m.on("click", () => selectItem(u.id));
      m.on("dragend", () => { const p = m.getLatLng(); mutate((x) => { const t = x.world.units.find((z) => z.id === u.id); if (t) { moveUnit(x.world, t, p.lat, p.lng, x.clock_min); Ex.log(x, "system", "EXCON", `Moved ${t.name}`); } }); });
    }
    m.addTo(v.units);
  }
  const prop = MapState.redProposal;
  if (prop && editable) {
    for (const o of prop.orders) {
      const u = w.units.find((z) => z.id === o.unit_id);
      if (!u || o.lat == null || o.lng == null) continue;
      L.polyline([[u.lat, u.lng], [o.lat, o.lng]], { className: `map-order ${o.accept ? "on" : "off"}`, interactive: false }).addTo(v.proposals);
      L.circleMarker([o.lat, o.lng], { radius: 5, className: `map-order-end ${o.accept ? "on" : "off"}`, interactive: false }).addTo(v.proposals);
    }
  }
}

// ------------------------------------------------------------------ EXCON / observer map tab

function worldOf() { return state.ex?.world || null; }
const canEdit = () => state.view === "excon" && !!state.ex;

function renderMapTab() {
  if (!state.ex || state.tab !== "map") return;
  const el = $("#exMap");
  const v = (MapState.views.ex ??= makeView(el));
  v.map.invalidateSize();
  setBasemap(v, MapState.source);
  drawWorld(v, worldOf(), { editable: canEdit() });
  renderMapSide();
}

function renderCellMap() {
  if (!(state.view === "blue" || state.view === "red") || state.ctab !== "map") return;
  const f = currentFeed();
  const v = (MapState.views.cell ??= makeView($("#cellMap")));
  v.map.invalidateSize();
  setBasemap(v, MapState.source);
  drawWorld(v, f?.world || null, { editable: false });
  const w = f?.world;
  $("#cellMapSide").innerHTML = !w ? `<div class="card">${empty("map", "No map yet.<br><span class='body-medium'>EXCON hasn't placed forces.</span>")}</div>` : `
    ${sourcePicker()}
    <div class="card"><h3 class="title-small">Your forces</h3>
      ${w.units.filter((u) => u.side === f.cell).map(unitRow).join("") || `<div class="body-small variant">None</div>`}</div>
    <div class="card"><h3 class="title-small">Enemy — last known</h3>
      ${w.units.filter((u) => u.ghost).map((u) => unitRow(u)).join("") || `<div class="body-small variant">Nothing detected yet.</div>`}</div>
    ${w.plan ? `<div class="card"><h3 class="title-small">RED plan</h3>${redPlanHtml(w.plan)}</div>` : ""}
    ${sideBars(w)}`;
}

const sideBars = (w) => `<div class="card"><h3 class="title-small">Condition</h3>
  ${["blue", "red"].filter((s) => w.sides?.[s]).map((s) => `
    <div class="bar-row"><span class="cell-badge sm ${s}">${s.toUpperCase()}</span><span class="body-small">Supply</span><span class="bar"><i style="width:${w.sides[s].supply}%"></i></span><span class="mono body-small">${w.sides[s].supply}%</span></div>
    <div class="bar-row"><span></span><span class="body-small">Morale</span><span class="bar"><i style="width:${w.sides[s].morale}%"></i></span><span class="mono body-small">${w.sides[s].morale}%</span></div>`).join("")}
  ${w.civil != null ? `<div class="bar-row"><span class="cell-badge sm observer">CIV</span><span class="body-small">Stability</span><span class="bar"><i style="width:${w.civil}%"></i></span><span class="mono body-small">${w.civil}%</span></div>` : ""}</div>`;

function unitRow(u) {
  return `<button type="button" class="unit-row ${MapState.selected === u.id ? "active" : ""}" data-unit="${esc(u.id)}">
    <span class="mini-sym">${unitSymbol(u, { ghost: u.ghost })}</span>
    <span class="text"><strong>${esc(u.name)}</strong><small>${esc(TYPE_LABEL[u.type] || u.type)} · ${esc(u.echelon)}${u.ghost ? ` · seen ${u.seen != null ? fmtT(u.seen) : ""} (${esc(u.confidence)})` : ` · ${u.strength}% · ${esc(String(u.status || "active").replace(/_/g, " "))}`}</small></span></button>`;
}

function sourcePicker() {
  return `<div class="card"><div class="row between"><h3 class="title-small">Map</h3>
      <button type="button" class="btn sm text" data-map-sources>${icon("layers")}Offline maps</button></div>
    <div class="field select"><select data-map-source>${[["world", "World outline (built in)"], ...MapState.packs.map((p) => [p.id, p.name])]
      .map(([id, n]) => `<option value="${esc(id)}" ${MapState.source === id ? "selected" : ""}>${esc(n)}</option>`).join("")}</select><label>Base map</label></div></div>`;
}

const redPlanHtml = (p) => `
  <div class="body-medium">${esc(p.intent || "No intent set.")}</div>
  ${(p.objectives || []).length ? `<ul class="bullets body-small">${p.objectives.map((o) => `<li><span class="tag ${o.priority === "high" ? "hostile" : o.priority === "medium" ? "neutral" : ""}">${esc(o.priority)}</span> ${esc(o.text)}</li>`).join("")}</ul>` : ""}
  ${(p.constraints || []).length ? `<div class="body-small variant"><strong>Constraints:</strong> ${p.constraints.map(esc).join("; ")}</div>` : ""}
  ${p.posture ? `<div class="body-small variant"><strong>Posture:</strong> ${esc(p.posture)}</div>` : ""}`;

function renderMapSide() {
  const ex = state.ex, w = ex.world, edit = canEdit(), side = $("#mapSide");
  const sel = w && (w.units.find((u) => u.id === MapState.selected) || w.features?.find((f) => f.id === MapState.selected));
  const warnings = w ? w.units.filter((u) => !["naval", "aviation"].includes(u.type) && !World.onLand(u.lat, u.lng)) : [];
  const tools = edit ? `<div class="card"><h3 class="title-small">Tools</h3>
      <div class="segmented tools">${[["select", "arrow_selector_tool", "Select"], ["unit", "add_location_alt", "Unit"], ["point", "flag", "Point"], ["line", "polyline", "Line"], ["area", "crop_free", "Area"]]
        .map(([m, ic, t]) => `<button type="button" class="seg-btn ${MapState.mode === m ? "active" : ""}" data-map-mode="${m}" title="${t}">${icon(ic)}<span>${t}</span></button>`).join("")}</div>
      <div class="body-small variant" id="mapHint">${{ select: "Click a unit or feature to edit it. Drag units to move them.", unit: "Click the map to place a new unit.", point: "Click the map to place an objective or point.", line: "Click to add points; double-click or press Finish to end the line.", area: "Click two opposite corners of the exercise area." }[MapState.mode]}</div>
      ${MapState.mode === "line" && MapState.lineDraft?.length ? `<div class="actions"><button type="button" class="btn sm filled" data-line-finish>${icon("check")}Finish line</button><button type="button" class="btn sm text" data-line-cancel>Cancel</button></div>` : ""}
      ${MapState.mode === "area" ? `<button type="button" class="btn sm text" data-area-view>${icon("fit_screen")}Use the current view</button>` : ""}
    </div>` : "";

  const setup = edit && (!w?.area || !w.units.length) ? `<div class="card accent"><h3 class="title-small">${icon("auto_awesome")}Set up the map</h3>
      <ol class="body-small steps"><li class="${w?.area ? "done" : ""}">Set the exercise area: choose <strong>Area</strong> and click two corners, or zoom to it and use the current view.</li>
      <li>Let the AI place both sides' forces on the real terrain, then drag anything that looks wrong.</li></ol>
      ${w?.area ? `<div class="field"><textarea id="forcesGuide" rows="2" placeholder="e.g. BLUE holds the west bank; RED mechanised company east of the river"></textarea><label for="forcesGuide">Guidance (optional)</label></div>
      <div class="actions"><button type="button" class="btn filled" data-gen-forces>${icon("auto_awesome")}Place forces with AI</button></div>
      <span id="forcesBusy" class="progress hidden"><span class="linear"></span><span class="body-small">Placing forces…</span></span>` : ""}
    </div>` : "";

  const editor = !sel ? "" : sel.coords ? `<div class="card"><div class="row between"><h3 class="title-small">${icon(featureIcon[sel.kind] || "place")}Feature</h3>
        ${edit ? `<button type="button" class="icon-btn danger" data-del-item aria-label="Delete">${icon("delete")}</button>` : ""}</div>
      ${edit ? `<div class="field"><input data-edit="name" value="${esc(sel.name)}" placeholder=" "><label>Name</label></div>
      <div class="grid-2"><div class="field select"><select data-edit="kind">${Schemas.FEATURE_KINDS.map((k) => `<option value="${k}" ${sel.kind === k ? "selected" : ""}>${k.replace(/_/g, " ")}</option>`).join("")}</select><label>Kind</label></div>
      <div class="field select"><select data-edit="side">${["blue", "red", "neutral"].map((k) => `<option value="${k}" ${sel.side === k ? "selected" : ""}>${k.toUpperCase()}</option>`).join("")}</select><label>Visible to</label></div></div>`
        : `<div class="body-medium"><strong>${esc(sel.name)}</strong> · ${esc(sel.kind.replace(/_/g, " "))}</div>`}</div>`
    : `<div class="card"><div class="row between"><h3 class="title-small row"><span class="mini-sym">${unitSymbol(sel)}</span>${esc(sel.name)}</h3>
        ${edit ? `<button type="button" class="icon-btn danger" data-del-item aria-label="Delete">${icon("delete")}</button>` : ""}</div>
      ${edit ? `<div class="field"><input data-edit="name" value="${esc(sel.name)}" placeholder=" "><label>Name</label></div>
      <div class="grid-2">
        <div class="field select"><select data-edit="side">${["blue", "red", "neutral", "civil"].map((k) => `<option value="${k}" ${sel.side === k ? "selected" : ""}>${k.toUpperCase()}</option>`).join("")}</select><label>Side</label></div>
        <div class="field select"><select data-edit="echelon">${Schemas.ECHELONS.map((k) => `<option value="${k}" ${sel.echelon === k ? "selected" : ""}>${k}</option>`).join("")}</select><label>Echelon</label></div>
        <div class="field select"><select data-edit="type">${Schemas.UNIT_TYPES.map((k) => `<option value="${k}" ${sel.type === k ? "selected" : ""}>${TYPE_LABEL[k]}</option>`).join("")}</select><label>Type</label></div>
        <div class="field select"><select data-edit="status">${Schemas.STATUS.map((k) => `<option value="${k}" ${(sel.status || "active") === k ? "selected" : ""}>${k.replace(/_/g, " ")}</option>`).join("")}</select><label>Status</label></div>
      </div>
      <label class="range"><span class="body-small">Strength <strong>${sel.strength}%</strong></span><input type="range" min="0" max="100" step="5" value="${sel.strength}" data-edit="strength"></label>
      <div class="field"><input data-edit="task" value="${esc(sel.task || "")}" placeholder=" "><label>Task</label></div>
      ${sel.side === "blue" || sel.side === "red" ? (() => { const other = sel.side === "blue" ? "red" : "blue", k = w.known?.[other]?.[sel.id];
        return `<div class="row between"><span class="body-small variant">${k ? `${other.toUpperCase()} last saw it at ${fmtT(k.clock ?? 0)} (${esc(k.confidence)})` : `Not detected by ${other.toUpperCase()}`}</span>
          <button type="button" class="btn sm ${k ? "text" : "tonal"}" data-reveal="${other}">${icon(k ? "visibility_off" : "visibility")}${k ? "Hide" : `Reveal to ${other.toUpperCase()}`}</button></div>`; })() : ""}`
        : `<div class="body-small variant">${esc(TYPE_LABEL[sel.type])} · ${esc(sel.echelon)} · ${sel.strength}% · ${esc(sel.status || "active")}${sel.task ? ` · ${esc(sel.task)}` : ""}</div>`}
    </div>`;

  const red = `<div class="card"><div class="row between"><h3 class="title-small row"><span class="cell-badge sm red">RED</span>Opposing force</h3>
      ${edit ? `<button type="button" class="btn sm text" data-red-plan>${icon("edit")}${ex.redPlan ? "Edit plan" : "Set plan"}</button>` : ""}</div>
    ${ex.redPlan ? redPlanHtml(ex.redPlan) : `<div class="body-small variant">No RED plan yet. EXCON sets RED's intent, objectives, constraints and posture; the RED AI follows it.</div>`}
    ${edit && w?.units.some((u) => u.side === "red") ? `<div class="actions"><button type="button" class="btn sm filled" data-red-turn ${ex.redPlan ? "" : "disabled"}>${icon("smart_toy")}Run RED turn</button>
      <span id="redBusy" class="progress hidden"><span class="linear"></span><span class="body-small">RED is planning…</span></span></div>` : ""}
    ${MapState.redProposal && edit ? redProposalHtml(MapState.redProposal, w) : ""}</div>`;

  side.innerHTML = `
    ${sourcePicker()}
    ${tools}${setup}
    ${warnings.length ? `<div class="note warn">${icon("water")}<span class="body-small">Possibly in water: ${warnings.map((u) => esc(u.name)).join(", ")}. Drag them onto land.</span></div>` : ""}
    ${editor}
    ${w ? red : ""}
    ${w ? sideBars(w) : ""}
    ${w?.units.length ? `<div class="card"><h3 class="title-small">Units (${w.units.length})</h3>${w.units.map(unitRow).join("")}</div>` : ""}`;
}

function redProposalHtml(p, w) {
  const name = (id) => w.units.find((u) => u.id === id)?.name || id;
  return `<div class="red-proposal">
    <div class="body-small"><strong>RED assessment:</strong> ${esc(p.assessment)}</div>
    ${p.orders.map((o, i) => `<label class="order-row"><input type="checkbox" data-order="${i}" ${o.accept ? "checked" : ""}>
      <span><strong>${esc(name(o.unit_id))}</strong> — ${esc(o.action)}${o.target_unit_id ? ` ${esc(name(o.target_unit_id))}` : ""}${o.lat != null ? ` (arrow on map${(() => { const u = w.units.find((x) => x.id === o.unit_id); return u && typeof Rules !== "undefined" ? `: ${esc(Rules.moveText(Rules.moveInfo(state.ex, u, o.lat, o.lng)))}` : ""; })()})` : ""}<br><span class="variant">${esc(o.rationale)}</span></span></label>`).join("")}
    ${p.suggested_injects.map((s, i) => `<label class="order-row"><input type="checkbox" data-sinj="${i}" ${s.accept ? "checked" : ""}>
      <span>${icon("playlist_add")} Add inject: <strong>${esc(s.title)}</strong><br><span class="variant">${esc(s.description)}</span></span></label>`).join("")}
    <div class="actions"><button type="button" class="btn sm filled" data-red-apply>${icon("check")}Apply selected</button><button type="button" class="btn sm text" data-red-discard>Discard</button></div>
  </div>`;
}

function selectItem(id) {
  MapState.selected = MapState.selected === id ? null : id;
  if (state.tab === "map") renderMapTab(); else renderCellMap();
}

// ---- map clicks by tool
function onMapClick(e) {
  if (!canEdit()) return;
  const { lat, lng } = e.latlng, mode = MapState.mode;
  if (mode === "unit") {
    const id = newWorldId("U");
    mutate((x) => { const w = x.world ??= emptyWorld(); w.units.push({ id, name: "New unit", side: "blue", type: "infantry", echelon: "company", lat: +lat.toFixed(5), lng: +lng.toFixed(5), strength: 100, status: "active", task: "" }); });
    MapState.selected = id; MapState.mode = "select";
  } else if (mode === "point") {
    const id = newWorldId("F");
    mutate((x) => { (x.world ??= emptyWorld()).features.push({ id, kind: "objective", name: "New objective", side: "blue", coords: [{ lat: +lat.toFixed(5), lng: +lng.toFixed(5) }] }); });
    MapState.selected = id; MapState.mode = "select";
  } else if (mode === "line") {
    (MapState.lineDraft ??= []).push({ lat: +lat.toFixed(5), lng: +lng.toFixed(5) });
    drawDraft();
  } else if (mode === "area") {
    if (!MapState.areaDraft) { MapState.areaDraft = e.latlng; drawDraft(); return; }
    const a = MapState.areaDraft;
    setArea({ south: Math.min(a.lat, lat), north: Math.max(a.lat, lat), west: Math.min(a.lng, lng), east: Math.max(a.lng, lng) });
  } else return;
  renderMapTab();
}

function drawDraft() {
  const v = MapState.views.ex;
  v.draft.clearLayers();
  if (MapState.lineDraft?.length) L.polyline(MapState.lineDraft.map((c) => [c.lat, c.lng]), { className: "map-draft", interactive: false }).addTo(v.draft);
  if (MapState.areaDraft) L.circleMarker(MapState.areaDraft, { radius: 6, className: "map-draft", interactive: false }).addTo(v.draft);
  renderMapSide();
}

function finishLine() {
  const pts = MapState.lineDraft || [];
  MapState.lineDraft = null;
  MapState.views.ex?.draft.clearLayers();
  if (pts.length < 2) return renderMapTab();
  const id = newWorldId("F");
  mutate((x) => { (x.world ??= emptyWorld()).features.push({ id, kind: "phase_line", name: "New line", side: "blue", coords: pts }); });
  MapState.selected = id; MapState.mode = "select";
  renderMapTab();
}

function setArea(area) {
  const r = (n) => +n.toFixed(4);
  MapState.areaDraft = null;
  MapState.views.ex?.draft.clearLayers();
  mutate((x) => { (x.world ??= emptyWorld()).area = { south: r(area.south), west: r(area.west), north: r(area.north), east: r(area.east) }; Ex.log(x, "system", "EXCON", "Exercise area set on the map"); });
  MapState.mode = "select";
  renderMapTab();
}

// ---- side panel actions (EXCON + cell map)
document.addEventListener("change", async (ev) => {
  const t = ev.target;
  if (t.matches("[data-map-source]")) {
    MapState.source = t.value;
    Store.write("exforge.mapsource", t.value);
    for (const v of Object.values(MapState.views)) await setBasemap(v, t.value);
    return;
  }
  if (!t.closest("#mapSide")) return;
  const key = t.dataset.edit;
  if (key && MapState.selected) {
    const val = key === "strength" ? +t.value : t.value;
    mutate((x) => {
      const w = x.world, item = w.units.find((u) => u.id === MapState.selected) || w.features.find((f) => f.id === MapState.selected);
      if (item) item[key] = val;
    });
  }
  if (t.dataset.order !== undefined) MapState.redProposal.orders[+t.dataset.order].accept = t.checked;
  if (t.dataset.sinj !== undefined) MapState.redProposal.suggested_injects[+t.dataset.sinj].accept = t.checked;
  if (t.dataset.order !== undefined || t.dataset.sinj !== undefined) { MapState.redProposal.key = Math.random(); renderMapTab(); }
});

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-map-mode],[data-unit],[data-del-item],[data-reveal],[data-line-finish],[data-line-cancel],[data-area-view],[data-gen-forces],[data-red-plan],[data-red-turn],[data-red-apply],[data-red-discard],[data-map-sources]");
  if (!b) return;
  if (b.dataset.mapSources !== undefined) return openMapSources();
  if (b.dataset.unit) {
    MapState.selected = b.dataset.unit;
    const v = b.closest("#cellMapSide") ? MapState.views.cell : MapState.views.ex;
    const u = (b.closest("#cellMapSide") ? currentFeed()?.world : worldOf())?.units.find((x) => x.id === b.dataset.unit);
    if (u && v) v.map.panTo([u.lat, u.lng]);
    return b.closest("#cellMapSide") ? renderCellMap() : renderMapTab();
  }
  if (!canEdit()) return;
  if (b.dataset.mapMode) { MapState.mode = b.dataset.mapMode; MapState.lineDraft = null; MapState.areaDraft = null; MapState.views.ex?.draft.clearLayers(); return renderMapTab(); }
  if (b.dataset.lineFinish !== undefined) return finishLine();
  if (b.dataset.lineCancel !== undefined) { MapState.lineDraft = null; MapState.views.ex.draft.clearLayers(); return renderMapTab(); }
  if (b.dataset.areaView !== undefined) { const bb = MapState.views.ex.map.getBounds(); return setArea({ south: bb.getSouth(), north: bb.getNorth(), west: bb.getWest(), east: bb.getEast() }); }
  if (b.dataset.delItem !== undefined) {
    const id = MapState.selected;
    MapState.selected = null;
    return mutate((x) => { x.world.units = x.world.units.filter((u) => u.id !== id); x.world.features = x.world.features.filter((f) => f.id !== id); });
  }
  if (b.dataset.reveal) {
    const side = b.dataset.reveal, id = MapState.selected;
    return mutate((x) => {
      const u = x.world.units.find((z) => z.id === id);
      if (x.world.known?.[side]?.[id]) delete x.world.known[side][id];
      else if (u) { detect(x.world, side, u, "high", x.clock_min); Ex.log(x, "system", "EXCON", `${u.name} revealed to ${side.toUpperCase()}`); }
    });
  }
  if (b.dataset.genForces !== undefined) return generateForces(b);
  if (b.dataset.redPlan !== undefined) return openRedPlan();
  if (b.dataset.redTurn !== undefined) return runRedTurn(b);
  if (b.dataset.redApply !== undefined) return applyRedTurn();
  if (b.dataset.redDiscard !== undefined) { MapState.redProposal = null; return renderMapTab(); }
});

async function generateForces(btn) {
  const ex = state.ex, area = ex.world.area;
  if (ex.world.units.length && !confirm("Replace the units and features already on the map?")) return;
  const res = await busy($("#forcesBusy"), btn, () => LLM.forces(ex, area, $("#forcesGuide")?.value.trim() || ""));
  if (!res) return;
  mutate((x) => {
    const w = x.world;
    w.units = res.units.map((u) => ({ ...u, strength: clamp(u.strength), status: "active" }));
    w.features = res.features;
    w.sides = { blue: { supply: clamp(res.sides.blue.supply), morale: clamp(res.sides.blue.morale) }, red: { supply: clamp(res.sides.red.supply), morale: clamp(res.sides.red.morale) } };
    w.civil = clamp(res.civil_stability);
    w.known = { blue: {}, red: {} };
    Ex.log(x, "system", "EXCON", `Forces placed on the map by ${LLM.label()}: ${w.units.length} units, ${w.features.length} features. ${res.notes || ""}`.trim());
  });
  toast("Forces placed. Check them and drag anything that looks wrong.", true);
}

async function runRedTurn(btn) {
  const res = await busy($("#redBusy"), btn, () => LLM.redTurn(state.ex));
  if (!res) return;
  MapState.redProposal = { ...res, key: Math.random(), orders: res.orders.map((o) => ({ ...o, accept: true })), suggested_injects: res.suggested_injects.map((s) => ({ ...s, accept: false })) };
  renderMapTab();
}

function applyRedTurn() {
  const p = MapState.redProposal;
  MapState.redProposal = null;
  const orders = p.orders.filter((o) => o.accept), injs = p.suggested_injects.filter((s) => s.accept);
  mutate((x) => {
    const w = x.world, lines = [];
    for (const o of orders) {
      const u = w.units.find((z) => z.id === o.unit_id && z.side === "red");
      if (!u) continue;
      if (o.lat != null && o.lng != null) moveUnit(w, u, o.lat, o.lng, x.clock_min);
      u.task = `${o.action}${o.target_unit_id ? ` ${w.units.find((z) => z.id === o.target_unit_id)?.name || ""}` : ""}`.trim();
      u.status = { move: "moving", attack: "engaged", defend: "defending", withdraw: "withdrawn" }[o.action] || u.status || "active";
      lines.push(`${u.name}: ${o.action} — ${o.rationale}`);
    }
    if (lines.length) Ex.log(x, "red", "RED (AI, approved by EXCON)", `RED orders at T+${x.clock_min}: ${lines.join(" | ")}`, { redOrders: true });
  });
  for (const s of injs) addInject({ ...s, cell: "blue" });
  toast(`${orders.length} RED order${orders.length === 1 ? "" : "s"} applied${injs.length ? `, ${injs.length} inject${injs.length === 1 ? "" : "s"} added` : ""}. Adjudicate any contact.`, true);
}

// ---- RED plan dialog
function openRedPlan() {
  const p = state.ex.redPlan || {}, f = $("#redPlanForm");
  f.elements.intent.value = p.intent || "";
  f.elements.constraints.value = (p.constraints || []).join("\n");
  f.elements.posture.value = p.posture || "balanced";
  renderPlanObjectives(p.objectives?.length ? p.objectives : [{ text: "", priority: "high" }]);
  $("#redPlanDlg").showModal();
}
function renderPlanObjectives(list) {
  $("#planObjectives").innerHTML = list.map((o, i) => `<div class="plan-obj">
    <div class="field"><input data-po-text value="${esc(o.text)}" placeholder=" " id="po${i}"><label for="po${i}">Objective ${i + 1}</label></div>
    <div class="field select"><select data-po-pri>${["high", "medium", "low"].map((k) => `<option ${o.priority === k ? "selected" : ""}>${k}</option>`).join("")}</select><label>Priority</label></div>
    <button type="button" class="icon-btn" data-po-rm="${i}" aria-label="Remove">${icon("close")}</button></div>`).join("");
}
const readPlanObjectives = () => $$("#planObjectives .plan-obj").map((r) => ({ text: r.querySelector("[data-po-text]").value.trim(), priority: r.querySelector("[data-po-pri]").value }));
$("#planAddObj").addEventListener("click", () => renderPlanObjectives([...readPlanObjectives(), { text: "", priority: "medium" }]));
$("#planObjectives").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-po-rm]");
  if (b) { const l = readPlanObjectives(); l.splice(+b.dataset.poRm, 1); renderPlanObjectives(l); }
});
$("#planDraft").addEventListener("click", async (ev) => {
  const p = await busy($("#planBusy"), ev.currentTarget, () => LLM.redPlan(state.ex));
  if (!p) return;
  const f = $("#redPlanForm");
  f.elements.intent.value = p.intent;
  f.elements.constraints.value = p.constraints.join("\n");
  f.elements.posture.value = p.posture;
  renderPlanObjectives(p.objectives);
});
$("#redPlanForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const f = ev.target, send = ev.submitter?.dataset.send !== undefined;
  const plan = {
    intent: f.elements.intent.value.trim(), objectives: readPlanObjectives().filter((o) => o.text),
    constraints: f.elements.constraints.value.split("\n").map((s) => s.trim()).filter(Boolean), posture: f.elements.posture.value,
  };
  $("#redPlanDlg").close();
  mutate((x) => { x.redPlan = plan; Ex.log(x, "system", "EXCON", "RED plan updated"); });
  if (send) {
    sendToCell("red", "EXCON", `RED PLAN\nIntent: ${plan.intent}\nObjectives:\n${plan.objectives.map((o) => `• [${o.priority}] ${o.text}`).join("\n")}\nConstraints:\n${plan.constraints.map((c) => `• ${c}`).join("\n")}\nPosture: ${plan.posture}`);
    toast("RED plan saved and sent to the RED cell", true);
  } else toast("RED plan saved", true);
});

// ---- offline map sources dialog
async function openMapSources() {
  await refreshPacks();
  const s = Settings.get();
  $("#mapUrl").value = s.mapTileUrl || "";
  $("#mapKeep").checked = s.mapTileKeep !== false;
  $("#mapPackUrl").value = s.mapPackUrl || "";
  await renderPackList();
  $("#mapDlg").showModal();
}

async function renderPackList() {
  const packs = MapState.packs.filter((p) => p.type === "pmtiles" || p.type === "mbtiles");
  let cached = 0;
  try { cached = await MapDB.tileCount(); } catch { /* storage blocked */ }
  $("#packList").innerHTML = (packs.map((p) => `<div class="member-row">
      <div class="avatar c1" style="width:36px;height:36px">${icon("map")}</div>
      <div class="text"><strong>${esc(p.name)}</strong><small>${p.type.toUpperCase()} · ${p.vector ? "vector" : "raster"} · ${(p.size / 1048576).toFixed(1)} MB · zoom ${p.minZoom}–${p.maxZoom}</small></div>
      <button type="button" class="icon-btn danger" data-pack-del="${esc(p.id)}" aria-label="Remove">${icon("delete")}</button></div>`).join("")
    || `<div class="body-small variant">No offline map files yet.</div>`)
    + `<div class="body-small variant" style="margin-top:8px">${cached} tile-server tiles kept for offline use${cached ? ` · <button type="button" class="btn sm text" data-tiles-clear>Clear</button>` : ""}</div>`;
}

$("#packFile").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  const type = /\.pmtiles$/i.test(file.name) ? "pmtiles" : /\.mbtiles$/i.test(file.name) ? "mbtiles" : null;
  if (!type) return mapDlgError("Choose a .pmtiles or .mbtiles file.");
  $("#packBusy").classList.remove("hidden");
  try {
    const prov = type === "pmtiles" ? await pmtilesProvider(new pmtiles.FileSource(file), file.name) : await mbtilesProvider(file, file.name);
    const pack = { id: `pack-${Date.now().toString(36)}`, name: file.name.replace(/\.(pm|mb)tiles$/i, ""), type, vector: !!prov.vector, file, size: file.size, minZoom: prov.minZoom, maxZoom: prov.maxZoom, bounds: prov.bounds, added: new Date().toISOString() };
    await MapDB.putPack(pack);
    await refreshPacks();
    MapState.source = pack.id;
    Store.write("exforge.mapsource", pack.id);
    await renderPackList();
    mapDlgError("");
    toast(`${pack.name} added and selected`, true);
    for (const v of Object.values(MapState.views)) { await setBasemap(v, pack.id); if (pack.bounds) v.map.fitBounds(pack.bounds); }
  } catch (e) { mapDlgError(e.message); }
  finally { $("#packBusy").classList.add("hidden"); }
});

function mapDlgError(msg) {
  const el = $("#mapDlgError");
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

$("#mapDlg").addEventListener("click", async (ev) => {
  const del = ev.target.closest("[data-pack-del]"), clear = ev.target.closest("[data-tiles-clear]");
  if (del) {
    if (!confirm("Remove this map from this browser?")) return;
    await MapDB.delPack(del.dataset.packDel);
    MapState.providers.delete(del.dataset.packDel);
    if (MapState.source === del.dataset.packDel) MapState.source = "world";
    await refreshPacks();
    await renderPackList();
  }
  if (clear) { await MapDB.clearTiles(); await renderPackList(); }
});

$("#mapSaveBtn").addEventListener("click", async () => {
  const url = $("#mapUrl").value.trim(), packUrl = $("#mapPackUrl").value.trim();
  if (url && !/\{z\}.*\{x\}.*\{y\}/.test(url)) return mapDlgError("The tile server address needs {z}, {x} and {y}, e.g. https://tiles.example.mil/{z}/{x}/{y}.png");
  Settings.update({ mapTileUrl: url, mapTileKeep: $("#mapKeep").checked, mapPackUrl: packUrl });
  MapState.providers.delete("server");
  MapState.providers.delete("url");
  for (const v of Object.values(MapState.views)) if (["server", "url"].includes(v.baseId)) { v.baseId = null; }
  await refreshPacks();
  $("#mapDlg").close();
  if (state.tab === "map") renderMapTab(); else renderCellMap();
  toast("Map sources saved", true);
});

// Download the tiles for the current view (your own tile server only) so the area works offline.
$("#mapCacheArea").addEventListener("click", async () => {
  const url = $("#mapUrl").value.trim(), v = MapState.views.ex || MapState.views.cell;
  if (!url || !v) return mapDlgError("Set a tile server address and open the map first.");
  if (/openstreetmap\.org/i.test(url)) return mapDlgError("OpenStreetMap's public servers don't allow bulk downloads. Use your own tile server, or load a map file.");
  const prov = serverProvider(url, true), b = v.map.getBounds(), z0 = Math.max(0, Math.floor(v.map.getZoom()) - 2), z1 = Math.min(18, Math.floor(v.map.getZoom()) + 3);
  const lon2x = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
  const lat2y = (lat, z) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
  const jobs = [];
  for (let z = z0; z <= z1; z++) {
    for (let x = lon2x(b.getWest(), z); x <= lon2x(b.getEast(), z); x++) for (let y = lat2y(b.getNorth(), z); y <= lat2y(b.getSouth(), z); y++) jobs.push([z, x, y]);
  }
  if (jobs.length > 6000 && !confirm(`That's ${jobs.length} tiles. Continue?`)) return;
  const btn = $("#mapCacheArea");
  btn.disabled = true;
  let done = 0;
  for (let i = 0; i < jobs.length; i += 8) {
    await Promise.all(jobs.slice(i, i + 8).map(([z, x, y]) => prov.get(z, x, y)));
    done = Math.min(jobs.length, i + 8);
    btn.innerHTML = `${icon("downloading")}${done} / ${jobs.length}`;
  }
  btn.disabled = false;
  btn.innerHTML = `${icon("download_for_offline")}Keep this area offline`;
  await renderPackList();
  toast(`${jobs.length} tiles kept for offline use (zoom ${z0}–${z1})`, true);
});

// ---- map setup: create views lazily when their tab first opens
function initMapClicks() {
  const v = MapState.views.ex;
  if (!v || v.clicks) return;
  v.clicks = true;
  v.map.on("click", onMapClick);
  v.map.on("dblclick", (e) => { if (MapState.mode === "line") { L.DomEvent.stop(e); finishLine(); } });
}
$('#exView [data-tab="map"]').addEventListener("click", () => { refreshPacks().then(() => { renderMapTab(); initMapClicks(); }); });
$('#cellView [data-ctab="map"]').addEventListener("click", () => { refreshPacks().then(renderCellMap); });
refreshPacks();

// Vector maps follow the light/dark theme.
addEventListener("exforge-theme", () => { for (const v of Object.values(MapState.views)) if (v.base instanceof VectorTileLayer) { v.base.cache.clear(); v.base.redraw(); } });

// ------------------------------------------------------------------ AAR map replay

const Replay = { i: 0, view: "all", speed: 1, timer: null, exId: null };
const MOMENT_KINDS = new Set(["adjudication", "red", "noduff", "inject"]);

function replaySnaps(ex) {
  const h = ex.worldHistory || [];
  if (h.length) {
    const key = `${ex.id}|${h.length}|${h.at(-1).at}`;
    if (replayCache.key !== key) {
      const all = expandHistory(h), first = all.findIndex((x) => x.units.length);   // start once forces exist
      replayCache.key = key;
      replayCache.snaps = first < 0 ? [] : all.slice(first);
    }
    return replayCache.snaps;
  }
  return ex.world?.units?.length ? [{ at: nowIso(), clock: ex.clock_min, ...worldCore(ex.world) }] : [];
}

function replayWorld(ex, snaps, i, view) {
  const snap = snaps[i];
  const trail = (id) => {
    const pts = [];
    for (let k = 0; k < i; k++) {
      const u = snaps[k].units.find((v) => v.id === id);
      if (u && (!pts.length || pts.at(-1).lat !== u.lat || pts.at(-1).lng !== u.lng)) pts.push({ lat: u.lat, lng: u.lng, clock: snaps[k].clock });
    }
    const cur = snap.units.find((v) => v.id === id);
    return pts.filter((p, k) => k < pts.length - 1 || p.lat !== cur.lat || p.lng !== cur.lng).slice(-30);
  };
  const w = { area: ex.world?.area, units: snap.units.map((u) => ({ ...u, trail: trail(u.id) })), features: snap.features || [], known: snap.known || {}, sides: snap.sides, civil: snap.civil };
  return view === "all" ? w : fogView(w, view);
}

// Snapshot index for a moment in time: the first snapshot taken at or after it.
const snapIndexAt = (snaps, ts) => { const k = snaps.findIndex((s) => s.at >= ts); return k < 0 ? snaps.length - 1 : k; };

function renderReplay() {
  const ex = state.ex, box = $("#aarReplay");
  const snaps = ex ? replaySnaps(ex) : [];
  box.classList.toggle("hidden", !snaps.length);
  if (!snaps.length || state.tab !== "aar") return;
  if (Replay.exId !== ex.id) { stopReplay(); Replay.exId = ex.id; Replay.i = snaps.length - 1; }
  Replay.i = Math.max(0, Math.min(Replay.i, snaps.length - 1));
  const i = Replay.i, snap = snaps[i], prev = snaps[i - 1];
  const slider = $("#rpSlider");
  slider.max = snaps.length - 1;
  slider.value = i;
  $$("[data-rp-view]").forEach((b) => b.classList.toggle("active", b.dataset.rpView === Replay.view));
  $("#rpPlay").innerHTML = icon(Replay.timer ? "pause" : "play_arrow");
  $("#rpPlay").setAttribute("aria-label", Replay.timer ? "Pause" : "Play");

  const v = (MapState.views.aar ??= makeView($("#aarMap")));
  v.map.invalidateSize();
  setBasemap(v, MapState.source);
  const w = replayWorld(ex, snaps, i, Replay.view);
  drawWorld(v, w, { editable: false });

  $("#rpStamp").innerHTML = `<div class="rp-clock mono">${fmtT(snap.clock ?? 0)}</div>
    <div class="body-small variant">${esc(new Date(snap.at).toLocaleString())}</div>
    <div class="body-small variant">Step ${i + 1} of ${snaps.length}${Replay.view !== "all" ? ` · ${Replay.view.toUpperCase()}'s picture` : ""}</div>`;
  const events = ex.log.filter((e) => (!prev || e.ts > prev.at) && e.ts <= snap.at && e.kind !== "system" || (e.kind === "system" && /Map updated|Forces placed/.test(e.text) && (!prev || e.ts > prev.at) && e.ts <= snap.at));
  $("#rpEvents").innerHTML = `<h3 class="title-small">What happened</h3>` + (events.slice(-8).map((e) => `
    <div class="rp-event"><span class="lead k-${esc(e.kind)}">${icon(KIND_ICON[e.kind] || "circle")}</span>
      <span class="body-small"><strong>${esc(e.actor)}</strong> ${esc(e.text.length > 160 ? `${e.text.slice(0, 160)}…` : e.text)}</span></div>`).join("")
    || `<div class="body-small variant">No logged events at this step.</div>`);
  $("#rpSides").innerHTML = w.sides ? sideBars(w) : "";
  const moments = ex.log.filter((e) => MOMENT_KINDS.has(e.kind)).slice(-60);
  $("#rpMoments").innerHTML = moments.length ? `<h3 class="title-small">Key moments</h3>${moments.map((e) => {
    const k = snapIndexAt(snaps, e.ts);
    return `<button type="button" class="rp-moment ${k === i ? "active" : ""}" data-rp-jump="${k}"><span class="mono body-small">${fmtT(e.game_time_min)}</span>
      ${icon(KIND_ICON[e.kind] || "circle")}<span class="body-small">${esc(e.text.length > 70 ? `${e.text.slice(0, 70)}…` : e.text)}</span></button>`;
  }).join("")}` : "";
}

function stopReplay() {
  clearInterval(Replay.timer);
  Replay.timer = null;
}

function stepReplay(to) {
  const n = replaySnaps(state.ex).length;
  Replay.i = Math.max(0, Math.min(n - 1, to));
  renderReplay();
}

document.addEventListener("click", (ev) => {
  const b = ev.target.closest("#aarReplay [data-rp], #aarReplay [data-rp-view], #aarReplay [data-rp-jump], #rpPlay");
  if (!b || !state.ex) return;
  const n = replaySnaps(state.ex).length;
  if (b.id === "rpPlay") {
    if (Replay.timer) { stopReplay(); return renderReplay(); }
    if (Replay.i >= n - 1) Replay.i = 0;
    Replay.timer = setInterval(() => {
      if (Replay.i >= replaySnaps(state.ex).length - 1) { stopReplay(); return renderReplay(); }
      stepReplay(Replay.i + 1);
    }, 1000 / Replay.speed);
    return renderReplay();
  }
  if (b.dataset.rpView) { Replay.view = b.dataset.rpView; return renderReplay(); }
  if (b.dataset.rpJump) { stopReplay(); return stepReplay(+b.dataset.rpJump); }
  stopReplay();
  stepReplay({ first: 0, prev: Replay.i - 1, next: Replay.i + 1, last: n - 1 }[b.dataset.rp]);
});
$("#rpSlider").addEventListener("input", (ev) => { stopReplay(); stepReplay(+ev.target.value); });
$("#rpSpeed").addEventListener("change", (ev) => {
  Replay.speed = +ev.target.value;
  if (Replay.timer) { stopReplay(); $("#rpPlay").click(); }
});
$('#exView [data-tab="aar"]').addEventListener("click", () => refreshPacks().then(() => setTimeout(renderReplay, 0)));

// Start-to-end force summary for the AI after action review.
function forceSummary(ex) {
  const snaps = replaySnaps(ex);
  if (snaps.length < 2) return "";
  const a = snaps[0], b = snaps.at(-1);
  const km = (p, q) => {
    const r = Math.PI / 180, dLat = (q.lat - p.lat) * r, dLng = (q.lng - p.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(p.lat * r) * Math.cos(q.lat * r) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };
  const lines = b.units.filter((u) => u.side === "blue" || u.side === "red").map((u) => {
    const s = a.units.find((v) => v.id === u.id);
    return s ? `${u.id} ${u.name} [${u.side}]: ${s.strength}% ${s.status || "active"} → ${u.strength}% ${u.status || "active"}, moved ${km(s, u).toFixed(1)} km`
      : `${u.id} ${u.name} [${u.side}]: added during the exercise, now ${u.strength}% ${u.status || "active"}`;
  });
  const det = (side) => Object.keys(b.known?.[side] || {}).length;
  return `FORCE STATE CHANGES (start T+${a.clock ?? 0} → end T+${b.clock ?? 0}, ${snaps.length} map changes):
${lines.join("\n")}
BLUE detected ${det("blue")} RED unit(s); RED detected ${det("red")} BLUE unit(s).
Sides: BLUE supply ${a.sides?.blue?.supply}→${b.sides?.blue?.supply}%, morale ${a.sides?.blue?.morale}→${b.sides?.blue?.morale}%; RED supply ${a.sides?.red?.supply}→${b.sides?.red?.supply}%, morale ${a.sides?.red?.morale}→${b.sides?.red?.morale}%.`;
}
