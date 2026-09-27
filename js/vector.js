"use strict";
// Vector map tiles (Mapbox Vector Tile / MVT), decoded and drawn in the browser with no extra libraries.
// Works with vector PMTiles, vector MBTiles and vector tile servers. The style understands the common open
// schemas (OpenMapTiles, Protomaps basemaps, Shortbread and similar) by layer and property names, draws
// contours and peaks when present, and follows the app's light/dark theme.

// ------------------------------------------------------------------ MVT decoder

const MVT = (() => {
  const utf8 = new TextDecoder();

  function varint(b, p) {
    let r = 0, s = 1, c;
    do { c = b[p++]; r += (c & 0x7f) * s; s *= 128; } while (c >= 0x80);
    return [r, p];
  }
  const zigzag = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);

  // Call cb(tag, wireType, a, b) for each protobuf field in b[start, end).
  function fields(b, start, end, cb) {
    let p = start;
    while (p < end) {
      let key;
      [key, p] = varint(b, p);
      const tag = Math.floor(key / 8), type = key & 7;
      if (type === 0) { let v; [v, p] = varint(b, p); cb(tag, 0, v); }
      else if (type === 2) { let len; [len, p] = varint(b, p); cb(tag, 2, p, p + len); p += len; }
      else if (type === 1) { cb(tag, 1, p); p += 8; }
      else if (type === 5) { cb(tag, 5, p); p += 4; }
      else throw new Error(`Unsupported protobuf wire type ${type}`);
    }
  }

  function value(b, start, end) {
    let v = null;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    fields(b, start, end, (tag, type, a, e) => {
      if (tag === 1) v = utf8.decode(b.subarray(a, e));
      else if (tag === 2) v = dv.getFloat32(a, true);
      else if (tag === 3) v = dv.getFloat64(a, true);
      else if (tag === 4 || tag === 5) v = a;
      else if (tag === 6) v = zigzag(a);
      else if (tag === 7) v = !!a;
    });
    return v;
  }

  function packed(b, start, end) {
    const out = [];
    for (let p = start, v; p < end;) { [v, p] = varint(b, p); out.push(v); }
    return out;
  }

  // Geometry → array of flat coordinate arrays [x0, y0, x1, y1, …] (points, lines or rings).
  function geometry(b, start, end) {
    const out = [];
    let x = 0, y = 0, cmd = 0, count = 0, cur = null;
    for (let p = start; p < end;) {
      if (!count) { let ci; [ci, p] = varint(b, p); cmd = ci & 7; count = ci >>> 3; }
      count--;
      if (cmd === 1 || cmd === 2) {
        let dx, dy;
        [dx, p] = varint(b, p);
        [dy, p] = varint(b, p);
        x += zigzag(dx); y += zigzag(dy);
        if (cmd === 1) { cur = []; out.push(cur); }
        cur.push(x, y);
      } else if (cmd === 7 && cur) cur.push(cur[0], cur[1]);
    }
    return out;
  }

  function layer(b, start, end) {
    const L = { name: "", extent: 4096, keys: [], values: [], features: [] };
    fields(b, start, end, (tag, type, a, e) => {
      if (tag === 1) L.name = utf8.decode(b.subarray(a, e));
      else if (tag === 2) L.features.push([a, e]);
      else if (tag === 3) L.keys.push(utf8.decode(b.subarray(a, e)));
      else if (tag === 4) L.values.push(value(b, a, e));
      else if (tag === 5) L.extent = a;
    });
    L.features = L.features.map(([a, e]) => {
      const f = { type: 0, props: {}, geom: [] };
      fields(b, a, e, (tag, type, s, t) => {
        if (tag === 2) { const tags = packed(b, s, t); for (let i = 0; i + 1 < tags.length; i += 2) f.props[L.keys[tags[i]]] = L.values[tags[i + 1]]; }
        else if (tag === 3) f.type = s;
        else if (tag === 4) f.geom = geometry(b, s, t);
      });
      return f;
    });
    return L;
  }

  // Tile bytes (already decompressed) → { layerName: layer }
  function decode(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const layers = {};
    fields(b, 0, b.length, (tag, type, a, e) => { if (tag === 3 && type === 2) { const l = layer(b, a, e); layers[l.name] = l; } });
    return layers;
  }

  return { decode };
})();

