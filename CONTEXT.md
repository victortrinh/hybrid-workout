# Compromised

A personal coach for one athlete's 26-week program toward a sub-22 5K (sub-20 after it) and a HYROX Men's Open race on 21 April 2027. It turns the program into today's session and adapts it to what has been logged.

## Program

**Program**:
The full 26-week plan, from week 1 (26 October 2026) to Race day.
_Avoid_: schedule, training plan (when meaning the whole thing)

**Race day**:
Wednesday 21 April 2027, the HYROX race every Week is counted back from.

**Finish time**:
The race's result, h:mm:ss, kept on the race's Session log. From the day after Race day, Today leads with it, and asks for it in one step until it is logged.
_Avoid_: race time, result (alone)

**Program recap**:
The whole Program in four numbers, shown on Today after Race day: the 5K tests first to last, the Working weights first to now, Sessions done, and the total Training load.

**Phase**:
A run of Weeks sharing one emphasis: Foundation, 5K development, HYROX build, Race specific, Taper.

**Week**:
A numbered Monday–Sunday period of the Program, counted back from Race day.
_Avoid_: microcycle

**Bucket**:
The set of Sessions a Week prescribes, done on any day and in any order within that Week. A Session may also be done early or late, outside its Week; it still counts for its own Week.
_Avoid_: schedule, calendar

**Deload week**:
A Week whose Prescriptions are reduced by roughly a third to let fatigue clear.

**Taper**:
The reduced-volume Week before Race week, defined by the race-week rules rather than the normal pattern.

**Race week**:
Week 26, holding Race day and the few easy days around it.

## Sessions

**Session**:
One planned piece of training of a single Session type, belonging to a Week's Bucket.
_Avoid_: workout, training

**Session type**:
Speed, Strength, Threshold, HYROX, Easy run, 5K test or Race simulation.

**Hard session**:
Any Session type other than Easy run; two Hard sessions should not fall on consecutive days when avoidable.

**Key session**:
The one Session in a Week that may carry over up to three days into the next Week if not done (a 5K test, a Race simulation, or the Week's designated priority).

**Optional session**:
The Easy run in a Bucket; it never carries over and missing it is not a miss.

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
One line of a HYROX session or Race simulation log: a round's time, or a run or Station with the load, distance and split actually done.

**Block**:
A timed part of a Session, such as warm-up, intervals, circuit or cooldown.

**Set up**:
The untimed Block before a HYROX session's first round where every Station it uses is loaded, once for the whole Session. Its time is not in the Session's minutes or Training load.

**Exercise**:
A single movement or protocol inside a Block.

**Substitution**:
An Exercise used in place of another because equipment is missing or Readiness calls for lower impact.

**Equipment profile**:
The list of equipment available at the athlete's gym, which decides Substitutions.

## Targets

**Prescription**:
The concrete targets of a Session after adaptation: reps, durations, paces or speeds, loads and RPE.
_Avoid_: plan text, workout description

**RPE**:
Rating of perceived exertion, 1–10; RPE 7 means about three reps left in reserve.

**5K test**:
An all-out 5 km time trial that replaces that Week's Speed session and resets the Training paces.
_Avoid_: benchmark, TT

**Training paces**:
The 5K, Threshold and Easy paces derived from the latest 5K test, or, before the first one, Estimated Training paces.

**Starting point**:
The estimates the athlete gives once, at first launch: an estimated 5K time and estimated Working weights for the main lifts, each optional. Editable in Settings until a real result replaces each; a real result always wins.
_Avoid_: onboarding, baseline (the baseline is the first 5K test)

**Estimated Training paces**:
Training paces from the Starting point's estimated 5K time, worked out as for a 5K test of that time and shown as estimates until the first 5K test replaces them.

**Goal pace**:
4:24 per km, the pace of a sub-22 5K: the April checkpoint. Sub-20 (4:00 per km) is the goal after this Program.

**Environment**:
Whether a run happens Indoors on a treadmill or Outdoors; Indoor Prescriptions are expressed as speed and incline.

**Working weight**:
The current load for a lift's main sets, first found in a calibration session and then progressed from logged reps and RPE. A calibration ramps from the empty bar, or from about 70% of the Starting point's estimate, rounded down to 5 lb.

**Station**:
One of the eight HYROX race stations: SkiErg, sled push, sled pull, burpee broad jumps, row, farmers carry, sandbag lunges, wall balls.

**Race load**:
The Men's Open weight and distance or rep count for a Station.

**Race simulation**:
A 60–75 minute Session of race-distance runs and Stations at Race load, done in place of a normal HYROX session.

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

**Recovery data**:
Sleep duration, heart-rate variability and resting heart rate measured by the ring overnight.

**Pain report**:
A 0–10 pain score with a body area, given at the start of a Session, in Log after, or at any time; "No" is a score of 0. The latest one stands until the next.

**Activity**:
A workout recorded by the watch and sent from Apple Health by the Workout Shortcut, which the Coach matches to a Session.
_Avoid_: using Session for imported data
