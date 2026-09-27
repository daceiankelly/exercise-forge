"use strict";
// Doctrine library: the staff's own doctrine, SOPs, ROE cards and past lessons, kept in this browser (IndexedDB).
// Documents are split into sections and searched offline with BM25 (no embeddings, no extra API calls). The best
// matching extracts ride along with AI requests (design, adjudication, RED turns, MSEL gaps, the AAR), and the AI
// cites them by reference so controllers can check every point against the source.

const Library = (() => {
  // ---------------------------------------------------------------- storage
  let dbp = null;
  const open = () => (dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("exforge-library", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("docs", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction("docs", mode), req = fn(t.objectStore("docs"));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error || new Error("Storage error"));
      t.onabort = () => reject(t.error || new Error("Storage full or blocked"));
    });
  }

  let cache = null;   // all docs, and the search index over the active ones
  let index = null;
  const invalidate = () => { cache = null; index = null; };
  async function docs() { return cache ??= (await run("readonly", (s) => s.getAll())).sort((a, b) => a.added.localeCompare(b.added)); }

  // ---------------------------------------------------------------- text → sections
  const STOP = new Set(("a an and are as at be been by can could do does for from had has have he her his how i if in into is it its may " +
    "might must no not of on or our shall she should so such than that the their them then there these they this those to under upon " +
    "was we were what when where which while who will with would you your").split(" "));
  // Crude suffix stripping so "alleges", "allegation" and "alleged" all match.
  const SUFFIXES = ["ations", "ation", "ments", "ment", "ings", "ing", "ions", "ion", "ates", "ated", "ate", "ers", "er", "ed", "es", "s", "ly"];
  function stem(w) {
    if (w.length > 4 && /ie[sd]$/.test(w)) return w.slice(0, -3) + "y";
    for (const s of SUFFIXES) {
      if (w.length - s.length >= 4 && w.endsWith(s) && !(s === "s" && w.endsWith("ss"))) { w = w.slice(0, -s.length); break; }
    }
    return w.length > 4 && w.endsWith("e") ? w.slice(0, -1) : w;
  }
  // Common abbreviations are searched as their words too, so "CASEVAC" finds "casualty evacuation".
  const ABBR = {
    casevac: "casualty evacuation", medevac: "medical evacuation", isr: "intelligence surveillance reconnaissance", recce: "reconnaissance",
    pao: "public affairs media", legad: "legal adviser", ngo: "humanitarian organisation", cimic: "civil military cooperation",
    roe: "rules engagement", loac: "law armed conflict", coa: "course action", cop: "common operational picture", rfi: "request information",
    sitrep: "situation report", logstat: "logistic status report", frago: "fragmentary order", ccir: "commander critical information requirement",
    pir: "priority intelligence requirement", eof: "escalation force", masscal: "mass casualty", excon: "exercise control", oc: "observer controller",
  };
  const tokens = (text) => (String(text).toLowerCase().match(/[a-z0-9]+/g) || [])
    .flatMap((w) => ABBR[w] ? [w, ...ABBR[w].split(" ")] : [w])
    .filter((w) => w.length > 1 && !STOP.has(w)).map(stem);

  const isHeading = (line) => {
    const l = line.trim();
    if (!l || l.length > 90) return false;
    if (/^#{1,6}\s/.test(l)) return true;
    if (/^(chapter|section|part|annex|appendix|article)\b/i.test(l)) return true;
    if (/^[A-Z0-9][A-Z0-9 ,&()\/'-]{3,}$/.test(l) && /[A-Z]{3}/.test(l)) return true;                // ALL CAPS
    if (/^\d+(\.\d+)*\.?\s+[A-Z]/.test(l) && !/[.;:,]$/.test(l) && l.split(/\s+/).length <= 10) return true;   // "3.2 Planning"
    return false;
  };
  const paraNo = (t) => t.match(/^\s*(\d+(?:\.\d+)+|\d+\.)\s/)?.[1]?.replace(/\.$/, "") || "";

  function sections(text) {
    const lines = String(text).replace(/\r\n?/g, "\n").replace(/\f/g, "\n\n").split("\n");
    const paras = [];
    let cur = [];
    const flush = () => { if (cur.length) paras.push({ kind: "p", text: cur.join(" ").replace(/\s+/g, " ").trim() }); cur = []; };
    for (const line of lines) {
      if (!line.trim()) { flush(); continue; }
      if (isHeading(line)) { flush(); paras.push({ kind: "h", text: line.replace(/^#+\s*/, "").trim() }); continue; }
      cur.push(line.trim());
    }
    flush();
    // Group paragraphs under their heading into chunks of roughly 900 characters.
    const out = [];
    let heading = "", buf = [], firstPara = "", lastPara = "";
    const push = () => {
      const t = buf.join("\n").trim();
      if (t) out.push({ h: heading, p: firstPara && lastPara && firstPara !== lastPara ? `${firstPara}–${lastPara}` : firstPara, t });
      buf = []; firstPara = ""; lastPara = "";
    };
    for (const p of paras) {
      if (p.kind === "h") { push(); heading = p.text; continue; }
      const pieces = p.text.length > 1400 ? p.text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g).reduce((acc, s) => {
        if (!acc.length || acc.at(-1).length + s.length > 900) acc.push(s); else acc[acc.length - 1] += s;
        return acc;
      }, []) : [p.text];
      for (const piece of pieces) {
        if (buf.join("\n").length + piece.length > 900 && buf.length) push();
        const no = paraNo(piece);
        if (no) { firstPara ||= no; lastPara = no; }
        buf.push(piece.trim());
      }
    }
    push();
    return out;
  }

  // ---------------------------------------------------------------- file formats
  const dec = (u8, enc = "utf-8") => new TextDecoder(enc).decode(u8);
  const entities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1))
      : { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[e.toLowerCase()]);

  // Tolerates trailing bytes after the compressed data (common in PDFs): keeps what was decoded before the error.
  async function inflate(data, format) {
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream(format)).getReader();
    const parts = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); size += value.length;
      }
    } catch (e) { if (!size) throw e; }
    const out = new Uint8Array(size);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // Minimal zip reader (enough for .docx): returns name → bytes for the entries wanted.
  async function unzip(buf, want) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("This isn't a valid Word (.docx) file.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = new Map();
    for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec(u8.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (!want(name)) continue;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = u8.subarray(start, start + csize);
      if (method === 0) out.set(name, data);
      else if (method === 8) out.set(name, await inflate(data, "deflate-raw"));
    }
    return out;
  }

  async function docxText(buf) {
    const files = await unzip(buf, (n) => n === "word/document.xml");
    const xml = files.get("word/document.xml");
    if (!xml) throw new Error("No document text found in this .docx file.");
    const paras = dec(xml).match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
    return paras.map((p) => {
      const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] || "";
      const text = entities(p.replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n").replace(/<[^>]+>/g, ""));
      return /^(heading|title)/i.test(style) && text.trim() ? `# ${text.trim()}` : text;
    }).join("\n\n");
  }

  function htmlText(html) {
    return entities(html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<h[1-6][^>]*>/gi, "\n\n# ").replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|div|tr|section|article|blockquote)>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ");
  }

  // Best-effort PDF text: reads the text operators in (Flate-compressed) content streams. Scanned PDFs and PDFs with
  // custom font encodings have no readable text this way; those are rejected with advice rather than stored as junk.
  const unescapePdf = (s) => s.replace(/\\(\d{1,3}|.)/gs, (m, c) =>
    /\d/.test(c[0]) ? String.fromCharCode(parseInt(c, 8)) : { n: "\n", r: "", t: "\t", b: "", f: "", "\n": "" }[c] ?? c);
  const hexStr = (h) => {
    const bytes = h.replace(/\s/g, "").match(/../g) || [];
    const chars = bytes.map((b) => parseInt(b, 16));
    return chars.every((c) => c >= 32 && c < 127) ? String.fromCharCode(...chars) : "";
  };
  function pdfOps(c) {
    let out = "";
    const re = /\[((?:\\.|[^\\\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(Tj|'|")|<([0-9A-Fa-f\s]+)>\s*Tj|(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]|T\*|\bET\b/g;
    let m;
    while ((m = re.exec(c))) {
      if (m[1] !== undefined) {
        for (const part of m[1].matchAll(/\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>|(-?[\d.]+)/g)) {
          if (part[1] !== undefined) out += unescapePdf(part[1]);
          else if (part[2] !== undefined) out += hexStr(part[2]);
          else if (+part[3] < -200) out += " ";
        }
      } else if (m[2] !== undefined) out += (m[3] === "Tj" ? "" : "\n") + unescapePdf(m[2]);
      else if (m[4] !== undefined) out += hexStr(m[4]);
      else if (m[5] !== undefined) out += +m[6] !== 0 ? "\n" : +m[5] !== 0 ? " " : "";
      else out += "\n";
    }
    return out;
  }
  async function pdfText(buf) {
    const u8 = new Uint8Array(buf), s = dec(u8, "latin1");
    if (!s.startsWith("%PDF")) throw new Error("This isn't a valid PDF file.");
    let text = "";
    const re = /stream\r?\n/g;
    let m;
    while ((m = re.exec(s))) {
      const start = m.index + m[0].length, end = s.indexOf("endstream", start);
      if (end < 0) break;
      const dict = s.slice(Math.max(0, s.lastIndexOf("obj", m.index)), m.index);
      re.lastIndex = end + 9;            // past "endstream", which itself ends in "stream"
      if (/\/Subtype\s*\/(Image|Type1C|CIDFontType0C|OpenType)|\/Length1|\/FontFile/.test(dict)) continue;
      let stop = end;
      while (stop > start && (u8[stop - 1] === 10 || u8[stop - 1] === 13)) stop--;
      let data = u8.subarray(start, stop);
      if (/FlateDecode/.test(dict)) { try { data = await inflate(data, "deflate"); } catch { continue; } }
      else if (/\/Filter/.test(dict)) continue;
      const content = dec(data, "latin1");
      if (/\bBT\b/.test(content)) text += pdfOps(content) + "\n\n";
    }
    text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    const letters = (text.match(/[A-Za-z]/g) || []).length;
    if (letters < 200 || letters / Math.max(1, text.replace(/\s/g, "").length) < 0.6) {
      throw new Error("Couldn't read the text in this PDF (it may be scanned, or use embedded fonts). Save it as .docx or .txt, or paste the text instead.");
    }
    return text;
  }

  async function fileText(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".docx")) return docxText(await file.arrayBuffer());
    if (name.endsWith(".pdf")) return pdfText(await file.arrayBuffer());
    const raw = await file.text();
    if (/\.(html?|xhtml)$/.test(name)) return htmlText(raw);
    if (/\.(doc|xls|xlsx|ppt|pptx|odt|rtf)$/.test(name)) throw new Error(`${file.name}: this format isn't supported. Save it as .docx, .pdf or .txt.`);
    return raw;
  }

  // ---------------------------------------------------------------- documents
  const KINDS = { doctrine: "Doctrine", sop: "SOP", roe: "ROE / legal", lessons: "Lessons", reference: "Reference" };
  const KIND_ICON = { doctrine: "menu_book", sop: "checklist", roe: "gavel", lessons: "lightbulb", reference: "description" };

  async function add({ title, kind = "doctrine", text, source = "" }) {
    const secs = sections(text);
    if (!secs.length) throw new Error(`${title || source}: no text found.`);
    const doc = { id: `L${Math.random().toString(36).slice(2, 10)}`, title: title || source || "Untitled", kind, source, active: true,
      added: new Date().toISOString(), chars: secs.reduce((n, c) => n + c.t.length, 0), chunks: secs };
    await run("readwrite", (s) => s.put(doc));
    invalidate();
    return doc;
  }
  async function addFile(file, kind) {
    const text = await fileText(file);
    return add({ title: file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "), kind, text, source: file.name });
  }
  async function update(id, patch) {
    const d = (await docs()).find((x) => x.id === id);
    if (!d) return;
    await run("readwrite", (s) => s.put({ ...d, ...patch }));
    invalidate();
  }
  async function remove(id) { await run("readwrite", (s) => s.delete(id)); invalidate(); }

  // ---------------------------------------------------------------- search (BM25)
  async function buildIndex() {
    if (index) return index;
    const items = [];
    for (const d of await docs()) {
      if (!d.active) continue;
      d.chunks.forEach((c, i) => {
        const toks = [...tokens(c.h), ...tokens(c.h), ...tokens(c.t)];    // headings count double
        const tf = new Map();
        for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
        items.push({ doc: d, i, c, tf, len: toks.length });
      });
    }
    const df = new Map();
    for (const it of items) for (const t of it.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    const avg = items.reduce((s, it) => s + it.len, 0) / Math.max(1, items.length);
    return index = { items, df, avg };
  }

  async function search(query, k = 5) {
    const { items, df, avg } = await buildIndex();
    const q = [...new Set(tokens(query))];
    if (!q.length || !items.length) return [];
    const N = items.length, k1 = 1.2, b = 0.75;
    const scored = [];
    for (const it of items) {
      let score = 0;
      for (const t of q) {
        const f = it.tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
        score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * it.len / avg));
      }
      if (score > 0) scored.push({ score, it });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0]?.score || 0;
    return scored.filter((s) => s.score >= top * 0.25).slice(0, k).map(({ score, it }) => ({
      docId: it.doc.id, title: it.doc.title, kind: it.doc.kind, section: it.c.h, para: it.c.p, text: it.c.t, score: Math.round(score * 100) / 100,
    }));
  }

  // Extracts for an AI request, labelled D1, D2… so the answer can cite them.
  async function context(query, { k = 5, maxChars = 6000 } = {}) {
    let hits;
    try { hits = await search(query, k); } catch { return { text: "", refs: [] }; }
    const refs = [];
    let used = 0;
    for (const h of hits) {
      const text = h.text.length > 1500 ? `${h.text.slice(0, 1500)}…` : h.text;
      if (used + text.length > maxChars && refs.length) break;
      used += text.length;
      refs.push({ ref: `D${refs.length + 1}`, docId: h.docId, title: h.title, kind: h.kind, section: h.section, para: h.para, text });
    }
    if (!refs.length) return { text: "", refs };
    const text = "REFERENCE EXTRACTS from the exercise staff's own doctrine, SOP and lessons library. Apply them where relevant and cite them by ref:\n\n" +
      refs.map((r) => `[${r.ref}] ${r.title} (${KINDS[r.kind] || r.kind})${r.section ? ` — ${r.section}` : ""}${r.para ? `, para ${r.para}` : ""}:\n${r.text}`).join("\n\n");
    return { text, refs };
  }

  // ---------------------------------------------------------------- sharing
  async function exportBundle() {
    return { format: "exforge-library", version: 1, exported: new Date().toISOString(), docs: await docs() };
  }
  async function importBundle(bundle) {
    if (bundle?.format !== "exforge-library" || !Array.isArray(bundle.docs)) throw new Error("That file isn't an ExerciseForge library export.");
    const have = new Set((await docs()).map((d) => d.id));
    let added = 0;
    for (const d of bundle.docs) {
      if (!d?.id || !Array.isArray(d.chunks) || have.has(d.id)) continue;
      await run("readwrite", (s) => s.put(d));
      added++;
    }
    invalidate();
    return added;
  }

  // ---------------------------------------------------------------- example documents (js/samples.js)
  const samples = () => typeof SAMPLE_DOCS === "undefined" ? [] : SAMPLE_DOCS;
  async function addExamples() {
    const have = new Set((await docs()).map((d) => d.id));
    let added = 0;
    for (const s of samples()) {
      if (have.has(s.id)) continue;
      const chunks = sections(s.text);
      await run("readwrite", (st) => st.put({ id: s.id, title: s.title, kind: s.kind, source: "ExerciseForge example", example: true, active: true,
        added: new Date().toISOString(), chars: chunks.reduce((n, c) => n + c.t.length, 0), chunks }));
      added++;
    }
    invalidate();
    return added;
  }
  async function removeExamples() {
    for (const d of (await docs()).filter((x) => x.example)) await run("readwrite", (st) => st.delete(d.id));
    invalidate();
  }
  // First run in this browser: load the examples into an empty library, once. Removing them keeps them removed.
  const SEEDED = "exforge.libexamples";
  async function seed() {
    try {
      if (localStorage.getItem(SEEDED)) return;
      localStorage.setItem(SEEDED, "1");
      if (!(await docs()).length) await addExamples();
    } catch { /* storage blocked: the library still works, just empty */ }
  }
  const ready = seed();

  return { docs, add, addFile, update, remove, search, context, sections, tokens, fileText, docxText, pdfText, htmlText, exportBundle, importBundle,
    addExamples, removeExamples, ready, samples, KINDS, KIND_ICON };
})();

// ------------------------------------------------------------------ library dialog

const fmtChars = (n) => n < 1000 ? `${n} characters` : `${Math.round(n / 1000)}k characters`;

async function renderLibrary() {
  const docs = await Library.docs();
  const active = docs.filter((d) => d.active).length;
  $("#libCount").textContent = docs.length ? `${docs.length} document${docs.length === 1 ? "" : "s"}, ${active} in use by the AI` : "";
  $("#libList").innerHTML = docs.map((d) => `
    <div class="lib-row ${d.active ? "" : "off"}">
      <div class="lib-ic">${icon(Library.KIND_ICON[d.kind] || "description")}</div>
      <div class="text"><strong>${esc(d.title)}</strong>
        <small>${esc(Library.KINDS[d.kind] || d.kind)} · ${d.chunks.length} section${d.chunks.length === 1 ? "" : "s"} · ${fmtChars(d.chars)}${d.source && !d.example ? ` · ${esc(d.source)}` : ""}</small></div>
      <label class="switch" data-tip="Use in AI requests"><input type="checkbox" data-lib-active="${esc(d.id)}" ${d.active ? "checked" : ""} aria-label="Use ${esc(d.title)}"><span class="track"></span></label>
      <button type="button" class="icon-btn" data-lib-del="${esc(d.id)}" aria-label="Remove ${esc(d.title)}">${icon("delete")}</button>
    </div>`).join("") || `<div class="header-empty">No documents yet. Add your doctrine, SOPs, ROE cards or past lessons, or add the examples below.</div>`;
  const examples = docs.filter((d) => d.example).length, total = Library.samples().length;
  $("#libExamplesAdd").classList.toggle("hidden", examples >= total);
  $("#libExamplesAdd").lastChild.textContent = examples ? "Restore missing examples" : "Add example documents";
  $("#libExamplesRemove").classList.toggle("hidden", !examples);
  renderLibIndicator(docs);
}

function renderLibIndicator(docs) {
  const n = docs.filter((d) => d.active).length;
  const el = $("#adjLibHint");
  if (el) el.innerHTML = n ? `${icon("menu_book")}Doctrine library: ${n} document${n === 1 ? "" : "s"} in use` : "";
}

function libError(msg) {
  const el = $("#libError");
  el.innerHTML = msg ? `${icon("error")}<span class="body-medium">${esc(msg)}</span>` : "";
  el.classList.toggle("hidden", !msg);
}

async function openLibrary() {
  libError("");
  $("#libSearchOut").innerHTML = "";
  $("#libPaste").classList.add("hidden");
  await renderLibrary();
  $("#libDlg").showModal();
}

$("#libraryBtn").addEventListener("click", () => { openLibrary(); closeDrawer(); });
$("#libExamplesAdd").addEventListener("click", async () => { await Library.addExamples(); await renderLibrary(); });
$("#libExamplesRemove").addEventListener("click", async () => {
  if (!confirm("Remove the example documents from the library? You can add them back later.")) return;
  await Library.removeExamples();
  await renderLibrary();
});
$("#libAddBtn").addEventListener("click", () => $("#libFile").click());
$("#libFile").addEventListener("change", async (ev) => {
  const files = [...ev.target.files];
  ev.target.value = "";
  if (!files.length) return;
  libError("");
  $("#libBusy").classList.remove("hidden");
  const problems = [];
  for (const f of files) {
    try { await Library.addFile(f, $("#libKind").value); }
    catch (e) { problems.push(e.message.startsWith(f.name) ? e.message : `${f.name}: ${e.message}`); }
  }
  $("#libBusy").classList.add("hidden");
  libError(problems.join(" "));
  await renderLibrary();
});
$("#libPasteBtn").addEventListener("click", () => { $("#libPaste").classList.toggle("hidden"); $("#libPasteTitle").focus(); });
$("#libPasteAdd").addEventListener("click", async () => {
  const title = $("#libPasteTitle").value.trim(), text = $("#libPasteText").value;
  if (!title || !text.trim()) return libError("Give the pasted text a title.");
  try {
    await Library.add({ title, kind: $("#libKind").value, text, source: "pasted" });
    $("#libPasteTitle").value = ""; $("#libPasteText").value = "";
    $("#libPaste").classList.add("hidden");
    libError("");
  } catch (e) { libError(e.message); }
  await renderLibrary();
});
$("#libList").addEventListener("change", async (ev) => {
  const t = ev.target.closest("[data-lib-active]");
  if (t) { await Library.update(t.dataset.libActive, { active: t.checked }); await renderLibrary(); }
});
$("#libList").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-lib-del]");
  if (!b) return;
  const d = (await Library.docs()).find((x) => x.id === b.dataset.libDel);
  if (d && confirm(`Remove "${d.title}" from the library?`)) { await Library.remove(d.id); await renderLibrary(); }
});