// gzip is common in MBTiles and on tile servers; PMTiles tiles arrive already decompressed.
async function gunzipIfNeeded(u8) {
  if (!(u8 && u8[0] === 0x1f && u8[1] === 0x8b)) return u8;
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ------------------------------------------------------------------ style

const VectorStyle = (() => {
  const light = {
    land: "#f2efe6", water: "#a9cde6", waterLine: "#8ab9dc", wood: "#c9dcb3", park: "#d8e8c2", farmland: "#ece7cf", residential: "#e6e2dc",
    industrial: "#e3dce4", military: "#f0d4d0", sand: "#f1e6c3", glacier: "#f4f8fb", wetland: "#d5e6d9", building: "#dcd3c8", buildingLine: "#c6bbae",
    boundary: "#8c7aa6", contour: "#c8a77e", motorway: "#e8905b", trunk: "#f0b06b", primary: "#f6cf7c", secondary: "#fbe69b", minor: "#ffffff",
    path: "#9d8f7a", rail: "#8a8a8a", casing: "#b9ad9c", label: "#2b2b2b", halo: "rgba(255,255,255,.9)", waterLabel: "#3c6f9c", peak: "#6b4f2e",
  };
  const dark = {
    land: "#232a33", water: "#0f2233", waterLine: "#1d3e5c", wood: "#233428", park: "#28392b", farmland: "#2c3029", residential: "#2b3038",
    industrial: "#302b36", military: "#3d2a2a", sand: "#3a3528", glacier: "#34414d", wetland: "#233530", building: "#343c47", buildingLine: "#414a57",
    boundary: "#9a88c0", contour: "#6e5d45", motorway: "#b8743f", trunk: "#a56b3a", primary: "#8f7a4c", secondary: "#6f6a52", minor: "#48505c",
    path: "#7d7466", rail: "#6e6e6e", casing: "#161b21", label: "#e4e6ea", halo: "rgba(10,14,20,.85)", waterLabel: "#8fb6d8", peak: "#c7a57a",
  };
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  };
  const palette = () => (isDark() ? dark : light);

  const cls = (p) => String(p.class ?? p.kind ?? p.subclass ?? p.highway ?? p.type ?? p.landuse ?? p.natural ?? "").toLowerCase();
  function landKind(p) {
    const k = `${cls(p)} ${p.kind_detail ?? ""} ${p.subclass ?? ""}`;
    if (/wood|forest|tree/.test(k)) return "wood";
    if (/grass|park|meadow|garden|recreation|pitch|cemetery|nature|golf|heath|scrub/.test(k)) return "park";
    if (/farm|orchard|vineyard|allotment|crop/.test(k)) return "farmland";
    if (/military|barracks|range|danger/.test(k)) return "military";
    if (/industrial|commercial|retail|railway|quarry|landfill|construction/.test(k)) return "industrial";
    if (/residential|suburb|neighbourhood|village|urban|built/.test(k)) return "residential";
    if (/sand|beach|rock|scree|bare|desert/.test(k)) return "sand";
    if (/glacier|ice|snow/.test(k)) return "glacier";
    if (/wetland|marsh|swamp|bog/.test(k)) return "wetland";
    if (/water|lake|reservoir|river|basin/.test(k)) return "water";
    return null;
  }
  function roadKind(p, layerName) {
    if (/rail/.test(layerName)) return "rail";
    const k = cls(p);
    if (/motorway/.test(k)) return "motorway";
    if (/trunk|highway$/.test(k)) return "trunk";
    if (/primary|major/.test(k)) return "primary";
    if (/secondary|tertiary|medium/.test(k)) return "secondary";
    if (/rail|transit|subway|tram|light_rail/.test(k)) return "rail";
    if (/path|track|foot|cycle|bridleway|steps|pedestrian|trail|other/.test(k)) return "path";
    if (/ferry|aeroway|runway|taxiway/.test(k)) return null;
    return "minor";
  }
  // Road widths grow with zoom.
  function roadWidth(kind, z) {
    const base = { motorway: 1.6, trunk: 1.4, primary: 1.2, secondary: 1, minor: 0.7, path: 0.6, rail: 0.8 }[kind] || 0.7;
    const f = z <= 8 ? 0.5 : z <= 11 ? 0.9 : z <= 13 ? 1.4 : z <= 15 ? 2.4 : 3.6;
    return Math.max(0.4, base * f * (kind === "minor" && z < 12 ? 0.6 : 1));
  }
  const minZoomFor = { motorway: 5, trunk: 6, primary: 8, secondary: 10, minor: 12, path: 14, rail: 10 };

  return { palette, isDark, cls, landKind, roadKind, roadWidth, minZoomFor };
})();

