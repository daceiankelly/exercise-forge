# ExerciseForge

ExerciseForge helps an exercise control (EXCON) team **design, run and review military training
exercises** with an AI assistant. It covers tabletop exercises (TTX), command post exercises (CPX),
field training exercises (FTX), wargames and staff rides.

- **No installation.** It's a static web page: open `index.html` in a browser. There's no server, no
  build step and no internet dependency except the AI provider itself.
- **Works offline.** Fonts and icons are bundled, and Demo mode needs no network at all.
- **Human in the loop.** The AI drafts and advises. Controllers decide what gets released, what stands
  and what goes in the record.
- **Fictional by design.** Every scenario uses invented countries, units and places.

---

## Quick start

1. Open `F:\ExerciseForge\index.html` in Edge or Chrome.
2. Try it in **Demo** mode first (the default). Responses are canned, so you can learn the workflow
   with no API key.
3. When you're ready, open **Settings** (gear icon, top right), choose **OpenAI** or **Claude**, and
   enter your API key.
4. Click **New exercise**, describe what you want to train, and select **Generate exercise**.

---

## How an exercise flows

```
  ┌──────────┐    ┌──────────────┐    ┌──────────────────────────────┐    ┌──────────┐
  │  DESIGN  │ ─▶ │ REVIEW/EDIT  │ ─▶ │  EXECUTE  (STARTEX → ENDEX)  │ ─▶ │   AAR    │
  │ AI draft │    │ scenario tab │    │ MSEL · adjudicate · role-play│    │ AI review│
  └──────────┘    └──────────────┘    │ everything lands in the LOG  │    └──────────┘
                                      └──────────────────────────────┘
```

1. **Design.** You fill in the exercise type, echelon, training audience, domains (land, maritime,
   air, cyber/EW, space, information, civil-military), training objectives, setting, duration, number
   of injects and complexity.
2. **Review.** The **Scenario** tab shows what the AI produced. Read it before you start. Export it as
   JSON if you want a planning copy.
