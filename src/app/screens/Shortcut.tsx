import type { ReactNode } from 'react'
import { Link } from 'react-aria-components'
import { sleepText, type RecoveryNight } from '../../domain/recovery'
import { longDay } from '../format'

/**
 * Settings → Recovery Shortcut: how to build the iOS Shortcut that sends
 * last night from Apple Health, filtered to the ring (ADR-0003), and whether
 * a night has arrived yet, to check the setup worked.
 */
export function Shortcut({ nights }: { nights: RecoveryNight[] }) {
  const endpoint = `${location.origin}/api/recovery`
  const last = nights.at(-1)
  return (
    <div className="px-pad pt-6 pb-8 desktop:max-w-plan desktop:px-gutter desktop:pt-9">
      <p>
        <Link href="/" className={backLink}>
          Today
        </Link>
      </p>
      <h1 tabIndex={-1} className="mt-2 text-headline-page">
        Recovery Shortcut
      </h1>
      <p className="mt-2 text-body">
        Every morning your iPhone sends last night’s sleep, HRV and resting heart rate from the ring to the Coach. Build
        it once. Never type a number.
      </p>

      <section aria-labelledby="last-night" className="mt-6 border-t-2 border-ink pt-3.5">
        <h2 id="last-night" className="text-title-sm">
          Last night received
        </h2>
        {last ? (
          <p className="mt-2 text-body">
            {longDay(last.date)}: sleep {sleepText(last.sleepMinutes)}
            {last.hrvMs !== null && ` · HRV ${last.hrvMs} ms`}
            {last.restingHeartRate !== null && ` · resting ${last.restingHeartRate} bpm`}
            <span className="block text-body-quiet text-muted">From {last.source}</span>
          </p>
        ) : (
          <p className="mt-2 text-body">Nothing yet. Run the Shortcut once and this shows what arrived.</p>
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
            <Code>POST</Code>, request body JSON
          </Field>
          <Field term="Headers">
            <Code>CF-Access-Client-Id</Code>: the service token’s Client ID
            <br />
            <Code>CF-Access-Client-Secret</Code>: the service token’s Client Secret
          </Field>
          <Field term="Body">
            <Code>sleepMinutes</Code>, <Code>hrvMs</Code>, <Code>restingHeartRate</Code> (numbers) and{' '}
            <Code>source</Code> (text, the ring’s name). The night counts for the day it arrives; add{' '}
            <Code>date</Code> (yyyy-MM-dd) only to send another day’s.
          </Field>
        </dl>
        <pre className="mt-3 overflow-x-auto rounded-sm bg-sunk p-3 text-[14px]">
          {JSON.stringify(
            { sleepMinutes: 341, hrvMs: 38, restingHeartRate: 52, source: 'Ultrahuman' },
            null,
            2,
          )}
        </pre>
        <p className="mt-2 text-body-quiet text-muted">
          The service token comes from Cloudflare Zero Trust (Access → Service Auth). Keep the secret in the Shortcut
          only. Sending the same morning twice just replaces it.
        </p>
      </section>

      <section aria-labelledby="steps" className="mt-6 border-t-2 border-ink pt-3.5">
        <h2 id="steps" className="text-title-sm">
          Build it
        </h2>
        <p className="mt-2 text-body-quiet text-muted">
          In every Find Health Samples action, filter Source to the ring. The Watch writes sleep and HRV too, and mixing
          the two wrecks the averages.
        </p>
        <ol className="mt-3 grid list-decimal gap-3 pl-6 text-body">
          <li>Shortcuts app → Shortcuts → +. Name it “Compromised recovery”.</li>
          <li>
            <b>Find Health Samples</b> where Type is Sleep Analysis, Source is your Ultrahuman ring, Start Date is in the
            last 18 hours, Value is not In Bed and Value is not Awake.
          </li>
          <li>
            <b>Get Details of Health Samples</b>: Duration. Then <b>Calculate Statistics</b>: Sum. Convert the total to
            minutes (<b>Calculate</b> ÷ 60 if it’s in seconds) and <b>Set Variable</b> Sleep.
          </li>
          <li>
            <b>Find Health Samples</b> where Type is Heart Rate Variability, Source is the ring, Start Date is in the
            last 18 hours. <b>Get Details</b>: Value. <b>Calculate Statistics</b>: Average. <b>Set Variable</b> HRV.
          </li>
          <li>
            <b>Find Health Samples</b> where Type is Resting Heart Rate, Source is the ring; sort by Start Date, latest
            first, limit 1. <b>Get Details</b>: Value. <b>Set Variable</b> RHR.
          </li>
          <li>
            <b>Get Contents of URL</b>: the address above, Method POST, the two headers, Request Body JSON with sleepMinutes =
            Sleep, hrvMs = HRV, restingHeartRate = RHR (all three as Number) and source = “Ultrahuman”.
          </li>
          <li>
            Run it once and allow Health access and the connection. “Last night received” above should show the same
            numbers as the Ultrahuman app. No sleep synced yet is refused: open the Ultrahuman app and run it again.
          </li>
          <li>
            Automation → + → Time of Day, daily, a little after you usually wake and open the Ultrahuman app (it syncs
            to Health then). Choose Run Immediately, then the Shortcut.
          </li>
        </ol>
      </section>
    </div>
  )
}

const backLink =
  'py-2 text-[15px] font-bold text-link underline decoration-2 underline-offset-4 hover:decoration-[3px] data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link'

function Field({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-label text-muted uppercase">{term}</dt>
      <dd className="mt-0.5 text-body break-words">{children}</dd>
    </div>
  )
}

const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded-sm bg-sunk px-1 font-mono text-[0.9em]">{children}</code>
)