// ------------------------------------------------------------------ renderer

const VectorRenderer = (() => {
  const has = (name, re) => re.test(name.toLowerCase());
  const labelName = (p) => p.name_en ?? p["name:en"] ?? p["name:latin"] ?? p.name ?? p["pmap:name"] ?? null;

  // opts: z (display zoom), size (tile px), scale (2^overzoom), ox/oy (px offset inside the scaled parent tile)
  function render(ctx, layers, opts) {
    const P = VectorStyle.palette(), { z, size, scale, ox, oy } = opts;
    const stats = { fills: 0, lines: 0, labels: 0 };
    const names = Object.keys(layers);
    const tx = (L) => { const k = (size * scale) / L.extent; return (x, y) => [x * k - ox, y * k - oy]; };

    const pathRings = (L, f) => {
      const t = tx(L);
      ctx.beginPath();
      for (const ring of f.geom) {
        for (let i = 0; i < ring.length; i += 2) { const [X, Y] = t(ring[i], ring[i + 1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      }
    };
    const fill = (L, f, color) => { pathRings(L, f); ctx.fillStyle = color; ctx.fill("evenodd"); stats.fills++; };
    const stroke = (L, f, color, width, dash) => {
      pathRings(L, f);
      ctx.setLineDash(dash || []);
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = dash ? "butt" : "round"; ctx.lineJoin = "round";
      ctx.stroke(); stats.lines++;
    };

    // Background: land, unless the tile draws land itself ("earth" in Protomaps), in which case water.
    const earth = names.find((n) => /^(earth|land)$/i.test(n));
    ctx.fillStyle = earth ? P.water : P.land;
    ctx.fillRect(0, 0, size, size);
    if (earth) for (const f of layers[earth].features) if (f.type === 3) fill(layers[earth], f, P.land);

    // Land cover and land use.
    for (const n of names.filter((n) => has(n, /landcover|landuse|park|natural|^land_|wood|forest/) && n !== earth)) {
      const L = layers[n];
      for (const f of L.features) if (f.type === 3) { const k = VectorStyle.landKind(f.props) || (has(n, /park/) ? "park" : null); if (k) fill(L, f, P[k]); }
    }
    // Water polygons, then waterways.
    for (const n of names.filter((n) => has(n, /water|ocean|lake|sea/))) {
      const L = layers[n];
      for (const f of L.features) {
        if (f.type === 3) fill(L, f, P.water);
        else if (f.type === 2) { const k = VectorStyle.cls(f.props); stroke(L, f, P.waterLine, /river|canal/.test(k) ? (z >= 12 ? 2.4 : 1.4) : z >= 13 ? 1 : 0.6); }
      }
    }
    // Contours (e.g. MapTiler / terrain tiles): thin lines, index contours heavier.
    for (const n of names.filter((n) => has(n, /contour/))) {
      const L = layers[n];
      for (const f of L.features) if (f.type === 2) {
        const e = +(f.props.ele ?? f.props.height ?? 0), index = f.props.nth_line === 10 || f.props.index === 1 || (e && e % 100 === 0);
        stroke(L, f, P.contour, index ? 1 : 0.5);
      }
    }
    // Buildings at street zooms.
    if (z >= 13) for (const n of names.filter((n) => has(n, /building/))) {
      const L = layers[n];
      for (const f of L.features) if (f.type === 3) { fill(L, f, P.building); if (z >= 15) { ctx.strokeStyle = P.buildingLine; ctx.lineWidth = 0.5; ctx.stroke(); } }
    }
    // Boundaries.
    for (const n of names.filter((n) => has(n, /boundar|admin/))) {
      const L = layers[n];
      for (const f of L.features) if (f.type === 2) {
        const lvl = +(f.props.admin_level ?? f.props.kind_detail ?? 4), country = lvl <= 2 || /country/.test(VectorStyle.cls(f.props));
        if (!country && z < 6) continue;
        stroke(L, f, P.boundary, country ? 1.6 : 0.8, country ? [6, 3] : [3, 3]);
      }
    }
    // Roads and railways: casings first, then fills, minor to major.
    const roadLayers = names.filter((n) => has(n, /transportation$|^roads?$|streets|highway|railway|^rail/) && !has(n, /name/));
    const order = ["path", "minor", "rail", "secondary", "primary", "trunk", "motorway"];
    const roads = [];
    for (const n of roadLayers) for (const f of layers[n].features) {
      if (f.type !== 2) continue;
      const k = VectorStyle.roadKind(f.props, n.toLowerCase());
      if (k && z >= (VectorStyle.minZoomFor[k] ?? 12)) roads.push([n, f, k]);
    }
    roads.sort((a, b) => order.indexOf(a[2]) - order.indexOf(b[2]));
    if (z >= 11) for (const [n, f, k] of roads) if (!["path", "rail"].includes(k)) stroke(layers[n], f, P.casing, VectorStyle.roadWidth(k, z) + 1.4);
    for (const [n, f, k] of roads) {
      const w = VectorStyle.roadWidth(k, z);
      if (k === "rail") stroke(layers[n], f, P.rail, w, [4, 3]);
      else if (k === "path") stroke(layers[n], f, P.path, w, [2, 2]);
      else stroke(layers[n], f, P[k], w);
    }
    ctx.setLineDash([]);

    // Labels: places (and peaks, which matter for terrain).
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    const text = (x, y, s, px, weight, color) => {
      if (x < -60 || y < -20 || x > size + 60 || y > size + 20) return;
      ctx.font = `${weight} ${px}px Roboto, sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = P.halo; ctx.strokeText(s, x, y);
      ctx.fillStyle = color; ctx.fillText(s, x, y); stats.labels++;
    };
    for (const n of names.filter((n) => has(n, /place|mountain_peak|peak|poi/))) {
      const L = layers[n], t = tx(L);
      for (const f of L.features) {
        if (f.type !== 1 || !f.geom[0]) continue;
        const name = labelName(f.props), k = VectorStyle.cls(f.props);
        const [x, y] = t(f.geom[0][0], f.geom[0][1]);
        if (/peak|mountain|volcano/.test(`${n} ${k}`)) {
          if (z < 10) continue;
          ctx.fillStyle = P.peak; ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y + 3); ctx.lineTo(x - 4, y + 3); ctx.fill();
          const ele = f.props.ele ?? f.props.elevation;
          if (name || ele) text(x, y + 11, `${name ?? ""}${ele ? ` ${Math.round(ele)} m` : ""}`.trim(), 10, 500, P.peak);
          continue;
        }
        if (!name || /poi/.test(n)) continue;
        const size_ = /country/.test(k) ? [13, 700] : /state|province|region/.test(k) ? [12, 600] : /city/.test(k) ? [13, 700]
          : /town/.test(k) ? [12, 600] : /village/.test(k) ? [11, 500] : [10, 500];
        const minZ = /country/.test(k) ? 0 : /state|city/.test(k) ? 4 : /town/.test(k) ? 8 : /village/.test(k) ? 11 : 13;
        if (z < minZ) continue;
        text(x, y, name, size_[0], size_[1], P.label);
      }
    }
    return stats;
  }

  return { render };
})();

// ------------------------------------------------------------------ Leaflet layer

// Draws vector tiles on canvases. Beyond the data's max zoom it keeps drawing sharp lines by rendering the
// parent tile's geometry at a larger scale instead of stretching a picture.
const VectorTileLayer = L.GridLayer.extend({
  initialize(provider, options) {
    this.provider = provider;
    this.cache = new Map();
    L.GridLayer.prototype.initialize.call(this, options);
  },
  tileData(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const p = this.provider.getRaw(z, x, y).then((raw) => (raw ? MVT.decode(raw) : null)).catch(() => null);
    this.cache.set(key, p);
    if (this.cache.size > 160) this.cache.delete(this.cache.keys().next().value);
    return p;
  },
  createTile(c, done) {
    const size = this.getTileSize(), dpr = window.devicePixelRatio || 1;
    const cv = document.createElement("canvas");
    cv.width = size.x * dpr; cv.height = size.y * dpr;
    const dz = Math.max(0, c.z - this.provider.maxZoom), px = c.x >> dz, py = c.y >> dz;
    this.tileData(c.z - dz, px, py).then((layers) => {
      if (layers) {
        const ctx = cv.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cv.stats = VectorRenderer.render(ctx, layers, { z: c.z, size: size.x, scale: 2 ** dz, ox: (c.x - (px << dz)) * size.x, oy: (c.y - (py << dz)) * size.y });
      }
      done(null, cv);
    });
    return cv;
  },
});

// Redraw vector maps when the theme changes.
new MutationObserver(() => window.dispatchEvent(new Event("exforge-theme"))).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => window.dispatchEvent(new Event("exforge-theme")));
