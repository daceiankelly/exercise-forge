"use strict";
// Where exercises and NO DUFF alerts are kept.
//   LocalBackend  — this browser (localStorage); other tabs follow via storage events.
//   GitLabBackend — shared. Each exercise is a project in the configured group holding one "state" issue:
//                   the issue description is the starting snapshot and every change is a comment carrying a
//                   small change set (see Diff). Changes are appended, never overwritten, so simultaneous
//                   edits merge and GitLab keeps the audit trail. NO DUFF alerts are issues in a Safety project.

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const slugify = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "x";

// ------------------------------------------------------------------ change sets
// Paths are arrays of keys; an {id} segment addresses an array element by its id, so concurrent edits to
// different injects or log entries never collide. Ops: set, del, ins (keyed insert), push (append), order.
const Diff = (() => {
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const keyed = (arr) => arr.every((x) => isObj(x) && typeof x.id === "string") && new Set(arr.map((x) => x.id)).size === arr.length;

  function diff(a, b, path = [], ops = []) {
    if (same(a, b)) return ops;
    if (isObj(a) && isObj(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (!(k in b)) ops.push({ op: "del", path: [...path, k] });
        else if (!(k in a)) ops.push({ op: "set", path: [...path, k], value: b[k] });
        else diff(a[k], b[k], [...path, k], ops);
      }
      return ops;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (b.length && keyed(b) && keyed(a)) {
        const inA = new Map(a.map((x) => [x.id, x])), inB = new Set(b.map((x) => x.id));
        for (const x of a) if (!inB.has(x.id)) ops.push({ op: "del", path: [...path, { id: x.id }] });
        for (const x of b) {
          if (inA.has(x.id)) diff(inA.get(x.id), x, [...path, { id: x.id }], ops);
          else ops.push({ op: "ins", path, value: x });
        }
        const expected = [...a.filter((x) => inB.has(x.id)).map((x) => x.id), ...b.filter((x) => !inA.has(x.id)).map((x) => x.id)];
        const actual = b.map((x) => x.id);
        if (!same(expected, actual)) ops.push({ op: "order", path, ids: actual });
        return ops;
      }
      if (a.length <= b.length && same(a, b.slice(0, a.length))) {
        for (const x of b.slice(a.length)) ops.push({ op: "push", path, value: x });
        return ops;
      }
    }
    ops.push({ op: "set", path, value: b });
    return ops;
  }

  function get(doc, path) {
    let cur = doc;
    for (const seg of path) {
      if (cur == null) return undefined;
      cur = typeof seg === "object" ? (Array.isArray(cur) ? cur.find((x) => x && x.id === seg.id) : undefined) : cur[seg];
    }
    return cur;
  }

  // Create missing objects along a path of plain keys; returns the parent container or undefined.
  function parentOf(doc, path) {
    let cur = doc;
    for (const seg of path.slice(0, -1)) {
      if (typeof seg === "object") { cur = Array.isArray(cur) ? cur.find((x) => x && x.id === seg.id) : undefined; if (!cur) return undefined; continue; }
      if (cur[seg] == null || typeof cur[seg] !== "object") cur[seg] = {};
      cur = cur[seg];
    }
    return cur;
  }

  function apply(doc, op) {
    if (op.op === "ins" || op.op === "push" || op.op === "order") {
      let arr = get(doc, op.path);
      if (!Array.isArray(arr)) {
        const parent = parentOf(doc, op.path), last = op.path[op.path.length - 1];
        if (!parent || typeof last === "object") return;
        arr = parent[last] = [];
      }
      if (op.op === "push") arr.push(clone(op.value));
      else if (op.op === "ins") {
        const i = arr.findIndex((x) => x && x.id === op.value.id);
        if (i >= 0) arr[i] = clone(op.value); else arr.push(clone(op.value));
      } else {
        const rank = new Map(op.ids.map((id, i) => [id, i]));
        const sorted = arr.map((x, i) => [x, i]).sort((p, q) =>
          (rank.get(p[0]?.id) ?? Infinity) - (rank.get(q[0]?.id) ?? Infinity) || p[1] - q[1]).map((p) => p[0]);
        arr.splice(0, arr.length, ...sorted);
      }
      return;
    }
    const parent = parentOf(doc, op.path), last = op.path[op.path.length - 1];
    if (!parent) return;
    if (typeof last === "object") {
      if (!Array.isArray(parent)) return;
      const i = parent.findIndex((x) => x && x.id === last.id);
      if (op.op === "del") { if (i >= 0) parent.splice(i, 1); } else if (i >= 0) parent[i] = clone(op.value); else parent.push(clone(op.value));
    } else if (op.op === "del") delete parent[last];
    else parent[last] = clone(op.value);
  }

  return { diff, apply, same };
})();

