"use strict";
// LLM access straight from the browser, with three providers:
//   anthropic: Claude Messages API (streaming, adaptive thinking, structured outputs, prompt caching)
//   openai:    Chat Completions API, which also works with OpenAI-compatible endpoints via base URL
//   demo:      canned responses, no network

const LLM = (() => {
  class LLMError extends Error {}

  // Server-sent events: yields each `data:` payload parsed as JSON.
  async function* sse(res) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try { yield JSON.parse(data); } catch { /* ignore keep-alives / partial junk */ }
      }
    }
  }

  async function httpError(res, provider) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.error?.message || JSON.stringify(j); } catch {}
    if (res.status === 401 || res.status === 403) return new LLMError(`${provider}: authentication failed. Check the API key in Settings. (${msg})`);
    if (res.status === 429) return new LLMError(`${provider}: rate limited. Wait a moment and retry. (${msg})`);
    return new LLMError(`${provider} API error ${res.status}: ${msg}`);
  }

  async function post(url, headers, body, provider, credentials = "same-origin") {
    let res;
    try {
      res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), credentials });
    } catch (e) {
      const hint = credentials === "include"
        ? " With an installed client certificate the server must allow credentialed CORS (Access-Control-Allow-Credentials: true)."
        : " If you added custom headers, the server's CORS policy must allow them.";
      throw new LLMError(`Could not reach ${provider} (${e.message}). Check the base URL and your network.${hint}`);
    }
    if (!res.ok) throw await httpError(res, provider);
    return res;
  }

  // ---------------------------------------------------------------- Anthropic

  async function anthropic({ system, messages, schema, effort, maxTokens, onText, onReset }) {
    const s = Settings.get();
    if (!s.anthropicKey) throw new LLMError("No Anthropic API key. Add one in Settings.");
    const model = s.anthropicModel;
    const body = {
      model,
      max_tokens: maxTokens,
      stream: true,
      // Stable prompt, then the per-exercise scenario (then persona): each block is cached.
      system: system.map((text) => ({ type: "text", text, cache_control: { type: "ephemeral" } })),
      messages,
    };
    const headers = {
      "x-api-key": s.anthropicKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
    const modern = !/haiku|claude-3|claude-(sonnet|opus)-4-[0-5]\b/.test(model);
    if (modern) {
      body.thinking = { type: "adaptive" };
      body.output_config = { effort };
    }
    if (schema) body.output_config = { ...body.output_config, format: { type: "json_schema", schema } };
    if (/^claude-(opus-5|fable-5)/.test(model)) {
      // Re-run a safety-declined request on Anthropic's recommended fallback model.
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      body.fallbacks = "default";
    }

    const res = await post(`${s.anthropicBaseUrl.replace(/\/$/, "")}/v1/messages`, headers, body, "Anthropic");
    let text = "", stop = null;
    for await (const ev of sse(res)) {
      if (ev.type === "content_block_start" && ev.content_block?.type === "fallback") {
        text = ""; onReset?.();          // a fallback model restarts the answer
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        text += ev.delta.text; onText?.(ev.delta.text);
      } else if (ev.type === "message_delta" && ev.delta?.stop_reason) {
        stop = ev.delta.stop_reason;
      } else if (ev.type === "error") {
        throw new LLMError(`Anthropic stream error: ${ev.error?.message || "unknown"}`);
      }
    }
    if (stop === "refusal") throw new LLMError("The model declined this request. Rephrase it as exercise-control material.");
    if (stop === "max_tokens") throw new LLMError("Response was cut off (max tokens). Try fewer injects or a shorter exercise.");
    return text;
  }

  // ---------------------------------------------------------------- OpenAI

  async function openai({ system, messages, schema, schemaName, onText }) {
    const s = Settings.get();
    const custom = (s.openaiHeaders || []).filter((h) => h.name);
    if (!s.openaiKey && !custom.length) throw new LLMError("No OpenAI API key or custom auth header. Add one in Settings.");

    const headers = {};
    if (s.openaiKey) headers.authorization = `Bearer ${s.openaiKey}`;
    for (const h of custom) headers[h.name] = h.value;          // custom headers can override the defaults
    let credentials = "same-origin";
    if (s.openaiCertMode === "browser") {
      credentials = "include";                                   // lets the browser present an installed client cert (mTLS)
    } else if (s.openaiCertMode === "header") {
      if (!s.openaiCert) throw new LLMError("Certificate header mode is on but no certificate is loaded. Load one in Settings.");
      headers[s.openaiCertHeader || "X-Client-Cert"] = Cert.headerValue(s.openaiCert, s.openaiCertFormat);
    }

    const body = {
      model: s.openaiModel,
      stream: true,
      messages: [{ role: "system", content: system.join("\n\n") }, ...messages],
    };
    if (schema) body.response_format = { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } };
    if (s.openaiReasoningEffort) body.reasoning_effort = s.openaiReasoningEffort;

    const res = await post(`${s.openaiBaseUrl.replace(/\/$/, "")}/chat/completions`, headers, body, "OpenAI", credentials);
    let text = "", refusal = "", stop = null;
    for await (const ev of sse(res)) {
      if (ev.error) throw new LLMError(`OpenAI stream error: ${ev.error.message || "unknown"}`);
      const c = ev.choices?.[0];
      if (!c) continue;
      if (c.delta?.content) { text += c.delta.content; onText?.(c.delta.content); }
      if (c.delta?.refusal) refusal += c.delta.refusal;
      if (c.finish_reason) stop = c.finish_reason;
    }
    if (refusal || stop === "content_filter") throw new LLMError(`The model declined this request. ${refusal}`.trim());
    if (stop === "length") throw new LLMError("Response was cut off (max tokens). Try fewer injects or a shorter exercise.");
    return text;
  }

  // ---------------------------------------------------------------- dispatch

  function provider() { return Settings.get().provider; }

  async function complete(req) {
    return provider() === "openai" ? openai(req) : anthropic(req);
  }

  async function structured(system, user, schema, schemaName, effort = "high") {
    const text = await complete({
      system, schema, schemaName, effort, maxTokens: 64000,
      messages: [{ role: "user", content: user }],
    });
    try { return JSON.parse(text); }
    catch { throw new LLMError("The model returned malformed JSON. Try again."); }
  }

  const fmtLog = (ex, limit = 60) => ex.log.slice(-limit)
    .map((e) => {
      const d = e.data || {};
      const who = `${e.actor}${d.fromCell ? `, ${d.fromCell.toUpperCase()} cell` : ""}${d.to ? ` → ${String(d.to).toUpperCase()}` : ""}`;
      const tags = e.kind === "observation" ? [d.objective && `objective ${d.objective}`, d.rating && `observer rating ${d.rating}`, d.cellObserved && `cell observed ${d.cellObserved.toUpperCase()}`].filter(Boolean) : [];
      return `[${e.id}] T+${e.game_time_min}min ${e.kind.toUpperCase()} (${who}): ${e.text}${tags.length ? ` {${tags.join(", ")}}` : ""}`;
    })
    .join("\n") || "(no events yet)";

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // Doctrine library extracts for a request (empty when the library isn't loaded or nothing matches).
  const lib = async (query) => typeof Library === "undefined" ? { text: "", refs: [] } : Library.context(query);
  const withLib = (l, text) => l.text ? `${l.text}\n\n${text}` : text;

  // ---------------------------------------------------------------- operations

  async function design(params) {
    if (provider() === "demo") { await delay(600); return Mock.scenario(params); }
    const l = await lib([params.objectives, params.training_audience, params.echelon, (params.domains || []).join(" "), params.exercise_type].join(" "));
    return structured([Prompts.DESIGN], withLib(l, "Design this exercise:\n" + JSON.stringify(params, null, 1)),
      Schemas.scenario, "exercise_scenario");
  }

  // opts.rules: a Rules.resolve() result that the narrative must follow.
  async function adjudicate(ex, action, opts = {}) {
    const l = await lib(action);
    let result;
    if (provider() === "demo") { await delay(500); result = Mock.adjudication(action, ex, opts.rules, l.refs); }
    else {
      const world = Prompts.worldContext(ex);
      const rules = opts.rules && typeof Rules !== "undefined" ? `${Rules.promptText(opts.rules, ex)}\n\n` : "";
      const user = `Current exercise time: T+${ex.clock_min} min\n\n${world ? `${world}\n\n` : ""}Recent exercise log:\n${fmtLog(ex)}\n\n${rules}Player action to adjudicate:\n${action}`;
      result = await structured([Prompts.ADJUDICATE, Prompts.scenarioContext(ex)], withLib(l, user), Schemas.adjudication, "adjudication");
    }
    result.library = l.refs;
    return result;
  }

  async function aar(ex) {
    const query = [...ex.scenario.objectives.map((o) => o.text), ...ex.log.filter((e) => e.kind === "observation").map((e) => e.text)].join(" ");
    const l = await lib(query);
    if (provider() === "demo") { await delay(600); return { ...Mock.aar(ex, l.refs), library: l.refs }; }
    const injects = ex.scenario.msel.map((i) => `${i.id} T+${i.time_offset_min} [${i.status}] ${i.title}` +
      (i.ack ? ` (acknowledged by ${i.ack.by} ${i.ack.delay_s}s after release)` : i.status === "released" ? " (never acknowledged)" : "")).join("\n");
    const forces = typeof forceSummary === "function" ? forceSummary(ex) : "";
    const user = `Exercise ended at T+${ex.clock_min} min.\n\nMSEL status:\n${injects}\n\n${forces ? `${forces}\n\n` : ""}Full exercise log:\n${fmtLog(ex, Infinity)}`;
    const result = await structured([Prompts.AAR, Prompts.scenarioContext(ex)], withLib(l, user), Schemas.aar, "after_action_review");
    return { ...result, library: l.refs };
  }

  // Injects to cover objectives the MSEL tests too little. gaps: [{ objective_id, objective, problem, injects }]
  async function mselGaps(ex, gaps) {
    const l = await lib(gaps.map((g) => g.objective).join(" "));
    if (provider() === "demo") { await delay(500); return { ...Mock.mselGaps(ex, gaps, l.refs), library: l.refs }; }
    const msel = ex.scenario.msel.map((i) => `${i.id} T+${i.time_offset_min} [${i.status}] → ${(i.cell || "blue").toUpperCase()} ${i.title} (${i.objective_ids.join(", ")})`).join("\n");
    const user = `Exercise duration: ${ex.params.duration_min} min. Current exercise time: T+${ex.clock_min} min.\n\nCurrent MSEL:\n${msel}\n\nCoverage gaps:\n${gaps.map((g) => `${g.objective_id} "${g.objective}": ${g.problem} (${g.injects} inject${g.injects === 1 ? "" : "s"} now)`).join("\n")}\n\nPropose injects to fill these gaps.`;
    const result = await structured([Prompts.MSEL_GAPS, Prompts.scenarioContext(ex)], withLib(l, user), Schemas.mselGaps, "msel_gaps");
    return { ...result, library: l.refs };
  }

  // Is an inject's release condition met, judging only from the log and world state?
  async function checkCondition(ex, inj) {
    if (provider() === "demo") { await delay(300); return Mock.condition(ex, inj); }
    const world = Prompts.worldContext(ex);
    const user = `Current exercise time: T+${ex.clock_min} min\n\n${world ? `${world}\n\n` : ""}Exercise log:\n${fmtLog(ex, 120)}\n\nInject ${inj.id} "${inj.title}": ${inj.description}\nRelease condition: ${inj.condition}\n\nIs the condition met now?`;
    return structured([Prompts.CONDITION, Prompts.scenarioContext(ex)], user, Schemas.condition, "release_condition", "medium");
  }

  // history: [{role:"user"|"assistant", content}], ending with the new user message.
  async function roleplay(ex, role, history, onText, onReset) {
    if (provider() === "demo") {
      const text = Mock.roleplay(role, history[history.length - 1].content);
      for (const w of text.split(" ")) { await delay(25); onText(w + " "); }
      return text;
    }
    const persona = `PERSONA: ${role.name}\n${role.persona}\nGoals: ${role.goals}`;
    const last = history[history.length - 1];
    // Exercise time rides on the newest user turn so the system prefix stays cacheable.
    const messages = [...history.slice(0, -1), { role: "user", content: `[T+${ex.clock_min} min] ${last.content}` }];
    return complete({
      system: [Prompts.ROLEPLAY, Prompts.scenarioContext(ex), persona],
      messages, effort: "low", maxTokens: 8000, onText, onReset,
    });
  }

  function label() {
    const s = Settings.get();
    return s.provider === "anthropic" ? `Claude · ${s.anthropicModel}`
      : s.provider === "openai" ? `OpenAI · ${s.openaiModel}` : "DEMO";
  }

  const areaText = (a) => `EXERCISE AREA: south ${a.south.toFixed(4)}, west ${a.west.toFixed(4)}, north ${a.north.toFixed(4)}, east ${a.east.toFixed(4)}`;

  // Initial units and map features, placed on the real map inside the chosen area.
  async function forces(ex, area, guidance = "") {
    if (provider() === "demo") { await delay(600); return Mock.forces(ex, area); }
    const user = `${areaText(area)}\nEchelon: ${ex.params.echelon}. Training audience: ${ex.params.training_audience}.${guidance ? `\nGuidance from exercise control: ${guidance}` : ""}\n\nPlace the forces.`;
    return structured([Prompts.FORCES, Prompts.scenarioContext(ex)], user, Schemas.forces, "forces");
  }

  async function redPlan(ex) {
    if (provider() === "demo") { await delay(500); return Mock.redPlan(ex); }
    return structured([Prompts.RED_PLAN, Prompts.scenarioContext(ex)], "Draft the RED plan.", Schemas.redPlan, "red_plan");
  }

  // RED's next orders, from RED's point of view only.
  async function redTurn(ex) {
    if (provider() === "demo") { await delay(600); return Mock.redTurn(ex); }
    const p = ex.redPlan || {};
    const l = await lib([p.intent, ...(p.objectives || []).map((o) => o.text), p.posture].join(" "));
    const redLog = ex.log.filter((e) => e.data?.to === "red" || e.data?.fromCell === "red" || e.data?.redOrders).slice(-30)
      .map((e) => `T+${e.game_time_min} ${e.actor}: ${e.text}`).join("\n") || "(nothing yet)";
    const user = `Current exercise time: T+${ex.clock_min} min. Exercise phase: ${ex.phase}.

RED PLAN (set by exercise control — follow it):
Intent: ${p.intent || "(none set)"}
Objectives: ${(p.objectives || []).map((o) => `[${o.priority}] ${o.text}`).join("; ") || "(none)"}
Constraints: ${(p.constraints || []).join("; ") || "(none)"}
Posture: ${p.posture || "balanced"}

${Prompts.worldContext(ex, "red")}

RED's recent traffic:
${redLog}

Issue RED's orders for the next period.`;
    return structured([Prompts.RED_TURN, Prompts.scenarioContext(ex)], withLib(l, user), Schemas.redTurn, "red_turn");
  }

  return { design, adjudicate, aar, mselGaps, checkCondition, roleplay, forces, redPlan, redTurn, label, LLMError };
})();
