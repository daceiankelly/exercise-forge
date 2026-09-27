"use strict";
// Browser persistence. Exercises and settings live in this browser's localStorage; use
// Export/Import to move them between machines. Falls back to memory if storage is blocked.

const Store = (() => {
  const mem = {};
  const read = (k) => { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } };
  const write = (k, v) => {
    try { localStorage.setItem(k, v); }
    catch (e) {
      if (e && e.name === "QuotaExceededError") throw new Error("Browser storage is full. Export and delete old exercises.");
      mem[k] = v;
    }
  };
  const remove = (k) => { try { localStorage.removeItem(k); } catch { delete mem[k]; } };
  const json = (k, dflt) => { try { return JSON.parse(read(k)) ?? dflt; } catch { return dflt; } };

  const INDEX = "exforge.index";
  const exKey = (id) => `exforge.ex.${id}`;

  function save(ex) {
    write(exKey(ex.id), JSON.stringify(ex));
    const idx = json(INDEX, []).filter((id) => id !== ex.id);
    idx.unshift(ex.id);
    write(INDEX, JSON.stringify(idx));
  }

  const get = (id) => json(exKey(id), null);

  function list() {
    return json(INDEX, []).map(get).filter(Boolean)
      .sort((a, b) => b.created.localeCompare(a.created))
      .map((ex) => ({ id: ex.id, title: ex.scenario.title, created: ex.created, phase: ex.phase, type: ex.params.exercise_type }));
  }

  function del(id) {
    remove(exKey(id));
    write(INDEX, JSON.stringify(json(INDEX, []).filter((x) => x !== id)));
  }

  return { save, get, list, del, read, write, remove, json };
})();

const Settings = (() => {
  const KEY = "exforge.settings";
  const KEYS = "exforge.keys";           // API keys, stored only if the user ticks "remember"
  const DEFAULTS = {
    provider: "demo",                    // demo | anthropic | openai
    anthropicModel: "claude-opus-5",
    anthropicBaseUrl: "https://api.anthropic.com",
    openaiModel: "gpt-5",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiReasoningEffort: "",           // "" = don't send; low | medium | high for reasoning models
    openaiCertMode: "none",              // none | browser (installed cert, mTLS) | header
    openaiCertHeader: "X-Client-Cert",
    openaiCertFormat: "der-base64",      // der-base64 | pem-urlencoded
    openaiCert: null,                    // public certificate only (see cert.js)
    storage: "local",                    // local (this browser) | gitlab (shared)
    gitlabUrl: "",
    gitlabGroup: "",                     // group path; each exercise becomes a project in it
    gitlabSafety: "",                    // project path holding NO DUFF issues
    gitlabSite: "",
    gitlabNotify: "",                    // optional @user / @group mentioned on NO DUFF issues
    gitlabPollSec: 15,
    gitlabAuth: "token",                 // token | oauth
    gitlabClientId: "",
    mapTileUrl: "",                      // tile server on your network, {z}/{x}/{y}
    mapTileKeep: true,                   // keep viewed tiles for offline use
    mapPackUrl: "",                      // PMTiles file served over http (e.g. next to the app on Pages)
    rememberKeys: false,
  };
  // Secrets: API keys, custom header values, GitLab credentials. Kept in sessionStorage (this tab, survives
  // reloads and the OAuth redirect, cleared when the tab closes) unless "remember" is on.
  const SECRETS = { anthropicKey: "", openaiKey: "", openaiHeaders: [], gitlabToken: "", gitlabOAuth: null };
  const SESSION_KEY = "exforge.session-keys";
  let memory = {};
  const session = {
    read() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || {}; } catch { return memory; } },
    write(v) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)); } catch { memory = v; } },
    clear() { try { sessionStorage.removeItem(SESSION_KEY); } catch { memory = {}; } },
  };

  function get() {
    const s = { ...DEFAULTS, ...Store.json(KEY, {}) };
    const src = s.rememberKeys ? Store.json(KEYS, {}) : session.read();
    const secrets = {};
    for (const k of Object.keys(SECRETS)) secrets[k] = src[k] ?? SECRETS[k];
    return { ...s, ...secrets };
  }

  function set(next) {
    const secrets = {}, rest = {};
    for (const [k, v] of Object.entries(next)) (k in SECRETS ? secrets : rest)[k] = v;
    Store.write(KEY, JSON.stringify(rest));
    const all = { ...SECRETS, ...secrets };
    if (rest.rememberKeys) { Store.write(KEYS, JSON.stringify(all)); session.clear(); }
    else { Store.remove(KEYS); session.write(all); }
  }

  const update = (partial) => set({ ...get(), ...partial });

  return { get, set, update, DEFAULTS, SECRETS };
})();
