"use strict";
// JSON schemas for structured outputs. The shape suits both Claude's output_config.format and
// OpenAI's strict json_schema mode: every object lists all its properties as required and sets
// additionalProperties: false, with no length or numeric constraints.

const Schemas = (() => {
  const obj = (props) => ({
    type: "object", properties: props, required: Object.keys(props), additionalProperties: false,
  });
  const S = { type: "string" };
  const SL = { type: "array", items: S };
  const en = (...values) => ({ type: "string", enum: values });

  const inject = obj({
    id: S,
    time_offset_min: { type: "integer" },
    title: S,
    from_role: S,
    to_audience: S,
    method: en("radio", "email", "phone", "sitrep", "intel_report", "media", "face_to_face", "observed_event"),
    description: S,
    expected_action: S,
    objective_ids: SL,
  });

  const scenario = obj({
    title: S,
    summary: S,
    setting: obj({
      region_description: S,
      actors: { type: "array", items: obj({
        name: S,
        kind: en("state", "non_state", "civil_authority", "ngo", "media", "coalition", "other"),
        disposition: en("friendly", "neutral", "hostile", "unknown"),
        description: S,
      }) },
    }),
    road_to_crisis: SL,
    blue_situation: S,
    red_situation: S,
    objectives: { type: "array", items: obj({ id: S, text: S, measures: SL }) },
    msel: { type: "array", items: inject },
    roles: { type: "array", items: obj({ name: S, persona: S, goals: S }) },
    controller_guidance: S,
  });

  // ---- world state (units on the map)
  const arr = (items) => ({ type: "array", items });
  const num = { type: "number" }, int = { type: "integer" };
  const nNum = { anyOf: [num, { type: "null" }] };
  const nStr = (values) => ({ anyOf: [values ? en(...values) : S, { type: "null" }] });
  const UNIT_TYPES = ["infantry", "armour", "mechanized", "artillery", "reconnaissance", "engineer", "headquarters", "logistics",
    "medical", "air_defence", "aviation", "signals", "special_forces", "militia", "naval", "civilian"];
  const ECHELONS = ["team", "squad", "section", "platoon", "company", "battalion", "regiment", "brigade", "division"];
  const STATUS = ["active", "moving", "engaged", "defending", "combat_ineffective", "destroyed", "withdrawn"];
  const FEATURE_KINDS = ["objective", "checkpoint", "phase_line", "boundary", "area", "observation_post", "supply_point", "town"];

  const forces = obj({
    units: arr(obj({
      id: S, name: S, side: en("blue", "red", "neutral", "civil"), type: en(...UNIT_TYPES), echelon: en(...ECHELONS),
      lat: num, lng: num, strength: int, task: S,
    })),
    features: arr(obj({
      id: S, kind: en(...FEATURE_KINDS), name: S, side: en("blue", "red", "neutral"), coords: arr(obj({ lat: num, lng: num })),
    })),
    sides: obj({ blue: obj({ supply: int, morale: int }), red: obj({ supply: int, morale: int }) }),
    civil_stability: int,
    notes: S,
  });

  const worldChanges = obj({
    unit_updates: arr(obj({ unit_id: S, lat: nNum, lng: nNum, strength_change: int, status: nStr(STATUS), task: nStr() })),
    detections: arr(obj({ observer_side: en("blue", "red"), unit_id: S, confidence: en("low", "medium", "high") })),
    side_changes: arr(obj({ side: en("blue", "red"), supply_change: int, morale_change: int })),
    civil_stability_change: int,
    summary: S,
  });

  const redPlan = obj({
    intent: S,
    objectives: arr(obj({ text: S, priority: en("high", "medium", "low") })),
    constraints: SL,
    posture: en("aggressive", "balanced", "defensive", "deceptive"),
  });

  const redTurn = obj({
    assessment: S,
    orders: arr(obj({
      unit_id: S, action: en("move", "attack", "defend", "recce", "withdraw", "hold", "resupply", "deceive"),
      lat: nNum, lng: nNum, target_unit_id: nStr(), rationale: S,
    })),
    suggested_injects: arr(obj({
      title: S, from_role: S, description: S, expected_action: S, objective_ids: SL,
      method: en("radio", "email", "phone", "sitrep", "intel_report", "media", "face_to_face", "observed_event"),
    })),
  });

  // Which library extracts (D1, D2…) the answer relied on, and for what point.
  const references = arr(obj({ ref: S, point: S }));

  const adjudication = obj({
    world_changes: worldChanges,
    outcome: S,
    effects: SL,
    rationale: S,
    confidence: en("low", "medium", "high"),
    state_changes: SL,
    recommended_injects: { type: "array", items: obj({
      title: S, from_role: S, description: S, expected_action: S, objective_ids: SL,
    }) },
    controller_notes: S,
    references,
  });

  const aar = obj({
    executive_summary: S,
    objective_assessments: { type: "array", items: obj({
      objective_id: S, rating: en("T", "P", "U"), evidence: S, gaps: S,
    }) },
    sustains: SL,
    improves: SL,
    lessons: { type: "array", items: obj({ observation: S, discussion: S, recommendation: S }) },
    references,
  });

  const mselGaps = obj({
    assessment: S,
    injects: arr(obj({
      time_offset_min: int, title: S, from_role: S, cell: en("blue", "red", "excon"),
      method: en("radio", "email", "phone", "sitrep", "intel_report", "media", "face_to_face", "observed_event"),
      description: S, expected_action: S, objective_ids: SL, rationale: S,
    })),
    references,
  });

  const condition = obj({ met: { type: "boolean" }, confidence: en("low", "medium", "high"), reasoning: S });

  return { scenario, adjudication, aar, mselGaps, condition, forces, redPlan, redTurn, UNIT_TYPES, ECHELONS, STATUS, FEATURE_KINDS };
})();
