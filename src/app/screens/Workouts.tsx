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
  const last = activities.at(-1)
  return (
    <div className="px-pad pt-6 pb-8 desktop:max-w-plan desktop:px-gutter desktop:pt-9">
      <p>
        <Link href="/" className={backLink}>
          Today
        </Link>
      </p>
      <h1 tabIndex={-1} className="mt-2 text-headline-page">
        Workout Shortcut
      </h1>
      <p className="mt-2 text-body">
        When an Apple Watch workout ends, your iPhone sends it to the Coach, which attaches it to the Session you did:
        duration, heart rate, distance. Build it once.
      </p>

      <section aria-labelledby="last-workout" className="mt-6 border-t-2 border-ink pt-3.5">
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

      <section aria-labelledby="request" className="mt-6 border-t-2 border-ink pt-3.5">
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
            <Code>type</Code>, <Code>start</Code> and <Code>end</Code> (text, ISO 8601), <Code>distance</Code> (text
            with its unit, optional), <Code>heartRates</Code> (text: the heart-rate samples during the workout, one per
            line) and <Code>indoor</Code> (optional, true or false). The server works out the average and the maximum.
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
              distance: '8.12 km',
              heartRates: '140\n152\n161\n171',
            },
            null,
            2,
          )}
        </pre>
        <p className="mt-2 text-body-quiet text-muted">
          Sending the same workout again just replaces it, so the Shortcut can send the whole last day every time.
        </p>
      </section>

      <section aria-labelledby="steps" className="mt-6 border-t-2 border-ink pt-3.5">
        <h2 id="steps" className="text-title-sm">
          Build it
        </h2>
        <ol className="mt-3 grid list-decimal gap-3 pl-6 text-body">
          <li>Shortcuts app → Shortcuts → +. Name it “Compromised workouts”.</li>
          <li>
            <b>Find Health Samples</b> where Type is Workouts and Start Date is in the last 1 day.
          </li>
          <li>
            <b>Repeat with Each</b> Health Sample. Inside it, <b>Find Health Samples</b> where Type is Heart Rate, Start
            Date is after Repeat Item’s Start Date and End Date is before Repeat Item’s End Date. Then{' '}
            <b>Combine Text</b>: those samples’ Value, with New Lines.
          </li>
          <li>
            Still inside the repeat, <b>Get Contents of URL</b>: the address above, Method POST, the two headers,
            Request Body JSON with Text type = Repeat Item’s Type, Text start = Repeat Item’s Start Date and Text end =
            Repeat Item’s End Date (both Date Format ISO 8601, with the time), Text distance = Repeat Item’s Distance if
            offered, and Text heartRates = Combined Text.
          </li>
          <li>
            Finish a short workout on the watch, then run the Shortcut once and allow Health access and the connection.
            “Last workout received” above should show it.
          </li>
          <li>
            Automation → + → Apple Watch Workout → When any workout ends → Run Immediately, then the Shortcut. If your
            iPhone doesn’t offer that trigger, use Time of Day, daily, in the evening.
          </li>
        </ol>
      </section>
    </div>
  )
}
