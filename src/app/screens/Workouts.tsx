import { Link } from 'react-aria-components'
import type { Activity } from '../../domain/activity'
import { activitySummary, longDay, nb, timeOfDay } from '../format'
import { backLink, Code, Field } from './Shortcut'

/**
 * Settings → Workout Shortcut: how to build the iOS Shortcut that sends each
 * Apple Watch workout from Apple Health (ADR-0004), and the last one that
 * arrived, to check the setup worked.
 */
export function Workouts({ activities }: { activities: Activity[] }) {
  const endpoint = `${location.origin}/api/activities`
  // The one that arrived last, whatever day it was: a resent older workout counts.
  const last = activities.reduce<Activity | undefined>(
    (latest, a) => (!latest || a.receivedAt > latest.receivedAt ? a : latest),
    undefined,
  )
  return (
    <div className="px-pad pt-6 pb-8 desktop:max-w-plan desktop:px-gutter desktop:pt-9">
      <p>
        <Link href="/" className={backLink}>
          ← Today
        </Link>
      </p>
      <h1 tabIndex={-1} className="mt-2 text-headline-page">
        Workout Shortcut
      </h1>
      <p className="mt-2 text-body">
        When an Apple Watch workout ends, your iPhone sends it to the Coach, which attaches it to the Session you did:
        duration, heart rate, distance. Build it once.
      </p>

      <section aria-labelledby="last-workout" className="mt-section border-t-2 border-ink pt-3.5">
        <h2 id="last-workout" className="text-title-sm">
          Last workout received
        </h2>
        {last ? (
          <p className="mt-2 text-body">
            {nb(`${last.workoutType}, ${longDay(last.date)} at ${timeOfDay(last.startedAt)}`)}
            <span className="block text-body-quiet text-muted">{nb(activitySummary(last, false))}</span>
          </p>
        ) : (
          <p className="mt-2 text-body">Nothing yet. Run the Shortcut once after a workout and this shows what arrived.</p>
        )}
      </section>

      <section aria-labelledby="request" className="mt-section border-t-2 border-ink pt-3.5">
        <h2 id="request" className="text-title-sm">
          What it sends
        </h2>
        <dl className="mt-2 grid gap-3">
          <Field term="Address">
            <Code>{endpoint}</Code>
          </Field>
          <Field term="Method">
            <Code>POST</Code>, request body JSON, once per workout
          </Field>
          <Field term="Headers">
            The Recovery Shortcut’s: <Code>CF-Access-Client-Id</Code> and <Code>CF-Access-Client-Secret</Code>
          </Field>
          <Field term="Body">
            <Code>type</Code> (text: the workout type, fixed per automation), <Code>start</Code> and <Code>end</Code>{' '}
            (text, ISO 8601), <Code>heartRates</Code> (text: each heart-rate sample’s value and time, one per line)
            and <Code>distanceSamples</Code> (text: each distance sample’s value, unit, time and source, one per line).
            The server keeps the samples between start and end, works out average and maximum heart rate, and counts
            distance from one device only, so the phone and the watch never add up twice.
          </Field>
        </dl>
        <pre
          tabIndex={0}
          aria-label="Example request body"
          className="mt-3 overflow-x-auto rounded-sm bg-sunk p-3 text-[14px] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          {JSON.stringify(
            {
              type: 'Running',
              start: '2026-11-04T07:12:00-05:00',
              end: '2026-11-04T07:54:30-05:00',
              distanceSamples:
                '0.52 km 2026-11-04T07:15:00-05:00 Victor’s Apple Watch\n0.48 km 2026-11-04T07:18:00-05:00 Victor’s Apple Watch',
              heartRates: '140 2026-11-04T07:13:00-05:00\n152 2026-11-04T07:20:00-05:00',
            },
            null,
            2,
          )}
        </pre>
        <p className="mt-2 text-body-quiet text-muted">
          Sending the same workout again just replaces it. No indoor flag: Apple Watch automations only know “Running”, so
          the treadmill months in Settings decide, and a treadmill run asks for the console distance.
        </p>
      </section>

      <section aria-labelledby="steps" className="mt-section border-t-2 border-ink pt-3.5">
        <h2 id="steps" className="text-title-sm">
          Build it
        </h2>
        <p className="mt-2 text-body-quiet text-muted">
          Shortcuts can’t read a workout back from Health, so two automations time it: one saves the time a workout
          starts, the other sends it when it ends, with the heart rate and distance Health has for that window.
        </p>
        <ol className="mt-3 grid list-decimal gap-3 pl-6 text-[17px] leading-[1.4] font-normal">
          <li>
            New Shortcut, “Compromised workout start”: <b>Date</b> (Current Date) → <b>Format Date</b>, ISO 8601 with
            the time → <b>Save File</b> to the Shortcuts folder, Ask Where to Save off, Subpath{' '}
            <Code>compromised-workout-start.txt</Code>, Overwrite If File Exists on.
          </li>
          <li>
            New Shortcut, “Compromised workouts”. In its ⓘ details, turn on Receive Text as input. Then: <b>Wait</b> 60
            seconds, so the watch syncs → <b>Get File</b> from the Shortcuts folder, the exact name the first Shortcut
            saved → <b>Get Text from Input</b> → <b>Set Variable</b> Start → <b>Date</b> (Current Date) →{' '}
            <b>Format Date</b>, ISO 8601 with the time → <b>Set Variable</b> End. No Get Dates from Input: it misreads
            ISO dates.
          </li>
          <li>
            <b>Find Health Samples</b> where Type is Heart Rate and Start Date is in the last 4 hours → <b>Repeat with
            Each</b>: a <b>Text</b> of Repeat Item’s Value, a space, its Start Date (Date Format ISO 8601, with the time)
            → after End Repeat, <b>Combine Text</b> Repeat Results with New Lines → <b>Set Variable</b> HR. The server
            keeps only the samples between start and end.
          </li>
          <li>
            <b>Find Health Samples</b> where Type is Walking + Running Distance and Start Date is in the last 4 hours →{' '}
            <b>Repeat with Each</b>: a <b>Text</b> of Repeat Item’s Value, a space, its Unit, a space, its Start Date (ISO
            8601, with the time), a space, its Source → <b>Combine Text</b> Repeat Results with New Lines →{' '}
            <b>Set Variable</b> Distance.
          </li>
          <li>
            <b>Get Contents of URL</b>: the address above, Method POST, the two headers, Request Body JSON with Text
            type = Shortcut Input, Text start = Start, Text end = End, Text heartRates = HR and Text distanceSamples =
            Distance.
          </li>
          <li>
            Automation → + → Apple Watch Workout → Any workout, Is Started → Run Immediately → “Compromised workout
            start”.
          </li>
          <li>
            For each workout type you start on the watch (Running, Traditional Strength Training, Functional Strength
            Training, Mixed Cardio…): Automation → + → Apple Watch Workout → that type, Is Ended → Run Immediately →{' '}
            <b>Text</b> with the type’s name exactly as listed → <b>Run Shortcut</b> “Compromised workouts” with the
            Text as input.
          </li>
          <li>
            Do a short workout. A minute after it ends, “Last workout received” above should show it. The first time,
            allow Health access and Always Allow the connection.
          </li>
        </ol>
      </section>
    </div>
  )
}
