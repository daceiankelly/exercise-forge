"use strict";
// Example documents for the doctrine library. They're generic and invented (not official publications), written
// to show how library documents work best: clear headings, numbered paragraphs, one topic per section, and the
// words staff actually use. They load on first run so the AI can cite something straight away, and the numbers
// match the default combat rules tables.

const SAMPLE_DOCS = [
{
  id: "X-excon", kind: "sop", title: "EXCON handbook (example)",
  text: `# About this document
EXAMPLE DOCUMENT. Generic exercise control procedures written for ExerciseForge. Not an official publication. Replace it with your own EXCON directive.

# 1 Exercise control organisation

1.1 The Exercise Director owns the exercise, approves the MSEL and is the only authority to declare ENDEX or change the training objectives.

1.2 The Chief of EXCON runs the exercise day to day: inject release, adjudication, role-play and the exercise log.

1.3 The white cell adjudicates player actions and plays neutral actors. The red cell plays the opposing force within the RED plan set by EXCON. Response cells play higher, lower and flanking headquarters.

1.4 Observer controllers (OCs) watch the training audience, record observations against the training objectives and never intervene in play except for safety.

# 2 EXCON battle rhythm

2.1 EXCON holds a short synchronisation meeting every two hours of exercise time: injects due in the next period, outstanding adjudications, training audience workload and any safety issues.

2.2 The MSEL is a plan, not a script. Hold, advance or skip injects to keep the training audience at the right level of pressure: busy but not saturated.

2.3 If the training audience is saturated, delay routine traffic first. Never delay injects that test an ethical or legal decision without the Exercise Director's approval.

# 3 Inject release and acknowledgement

3.1 Release each inject through the agreed channel and record the release time. The receiving cell acknowledges receipt, not agreement.

3.2 An inject not acknowledged within five minutes is chased by EXCON and recorded as a battle rhythm observation.

3.3 Dynamic injects created during play must name the training objective they serve and be logged before release.

# 4 Adjudication principles

4.1 Adjudicate the decision, not the paperwork. Sound staff work that is coordinated and timely should generally succeed; uncoordinated action should meet realistic friction.

4.2 Every adjudication records the outcome, the rationale and the controller who approved it, so the result can be explained in the after action review.

4.3 Use the combat rules for engagements between units, and white cell judgement for decisions, coordination, information and civil effects.

# 5 Safety and NO DUFF

5.1 Safety overrides training at all times. Any participant may call NO DUFF for a real-world emergency.

5.2 On NO DUFF all play stops, the exercise clock is paused and radio nets are kept clear for the emergency. Play resumes only when the Exercise Director stands down the NO DUFF and EXCON resumes the clock.

# 6 Evidence for the after action review

6.1 Log every player decision, adjudication and observation with the exercise time. The after action review uses only what is in the log.

6.2 Observations state what was seen, the effect it had and the training objective it relates to, with a rating of trained, partially trained or untrained.`,
},
{
  id: "X-hqsop", kind: "sop", title: "Brigade HQ standing operating procedures (example)",
  text: `# About this document
EXAMPLE DOCUMENT. Generic headquarters procedures written for ExerciseForge. Not an official publication.

# 1 Headquarters battle rhythm

1.1 The headquarters runs a fixed battle rhythm: commander's update brief every six hours, plans synchronisation every twelve hours and a sustainment meeting daily.

1.2 The chief of staff owns the battle rhythm and may add unscheduled briefs when a commander's critical information requirement (CCIR) is triggered.

# 2 Reporting

2.1 Subordinate units send a situation report (SITREP) every four hours and immediately on any significant event.

2.2 A SITREP gives location, activity, enemy seen, own casualties, logistic state and intentions for the next period.

2.3 Any report that answers a CCIR goes straight to the commander, not through the normal battle rhythm.

# 3 Common operational picture

3.1 The J3 watchkeeper updates the common operational picture (COP) within 15 minutes of new information.

3.2 Every item on the COP shows its source and the time of the information, not the time it was plotted.

3.3 Enemy positions older than two hours are shown as last known positions, not current positions.

# 4 Requests for information

4.1 Requests for information (RFIs) are logged with a unique number, the requester, the question and the latest time the answer is of value.

4.2 The RFI manager tracks every open RFI and chases answers before the latest time of value.

4.3 An RFI that cannot be answered in time is reported back to the requester with the reason.

# 5 Handover between shifts

5.1 Each shift hands over with a written brief: current situation, open RFIs, injects or tasks in progress and decisions awaiting the commander.

5.2 The incoming watchkeeper confirms the COP matches the handover brief before the outgoing shift leaves.`,
},
{
  id: "X-planning", kind: "doctrine", title: "Rapid planning process (example)",
  text: `# About this document
EXAMPLE DOCUMENT. A generic planning process written for ExerciseForge. Not an official publication.

# 1 Planning under time pressure

1.1 Use no more than one third of the available time for your own planning and give subordinates at least two thirds.

1.2 Issue a warning order as soon as the mission is understood, so subordinates can start preparing in parallel.

# 2 Mission analysis

2.1 Identify the specified and implied tasks, constraints, key facts and assumptions.

2.2 Every assumption is written down with the information that would confirm or disprove it, and becomes a request for information.

2.3 Mission analysis ends with a restated mission and the commander's planning guidance.

# 3 Course of action development

3.1 Develop at least two courses of action (COAs) that are suitable, feasible, acceptable, exclusive and complete.

3.2 Each COA states the scheme of manoeuvre, the main effort, the reserve and the risks.

3.3 Under severe time pressure one COA is acceptable if the commander directs it, but the risks must still be stated.

# 4 Wargaming and decision

4.1 Wargame each COA against the enemy's most likely and most dangerous courses of action.

4.2 The COA decision brief states the recommendation, the risks, the assumptions it depends on and the decision points the commander will face.

4.3 Decision points are linked to CCIRs so the headquarters knows what information will trigger each decision.

# 5 Updated plans at short notice

5.1 When higher HQ requests an updated course of action brief at short notice, the chief of staff sets the brief time first and works back: mission analysis update, one or two COAs, a short wargame and the brief.

5.2 An updated COA brief states what has changed since the last plan, the new risks and any decisions needed from higher HQ.

# 6 Orders

6.1 Orders follow the five-paragraph format: situation, mission, execution, service support, command and signal.

6.2 Changes to an existing order are issued as a fragmentary order (FRAGO) that states only what has changed.

6.3 Boundaries and coordination measures are confirmed with adjacent units before a FRAGO that changes them is issued.`,
},
{
  id: "X-intel", kind: "doctrine", title: "Intelligence reporting standards (example)",
  text: `# About this document
EXAMPLE DOCUMENT. Generic intelligence reporting standards written for ExerciseForge. Not an official publication.

# 1 Priority intelligence requirements

1.1 Priority intelligence requirements (PIRs) are the questions the commander needs answered to make decisions. Every collection task is linked to a PIR.

1.2 PIRs are reviewed at each plans synchronisation and removed once answered or no longer relevant.

# 2 Source grading

2.1 Every intelligence report grades the source for reliability (A completely reliable to F cannot be judged) and the information for credibility (1 confirmed to 6 cannot be judged).

2.2 A single-source report is never presented to the commander as confirmed.

# 3 Confidence statements

3.1 Every assessment carries a confidence statement in standard words: almost certain, highly likely, likely, realistic possibility, unlikely, highly unlikely, remote chance.

3.2 The J2 briefs what is known, what is assessed and what is not known, and keeps the three separate.

# 4 Conflicting reports

4.1 When reports conflict or ISR sources disagree about enemy movement, J2 does not discard either. It states both, gives the sources and their grades, and assesses which is more likely with a confidence statement.

4.2 Conflicting reports on an enemy force near a friendly unit are passed to the commander and the unit concerned immediately, with the uncertainty stated.

4.3 J2 raises a collection task to resolve the conflict and states when an answer is expected.

# 5 Timeliness

5.1 Intelligence of immediate operational significance is passed within 15 minutes of receipt, even if incomplete.

5.2 A late but complete report is less useful than a timely report with its uncertainty stated.`,
},
{
  id: "X-roe", kind: "roe", title: "ROE and law of armed conflict training card (example)",
  text: `# About this document
EXAMPLE DOCUMENT. A generic training card summarising widely published principles, written for ExerciseForge exercises. Not a real rules of engagement card and not legal advice.

# 1 Principles of the law of armed conflict

1.1 Distinction: only military objectives may be attacked. Civilians and civilian objects are protected unless and for such time as they take a direct part in hostilities.

1.2 Proportionality: an attack must not be expected to cause incidental civilian harm that is excessive in relation to the concrete and direct military advantage anticipated.

1.3 Precautions: take all feasible precautions to verify targets and to avoid or minimise civilian harm, including giving warnings where circumstances permit.

1.4 Military necessity and humanity: use only the force needed to achieve a legitimate military purpose, and never cause unnecessary suffering.

# 2 Self-defence

2.1 Nothing in these rules limits the inherent right of self-defence against a hostile act or demonstrated hostile intent.

2.2 Force used in self-defence must be necessary and proportionate to the threat.

# 3 Escalation of force

3.1 Where the situation allows, use graduated measures to warn and deter before using force: signs and barriers, verbal warnings, visual signals, and a show of force.

3.2 Every escalation of force incident is reported through the chain of command and to the legal adviser (LEGAD) within two hours.

# 4 Civilian harm allegations

4.1 Any allegation of civilian harm is taken seriously, recorded and reported to the commander and LEGAD immediately.

4.2 The commander orders an initial assessment. Nobody speculates publicly about the cause before the assessment is complete.

# 5 Detained persons

5.1 Detained persons are treated humanely at all times, protected from violence and public curiosity, and their details recorded.

# 6 When to consult the legal adviser

6.1 Consult LEGAD before any decision that involves a protected site, a possible civilian harm, a ceasefire or truce proposal, or a change to the rules of engagement.

6.2 Record the legal advice and the commander's decision with its rationale.`,
},
{
  id: "X-civmil", kind: "doctrine", title: "Civil-military cooperation and protection of civilians (example)",
  text: `# About this document
EXAMPLE DOCUMENT. Generic civil-military cooperation (CIMIC) guidance written for ExerciseForge. Not an official publication.

# 1 Humanitarian principles

1.1 Humanitarian organisations and NGOs work to the principles of humanity, neutrality, impartiality and independence. Military forces respect this and avoid actions that make aid workers appear partisan.

1.2 Coordination with NGOs is by liaison and information sharing, not command.

# 2 Deconfliction of humanitarian movement

2.1 Requests from NGOs for safe passage of convoys are passed to J3 through the CIMIC cell and answered before the requested movement time.

2.2 J3 deconflicts the convoy route and timing with planned manoeuvre, fires and known threats, and tells the NGO of any route that is not safe.

2.3 Humanitarian convoy routes and timings are shown on the common operational picture and passed to all units along the route.

# 3 Displaced persons

3.1 Movements of displaced persons are reported as soon as observed, with numbers, direction and needs.

3.2 Operations are planned to avoid obstructing displaced persons' routes to safety wherever possible.

# 4 Host nation and local authorities

4.1 Liaison with host-nation authorities is through a single point of contact to avoid conflicting messages.

4.2 Requests from local officials are logged like RFIs and answered, even when the answer is no.

# 5 Protection of civilians

5.1 Protection of civilians is considered in every course of action: likely civilian presence, protected sites and the effect of the operation on essential services.

5.2 Allegations of civilian harm are handled with the legal adviser and public affairs together, following the ROE card.`,
},
{
  id: "X-media", kind: "sop", title: "Public affairs and media handling (example)",
  text: `# About this document
EXAMPLE DOCUMENT. Generic public affairs procedures written for ExerciseForge. Not an official publication.

# 1 Principles

1.1 Tell the truth, be first where possible and never speculate. An accurate holding line now is better than a detailed statement too late.

1.2 Only the commander or an authorised spokesperson speaks for the force.

# 2 Responding to media queries

2.1 Media queries are passed to the public affairs officer (PAO) immediately and logged with the deadline the journalist has given.

2.2 The PAO drafts a holding line within 30 minutes and has it approved by the chief of staff.

2.3 A holding line acknowledges the query, states what is being done and promises an update. It does not confirm or deny facts that are not yet established.

# 3 Allegations of civilian harm

3.1 Allegations of civilian harm are coordinated between PAO, the legal adviser and J3 before any response.

3.2 The response states that the allegation is being taken seriously and assessed, and that the force follows the law of armed conflict.

3.3 Never blame the enemy or the civilians before the facts are known.

# 4 Information environment

4.1 Hostile information activity is expected. Monitor local media and social media and report significant narratives to J2 and the commander.

4.2 Correct false information quickly with facts, not counter-accusations.`,
},
{
  id: "X-sustain", kind: "sop", title: "Sustainment and casualty evacuation (example)",
  text: `# About this document
EXAMPLE DOCUMENT. Generic sustainment and medical procedures written for ExerciseForge. Not an official publication. The supply thresholds match the default combat rules tables.

# 1 Logistic reporting

1.1 Units send a logistic status report (LOGSTAT) every twelve hours and immediately when any commodity falls below 50%.

1.2 Below 50% supply a unit's combat power is reduced; below 25% it is critical and the unit should not be given offensive tasks until resupplied.

# 2 Resupply priorities

2.1 The main effort is resupplied first, then units in contact, then the reserve.

2.2 Resupply routes are planned with J3 and shown on the common operational picture, avoiding humanitarian convoy routes where possible.

2.3 Disruption to sealift, ports or main supply routes is reported to J4 and assessed for its effect on operations within the hour.

# 3 Casualty evacuation

3.1 Casualties are categorised as urgent, priority or routine. Urgent casualties need surgical care within one hour; priority within four hours; routine within 24 hours.

3.2 The unit requests evacuation through the medical net with location, number of casualties by category, special equipment needed and security at the pick-up point.

3.3 The battalion medical officer coordinates evacuation routes with the operations cell and reports casualty numbers to brigade.

# 4 Mass casualty incidents

4.1 A mass casualty incident is declared when casualties exceed the medical capacity immediately available.

4.2 On declaration, the headquarters activates the mass casualty plan, requests host-nation and higher medical support and informs public affairs.`,
},
{
  id: "X-adjudication", kind: "reference", title: "White cell adjudication guide (example)",
  text: `# About this document
EXAMPLE DOCUMENT. Generic guidance for exercise adjudicators written for ExerciseForge. Not an official publication. Planning factors match the default combat rules tables.

# 1 Purpose of adjudication

1.1 Adjudication serves the training objectives. The aim is a plausible, explainable outcome that teaches, not a precise simulation.

1.2 Adjudicate what the training audience actually decided and did, based on what they knew at the time.

# 2 Planning factors for engagements

2.1 A deliberate attack on a prepared position generally needs a local force ratio of about 3:1 to have a good chance of success. At 1:1 an attack is unlikely to succeed.

2.2 Defenders in urban or close terrain, or behind a river, are much harder to dislodge. A river crossing against a defended bank needs more force and careful coordination.

2.3 Units low on supply or morale fight less effectively. Units that are moving when attacked are more vulnerable than units in position.

# 3 Coordination and friction

3.1 Actions that are coordinated with adjacent units, supported by reconnaissance and reported promptly should generally succeed as planned.

3.2 Actions taken without coordination should create friction: boundary confusion, delays, or exposure to the enemy. Show the consequence rather than stating a penalty.

# 4 Information and civil effects

4.1 Decisions that affect civilians, the media or the host nation have effects beyond the battlefield. Adjudicate these consequences too, and use role-players to deliver them.

# 5 Fairness and consistency

5.1 Similar actions in similar circumstances should get similar outcomes. Use the combat rules for engagements so results can be repeated and explained.

5.2 Do not punish the training audience for information they could not have had. Do not reward them for information they should not have had.

5.3 Record the rationale for every adjudication so it can be explained and challenged in the after action review.`,
},
{
  id: "X-lessons", kind: "lessons", title: "Lessons from Exercise GREY HERON (example)",
  text: `# About this document
EXAMPLE DOCUMENT. Lessons from an invented past exercise, to show what saved lessons look like. Use Save lessons to the library in the AAR tab to add your own.

# Summary
Exercise GREY HERON was a brigade command post exercise. The headquarters planned well under time pressure but was slow to share uncertain intelligence and to coordinate with civil actors.

# Objective assessment
Common operational picture: partially trained. The COP was updated within 15 minutes on most occasions, but enemy positions were not marked as last known.
Course of action under time pressure: trained. The COA was briefed on time with risks and assumptions stated.
Civil-military coordination: partially trained. An NGO convoy request was answered after the requested movement time.
ROE and LOAC: untrained. The legal adviser was consulted only after the decision on a civilian harm allegation had been made.

# Sustain
Warning orders were issued early, giving subordinates time to prepare.
The COA decision brief linked decision points to CCIRs.

# Improve
J2 updates must include a confidence statement and the source grading.
Involve the legal adviser before, not after, decisions involving possible civilian harm.
Route NGO requests to J3 through the CIMIC cell with a deadline.

# Lessons identified
Observation: conflicting ISR reports were passed to the commander without a confidence statement. Discussion: the commander committed the reserve on an unqualified single-source report. Recommendation: every J2 update states what is known, assessed and not known, with a confidence statement.

Observation: a media query about civilian casualties was answered before the facts were established. Discussion: the statement had to be corrected, damaging credibility with the host nation. Recommendation: use an approved holding line within 30 minutes and coordinate PAO, LEGAD and J3 before any substantive response.`,
},
];
