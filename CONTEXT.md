# Compromised

A personal coach for one athlete's 24-week program toward HYROX Ottawa, Doubles Men Open, on 22 April 2027. It turns the program into today's session and adapts it to what has been logged.

## Program

**Program**:
The full 24-week plan, from week 1 (9 November 2026) to Race day.
_Avoid_: schedule, training plan (when meaning the whole thing)

**Race day**:
Thursday 22 April 2027, the HYROX race every Week is counted back from. The start time is assigned a few days before.

**Doubles**:
The race format: two partners run every 1 km together and split each Station's work between them as they choose, at the same Race load as singles. The athlete trains alone, at full Race load and full Station volume, as if racing singles.
_Avoid_: pairs, team

**Finish time**:
The pair's race result, h:mm:ss, kept on the race's Session log. From the day after Race day, Today leads with it, and asks for it in one step until it is logged.
_Avoid_: race time, result (alone)

**Program recap**:
The whole Program in four numbers, shown on Today after Race day: Race run pace first to last, the Working weights first to now, Sessions done, and the total Training load.

**Phase**:
A run of Weeks sharing one emphasis: Foundation, Build, Race specific, Taper.

**Week**:
A numbered Monday–Sunday period of the Program, counted back from Race day.
_Avoid_: microcycle

**Bucket**:
The set of Sessions a Week prescribes, done on any day and in any order within that Week. Its order (Strength, HYROX B, Run, HYROX A, then the Optional sessions; ADR-0008) is how the Coach lists it and the tie-break for Up next when nothing else decides. A Session may also be done early or late, outside its Week; it still counts for its own Week. In Catch-up, the Late sessions come first in it.
_Avoid_: schedule, calendar

**Catch-up**:
While a Week that is over still holds a required Session with no log, Up next comes from the oldest such Week instead of the Week holding today, until the athlete has caught up or Race specific starts, when the ones still late are dropped as Coach-Skipped (ADR-0007).
_Avoid_: backlog, behind mode

**Late session**:
A required Session with no log in a Week that is over. It waits in Catch-up rather than being missed; one logged Skipped is not Late.
_Avoid_: overdue, missed (a Late session isn't missed yet)

**Deload week**:
A Week whose Prescriptions are reduced by roughly a third to let fatigue clear.

**Taper**:
The two reduced-volume Weeks before Race week: every Session type stays, each about 40% then 60% shorter, at the same intensity.

**Race week**:
Week 24, holding Race day and the few easy days around it.

## Sessions

**Session**:
One planned piece of training of a single Session type, belonging to a Week's Bucket.
_Avoid_: workout, training

**Session type**:
Strength, Run, HYROX, Easy run, Compromised run test or Race simulation.

**Session cap**:
45 minutes, the most any Session may take, Set up excluded. Only a Race simulation is exempt.
_Avoid_: time limit, budget

**Hard session**:
Any Session type other than Easy run; two Hard sessions should not fall on consecutive days when avoidable.

**Key session**:
The one Session in a Week the Coach marks as the Week's priority (a Compromised run test, a Race simulation, or the Week's designated HYROX or Run). It keeps its place in the Bucket. Not done by Sunday, it is a Late session like any other.

**Optional session**:
An Easy run in a Bucket; it is never a Late session and missing it is not a miss. A Week holds one, or two once the Coach offers a second.

**Session status**:
Planned, Done, Partial, Skipped or Swapped.

**Live session**:
A Session being performed with guided timers and set-by-set logging.
_Avoid_: active workout

**Lock-screen cue**:
A push notification at a Live session's Block change or the end of a rest, sent by the server while the app is off screen (ADR-0006).
_Avoid_: alert, reminder

**Session log**:
What actually happened in a Session: actual sets, reps, loads, times, RPE and notes.
_Avoid_: entry, record

**By-feel speeds**:
The speeds of a Live session's by-feel reps and of its recovery jogs, asked once on the finish sheet (a treadmill speed indoors, a pace per km outdoors), since nobody types on a moving belt. Both optional. The hard-rep speed is logged on each by-feel rep that ran its course; the jogs' is the Session log's recovery pace. The latest logged before a Session come back as a hint, "Hard, by feel · Last time 14.0 km/h", as the recovery jog's suggestion when there are no Training paces, and as the finish sheet's starting answers. Never a target, never Training paces (ADR-0002).
_Avoid_: rep feedback, actual speed

**Station log**:
One line of a HYROX session, Compromised run test or Race simulation log: a round's time, or a run or Station with the load, distance and split actually done.

**Block**:
A timed part of a Session, such as warm-up, rounds, intervals or cooldown.

**Set up**:
The untimed Block before a HYROX session's first round where every Station it uses is loaded, once for the whole Session. Its time is not in the Session's minutes, the Session cap or Training load.