// ------------------------------------------------------------------ GitLab REST client

class GitLabError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

const GL = (() => {
  const base = () => (Settings.get().gitlabUrl || "").trim().replace(/\/+$/, "");
  const enc = encodeURIComponent;

  function token() {
    const s = Settings.get();
    const t = s.gitlabAuth === "oauth" ? s.gitlabOAuth?.access : s.gitlabToken;
    if (!t) throw new GitLabError("Not signed in to GitLab. Open Settings → Collaboration.", 401);
    return t;
  }

  async function req(path, { method = "GET", body, query, raw } = {}, retried = false) {
    if (!base()) throw new GitLabError("No GitLab URL set. Open Settings → Collaboration.", 0);
    let url = `${base()}/api/v4${path}`;
    if (query) url += "?" + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== "")).toString();
    const headers = { authorization: `Bearer ${token()}` };
    if (body) headers["content-type"] = "application/json";
    let res;
    try {
      res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new GitLabError(`Can't reach GitLab at ${base()} (${e.message}).`, 0);
    }
    if (res.status === 401 && !retried && Settings.get().gitlabAuth === "oauth" && await OAuth.refresh()) {
      return req(path, { method, body, query, raw }, true);
    }
    if (!res.ok) {
      let m = res.statusText;
      try {
        const j = await res.json();
        m = typeof j.message === "string" ? j.message : j.message ? JSON.stringify(j.message) : j.error_description || j.error || m;
      } catch {}
      throw new GitLabError(`GitLab ${res.status}: ${m}`, res.status);
    }
    if (raw) return res;
    return res.status === 204 ? null : res.json();
  }

  // Follow x-next-page pagination.
  async function all(path, query = {}, maxPages = 100) {
    const out = [];
    for (let page = 1; page && page <= maxPages;) {
      const res = await req(path, { query: { per_page: 100, ...query, page }, raw: true });
      out.push(...await res.json());
      page = +res.headers.get("x-next-page") || 0;
    }
    return out;
  }

  return { req, all, enc, base };
})();

// ------------------------------------------------------------------ GitLab OAuth (authorization code + PKCE)

