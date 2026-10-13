# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React 19 + Tailwind v4 + react-aria-components single-page app, installable as a PWA with offline logging; Hono API on Cloudflare Workers with D1; Cloudflare Access in front of the whole site. Decided during the grilling session (see `docs/adr/`).

## Users

One user: Victor, an amateur hybrid athlete in Montréal training for a sub-20 5K and a HYROX Men's Open race on 21 April 2027. He trains 4–5 times a week in a gym that has a sled, SkiErg, rower, wall balls, sandbags, dumbbells, a barbell, a bike and about 15 m of open floor; most winter runs are on a treadmill. He is the only person who will ever use the app.

## Product Purpose

Turn a fixed 27-week Program (`docs/training-plan.md`) into "what do I do today, and at what targets", then adapt the following Sessions to what was actually logged and how recovered he is. Success: every Week's Bucket gets done, the 5K tests trend toward 20:00, and he reaches race day healthy and race-ready without ever opening a spreadsheet.

## Positioning

A coach for exactly one Program and one athlete. It knows the plan, the race date, the gym's equipment and the athlete's history, so it can say "do this now, at this speed, with this weight" and explain every change in one line. Generic training apps make the athlete build or pick the plan; this one already has it and only asks for what it cannot measure.

## Operating Context

- Days are flexible: a Week is a Bucket of Sessions done in any order; the Coach recommends Up next.
- During a Live session the phone is usually propped on the treadmill console (read at arm's length while running) or lying on the floor or a bench during HYROX circuits (glanced at from a distance). Often the Apple Watch records the Session and the phone stays in a pocket, so logging happens afterwards.
- Recovery data (sleep, HRV, resting heart rate) arrives on its own each morning from the Ultrahuman ring via an iOS Shortcut; workouts arrive from the Apple Watch via Strava. The athlete is never asked to type daily data.
- Reviewing trends and the Program happens on desktop or phone outside training.
- Domain vocabulary is defined in `CONTEXT.md` and must be used in UI copy.

## Capabilities and Constraints

- Today: Up next, the rest of the Week's Bucket, race countdown, "Something hurts".
- Live session: interval timer with treadmill speed and incline cues, set logger with rest timer, HYROX round clock, wake lock, haptic and sound cues; logging afterwards is always possible.
- Plan: Phases and Weeks timeline; Session logs for past Sessions.
- Progress: 5K tests vs. sub-20, Training paces, Working weights, Station and Race simulation times, weekly completion and Training load, recovery trends.
- Settings: treadmill units (km/h default, mph option), Environment defaults, equipment profile, integrations, export.
- Free to run; works offline in the gym; English only; America/Toronto time zone.
- Units: distances and speeds are metric (km, m, km/h, with an mph option for the treadmill); every weight is in pounds (lb), matching the gym's plates and dumbbells.
- Product name: **Compromised** (confirmed 13 Oct 2026). HYROX athletes call running on legs tired from the Stations "compromised running".

## Brand Commitments

- **Coach voice: funny and blunt.** Short, direct lines with a dry joke where it fits, always carrying the reason and the number ("Slept 5 h. Bold of you. One fewer rep today."). Never preachy, never cheerleading, never motivational-poster. Humour never hides the instruction.

## Evidence on Hand

- `docs/training-plan.md`: the approved 27-week Program with every Session, Phase, deload and Race load.
- `CONTEXT.md`: the domain glossary.
- No logged data exists yet; prototypes may use realistic sample values but must not present them as real history.

## Product Principles

1. **One answer, then details.** Every screen leads with the single thing to do or know now; everything else is one tap away.
2. **Never ask for what can be measured.** Manual input is limited to what no device knows: pain, RPE, and corrections.
3. **Every change has a reason.** The Coach never alters a Prescription silently; each Suggestion says why in one line and can be overridden.
4. **Readable mid-effort.** Anything shown during a Live session must be legible at arm's length on a moving treadmill and operable in one tap.
5. **The race date is the spine.** Every Week, countdown and taper decision is anchored to 21 April 2027.

## Accessibility & Inclusion

WCAG 2.2 AA. Live-session numbers must stay legible at a distance and in bright gym lighting or a dim room; respect reduced-motion settings; never rely on colour or sound alone for cues (pair with text and haptics).