async function runLibSearch() {
  const q = $("#libSearch").value.trim();
  if (!q) { $("#libSearchOut").innerHTML = ""; return; }
  const hits = await Library.search(q, 5);
  $("#libSearchOut").innerHTML = hits.map((h) => `
    <div class="lib-hit"><div class="row between"><span class="title-small">${esc(h.title)}${h.section ? ` — ${esc(h.section)}` : ""}${h.para ? ` · para ${esc(h.para)}` : ""}</span><span class="body-small variant mono">${h.score}</span></div>
      <div class="body-small variant">${esc(h.text.length > 360 ? `${h.text.slice(0, 360)}…` : h.text)}</div></div>`).join("")
    || `<div class="header-empty">Nothing in the documents in use matches.</div>`;
}
$("#libSearch").addEventListener("input", () => { clearTimeout(runLibSearch._t); runLibSearch._t = setTimeout(runLibSearch, 250); });
$("#libSearch").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); runLibSearch(); } });

$("#libExport").addEventListener("click", async () => {
  const blob = new Blob([JSON.stringify(await Library.exportBundle())], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `exerciseforge-library-${nowIso().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("#libImport").addEventListener("click", () => $("#libImportFile").click());
$("#libImportFile").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const n = await Library.importBundle(JSON.parse(await file.text()));
    libError("");
    toast(`${n} document${n === 1 ? "" : "s"} added to the library`, true);
  } catch (e) { libError(e instanceof SyntaxError ? "That file isn't an ExerciseForge library export." : e.message); }
  await renderLibrary();
});

// Cited references under an AI result: which extracts it relied on, and what for.
function referencesHtml(d) {
  const refs = d.library || [];
  const cited = (d.references || []).filter((c) => refs.some((r) => r.ref === c.ref));
  if (!cited.length) return "";
  return `<div class="refs"><div class="title-small row">${icon("menu_book")}Doctrine and references</div>
    ${cited.map((c) => {
      const r = refs.find((x) => x.ref === c.ref);
      return `<details class="ref"><summary><span class="tag primary mono">${esc(r.ref)}</span><span class="body-medium"><strong>${esc(r.title)}</strong>${r.section ? ` — ${esc(r.section)}` : ""}${r.para ? `, para ${esc(r.para)}` : ""}</span></summary>
        <div class="body-medium">${esc(c.point)}</div><blockquote class="body-small variant">${esc(r.text)}</blockquote></details>`;
    }).join("")}</div>`;
}

// Save the AAR's lessons to the library, so later exercises' AI can draw on them.
async function aarToLibrary() {
  const ex = state.ex, a = ex.aar;
  if (!a) return;
  const objs = Object.fromEntries(ex.scenario.objectives.map((o) => [o.id, o.text]));
  const text = [
    `# Summary`, a.executive_summary,
    `# Objective assessment`, ...a.objective_assessments.map((o) => `${o.objective_id} ${objs[o.objective_id] || ""}: rated ${o.rating}. Evidence: ${o.evidence} Gaps: ${o.gaps}`),
    `# Sustain`, ...a.sustains, `# Improve`, ...a.improves,
    `# Lessons identified`, ...a.lessons.map((l) => `Observation: ${l.observation} Discussion: ${l.discussion} Recommendation: ${l.recommendation}`),
  ].join("\n\n");
  const doc = await Library.add({ title: `${ex.scenario.title} AAR (${(a.generated || nowIso()).slice(0, 10)})`, kind: "lessons", text, source: "after action review" });
  mutate((x) => { x.aar.libraryDoc = doc.id; Ex.log(x, "system", "EXCON", `After action review saved to the doctrine library as "${doc.title}"`); });
  toast("Lessons saved to the library", true);
}

Library.ready.then(() => Library.docs()).then(renderLibIndicator).catch(() => {});
