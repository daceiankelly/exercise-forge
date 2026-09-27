"use strict";
// Canned responses for the Demo provider. Shapes match schemas.js.

const Mock = (() => {
  function scenario(p) {
    const dur = +p.duration_min || 240;
    const step = Math.max(Math.floor(dur / 8), 10);
    const injects = [
      ["Harbour master reports blockship", "Port Authority Liaison", "phone",
        "The Kessarine harbour master reports a scuttled freighter partially blocking the main channel.",
        "Task J3/J4 to assess impact on sealift schedule; update COP.", ["OBJ-1"]],
      ["Conflicting ISR reports", "EXCON", "intel_report",
        "Two ISR reports disagree on whether RED mechanised elements have moved south of the Varda river.",
        "J2 reconciles sources, states confidence, informs commander of uncertainty.", ["OBJ-2"]],
      ["NGO convoy requests deconfliction", "Relief Coordinator", "email",
        "An NGO medical convoy asks for safe passage along Route AMBER within 3 hours.",
        "CIMIC coordinates; J3 deconflicts route with manoeuvre plan.", ["OBJ-3"]],
      ["Local media claims civilian casualties", "Journalist", "media",
        "A local news outlet alleges BLUE artillery struck a school near Orvan.",
        "PAO holds line, commander orders investigation, LEGAD advises.", ["OBJ-3", "OBJ-4"]],
      ["Higher HQ requests updated COA", "Higher HQ", "sitrep",
        "Joint Task Force HQ requests an updated course of action brief within 60 minutes.",
        "Plans cell runs rapid planning; commander briefs COA.", ["OBJ-1", "OBJ-2"]],
      ["RED proposes local ceasefire", "RED Commander", "radio",
        "RED sector commander proposes a 12-hour local ceasefire to recover casualties.",
        "Commander weighs ROE and political guidance; seeks higher direction.", ["OBJ-4"]],
    ];
    return {
      title: p.title || "Exercise IRON LANTERN",
      summary: "A fictional regional crisis in the Kessarine littoral tests a brigade HQ's ability to plan, " +
        "coordinate and communicate under uncertainty while protecting civilians.",
      setting: {
        region_description: "The Kessarine coast: a port city, a river line (Varda) and contested farmland.",
        actors: [
          { name: "Republic of Kessar", kind: "state", disposition: "friendly", description: "Host nation requesting coalition support." },
          { name: "Varda People's Front", kind: "non_state", disposition: "hostile", description: "Armed movement backed by a neighbouring power, seeking control of the river valley." },
          { name: "Coastal Relief Network", kind: "ngo", disposition: "neutral", description: "Humanitarian NGO running medical convoys." },
          { name: "Kessar Daily", kind: "media", disposition: "neutral", description: "Influential local outlet, sceptical of foreign forces." },
        ],
      },
      road_to_crisis: [
        "D-90: Disputed election result sparks protests in the Varda valley.",
        "D-30: VPF seizes two border crossings; refugees move toward the coast.",
        "D-7: Kessar requests coalition assistance; coalition brigade deploys.",
        "D-Day: VPF mechanised elements reported massing north of the Varda.",
      ],
      blue_situation: "Coalition brigade HQ established in Kessarine with two manoeuvre battalions, limited ISR and a sealift-dependent sustainment chain.",
      red_situation: "VPF holds the north bank of the Varda with light infantry and an unknown number of mechanised companies; active information campaign.",
      objectives: [
        { id: "OBJ-1", text: "Maintain a shared operational picture and synchronise sustainment.", measures: ["COP updated within 15 min of new info", "Sustainment impacts briefed"] },
        { id: "OBJ-2", text: "Produce and brief a course of action under time pressure.", measures: ["COA delivered on time", "Risks and assumptions stated"] },
        { id: "OBJ-3", text: "Coordinate with civil actors and protect civilians.", measures: ["NGO movement deconflicted", "Civilian harm allegations handled correctly"] },
        { id: "OBJ-4", text: "Apply ROE and LOAC in ambiguous situations.", measures: ["LEGAD consulted", "Decisions documented with rationale"] },
      ],
      msel: injects.map(([title, from_role, method, description, expected_action, objective_ids], n) => ({
        id: `INJ-${String(n + 1).padStart(3, "0")}`, time_offset_min: step * (n + 1), title, from_role,
        to_audience: p.training_audience || "Brigade HQ staff", method, description, expected_action, objective_ids,
      })),
      roles: [
        { name: "Higher HQ", persona: "Chief of staff at the joint task force; brisk and deadline-driven.", goals: "Get timely, accurate reporting and a sound COA." },
        { name: "RED Commander", persona: "VPF sector commander; proud, tactically shrewd, uses negotiation to buy time.", goals: "Hold the river line and win the information fight." },
        { name: "Journalist", persona: "Reporter for Kessar Daily; persistent and sceptical.", goals: "Get an on-record response about civilian harm." },
        { name: "Relief Coordinator", persona: "Head of Coastal Relief Network operations; pragmatic, neutral.", goals: "Move convoys safely without being seen as partisan." },
        { name: "Port Authority Liaison", persona: "Kessarine harbour master; cooperative but overwhelmed.", goals: "Reopen the port quickly." },
      ],
      controller_guidance: "Release injects on time unless the training audience is saturated; use role-players to add friction around OBJ-3 and OBJ-4. (DEMO output)",
    };
  }

  // Demo world changes: nudge the first BLUE unit and let BLUE spot the nearest RED unit.
  function demoWorldChanges(ex) {
    const units = ex?.world?.units || [];
    const b = units.find((u) => u.side === "blue"), r = units.find((u) => u.side === "red");
    if (!b) return { unit_updates: [], detections: [], side_changes: [], civil_stability_change: 0, summary: "" };
    return {
      unit_updates: [{ unit_id: b.id, lat: +(b.lat + 0.01).toFixed(5), lng: +(b.lng + 0.015).toFixed(5), strength_change: -5, status: "moving", task: "Screen the crossing" }],
      detections: r ? [{ observer_side: "blue", unit_id: r.id, confidence: "medium" }] : [],
      side_changes: [{ side: "blue", supply_change: -3, morale_change: 2 }],
      civil_stability_change: -1,
      summary: `${b.name} moves forward to screen; ${r ? `${r.name} is spotted by BLUE patrols.` : ""} (DEMO output)`,
    };
  }

  // Demo citations: the first library extract, if any were found.
  const cite = (refs, point) => refs?.length ? [{ ref: refs[0].ref, point }] : [];

  const adjudication = (action, ex, rules, refs) => ({
    world_changes: demoWorldChanges(ex),
    references: cite(refs, "Applied to judge whether the action followed the staff's procedure. (DEMO output)"),
    outcome: rules ? `${rules.label}. The engagement goes as the combat rules decided (DEMO narrative).`
      : "Partially successful. The action achieves its immediate aim but exposes a coordination gap.",
    effects: ["Immediate objective met within 40 minutes", "Adjacent unit not informed; minor friction on the boundary"],
    rationale: `The action ('${action.slice(0, 120)}') is sound in principle, but no coordination step with the adjacent unit appears in the log. (DEMO output)`,
    confidence: "medium",
    state_changes: ["BLUE posture updated on the COP", "Adjacent battalion requests clarification"],
    recommended_injects: [{
      title: "Adjacent battalion queries boundary",
      from_role: "Higher HQ",
      description: "The adjacent battalion reports unexpected BLUE movement near its left boundary.",
      expected_action: "J3 issues a FRAGO clarifying boundaries and coordination measures.",
      objective_ids: ["OBJ-1"],
    }],
    controller_notes: "Good teaching point for coordination; consider releasing the follow-up inject.",
  });

  const aar = (ex, refs) => ({
    references: cite(refs, "Benchmark used for the objective assessments. (DEMO output)"),
    executive_summary: `The training audience worked ${ex.log.length} logged events. Staff processes were generally sound; ` +
      "civil-military coordination and legal consultation need reinforcement. (DEMO output)",
    objective_assessments: ex.scenario.objectives.map((o, i) => ({
      objective_id: o.id, rating: ["P", "T", "P", "U"][i % 4],
      evidence: "See log entries relating to this objective.", gaps: "Timeliness and documentation of rationale.",
    })),
    sustains: ["Battle rhythm maintained", "Clear commander's intent"],
    improves: ["Earlier LEGAD involvement", "Faster COP updates after new information"],
    lessons: [{
      observation: "Conflicting intelligence was passed forward without a confidence statement.",
      discussion: "The commander made a decision on an unqualified report.",
      recommendation: "Adopt a standard confidence/source line in all J2 updates.",
    }],
  });

  const roleplay = (role, message) =>
    `(${role.name}, demo) Understood: "${message.slice(0, 80)}". I'll need more detail before I can commit. ` +
    "What is your timeline, and who is my point of contact?";

  // Demo ORBAT laid out across the chosen area: BLUE in the west third, RED in the east third.
  function forces(ex, a) {
    const lat = (f) => +(a.south + (a.north - a.south) * f).toFixed(5);
    const lng = (f) => +(a.west + (a.east - a.west) * f).toFixed(5);
    const u = (id, name, side, type, echelon, fy, fx, strength, task) => ({ id, name, side, type, echelon, lat: lat(fy), lng: lng(fx), strength, task });
    return {
      units: [
        u("B1", "1st Kessar Brigade HQ", "blue", "headquarters", "brigade", .45, .15, 100, "Command the brigade"),
        u("B2", "2nd Battalion", "blue", "infantry", "battalion", .6, .28, 95, "Screen the river line"),
        u("B3", "3rd Battalion", "blue", "mechanized", "battalion", .35, .3, 90, "Brigade reserve"),
        u("B4", "Recce Squadron", "blue", "reconnaissance", "company", .5, .4, 100, "Observe crossings"),
        u("B5", "Brigade Support Battalion", "blue", "logistics", "battalion", .42, .08, 100, "Sustain the brigade"),
        u("R1", "VPF Northern Group HQ", "red", "headquarters", "brigade", .55, .85, 100, "Command"),
        u("R2", "VPF Mechanised Company", "red", "mechanized", "company", .62, .68, 85, "Seize the crossing"),
        u("R3", "VPF Militia", "red", "militia", "battalion", .4, .7, 70, "Hold the villages"),
        u("R4", "VPF Artillery Battery", "red", "artillery", "company", .5, .8, 90, "Support the attack"),
        u("N1", "Relief convoy", "civil", "civilian", "team", .3, .5, 100, "Move medical supplies"),
      ],
      features: [
        { id: "F1", kind: "objective", name: "OBJ ORVAN BRIDGE", side: "blue", coords: [{ lat: lat(.55), lng: lng(.55) }] },
        { id: "F2", kind: "phase_line", name: "PL VARDA", side: "blue", coords: [{ lat: lat(.9), lng: lng(.5) }, { lat: lat(.5), lng: lng(.52) }, { lat: lat(.1), lng: lng(.5) }] },
        { id: "F3", kind: "town", name: "Orvan", side: "neutral", coords: [{ lat: lat(.52), lng: lng(.56) }] },
      ],
      sides: { blue: { supply: 80, morale: 75 }, red: { supply: 70, morale: 80 } },
      civil_stability: 60,
      notes: "DEMO forces laid out on a grid across the chosen area; drag units to realistic positions.",
    };
  }

  const redPlan = () => ({
    intent: "Seize the Orvan bridge intact before BLUE can reinforce, while winning the information fight so coalition support erodes.",
    objectives: [
      { text: "Seize OBJ ORVAN BRIDGE intact", priority: "high" },
      { text: "Fix BLUE's reserve with the militia in the villages", priority: "medium" },
      { text: "Generate media stories of civilian harm by BLUE", priority: "medium" },
    ],
    constraints: ["No deliberate targeting of civilians", "Do not cross PL VARDA before T+2:00", "Preserve the mechanised company for the bridge"],
    posture: "deceptive",
  });

  function redTurn(ex) {
    const w = ex.world || { units: [] };
    const reds = w.units.filter((u) => u.side === "red" && u.status !== "destroyed");
    const target = w.features?.find((f) => f.kind === "objective")?.coords[0];
    return {
      assessment: "BLUE is screening the river line; the bridge is lightly held. (DEMO output)",
      orders: reds.slice(0, 3).map((u, i) => {
        const move = i < 2 && target;
        return {
          unit_id: u.id, action: i === 0 ? "move" : i === 1 ? "recce" : "hold",
          lat: move ? +(u.lat + (target.lat - u.lat) * 0.4).toFixed(5) : null,
          lng: move ? +(u.lng + (target.lng - u.lng) * 0.4).toFixed(5) : null,
          target_unit_id: null, rationale: i === 0 ? "Close on the bridge while BLUE is dispersed." : i === 1 ? "Confirm BLUE positions on the far bank." : "Keep the reserve concealed.",
        };
      }),
      suggested_injects: [{
        title: "Vehicle movement reported east of the Varda", from_role: "EXCON", method: "observed_event",
        description: "Local farmers report tracked vehicles moving west along the river road at dusk.",
        expected_action: "J2 tasks ISR to confirm and warns the forward battalion.", objective_ids: ["OBJ-2"],
      }],
    };
  }

  // One inject per objective with a gap, placed in the second half of the exercise.
  function mselGaps(ex, gaps, refs) {
    const dur = +ex.params.duration_min || 240;
    return {
      assessment: `${gaps.length === 1 ? "1 objective needs" : `${gaps.length} objectives need`} more injects. (DEMO output)`,
      injects: gaps.map((g, n) => ({
        time_offset_min: Math.max(ex.clock_min, Math.round((dur * (0.6 + 0.1 * n)) / 5) * 5),
        title: `Test ${g.objective_id}: new demand from Higher HQ`, from_role: ex.scenario.roles[0]?.name || "EXCON", cell: "blue", method: "email",
        description: `Higher HQ asks for a decision that exercises ${g.objective_id}: ${g.objective}`,
        expected_action: "Staff analyse, decide and report back within 30 minutes.", objective_ids: [g.objective_id],
        rationale: `${g.objective_id} has ${g.problem}.`,
      })),
      references: cite(refs, "Timings follow the staff's battle rhythm. (DEMO output)"),
    };
  }

  const condition = (ex, inj) => ({ met: true, confidence: "low", reasoning: `The log doesn't contradict "${inj.condition}". (DEMO output)` });

  return { scenario, adjudication, aar, mselGaps, condition, roleplay, forces, redPlan, redTurn };
})();