**Exercise**:
A single movement or protocol inside a Block.

**Substitution**:
An Exercise used in place of another because equipment is missing or Readiness calls for lower impact.

**Equipment profile**:
The list of equipment available at the athlete's gym, which decides Substitutions.

## Targets

**Prescription**:
The concrete targets of a Session after adaptation: reps, durations, paces or speeds, loads, Station targets and RPE.
_Avoid_: plan text, workout description

**RPE**:
Rating of perceived exertion, 1–10; RPE 7 means about three reps left in reserve.

**Compromised run**:
A run done straight after a Station, on legs the Station has tired. Every run in the race after the first is one.
_Avoid_: tired run, transition run

**Compromised run test**:
Four rounds of a 1 km run at full effort followed by one Station at Race load and half race volume; the Key session of its Week, replacing that Week's Run session. Its average run split becomes Race run pace and resets the Training paces; the gap from its first split to its last is the Fade.
_Avoid_: benchmark, TT, time trial

**Fade**:
How much slower the last run of a Session is than its first, as seconds per km. Shown for HYROX sessions, Compromised run tests and Race simulations.
_Avoid_: drop-off, slowdown

**Race run pace**:
The average 1 km split of the latest Compromised run test: the pace the athlete can hold between Stations. Before the first test, the Starting point's estimate.
_Avoid_: 5K pace, goal pace

**Training paces**:
Race run pace and the Threshold and Easy paces derived from it, or, before the first Compromised run test, Estimated Training paces.

**Starting point**:
The estimates the athlete gives once, at first launch: an estimated 1 km split between Stations and estimated Working weights for the main lifts, each optional. Editable in Settings until a real result replaces each; a real result always wins.
_Avoid_: onboarding, baseline (the baseline is the first Compromised run test)

**Estimated Training paces**:
Training paces from the Starting point's estimated 1 km split, worked out as for a Compromised run test of that pace and shown as estimates until the first test replaces them.

**Environment**:
Whether a run happens Indoors on a treadmill or Outdoors; Indoor Prescriptions are expressed as speed and incline.

**Working weight**:
The current load for a lift's main sets in a Strength session, first found in a calibration session and then progressed from logged reps and RPE. A calibration ramps from the empty bar, or from about 70% of the Starting point's estimate, rounded down to 5 lb. Stations have no Working weight: they are always at Race load.

**Station**:
One of the eight HYROX race stations: SkiErg, sled push, sled pull, burpee broad jumps, row, farmers carry, sandbag lunges, wall balls.

**Race load**:
The Men's Open weight for a Station, the same in Doubles as in singles, and its full race distance or rep count.

**Station volume**:
The distance or rep count of a Station prescribed in one round, from a fraction of its Race load distance in Foundation to the full race amount in Race specific.
_Avoid_: station distance, station reps (when meaning the prescribed amount)

**Station best**:
The fastest time logged for a Station at a given Station volume, at Race load.
_Avoid_: PR, record

**Station target**:
The time the Coach asks the athlete to beat for a Station at its prescribed Station volume: the Station best, or the Station best less about 3% once the last two logs at that volume came in at RPE 7 or under.
_Avoid_: goal time, split goal

**Race simulation**:
A 60–85 minute Session of race-distance runs and Stations at Race load, done in place of a normal HYROX session and exempt from the Session cap.

**Projected finish**:
The solo finish time the Coach estimates from the Station bests at full Station volume, eight runs at Race run pace and a fixed transition allowance; shown with the Doubles share beside it.
_Avoid_: predicted time, forecast

**Training load**:
RPE multiplied by minutes, summed per Session or Week.

## Coaching

**Coach**:
The fixed rules that pick Up next and produce Suggestions from the Program, Session logs and Readiness.
_Avoid_: AI, algorithm, engine (in user-facing language)

**Up next**:
The single Session the Coach recommends doing today.

**Suggestion**:
A proposed change to a Prescription or a Week, with a one-line reason, that the athlete accepts or overrides.
_Avoid_: auto-adjustment, recommendation (when meaning a change)

**Readiness**:
The athlete's state for a day, combining Recovery data and the latest Pain report.

**Readiness flag**:
A day the Readiness rules acted on: a Pain report of 3 or more, or rising, or a night under 6 hours. A day counts once. Three in one Week make the Coach suggest the rest of it a third lighter, never in a Deload week or the Taper.

**Recovery data**:
Sleep duration, heart-rate variability and resting heart rate measured by the ring overnight.

**Pain report**:
A 0–10 pain score with a body area, given at the start of a Session, in Log after, or at any time; "No" is a score of 0. The latest one stands until the next.

**Activity**:
A workout recorded by the watch and sent from Apple Health by the Workout Shortcut, which the Coach matches to a Session.
_Avoid_: using Session for imported data
