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
          ← Today
        </Link>
      </p>
      <h1 tabIndex={-1} className="mt-2 text-headline-page">
        Recovery Shortcut
      </h1>
      <p className="mt-2 text-body">
        Every morning your iPhone sends last night’s sleep, HRV and resting heart rate from the ring to the Coach. Build
        it once. Never type a number.
      </p>

      <section aria-labelledby="last-night" className="mt-section border-t-2 border-ink pt-3.5">
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

      <section aria-labelledby="request" className="mt-section border-t-2 border-ink pt-3.5">
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
            <Code>sleep</Code> (text: each sleep entry’s start and end, one pair per line), <Code>hrvMs</Code>,{' '}
            <Code>restingHeartRate</Code> (numbers) and <Code>source</Code> (text). The server merges entries that
            overlap, so a night tracked by the Watch and the ring counts once, and keeps only the latest night.
          </Field>
        </dl>
        <pre
          tabIndex={0}
          aria-label="Example request body"
          className="mt-3 overflow-x-auto rounded-sm bg-sunk p-3 text-[14px] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          {JSON.stringify(
            {
              sleep: '2026-12-15T23:30:00-05:00 2026-12-16T03:10:00-05:00\n2026-12-16T03:25:00-05:00 2026-12-16T05:26:00-05:00',
              hrvMs: 38,
              restingHeartRate: 52,
              source: 'Ultrahuman',
            },
            null,
            2,
          )}
        </pre>
        <p className="mt-2 text-body-quiet text-muted">
          The service token comes from Cloudflare Zero Trust (Access → Service Auth). Keep the secret in the Shortcut
          only. Sending the same morning twice just replaces it.
        </p>
      </section>

      <section aria-labelledby="steps" className="mt-section border-t-2 border-ink pt-3.5">
        <h2 id="steps" className="text-title-sm">
          Build it
        </h2>
        <p className="mt-2 text-body-quiet text-muted">
          No Source filter needed: the server counts overlapping entries from the Watch and the ring once.
        </p>
        <ol className="mt-3 grid list-decimal gap-3 pl-6 text-[17px] leading-[1.4] font-normal">
          <li>Shortcuts app → Shortcuts → +. Name it “Compromised recovery”.</li>
          <li>
            <b>Find Health Samples</b> where Type is Sleep, Start Date is in the last 2 days, Value is not Awake and
            Value is not In Bed.
          </li>
          <li>
            <b>Repeat with Each</b> Health Sample. Inside it, a <b>Text</b> action: Repeat Item’s Start Date, a space,
            then Repeat Item’s End Date, both with Date Format ISO 8601 and the time included.
          </li>
          <li>
            After End Repeat, <b>Combine Text</b>: Repeat Results, with New Lines. <b>Set Variable</b> Sleep.
          </li>
          <li>
            <b>Find Health Samples</b> where Type is Heart Rate Variability, Start Date is in the last 1 day; sort by
            Start Date, latest first, limit 1. <b>Get Details</b>: Value. <b>Set Variable</b> HRV. The same for Type
            Resting Heart Rate into RHR.
          </li>
          <li>
            <b>Get Contents of URL</b>: the address above, Method POST, the two headers, Request Body JSON with Text
            sleep = Sleep, Number hrvMs = HRV, Number restingHeartRate = RHR and Text source = “Ultrahuman”.
          </li>
          <li>
            Run it once and allow Health access and the connection. “Last night received” above should show about
            the sleep the Health app shows. No sleep synced yet is refused: open the Ultrahuman app and run it again.
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

export const backLink =
  'inline-flex min-h-11 items-center text-[15px] font-bold text-link underline decoration-2 underline-offset-4 hover:decoration-[3px] data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link'

export function Field({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-label text-muted uppercase">{term}</dt>
      <dd className="mt-0.5 text-body break-words">{children}</dd>
    </div>
  )
}

export const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded-sm bg-sunk px-1 font-mono text-[0.9em]">{children}</code>
)