const OAuth = (() => {
  const FLOW = "exforge.oauth-flow";
  const redirectUri = () => location.origin + location.pathname;
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const usable = () => location.protocol === "https:" || location.hostname === "localhost";

  async function start() {
    const s = Settings.get();
    if (!usable()) throw new Error("“Sign in with GitLab” needs the app served over https, e.g. GitLab Pages. When running from a file, use an access token.");
    if (!GL.base()) throw new Error("Enter the GitLab URL first.");
    if (!s.gitlabClientId) throw new Error("Enter the OAuth application ID first.");
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    sessionStorage.setItem(FLOW, JSON.stringify({ verifier, state }));
    location.assign(`${GL.base()}/oauth/authorize?` + new URLSearchParams({
      client_id: s.gitlabClientId, redirect_uri: redirectUri(), response_type: "code", state, scope: "api",
      code_challenge: challenge, code_challenge_method: "S256",
    }));
  }

  async function exchange(params) {
    const res = await fetch(`${GL.base()}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: Settings.get().gitlabClientId, ...params }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error(`GitLab sign-in failed: ${j.error_description || j.error || res.status}`);
    const exp = ((j.created_at || Date.now() / 1000) + (j.expires_in || 7200)) * 1000;
    Settings.update({ gitlabOAuth: { access: j.access_token, refresh: j.refresh_token, exp } });
  }

  // Finish the redirect back from GitLab (?code=…&state=…). Returns true if a sign-in completed.
  async function complete() {
    const q = new URLSearchParams(location.search);
    if (!q.has("code") && !q.has("error")) return false;
    const flow = JSON.parse(sessionStorage.getItem(FLOW) || "null");
    sessionStorage.removeItem(FLOW);
    history.replaceState(null, "", redirectUri() + location.hash);
    if (q.has("error")) throw new Error(`GitLab sign-in was cancelled: ${q.get("error_description") || q.get("error")}`);
    if (!flow || flow.state !== q.get("state")) throw new Error("GitLab sign-in failed (state mismatch). Try again.");
    await exchange({ grant_type: "authorization_code", code: q.get("code"), redirect_uri: redirectUri(), code_verifier: flow.verifier });
    return true;
  }

  async function refresh() {
    const o = Settings.get().gitlabOAuth;
    if (!o?.refresh) return false;
    try { await exchange({ grant_type: "refresh_token", refresh_token: o.refresh, redirect_uri: redirectUri() }); return true; }
    catch { return false; }
  }

  return { start, complete, refresh, redirectUri, usable };
})();

// ------------------------------------------------------------------ local backend

const LocalBackend = {
  kind: "local",
  NODUFF_KEY: "exforge.noduffs",
  async list() { return Store.list(); },
  async open(id) { return Store.get(id); },
  async create(ex) { Store.save(ex); return ex; },
  mutate(id, fn) {
    const ex = Store.get(id);
    if (!ex) throw new Error("Exercise not found");
    fn(ex);
    Store.save(ex);
    return ex;
  },
  async remove(id) { Store.del(id); },
  async pull() { return null; },
  async flush() {},
  pending() { return 0; },

  // NO DUFF records live in their own key so an alert can span exercises.
  all() { return Store.json(this.NODUFF_KEY, []); },
  async noDuffs() { return this.all().filter((n) => n.active); },
  async noDuffInfo(id) { return this.all().find((n) => n.id === id) || null; },
  async declare(nd) {
    const rec = { ...nd, id: `nd-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, active: true };
    Store.write(this.NODUFF_KEY, JSON.stringify([...this.all(), rec]));
    return rec;
  },
  async standDown(nd, by, outcome) {
    Store.write(this.NODUFF_KEY, JSON.stringify(this.all().map((n) =>
      n.id === nd.id ? { ...n, active: false, clearedBy: by, clearedAt: new Date().toISOString(), outcome } : n)));
  },
};

// ------------------------------------------------------------------ GitLab backend

const GitLabBackend = (() => {
  const EVENT = "<!-- exforge:event v1 -->", SNAP = "<!-- exforge:snapshot v1 -->", ND = "<!-- exforge:noduff v1 -->";
  const EX_LABEL = "exforge-exercise", CELL_LABEL = "exforge-cell";
  const CELL = "<!-- exforge:cell v1 -->", CELL_SNAP = "<!-- exforge:cell-brief v1 -->";
  const EXCON_LEVEL = 30;           // Developer and above run the exercise; Reporters are observers.
  const channels = new Map();       // "projectId-iid" → cell channel { projectId, iid, brief, events[], lastNoteId, levels, webUrl }
  const cache = new Map();          // exercise id → { projectId, iid, base, pending[], lastNoteId, seen:Set, webUrl }
  let ids = null;                   // { key, groupId, groupPath, safetyId }

  const jsonBlock = (text) => {
    const m = [...String(text || "").matchAll(/```json\n([\s\S]*?)\n```/g)].pop();
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
  };
  const fence = (obj) => "```json\n" + JSON.stringify(obj) + "\n```";
  const idOf = (projectId, iid) => `gl-${projectId}-${iid}`;
  const parseId = (id) => { const m = /^gl-(\d+)-(\d+)$/.exec(id); if (!m) throw new Error("Not a GitLab exercise"); return [+m[1], +m[2]]; };
  const labelsFor = (ex) => [EX_LABEL, `phase-${ex.phase}`, `type-${slugify(ex.params.exercise_type)}`, ex.site && `site-${slugify(ex.site)}`].filter(Boolean);
  const labelValue = (labels, prefix) => (labels.find((l) => l.startsWith(prefix)) || "").slice(prefix.length);

  async function init() {
    const s = Settings.get(), key = `${GL.base()}|${s.gitlabGroup}|${s.gitlabSafety}`;
    if (ids?.key === key) return ids;
    if (!s.gitlabGroup) throw new GitLabError("No exercise group set. Open Settings → Collaboration.", 0);
    const group = await GL.req(`/groups/${GL.enc(s.gitlabGroup.trim())}`, { query: { with_projects: false } });
    let safetyId = null;
    if (s.gitlabSafety) safetyId = (await GL.req(`/projects/${GL.enc(s.gitlabSafety.trim())}`)).id;
    ids = { key, groupId: group.id, groupPath: group.full_path, safetyId };
    return ids;
  }

  let meCache = null;
  const me = async () => (meCache ??= await GL.req("/user"));

  // Everyone's access level in a project (inherited memberships included), cached for five minutes.
  const levelCache = new Map();
  async function levels(projectId, force = false) {
    const hit = levelCache.get(projectId);
    if (hit && !force && Date.now() - hit.at < 300000) return hit.map;
    const list = await GL.all(`/projects/${projectId}/members/all`, {}, 20);
    const map = new Map(list.map((m) => [m.id, m.access_level]));
    levelCache.set(projectId, { at: Date.now(), map });
    return map;
  }
  async function levelsFor(projectId, current, notes) {
    const unknown = notes.some((n) => n.author && !current?.has(n.author.id));
    return unknown || !current ? levels(projectId, !!current) : current;
  }

  // Observers (below Developer) may only add observations to the log; anything else they post is ignored,
  // so a player or observer can't alter the exercise by writing comments by hand.
  function allowedOps(ops, level) {
    if (level >= EXCON_LEVEL) return ops;
    return ops.filter((o) => o.op === "ins" && o.path.length === 1 && o.path[0] === "log" && o.value?.kind === "observation");
  }

  function view(c) {
    const doc = clone(c.base);
    for (const ev of c.pending) for (const op of ev.ops) Diff.apply(doc, op);
    doc.id = c.id;
    return doc;
  }

  function ingest(c, notes) {
    let changed = false;
    for (const n of notes.filter((n) => n.id > c.lastNoteId).sort((a, b) => a.id - b.id)) {
      c.lastNoteId = n.id;
      if (n.system || !String(n.body).startsWith(EVENT)) continue;
      const ev = jsonBlock(n.body);
      if (!ev?.eid || !Array.isArray(ev.ops) || c.seen.has(ev.eid)) continue;
      c.seen.add(ev.eid);
      for (const op of allowedOps(ev.ops, c.levels?.get(n.author?.id) ?? 0)) Diff.apply(c.base, op);
      c.pending = c.pending.filter((p) => p.eid !== ev.eid);
      changed = true;
    }
    return changed;
  }

  function summary(ops, doc) {
    const ins = ops.find((o) => o.op === "ins" && o.path.length === 1 && o.path[0] === "log");
    if (ins) return `**${ins.value.actor}** (${ins.value.kind}): ${String(ins.value.text).slice(0, 240)}`;
    const phase = ops.find((o) => o.path.length === 1 && o.path[0] === "phase");
    if (phase) return `Exercise ${phase.value}`;
    if (ops.some((o) => o.path[0] === "clock_min")) return `Exercise clock set to T+${doc.clock_min} min`;
    return "Exercise updated";
  }

  return {
    kind: "gitlab",
    init,
    resetIds() { ids = null; meCache = null; levelCache.clear(); },

    // Exercises you can open: full exercises (EXCON / observers), plus cell channels for players who
    // only belong to a cell project.
    async list() {
      const { groupId } = await init();
      const [masters, cellIssues] = await Promise.all([
        GL.all(`/groups/${groupId}/issues`, { labels: EX_LABEL, state: "opened", scope: "all" }, 5),
        GL.all(`/groups/${groupId}/issues`, { labels: CELL_LABEL, state: "opened", scope: "all" }, 5),
      ]);
      const out = masters.map((i) => ({
        id: idOf(i.project_id, i.iid), title: i.title, created: i.created_at,
        phase: labelValue(i.labels, "phase-") || "planning",
        type: ["TTX", "CPX", "FTX", "Wargame", "Staff Ride"].find((t) => slugify(t) === labelValue(i.labels, "type-")) || "",
        webUrl: i.web_url,
      }));
      const masterIds = new Set(out.map((e) => e.id));
      for (const i of cellIssues) {
        const masterId = labelValue(i.labels, "exercise-");
        if (masterIds.has(masterId)) continue;
        out.push({ id: `glc-${i.project_id}-${i.iid}`, title: i.title, created: i.created_at, phase: "cell", type: "",
          cell: labelValue(i.labels, "cell-"), masterId, webUrl: i.web_url });
      }
      return out.sort((a, b) => b.created.localeCompare(a.created));
    },

    async create(ex) {
      const { groupId } = await init();
      ex = clone(ex);
      ex.site = Settings.get().gitlabSite || "";
      const project = await GL.req("/projects", { method: "POST", body: {
        name: `${ex.scenario.title} (${ex.id.slice(0, 4)})`, path: `${slugify(ex.scenario.title)}-${ex.id.slice(0, 6)}`,
        namespace_id: groupId, visibility: "private", description: `ExerciseForge exercise: ${ex.scenario.title}`,
      } });
      const issue = await GL.req(`/projects/${project.id}/issues`, { method: "POST", body: {
        title: ex.scenario.title, labels: labelsFor(ex).join(","),
        description: `${SNAP}\n**ExerciseForge exercise state.** Changes are recorded as comments below; don't edit this description.\n\n${fence(ex)}`,
      } });
      const id = idOf(project.id, issue.iid);
      const c = { id, projectId: project.id, iid: issue.iid, base: { ...ex, id }, pending: [], lastNoteId: 0, seen: new Set(), webUrl: issue.web_url };
      c.levels = await levels(project.id);
      c.myLevel = c.levels.get((await me()).id) ?? 50;
      cache.set(id, c);
      return view(c);
    },

    async open(id) {
      const [projectId, iid] = parseId(id);
      const issue = await GL.req(`/projects/${projectId}/issues/${iid}`);
      const base = jsonBlock(issue.description);
      if (!base?.scenario) throw new Error("That GitLab issue doesn't contain an ExerciseForge exercise.");
      const c = { id, projectId, iid, base, pending: [], lastNoteId: 0, seen: new Set(), webUrl: issue.web_url };
      const notes = await GL.all(`/projects/${projectId}/issues/${iid}/notes`, { sort: "asc", order_by: "created_at" });
      c.levels = await levels(projectId);
      c.myLevel = c.levels.get((await me()).id) ?? 0;
      ingest(c, notes);
      cache.set(id, c);
      return view(c);
    },

    // Apply locally at once; the change is posted in the background and confirmed on the next pull.
    mutate(id, fn) {
      const c = cache.get(id);
      if (!c) throw new Error("Exercise not loaded");
      const before = view(c), after = clone(before);
      fn(after);
      const ops = Diff.diff(before, after);
      if (!ops.length) return after;
      c.pending.push({ eid: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, ops, summary: summary(ops, after) });
      if (before.phase !== after.phase) {
        GL.req(`/projects/${c.projectId}/issues/${c.iid}`, { method: "PUT", body: { labels: labelsFor(after).join(",") } }).catch(() => {});
      }
      this.flush(id).catch(() => {});
      return view(c);
    },

    // Post queued changes in order. Concurrent callers share one run.
    flush(id) {
      const c = cache.get(id);
      if (!c) return Promise.resolve();
      c.flushing ??= this.sendQueued(c).finally(() => { c.flushing = null; });
      return c.flushing;
    },

    async sendQueued(c) {
      for (let ev; (ev = c.pending.find((p) => !p.sent));) {
        const body = `${EVENT}\n${ev.summary}\n\n<details><summary>Change data</summary>\n\n${fence({ eid: ev.eid, ops: ev.ops })}\n\n</details>`;
        await GL.req(`/projects/${c.projectId}/issues/${c.iid}/notes`, { method: "POST", body: { body } });
        ev.sent = true;
      }
    },

    pending(id) { return cache.get(id)?.pending.filter((p) => !p.sent).length || 0; },

    // Fetch comments newer than the last one seen. Returns the updated exercise, or null if nothing changed.
    async pull(id) {
      const c = cache.get(id);
      if (!c) return null;
      await this.flush(id);
      const fresh = [];
      for (let page = 1; page <= 20; page++) {
        const notes = await GL.req(`/projects/${c.projectId}/issues/${c.iid}/notes`, { query: { sort: "desc", order_by: "created_at", per_page: 50, page } });
        fresh.push(...notes.filter((n) => n.id > c.lastNoteId));
        if (notes.length < 50 || notes.some((n) => n.id <= c.lastNoteId)) break;
      }
      c.levels = await levelsFor(c.projectId, c.levels, fresh);
      return ingest(c, fresh) ? view(c) : null;
    },

    // Archive, don't delete: close the state issue so it drops out of the list; the project and history stay.
    async remove(id) {
      const c = cache.get(id), [projectId, iid] = c ? [c.projectId, c.iid] : parseId(id);
      await GL.req(`/projects/${projectId}/issues/${iid}`, { method: "PUT", body: { state_event: "close", add_labels: "exforge-archived" } });
      for (const ch of Object.values(c ? view(c).cellChannels || {} : {})) {
        await GL.req(`/projects/${ch.projectId}/issues/${ch.iid}`, { method: "PUT", body: { state_event: "close", add_labels: "exforge-archived" } }).catch(() => {});
      }
      cache.delete(id);
    },

    webUrl(id) { return cache.get(id)?.webUrl; },

    // "excon" for Developer and above on the exercise project, otherwise "observer".
    role(id) { return (cache.get(id)?.myLevel ?? 0) >= EXCON_LEVEL ? "excon" : "observer"; },
    projectOf(id) { return cache.get(id)?.projectId; },

    // ---- Cell channels: one private project per cell with a single issue. EXCON delivers released
    // injects and messages into it; players acknowledge and report back in it. Players are members of
    // their cell's project only, so GitLab itself keeps BLUE and RED traffic apart.
    async createCellChannel(masterId, cell, brief) {
      const c = cache.get(masterId);
      const master = await GL.req(`/projects/${c.projectId}`);
      const project = await GL.req("/projects", { method: "POST", body: {
        name: `${master.name} ${cell.toUpperCase()} cell`, path: `${master.path}-${cell}`,
        namespace_id: master.namespace?.id ?? (await init()).groupId, visibility: "private",
        description: `ExerciseForge ${cell.toUpperCase()} cell channel for ${brief.title}`,
      } });
      const issue = await GL.req(`/projects/${project.id}/issues`, { method: "POST", body: {
        title: `${brief.title} — ${cell.toUpperCase()} cell`,
        labels: [CELL_LABEL, `cell-${cell}`, `exercise-${masterId}`].join(","),
        description: `${CELL_SNAP}\n**ExerciseForge ${cell.toUpperCase()} cell channel.** EXCON delivers injects and messages here; the cell acknowledges and reports back.\n\n${fence({ ...brief, cell, masterId })}`,
      } });
      return { projectId: project.id, iid: issue.iid, webUrl: issue.web_url };
    },

    async openChannel(id) {
      const m = /^glc-(\d+)-(\d+)$/.exec(id);
      if (!m) throw new Error("Not a cell channel");
      const [projectId, iid] = [+m[1], +m[2]];
      const issue = await GL.req(`/projects/${projectId}/issues/${iid}`);
      const brief = jsonBlock(issue.description);
      if (!brief?.cell) throw new Error("That GitLab issue isn't an ExerciseForge cell channel.");
      const ch = { projectId, iid, brief, events: [], lastNoteId: 0, levels: null, webUrl: issue.web_url, id };
      channels.set(`${projectId}-${iid}`, ch);
      await this.channelPull(ch);
      return ch;
    },

    // New channel events since the last pull. Deliveries and status updates only count when posted by
    // EXCON (Developer and above on the cell project); anything else from a player is ignored.
    async channelPull(ref) {
      const key = `${ref.projectId}-${ref.iid}`;
      const ch = channels.get(key) || { projectId: ref.projectId, iid: ref.iid, events: [], lastNoteId: 0, levels: null };
      channels.set(key, ch);
      const fresh = [];
      for (let page = 1; page <= 50; page++) {
        const notes = await GL.req(`/projects/${ch.projectId}/issues/${ch.iid}/notes`, { query: { sort: "desc", order_by: "created_at", per_page: 100, page } });
        fresh.push(...notes.filter((n) => n.id > ch.lastNoteId));
        if (notes.length < 100 || notes.some((n) => n.id <= ch.lastNoteId)) break;
      }
      ch.levels = await levelsFor(ch.projectId, ch.levels, fresh);
      for (const n of fresh.sort((a, b) => a.id - b.id)) {
        ch.lastNoteId = n.id;
        if (n.system || !String(n.body).startsWith(CELL)) continue;
        const ev = jsonBlock(n.body);
        if (!ev?.type) continue;
        const trusted = (ch.levels.get(n.author?.id) ?? 0) >= EXCON_LEVEL;
        if (["deliver", "status", "world"].includes(ev.type) && !trusted) continue;
        ch.events.push({ ...ev, noteId: n.id, author: n.author, at: ev.at || n.created_at });
      }
      return ch.events;
    },

    async channelPost(ref, ev) {
      const text = ev.type === "deliver" ? `Delivered ${ev.item.type}: ${ev.item.title || String(ev.item.text).slice(0, 120)}`
        : ev.type === "status" ? `Exercise ${ev.phase}, T+${ev.clock} min`
        : ev.type === "world" ? `Map updated (${ev.view?.units?.length ?? 0} units visible to this cell)`
        : ev.type === "ack" ? `**${ev.by}** acknowledged ${ev.ref}`
        : `**${ev.by}** (${ev.kind}) → ${ev.to}: ${String(ev.text).slice(0, 200)}`;
      return GL.req(`/projects/${ref.projectId}/issues/${ref.iid}/notes`, { method: "POST", body: { body: `${CELL}\n${text}\n\n${fence(ev)}` } });
    },

    // ---- membership
    async members(projectId) { return GL.all(`/projects/${projectId}/members`, {}, 10); },
    async addMember(projectId, username, level) {
      const user = (await GL.req("/users", { query: { username: username.replace(/^@/, "") } }))[0];
      if (!user) throw new Error(`No GitLab user called “${username}”.`);
      try {
        await GL.req(`/projects/${projectId}/members`, { method: "POST", body: { user_id: user.id, access_level: level } });
      } catch (e) {
        if (e.status !== 409) throw e;
        await GL.req(`/projects/${projectId}/members/${user.id}`, { method: "PUT", body: { access_level: level } });
      }
      levelCache.delete(projectId);
      return user;
    },
    async removeMember(projectId, userId) {
      await GL.req(`/projects/${projectId}/members/${userId}`, { method: "DELETE" });
      levelCache.delete(projectId);
    },

    // ---- NO DUFF: issues labelled NO-DUFF in the Safety project; open = active.
    async noDuffs() {
      const { safetyId } = await init();
      if (!safetyId) throw new GitLabError("No Safety project set. Open Settings → Collaboration.", 0);
      const issues = await GL.req(`/projects/${safetyId}/issues`, { query: { labels: "NO-DUFF", state: "opened", per_page: 100 } });
      return issues.map((i) => {
        const rec = jsonBlock(i.description) || {};
        return { ...rec, id: `gl-nd-${i.iid}`, iid: i.iid, active: true, webUrl: i.web_url, raisedBy: rec.raisedBy || i.author?.name };
      });
    },

    async noDuffInfo(id) {
      const { safetyId } = await init();
      const i = await GL.req(`/projects/${safetyId}/issues/${id.replace("gl-nd-", "")}`);
      const rec = jsonBlock(i.description) || {};
      const notes = await GL.req(`/projects/${safetyId}/issues/${i.iid}/notes`, { query: { sort: "desc", per_page: 20 } });
      const sd = notes.map((n) => jsonBlock(n.body)).find((j) => j?.standDown);
      return { ...rec, id, active: i.state === "opened", clearedBy: sd?.by || i.closed_by?.name, clearedAt: i.closed_at, outcome: sd?.outcome || "" };
    },

    async declare(nd) {
      const { safetyId } = await init();
      if (!safetyId) throw new GitLabError("No Safety project set, so the NO DUFF can't be broadcast.", 0);
      const s = Settings.get();
      const labels = ["NO-DUFF", nd.scope === "site" ? "noduff-site" : "noduff-exercise",
        nd.site && `site-${slugify(nd.site)}`, nd.exerciseId && `exercise-${nd.exerciseId}`].filter(Boolean);
      const text = [
        `${ND}`, `## 🚨 NO DUFF — REAL-WORLD EMERGENCY`, "",
        `| | |`, `|---|---|`,
        `| **Nature** | ${nd.nature} |`, `| **Location** | ${nd.location} |`,
        `| **Scope** | ${nd.scope === "site" ? `Whole site${nd.site ? `: ${nd.site}` : ""}` : `Exercise: ${nd.exerciseTitle}`} |`,
        `| **Declared by** | ${nd.raisedBy} |`, "",
        nd.instructions ? `**Instructions:** ${nd.instructions}` : "",
        s.gitlabNotify ? `\n${s.gitlabNotify}` : "", "", fence(nd),
      ].join("\n");
      const issue = await GL.req(`/projects/${safetyId}/issues`, { method: "POST", body: {
        title: `NO DUFF — ${nd.nature} — ${nd.location}`, labels: labels.join(","), description: text,
      } });
      return { ...nd, id: `gl-nd-${issue.iid}`, iid: issue.iid, active: true, webUrl: issue.web_url };
    },

    async standDown(nd, by, outcome) {
      const { safetyId } = await init();
      await GL.req(`/projects/${safetyId}/issues/${nd.iid}/notes`, { method: "POST", body: {
        body: `**NO DUFF stood down** by ${by}.${outcome ? ` ${outcome}` : ""}\n\n${fence({ standDown: true, by, outcome })}`,
      } });
      await GL.req(`/projects/${safetyId}/issues/${nd.iid}`, { method: "PUT", body: { state_event: "close" } });
    },

    async createSafetyProject() {
      const { groupId } = await init();
      const p = await GL.req("/projects", { method: "POST", body: {
        name: "Safety", path: "safety", namespace_id: groupId, visibility: "private",
        description: "ExerciseForge NO DUFF alerts. Every exercise participant needs at least Reporter access.",
      } });
      return p.path_with_namespace;
    },

    // Connection check for the settings dialog.
    async test() {
      ids = null;
      const out = { user: await GL.req("/user") };
      const s = Settings.get();
      try {
        const g = await GL.req(`/groups/${GL.enc(s.gitlabGroup.trim())}`, { query: { with_projects: false } });
        out.group = g.full_path;
      } catch (e) { out.groupError = e.message; }
      if (s.gitlabSafety) {
        try { out.safety = (await GL.req(`/projects/${GL.enc(s.gitlabSafety.trim())}`)).path_with_namespace; }
        catch (e) { out.safetyError = e.message; }
      } else out.safetyError = "Not set";
      return out;
    },
  };
})();

const backend = () => (Settings.get().storage === "gitlab" ? GitLabBackend : LocalBackend);

// A timer that keeps its pace in background tabs: browsers throttle page timers there, but not worker timers.
function makeTicker(ms, cb) {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: "text/javascript" }));
    const w = new Worker(url);
    w.onmessage = cb;
    return { stop: () => { w.terminate(); URL.revokeObjectURL(url); } };
  } catch {
    const t = setInterval(cb, ms);
    return { stop: () => clearInterval(t) };
  }
}