3. **Execute.** Press **STARTEX**. Move the exercise clock with −15 / +15 / +60, or let it run at real
   time or faster. Then:
   - **Control:** injects that are due are highlighted. **Release** sends one to the players,
     **Acknowledge** records receipt, and **Actioned** closes it (see [Inject acknowledgements](#inject-acknowledgements)).
     The **Timeline** view lets you drag injects to reschedule them, chain and branch them, and release
     them automatically on time (see [MSEL timeline](#msel-timeline-dependencies-and-auto-release)).
   - **Adjudication:** type what the players decided. The AI white cell rules on the outcome, and you
     accept, override or ignore it. For fights between units, **Combat rules + AI** decides the result
     from tables and a repeatable dice roll, and the AI narrates it.
   - **Role-players:** chat as the training audience with AI personas such as higher HQ, the opposing
     commander, a journalist or an NGO.
   - **Log:** every inject, action, ruling, role-play reply and controller note is timestamped against
     exercise time. Add observations as you go.
4. **ENDEX and review.** Open **AAR** and generate the after action review. It uses only what is in the
   log, so the more you log, the better the review.

---

## Inject acknowledgements

Each inject in the MSEL goes through a tracked lifecycle:

```
pending ──Release──▶ released ──Acknowledge──▶ acknowledged ──Actioned──▶ actioned
   │                    │ (Recall → pending)
   └──Skip──▶ skipped
```

- **Release** stamps the inject with the exercise time and the real time.
- **Acknowledge** records **who** received it (cell or appointment), an optional note, and the
  **real-time delay** since release.
- An inject not acknowledged within the **Ack limit** (default 5 minutes, set on the Control tab) is
  flagged **ack overdue** in red.
- The Control tab badge shows how many injects are awaiting acknowledgement; it turns red when any are
  overdue.
- Acknowledgements are written to the log, and the after action review treats acknowledgement times,
  and injects never acknowledged, as evidence of information flow and battle rhythm.

## MSEL timeline, dependencies and auto-release

The Control tab has two views of the MSEL: **Table** (release, acknowledge, skip) and **Timeline**.

**Timeline.** Each inject is a chip on a time axis, in lanes by **cell**, **sender** or **objective**.
Colours show pending, due, released, acknowledged and done. A red line marks the current exercise time,
and arrows link injects that depend on each other. **Drag a pending inject to reschedule it** (it snaps
to 5 minutes), or focus it and use the arrow keys. Click it to edit. Injects that depend on it move
with it.

**Editing.** **New inject** (or the pencil on a pending row) opens the editor: title, time, sender,
recipient, method, which cell receives it, description, expected action and objectives, plus:

| Option | What it does |
|---|---|
| **Release after** another inject | The inject becomes due a set delay after the other one **is released**, **is acknowledged** or **is skipped**. The delay counts from when that actually happens, not from the plan. |
| **Branches** | Make inject A follow X being *released* and inject B follow X being *skipped*. Whichever way EXCON decides on X, only that branch goes live. The other is marked **blocked**. |
| **Release condition** | Free text, e.g. "Only if BLUE has not secured the bridge". The inject is flagged **decide** when due and is never released automatically. **Check with AI** reads the log and world state and says whether the condition is met, with its confidence and the log entries it relied on. |
| **Release automatically** | Untick to keep an inject manual even when auto-release is on. |

**Auto-release on time.** Turn it on (Control tab) and every due inject without a condition is released
as soon as the clock reaches it, including chains of dependants. Each is marked *Auto-released on time*.

**Running clock.** Next to the clock buttons, choose **Manual clock**, **Real time**, or **2×, 4× or 10×
real time**. While the exercise is running, the clock then moves by itself, and auto-release and supply
use follow it. Only the EXCON screen that started the clock moves it. If that screen closes, another
EXCON screen takes over. Pausing (or a NO DUFF) stops it.

**Objective coverage.** Above the timeline, each training objective shows how many live injects test it
and in which quarter of the exercise. Gaps are flagged: **no injects**, **only one inject**, or
**nothing in the second half**. **Suggest injects for gaps** asks the AI for injects that fill them,
timed into the gap and fitted to the scenario and role-players. Add the ones you want with one click.

## NO DUFF: real-world emergency override

**NO DUFF** is the standard call that a real emergency has happened during an exercise. The red
**NO DUFF** button is in the top bar on every screen.

1. Choose who it affects:
   - **This exercise**, or
   - **Whole site**: every exercise at the site. This is the only option when no exercise is open.
2. Record the nature of the emergency, the location, instructions for everyone, and who is declaring it.
3. On the declaring screen the alert appears **immediately**. It is then broadcast (see below), and the
   alert shows its broadcast status:
   - **Broadcast via GitLab**, or **Shown on this computer only** in local mode.
   - If the broadcast fails: **NOT BROADCAST — declare NO DUFF by voice or radio now**, with a Retry
     button.
4. Every affected screen gets a full-screen red alert, an audible alarm and, in GitLab mode, a system
   notification. The rest of the app is locked so nothing can be changed by mistake.
5. Affected exercises are **paused**, and the declaration is written to each exercise's log once.
6. People viewing a **different** exercise see a red banner, "NO DUFF in *exercise name*", with an
   **Open** button, rather than being locked out. The exercise list marks affected exercises.
7. **Stand down NO DUFF** records who authorised it and the outcome, then logs it. Exercises **stay
   paused** until EXCON deliberately presses Resume.

Several NO DUFFs can be active at once; each gets its own card on the alert screen.

**How far it reaches:**

| Mode | Reaches |
|---|---|
| This browser | Every tab and window on this computer, instantly (e.g. a projector screen). |
| GitLab | Every screen signed in to the same GitLab workspace, within the check interval (default 15 s). Also GitLab email to the *Notify on NO DUFF* user or group, and any Mattermost, Slack or Teams integration on the Safety project. |

The app is a backup. **Always call NO DUFF by voice or radio as well.**

---

## Cell views: EXCON, BLUE, RED and observers

Each person sees the exercise from their own role:

| View | Sees | Can do |
|---|---|---|
| **EXCON** | Everything | Everything: design, release injects, adjudicate, role-players, messages to cells, AAR |
| **BLUE** (training audience) | Their own brief (summary, region, road to crisis, BLUE situation, actors); an **Inbox** of injects and messages EXCON has released to BLUE; their own reports; a BLUE-only log | Acknowledge injects; send **Decisions**, **Messages** and **RFIs** to EXCON or a named role |
| **RED** (opposing force cell) | The same, with the RED situation and RED's traffic | The same, for RED |
| **Observer** (O/C) | Everything, read-only | Record **observations** tagged to an objective, with a Trained / Partly / Untrained rating and the cell observed |

BLUE and RED never see the MSEL, future injects, expected player actions, training objectives,
adjudication rationale or the other cell's traffic.

**How EXCON runs it:**
- **Control tab:** each pending inject has a *deliver to* choice: **BLUE cell**, **RED cell** or
  **EXCON only**. Release as usual; the inject appears in that cell's Inbox.
- **Cells tab** (EXCON only):
  - **Message a cell** as EXCON, the White Cell or any role-player.
  - **From the cells:** every decision, message and RFI the cells send. **Adjudicate** loads a decision
    into the adjudication form without logging it twice. **Reply** messages the cell back. **Mark
    handled** clears it from the badge count.
- **Adjudication:** each ruling has **Send outcome to BLUE / RED**, so you choose what the players learn.
- **Observations tab:** observations are grouped by objective with rating counts. The AI review weighs
  them as primary evidence, alongside what the cells actually sent.
- **View as:** the switch under the exercise title lets EXCON preview exactly what BLUE, RED or an
  observer sees.

### This browser: previews and locked terminals

In local mode the views are filters over one browser's data. For a player terminal:
1. In the Cells tab, use **Lock this browser to one cell** with a PIN.
2. The browser then shows only that cell's view. New exercise, import, settings, delete and the view
   switch are hidden.
3. The top bar shows **BLUE terminal**. Click it and enter the PIN to unlock.

This stops casual switching, but it isn't a security boundary: someone with the browser's developer
tools could read the data. Use GitLab mode when cells must not be able to see each other's traffic.

### GitLab: real separation

In GitLab mode the separation is enforced by GitLab permissions, not just hidden in the UI:
- **Cells tab → Create BLUE and RED channels** makes a private project for each cell, holding one
  channel issue with that cell's brief. The brief doesn't include the MSEL, objectives or the other
  side's situation.
- **Add members** by GitLab username. Players become Reporters in **their cell's project only**. They
  can't open the EXCON exercise project or the other cell's project. Their exercise list shows just
  their channel, and it opens straight into their cell view.
- **Observers** are added as Reporters on the exercise project. They can read everything.
- **EXCON's screen does the delivery:**
  - On each check it posts newly released injects, messages and exercise status (clock and phase)
    into each channel.
  - It imports the cells' acknowledgements and reports into the exercise.
  - Imports use the GitLab comment id, so several EXCON screens importing at once don't create
    duplicates.
- **Edits are checked against GitLab roles on every screen:**
  - Changes to the exercise are applied only from **Developer or above**.
  - Reporters, i.e. observers, can add observations and nothing else.
  - In a cell channel, deliveries and status updates count only if EXCON posted them, so a player
    can't forge an inject.
  - A comment written by hand in GitLab that breaks these rules is ignored.
- **Access for everyone:** everyone needs Reporter on the **Safety project** to get NO DUFF alerts.
- **Archiving** an exercise also closes its cell channels.

Limits:
- A recalled inject stays in the cell's Inbox if it had already been delivered.
- Role-player AI replies are generated on EXCON's screen. Players message a role through **Report**,
  and EXCON replies from the Cells tab.
- Don't remove EXCON staff from an exercise project mid-exercise: their earlier changes would then
  come from an unknown author and be ignored when the exercise is reloaded. Lower their role instead.

---

## Map, world state and the RED AI

### The map works offline

The **Map** tab shows a real map with NATO-style unit symbols (simplified APP-6: friendly rectangles,
hostile diamonds, neutral and civil squares, type icons, echelon marks, a strength bar and movement
trails). No internet connection is needed:

| Base map | What it is | Detail |
|---|---|---|
| **World outline** (built in) | Natural Earth 1:50m country and coastline outlines, bundled with the app | Country and region scale. Always available. |
| **Map files** | **PMTiles** or **MBTiles** files, **raster or vector**, e.g. from QGIS, MOBAC, Planetiler, tippecanoe or your geospatial team. Add them in **Map → Offline maps**; they're stored in this browser. | Whatever the file holds: street, topographic, contour or satellite. |
| **Tile server on your network** | A `{z}/{x}/{y}` tile address on your own server: `.png`/`.jpg` for raster, `.pbf`/`.mvt` for vector. Tiles you view are kept for offline use, and **Keep this area offline** downloads the current view across several zoom levels. | As served |
| **Map file on a web server** | A PMTiles file served over http, e.g. committed next to the app on GitLab Pages, so nobody has to add it by hand | As supplied |

Public OpenStreetMap servers don't allow bulk downloads, so use your own tile server or a map file for
offline detail.

**Vector maps** (Mapbox Vector Tiles) are decoded and drawn in the browser by ExerciseForge itself,
with no extra libraries:
- **Schemas:** the built-in style understands the common open schemas (OpenMapTiles, Protomaps
  basemaps, Shortbread and similar) from their layer and property names. It draws water, land cover,
  woods, military areas, roads by class, railways, boundaries, buildings, **contour lines** (index
  contours heavier), **peaks with heights**, and town and city names.
- **Sharp at any zoom:** beyond the data's maximum zoom (typically 14), tiles are redrawn at scale
  rather than stretched, so lines stay crisp.
- **Theme:** vector maps switch to a dark style with the app's dark theme.
- **Compression:** gzip-compressed tiles, as in most MBTiles files and tile servers, are handled
  automatically.
- **Limitations:** labels are drawn per tile, so a name near a tile edge can be clipped. A fully custom
  map style (e.g. a MapLibre style file) isn't supported.

### World state

Each exercise keeps a structured record of the situation:
- units: side, type, echelon, position, strength, status, task and movement trail
- map features: objectives, checkpoints, phase lines, boundaries, areas and towns
- BLUE and RED supply and morale, and civil stability
- **what each side knows**: the last known position of each enemy unit it has detected

The AI reads this record, so rulings stay consistent across a long exercise.

**Setting up (EXCON, Map tab):**
1. **Area:** click two corners, or use the current view, to set the exercise area.
2. **Place forces with AI:** both sides' units and features are placed on the real terrain inside the
   area, sized to the echelon, with optional guidance. The terrain is real; names and the political
   overlay stay fictional.
3. Anything the app thinks is in water is flagged. Drag units to fix positions, or use the tools to add
   units, objectives and lines. Click any unit or feature to edit it.

**During play:**
- Each **adjudication** now includes proposed **map changes**: moves, strength and status changes,
  detections, supply and morale. Nothing changes until EXCON presses **Apply to map**.
- **Reveal to BLUE / RED** on a unit records that the other side has seen it.

**Fog of war:** the BLUE and RED views have their own **Map** tab. They see:
- their own units
- neutral and civil units
- features marked for their side
- faded **last-known** markers for enemy units they've detected, with the time and confidence

In GitLab mode each cell's map view is posted to its own channel, so players never receive the full
picture.

### Map replay for the after action review

The **AAR** tab opens with a **Map replay** of the whole exercise:
- **Timeline:** every change to the map (forces placed, moves, applied rulings, RED orders, edits) is
  one step. Use the **slider**, the step and jump buttons, or **play** at 1× to 8×.
- **At each step:** the exercise time and real time, units in their positions at that moment with the
  **tracks** they took to get there, supply, morale and civil stability, and **what happened** (the
  logged events between that step and the previous one).
- **Whose picture:**
  - **Ground truth** shows everything.
  - **BLUE's picture** and **RED's picture** show only what that side knew at the time, with faded
    last-known markers for enemy units. Compare BLUE's picture with the ground truth to show where the
    staff's situational awareness diverged from reality.
- **Key moments:** a list of injects, rulings, RED orders and NO DUFFs. Click one to jump to the map at
  that point.
- **AI review:** the AI after action review also receives each unit's start-to-end strength, status
  and distance moved, and how many enemy units each side detected.

History is stored as **only what changed** at each step (the first step is complete), so it stays
small enough for browser storage over long exercises. In GitLab mode each step is appended like any
other change.

### How EXCON defines the opposing force's goals: the RED plan

On the Map tab, **Opposing force → Set plan** opens the RED plan:
- **Commander's intent:** purpose, method and end state.
- **Objectives**, each with a **priority** (high, medium or low).
- **Constraints:** political limits, rules of engagement, timings, and anything RED must not do so the
  exercise keeps its training value (e.g. "Do not cross PL VARDA before T+2:00").
- **Posture:** aggressive, balanced, defensive or deceptive.

**Draft with AI** writes a first version from the scenario and training objectives for you to edit.
**Save and send to RED** also sends it to a human RED cell, and it appears in their Situation tab.

### RED AI turns

**Run RED turn** gives the RED AI only what RED knows: its own units, the RED plan, the last known
positions of detected BLUE units, and RED's own traffic. It then proposes:
- an order for each RED unit (move, attack, defend, reconnoitre, withdraw, hold, resupply or deceive),
  with a rationale, drawn as arrows on the map
- 0–2 injects that show BLUE only the observable effects

EXCON ticks the orders and injects to accept, then presses **Apply selected**. Accepted moves update the
map and are logged as RED orders, which BLUE never sees. Any contact is then adjudicated as normal. The
RED AI must follow the plan's constraints even when that stops it reaching an objective.

Each proposed move shows its distance and the time the unit needs at its movement rate, e.g. *"6.2 km,
about 1 h 33 min at 4 km/h"*, so EXCON can spot a move that's too fast. AI adjudication moves show the
same.

---

## Rules-based adjudication: numbers from tables, narrative from the AI

AI judgement alone is fluent but not repeatable: ask twice and you may get two outcomes. For fights
between units on the map, the Adjudication tab offers **Combat rules + AI**:

1. Pick the **attacking** and **defending** units, the **terrain** (open, mixed, close, urban, river),
   the **defender's position** (hasty, prepared, fortified) and **how long** the fighting lasts. A preview
   shows the force ratio and the chance of success before anything is rolled.
2. On **Adjudicate**, the rules work out the result. The AI then writes the outcome, effects and
   rationale **to match it**. It's told the result is binding, and the app puts the rules' losses and
   statuses into the map changes whatever the AI says. The AI can still add movement, new tasks, other
   detections and civil effects.

How the result is worked out, all shown under **How it was calculated** on the result card:

| Step | Rule (defaults; all editable) |
|---|---|
| Unit combat power | type value (e.g. infantry 4, armour 8 per company) × echelon size (company 1, battalion 3, brigade 9…) × strength % × status (moving 0.8, combat ineffective 0.3…) × low supply or morale (0.85 below 50%, 0.7 below 25%) |
| Defence | sum of defenders × terrain (urban ×2, river ×1.75…) × position (prepared ×1.5, fortified ×2) |
| Force ratio → table | combat results table row for that ratio: chance of success and base losses per hour (e.g. 3:1 → 70%, attacker 8%, defender 15%) |
| Outcome roll (d100) | ≤ a third of the chance: **decisive**; ≤ the chance: **attack succeeds**; up to halfway to 100: **attack stalls**; otherwise **attack repulsed** |
| Losses | base × outcome (e.g. defender ×1.5 when decisive) × a second roll (0.75–1.25) × duration |
| Status | winners and losers take the outcome's status; units at 30% or less become combat ineffective, at 10% or less destroyed |
| Afterwards | both sides use 3% supply; the winner gains 5 morale and the loser loses 5; each side detects the units it fought |

**Repeatable dice.** Each exercise has a seed. An engagement's rolls come from the seed plus the log id of
the action, so the same engagement always produces the same result and anyone can re-check it later.
The seed and key are shown on the card.

**Rules tables.** **Rules tables** (in the engagement panel) opens every number for this exercise: unit
values and speeds, echelon sizes, status, terrain and position multipliers, the combat results table
(add or remove rows), thresholds, after-effects and the low supply and morale penalties. Changes are
logged. **Reset to defaults** restores the built-in tables. The defaults are generic planning-level
figures for training. Set them to your own doctrine and scenario.

**Supply use over time** (off by default; switch it on in the rules tables). As the clock advances, each
side uses supply per hour according to what it's doing: idle 1%, moving 2%, engaged 5%. Fractions carry
over, so small clock steps still add up. Each drop is logged.

**AI judgement** is still the default for everything that isn't a fight between units: decisions,
coordination, information and civil effects.

---

## Doctrine library: your own doctrine, SOPs and lessons in every AI answer

Open **Doctrine library** (bottom of the left-hand menu). Add:
- **Word (.docx)**, **PDF** with a text layer, **HTML**, **Markdown** or **plain text** files, or
  **paste text** (e.g. an ROE card). Scanned PDFs have no text to read: the app says so rather than
  storing gibberish. Save those as .docx or .txt instead.
- Tag each as **Doctrine**, **SOP**, **ROE / legal**, **Lessons** or **Reference**.

What happens:
- Documents are split into sections, keeping **headings** and **paragraph numbers** (e.g. *Chapter 3
  Casualty evacuation, para 3.1–3.2*).
- For each AI request, the app searches the library **in the browser** (BM25 keyword ranking: offline,
  with no embeddings and no extra API calls) and sends the best-matching extracts, up to about 6,000
  characters, labelled D1, D2….
- The AI is told to prefer them to general knowledge, cite the ones it relied on, never cite one it
  wasn't given, and flag an extract that conflicts with the scenario.
- Results show **Doctrine and references**: each citation with the point it supports and the exact
  extract, so a controller can check it against the source.

The library is used by **exercise design**, **adjudication** (both modes), **RED AI turns**, **MSEL gap
suggestions** and the **after action review**. Use **Try a search** to see what the AI would be given
for a question. Switch a document off to keep it out of AI requests without deleting it.

### Example documents

The first time the app runs in a browser, the library is filled with ten **example documents**, so the AI
has something to cite straight away and you can see what works well. They're invented and generic, **not
official publications**. Replace them with your own. The library dialog has **Remove examples** and
**Add example documents** (or **Restore missing examples**) buttons. Once removed, they stay removed.

| Example | Type | What it covers | Used when… |
|---|---|---|---|
| EXCON handbook | SOP | Control organisation, EXCON battle rhythm, inject release and 5-minute acknowledgement, adjudication principles, NO DUFF, evidence for the AAR | running the exercise, adjudicating, the AAR |
| Brigade HQ standing operating procedures | SOP | HQ battle rhythm, SITREPs every 4 hours, COP updated within 15 minutes, RFI tracking, shift handover | players report, miss an RFI, let the COP go stale |
| Rapid planning process | Doctrine | One-third/two-thirds rule, mission analysis, COA development and wargaming, short-notice COA briefs, orders and FRAGOs | higher HQ demands a plan, a COA brief is due |
| Intelligence reporting standards | Doctrine | PIRs, source grading, standard confidence words, handling conflicting reports, 15-minute timeliness | conflicting ISR reports, J2 updates |
| ROE and law of armed conflict training card | ROE / legal | Distinction, proportionality, precautions, self-defence, escalation of force, civilian harm allegations, detainees, when to consult LEGAD | ceasefires, civilian harm, escalation of force |
| Civil-military cooperation and protection of civilians | Doctrine | Humanitarian principles, NGO convoy deconfliction, displaced persons, host-nation liaison | NGO requests, refugees, local officials |
| Public affairs and media handling | SOP | Holding lines within 30 minutes, responding to allegations, the information environment | journalists, social media, allegations |
| Sustainment and casualty evacuation | SOP | LOGSTATs, supply thresholds (matching the combat rules: 50% reduced, 25% critical), resupply priorities, urgent/priority/routine CASEVAC, mass casualty | port or route disruption, casualties |
| White cell adjudication guide | Reference | Purpose of adjudication, force-ratio planning factors (matching the combat rules tables), terrain, friction, fairness and consistency | every adjudication |
| Lessons from Exercise GREY HERON | Lessons | An invented past exercise's AAR: ratings, sustains, improves, lessons | design and the AAR, to spot repeated weaknesses |

They're written to match the demo scenario's injects. In Demo mode an adjudication about the NGO convoy,
for example, cites the CIMIC document's section on deconflicting humanitarian movement.

### Writing documents that work well

The examples follow these rules, which make the difference between a useful citation and none:

- **Use headings.** Start a heading line with `#` in text files, or use Word's Heading styles. Each
  heading starts a new section, and citations name it.
- **Number paragraphs** (1.1, 1.2…) so citations point to the exact paragraph.
- **One topic per section.** The AI gets the best-matching sections, not whole documents.
- **Use the words your staff use**, and spell out abbreviations at least once. Search matches words,
  not meanings. Common abbreviations (CASEVAC, ISR, RFI, SITREP, LEGAD, PAO, NGO, COA, COP, ROE and
  others) are also searched as their full words, and word endings are ignored ("alleges" matches
  "allegation").
- **State standards plainly, with numbers** ("within 15 minutes", "below 50%", "about 3:1"), so the AI
  can judge players against them.
- **Test with Try a search**, using the words a player or controller would use in an action.

A text file in this shape is all it takes:

```
# 3 Requests for information

3.1 RFIs are logged with a number, the requester, the question and the latest time of value.

3.2 The RFI manager chases every open RFI before its latest time of value.
```

**Lessons from past exercises.** In the AAR, **Save lessons to the library** stores the review's
assessments, sustains, improves and lessons as a *Lessons* document. Later exercises' designs,
adjudications and reviews can then draw on them.

**Sharing.** The library is kept in this browser (IndexedDB). **Export library** gives a file other
EXCON staff can **Import**. Only the AI requests use it, so players' screens don't need it.

---

## What the AI does for you

The AI does five jobs. Each has its own instructions (in `js/prompts.js`), and the answers come back as
**structured data** that the app validates and renders, not free text.

### 1. Exercise designer: builds the whole package from your brief

| You provide | The AI returns |
|---|---|
| Type, echelon, audience, domains, objectives, setting, duration, number of injects, complexity | **Scenario summary** and region description |
| | **Actors**: invented states, armed groups, civil authorities, NGOs and media, each with a disposition (friendly / neutral / hostile / unknown) |
| | **Road to crisis**: the timeline of events leading to STARTEX |
| | **BLUE and RED situation** at STARTEX |
| | **Training objectives** with measurable performance measures |
| | **MSEL**: timed injects, each with sender, recipient, delivery method, description, **expected player action** and linked objectives |
| | **Role-player personas** with personality and goals |
| | **Controller guidance** for running it |

Design rules the AI follows:
- Every inject drives at least one objective.
- Injects are spread across the exercise duration and escalate.
- There is at least one conflicting-information inject and one legal/ethical dilemma.

This replaces days of scenario writing with a first draft in a minute or two. Planners then refine it.

### 2. White cell adjudicator: rules on what the players do

When you submit a player action, the AI reads the scenario, the current exercise time and the recent
log, then returns:
- **Outcome**: what happens in the fictional world
- **Effects** and **state changes**
- **Rationale**, so a controller can see the reasoning and overrule it
- **Confidence**: low, medium or high
- **Recommended follow-up injects** (0–3) that build on teaching points the action revealed. Add any of
  them to the MSEL with one click.

It's told to be fair: sound staff work should generally succeed, and poor coordination should cause
realistic friction. Rulings are logged as *pending controller review*. They advise, they don't decide.

In **Combat rules + AI** mode the tables and dice decide the result, and the AI only narrates it (see
[Rules-based adjudication](#rules-based-adjudication-numbers-from-tables-narrative-from-the-ai)).

### 3. Role-players: in-character voices that react to your players

Each persona stays in character, speaks in the right register (terse radio traffic, pointed press
questions, a civil official with their own priorities) and remembers its own conversation. Replies
stream in live and are written to the log. Start a message with `EXCON:` to talk to the persona out of
character, e.g. "EXCON: make this more hostile".

This frees controllers from voicing every non-player character, and one person can run several at once.

### 4. After action reviewer: assesses performance against the objectives

From the full log and the MSEL status, the AI produces:
- **Executive summary**
- A **T / P / U rating** (Trained, Partially trained, Untrained) for each objective, with the evidence
  it relied on and the gaps
- **Sustains** (keep doing) and **Improves** (fix)
- **Lessons identified** as observation → discussion → recommendation

It's instructed to use only evidence in the log and never invent events.

### 5. MSEL assistant: fills coverage gaps and checks release conditions

- **Suggest injects for gaps** proposes injects for objectives the MSEL tests too little or too early,
  timed into the gap, each with a one-line reason.
- **Check with AI** on a conditional inject judges from the log and world state whether its condition
  is met, gives its confidence, and cites the log entries it used.

Wherever the doctrine library has relevant passages, the AI works from them and cites them (see
[Doctrine library](#doctrine-library-your-own-doctrine-sops-and-lessons-in-every-ai-answer)).

### Guardrails built into every AI call

- The scenario world is always fictional. No real present-day states, units, bases or people appear as
  participants.
- Content stays at staff-training level: decisions, information flow, dilemmas and friction. It never
  includes real targeting data, weapon-employment procedures or anything that would work outside the
  exercise.
- The law of armed conflict and rules of engagement are **assessed training areas**. The AI surfaces
  dilemmas rather than solving them for the players.
- All AI output is advisory, and controllers approve everything.
- Library references are checked: the app shows only citations of extracts it actually sent, next to the
  extract text.
- If a provider declines a request or the answer is cut off, the app shows a clear error instead of
  broken data.

---

## AI providers

Choose the provider in **Settings**:

| Provider | What you need | How it's called |
|---|---|---|
| **Demo** (default) | Nothing | Canned responses, fully offline |
| **OpenAI** | API key (or a custom auth header) and a model with JSON-schema structured outputs, e.g. `gpt-5`, `gpt-4.1`, `gpt-4o` | `POST {baseUrl}/chat/completions`, streaming, `response_format: json_schema` (strict) |
| **Claude** | Anthropic API key. Default model `claude-opus-5` | `POST {baseUrl}/v1/messages`, streaming, adaptive thinking, structured outputs, prompt caching |

### OpenAI options

- **Base URL.** Point it at Azure OpenAI, an API gateway, a proxy, or a local OpenAI-compatible server.
- **Reasoning effort.** Only for reasoning models; leave it on *Don't send* otherwise.
- **Custom headers.** Add any number of name/value pairs, sent with every request. Examples:
  `api-key` for Azure OpenAI, `OpenAI-Organization`, or a gateway or tenant token.
  - A custom `Authorization` header replaces the bearer key, and the API key field can be left empty.
  - Header values are treated like secrets: kept only for the session unless *Remember API keys* is on.
  - Headers browsers refuse to let pages set (Host, Cookie, Origin and so on) are rejected with a
    message.
- **Client certificate.** Pick the option that matches your gateway:

  | Option | What happens | Use when |
  |---|---|---|
  | **None** | No certificate | Normal API-key access |
  | **Installed (mTLS)** | The browser presents a certificate from the **Windows certificate store** during the TLS handshake. The app sends requests with credentials so this is allowed. | The endpoint requires mutual TLS. Install your `.pfx` first by double-clicking it; the browser may ask you to choose a certificate. |
  | **Header** | You load a public certificate (`.pem`, `.crt`, `.cer`, `.der`) and it's sent in a request header on every call, as single-line **Base64 DER** or **URL-encoded PEM**. The default header name is `X-Client-Cert`; set it to whatever your gateway expects (e.g. `X-ARR-ClientCert`, `X-SSL-Client-Cert`). | A gateway or proxy reads the client certificate from a header. |

  In Header mode:
  - The app shows the certificate's subject, issuer, expiry and SHA-256 fingerprint so you can confirm
    you loaded the right one, and warns if it has expired.
  - **Only the public certificate is kept.** If the file also holds a private key, the key is stripped
    and never stored or sent.
  - `.pfx`/`.p12` files are rejected because they carry a private key; use *Installed (mTLS)* for
    those.
  - A web page cannot attach a certificate file to the TLS handshake itself. That's a browser security
    rule, which is why true mTLS goes through the Windows certificate store.

- **CORS.** Because the browser calls the API directly, the endpoint must allow cross-origin requests,
  including any custom headers you add. For *Installed (mTLS)* it must also return
  `Access-Control-Allow-Credentials: true` with a specific allowed origin. OpenAI's public API allows
  normal browser calls. Corporate gateways may need configuring.

---

## Multi-user with GitLab

ExerciseForge can use **GitLab as its shared workspace**, so several controllers work on the same
exercises from their own computers. You don't need a server of your own: GitLab provides logins,
permissions, storage, notifications and the audit trail.

### How it works

```
  GitLab group  training/exercises
  ├── safety/                         Safety project: one issue per NO DUFF (open = active)
  ├── iron-lantern-3f2a9c/            one private project per exercise
  │     └── issue "Exercise IRON LANTERN"   ← the exercise
  │           description: starting snapshot (scenario, MSEL, …)
  │           comment: "EXCON (inject): INJ-003 released"      ← one change
  │           comment: "J3 (ack): INJ-003 acknowledged …"       ← another change
  ├── iron-lantern-3f2a9c-blue/      BLUE cell channel (BLUE players are members here only)
  ├── iron-lantern-3f2a9c-red/       RED cell channel
  └── steel-harbour-81bd02/
```

- **Every change is a comment.** Releasing an inject, an acknowledgement, a log entry or a clock
  change is posted as a comment holding a small change set, plus a readable summary line. Comments
  are only ever added, never overwritten, so two people changing different things at the same time
  both keep their changes. Every screen replays the comments in order and ends up with the same
  exercise.
- **Changes are targeted by ID.** Edits address a specific inject or log entry, not "item number 3", so
  simultaneous edits to different injects never collide. If two people change the *same* field at
  once, the later comment wins, and both remain visible in GitLab's history.
- **Your own changes show instantly**, then are sent in the background. The top-bar chip shows
  *Synced 5s ago*, *2 to send* or *Offline*. Changes made while offline are queued and sent once
  GitLab is reachable.
- **Audit trail:** the exercise's issue shows who changed what, and when, in GitLab's own history.
- **Archiving:** the delete button *archives* in GitLab mode. It closes the exercise issue so the
  exercise leaves the list, and keeps the project and its full history.
- **Separation:** each exercise is its own private project, so GitLab membership controls who can see
  and change it.

### Check interval

Each open screen checks GitLab every **15 seconds** by default (*Check every* in settings, 5–300
seconds). It also checks straight after you save, when the tab regains focus, and when the network
comes back.
- **Latency:** other people's changes and NO DUFFs arrive within one interval, about half of it on
  average.
- **Load:** at 15 s, about 4 small requests a minute per screen, so 100 screens is about 7 a second.
  That's trivial for GitLab.
- **Background tabs:** the timer runs in a background worker so it keeps its pace in hidden tabs.
- **Lost connection:** after **3 missed checks** an amber **Safety link lost** banner appears, telling
  people to rely on voice or radio.
- **Duplicate log entries:** the screen that declares or stands down a NO DUFF writes the log entry
  itself. Other screens wait 1.5 intervals before writing theirs, so normally only one entry lands.

### Setting it up

1. **Create a group** for exercises, e.g. `training/exercises`. Controllers need permission to create
   projects in it (Developer or Maintainer, depending on the group's *Roles allowed to create
   projects* setting).
2. **Create the Safety project.** Enter its path in settings and use **Test connection → Create
   Safety project**, or create it yourself. Give **everyone** who takes part at least *Reporter*
   access, so every screen can see NO DUFFs.
3. **Choose how people sign in** (Settings → Collaboration → Sign-in):
   - **Access token:** each person creates a personal access token with the `api` scope. This works
     from a local file and from Pages.
   - **Sign in with GitLab (OAuth):**
     1. In GitLab, open **Group or Admin → Applications** and add an application.
     2. Set the scope to `api`.
     3. Untick **Confidential**.
     4. Set the redirect URI to the app's Pages address (shown in the settings panel).
     5. Put the resulting application ID in settings.

     This only works when the app is served over https (GitLab Pages). The token renews itself
     automatically.
4. **Fill in the Collaboration tab:**
   - GitLab URL
   - Exercise group
   - Safety project
   - **Site**: NO DUFFs set to *Whole site* reach everyone with the same site name.
   - Check interval
   - Optionally a **Notify on NO DUFF** @user or @group
5. **Test connection** confirms your user, the group and the Safety project.
6. **Save.** The exercise list now comes from GitLab, and new exercises are created there.

Settings are per browser, so each participant enters them once. Sign-in details follow the *Remember
keys and tokens* switch: without it, they last until the tab closes, and they survive page reloads
and the GitLab sign-in redirect.

### Publishing on GitLab Pages

`.gitlab-ci.yml` is included. Push this folder to a GitLab project and the `pages` job publishes it on
every commit to the default branch. Then:
- **Restrict access:** Settings → General → Visibility → **Pages → Only project members**.
- **Self-managed GitLab:** an administrator must have Pages enabled.
- **CORS:** the GitLab API accepts cross-origin requests that carry a token, so nothing is needed for
  GitLab itself. **AI gateways** will see the Pages URL as the request origin; add it to their CORS
  allow-list, especially for custom headers and installed-certificate (mTLS) mode.

### Limits of GitLab mode

- There are **no instant pushes**: updates arrive within the check interval. For sub-second NO DUFF
  delivery you'd need a small real-time server (e.g. PocketBase or a WebSocket service), which could
  also hold the AI keys.
- **AI features stay on controller machines**, using each controller's own key. GitLab can't hide an
  API key from the browser.
- **Cell separation** relies on project membership, so keep players out of the exercise group's other
  projects (see [Cell views](#cell-views-excon-blue-red-and-observers)).

---

## Data, keys and security

- **Exercises** are stored in the browser's `localStorage` (so each browser profile has its own copy), or
  in GitLab in GitLab mode. Use **Export** (download icon) and **Import exercise** to back up or move
  them. Importing in GitLab mode creates a new GitLab exercise.
- **API keys, custom header values and GitLab sign-in** are kept for the browser tab (`sessionStorage`)
  unless you turn on *Remember keys and tokens*. API keys go only to the AI base URL you set, and
  GitLab credentials only to your GitLab URL.
- **Certificates:** only the public certificate is stored, never a private key.
- **Doctrine library** documents are kept in this browser's IndexedDB. Only the extracts that match a
  request are sent to the AI provider, so the same classification caution applies to what you load.
  Each AI result stores the extracts it was given, and those travel with the exercise (and to GitLab in
  GitLab mode).
- **Classification:** OpenAI and Anthropic are commercial cloud services. Don't enter classified or
  sensitive real-world information. For higher-classification work, point the OpenAI base URL at an
  accredited, locally hosted OpenAI-compatible model on your own network.
- **Shared deployments:** for many users, put a small proxy in front of the provider so users never
  handle keys, and add authentication there.

---

## Look and feel

- **Material Design 3:** colour roles from a navy-blue seed with teal accents, in full light and dark
  schemes; Roboto type; Material Symbols icons; standard M3 components.
- **Theme toggle** (top right) cycles System → Light → Dark and is remembered.
- **Responsive:** on narrow screens the drawer becomes a slide-out menu and the MSEL table stacks into
  cards.

---

## Files

```
.gitlab-ci.yml   GitLab Pages deployment
index.html       Page structure, settings, acknowledgement and NO DUFF dialogs
styles.css       Material 3 theme (light/dark) and components
fonts/           Bundled Roboto, Roboto Mono, Material Symbols (offline) + fonts.css
js/store.js      localStorage persistence and settings (secrets kept separately)
js/schemas.js    JSON schemas for AI output (valid for both OpenAI strict mode and Claude)
js/prompts.js    The AI's instructions and guardrails for each job
js/llm.js        Provider adapters: OpenAI (headers, certificates), Claude, Demo; streaming
js/cert.js       Client certificate loading (public cert only), fingerprint and expiry
js/vector.js     Vector tile (MVT) decoder and renderer: built-in style, contours, peaks, overzoom, light/dark
js/map.js        Map (Leaflet), offline map files and tile cache, NATO-style symbols, world state, fog of war, RED plan and RED turns
js/rules.js      Combat rules: tables, seeded dice, force ratios, losses, movement rates, supply use; engagement picker and tables editor
js/timeline.js   MSEL timeline, inject editor, dependencies and branches, release conditions, auto-release, running clock, objective coverage
js/samples.js    The ten example library documents
js/library.js    Doctrine library: .docx/.pdf/.html/.txt reading, sectioning, offline BM25 search, citations, export/import
js/sync.js       Storage backends (this browser / GitLab), change sets and merge, GitLab API + OAuth, NO DUFF records
js/mock.js       Demo-mode responses
js/app.js        Exercise logic and rendering
vendor/          Bundled libraries and data (see below)
```

### Bundled third-party files (`vendor/`)

| File | Version | Licence | Purpose |
|---|---|---|---|
| `leaflet/` | Leaflet 1.9.4 | BSD-2-Clause | Map engine |
| `pmtiles.js` | PMTiles 3.2.1 | BSD-3-Clause | Reads PMTiles map files |
| `sql-wasm.js`, `sql-wasm-binary.js` | sql.js 1.11.0 | MIT | Reads MBTiles map files (WebAssembly embedded so it loads from a file) |
| `topojson-client.min.js` | 3.1.0 | ISC | Decodes the world outline |
| `world-50m.js` | world-atlas 2.0.2 (Natural Earth 1:50m) | Public domain | Built-in world outline and land check |
