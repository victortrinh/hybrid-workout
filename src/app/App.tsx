import { useEffect, useMemo, useRef } from 'react'
import { addDays } from '../domain/calendar'
import { Link, RouterProvider } from 'react-aria-components'
import { coach, findWeek, keyDeadline, prescribedWeek, type CoachDay } from '../domain/coach'
import { liftsLog, startLifts } from '../domain/lifts'
import { liveLog, startRun } from '../domain/live'
import { logFor, type SessionLog } from '../domain/log'
import type { Environment, RunContext } from '../domain/paces'
import type { PainArea, PainReport } from '../domain/pain'
import { mergeDecisions, painId } from '../domain/suggestion'
import type { Session } from '../domain/program/types'
import { environmentOn } from '../domain/settings'
import { program } from '../domain/program/program'
import { Icon } from './components/Icons'
import { StripedNumeral } from './components/StripedNumeral'
import { longDay } from './format'
import { navigate, SCREEN_PATH, useRoute, type Route, type Screen } from './router'
import { NotFound } from './screens/NotFound'
import { Plan } from './screens/Plan'
import { Progress } from './screens/Progress'
import { unlockSound } from './liveCues'
import { Live } from './screens/Live'
import { LogAfter } from './screens/LogAfter'
import { Today, type PainAtStart } from './screens/Today'
import { WeekScreen } from './screens/Week'
import { usePicked } from './usePicked'
import { editedAt, useDecisions } from './useDecisions'
import { usePainReports } from './usePainReports'
import { useSessionLogs } from './useSessionLogs'
import { environmentKey, useSettings } from './useSettings'
import { useLiveRun } from './useLiveRun'
import { useToday } from './useToday'

const NAV = [
  { screen: 'today', label: 'Today' },
  { screen: 'plan', label: 'Plan' },
  { screen: 'progress', label: 'Progress' },
] as const

const TITLES: Record<Screen, string> = {
  today: 'Today',
  log: 'Log after',
  live: 'Live session',
  plan: 'Plan',
  week: 'Week',
  progress: 'Progress',
  'not-found': 'Not found',
}

/** A Week is part of Plan in the navigation; Log after is part of Today. */
const NAV_SCREEN: Partial<Record<Screen, Screen>> = { week: 'plan', log: 'today' }

/**
 * The shell: a cobalt side rail from 960px, a bottom tab bar below it. The
 * Coach runs here, on the device, against today's date in Toronto and the
 * Session logs stored on the device, so Today works without signal.
 */
export function App() {
  const today = useToday()
  const { logs, save, pending, error } = useSessionLogs()
  const { decisions, decide, error: decisionError } = useDecisions()
  const [picked, pick] = usePicked()
  const { reports: painReports, report } = usePainReports()
  const { settings, change, overrides, override } = useSettings()
  const { equipment } = settings
  const day = useMemo(
    () => coach({ program, today, logs, picked, decisions, equipment, painReports }),
    [today, logs, picked, decisions, equipment, painReports],
  )
  /** How a Session's runs read: the Training paces, in this Session's Environment and the chosen units. */
  const runContext = (week: number, session: Session): RunContext => {
    const inWeek = day.position.kind === 'in-week' && day.position.week === week
    const start = findWeek(program, week)?.startDate ?? today
    const date = session.date ?? (inWeek ? today : start)
    return {
      paces: day.paces,
      unit: settings.unit,
      environment: environmentOn(date, settings, overrides[environmentKey(week, session.id)]),
    }
  }
  const setEnvironment = (week: number, session: Session, environment: Environment) =>
    override(week, session.id, environment)
  const [live, setLive] = useLiveRun()
  /** A Pain report given now, for a Session or (with neither) from Something hurts. */
  const painReport = (score: number, area: PainArea | null, week: number | null, sessionId: string | null): PainReport => ({
    id: crypto.randomUUID(),
    date: today,
    score,
    area,
    week,
    sessionId,
    updatedAt: new Date().toISOString(),
  })
  /**
   * Start session, once the pain step is answered: the report and the
   * decision on its Suggestion count at once, and the Live session starts
   * from the Coach's answer with them in it, so the pain rules are already in
   * its Blocks. Strength is prefilled with today's Working weights; a run's
   * clock starts at the tap, in the Environment Today shows for it.
   */
  const startLive = (week: number, session: Session, pain: PainAtStart) => {
    unlockSound()
    const given = painReport(pain.score, pain.area, week, session.id)
    report(given)
    let decided = decisions
    if (pain.decision) {
      const decision = { id: painId(given.id), decision: pain.decision, date: today, updatedAt: editedAt(undefined) }
      decide(decision)
      decided = mergeDecisions(decisions, [decision])
    }
    if (!pain.start) return
    const after = coach({ program, today, logs, picked, decisions: decided, equipment, painReports: [...painReports, given] })
    const started = after.bucket.find((e) => e.week === week && e.session.id === session.id)?.session ?? session
    const now = Date.now()
    setLive(
      started.type === 'strength'
        ? startLifts({ week, session: started, date: today, weights: day.workingWeights }, now)
        : startRun({ week, session: started, date: today, environment: runContext(week, session).environment }, now),
    )
    navigate(SCREEN_PATH.live)
  }
  /** The finished Live session's log, replacing any log the Session already has. */
  const saveLive = (make: (id: string, updatedAt: string) => SessionLog) => {
    if (!live) return
    const existing = logFor(logs, live.week, live.sessionId)
    save({ ...make(existing?.id ?? crypto.randomUUID(), editedAt(existing?.updatedAt)), notes: existing?.notes ?? null })
    setLive(null)
    navigate(SCREEN_PATH.today)
  }
  const route = useRoute()
  const week =
    route.screen === 'week' || route.screen === 'log'
      ? prescribedWeek(program, route.week ?? 0, logs, decisions, equipment, { reports: painReports, today })
      : null
  const logged = route.screen === 'log' ? week?.sessions.find((s) => s.id === route.sessionId) : undefined
  const screen: Screen =
    (route.screen === 'week' && !week) || (route.screen === 'log' && !logged) ? 'not-found' : route.screen
  useScreenChange(screen, screen === 'week' && week ? `Week ${week.number}` : TITLES[screen], route)
  const navScreen = NAV_SCREEN[screen] ?? screen

  if (screen === 'live') {
    // Full screen, no navigation: nothing on it moves or competes with the clock.
    return (
      <RouterProvider navigate={navigate}>
        <main id="main">
          <Live
            live={live}
            runContext={{ paces: day.paces, unit: settings.unit, environment: 'indoor' }}
            onChange={setLive}
            onSave={(run, finish) => saveLive((id, updatedAt) => liveLog(run, Date.now(), { ...finish, id, updatedAt }))}
            onSaveLifts={(lifts, finish) =>
              saveLive((id, updatedAt) => liftsLog(lifts, Date.now(), { ...finish, id, updatedAt }))
            }
          />
        </main>
      </RouterProvider>
    )
  }

  return (
    <RouterProvider navigate={navigate}>
      <a
        href="#main"
        className="sr-only z-50 bg-paper px-4 py-3 font-bold text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <div className="grid min-h-dvh desktop:grid-cols-[240px_1fr]">
        <SideRail screen={navScreen} day={day} />
        <main id="main" className="min-w-0 pb-24 desktop:pb-12">
          {screen === 'today' && (
            <Today
              day={day}
              weekCount={program.weekCount}
              pending={pending}
              error={error ?? decisionError}
              onPick={(weekNumber, sessionId) => pick(weekNumber, sessionId, today)}
              onDecide={(suggestion, decision) => {
                const previous = decisions.find((d) => d.id === suggestion.id)
                decide({ id: suggestion.id, decision, date: today, updatedAt: editedAt(previous?.updatedAt) })
              }}
              runContext={runContext}
              onEnvironment={setEnvironment}
              settings={settings}
              onSettings={change}
              live={live}
              onStart={startLive}
              onSomethingHurts={(score, area) => report(painReport(score, area, null, null))}
            />
          )}
          {screen === 'log' && week && logged && (
            <LogAfter
              week={week}
              session={logged}
              lastDay={logged.key ? keyDeadline(program, week) : addDays(week.startDate, 6)}
              logs={logs}
              today={today}
              defaultEnvironment={(date) => environmentOn(date, settings)}
              onSave={save}
              onPain={(score, area) => report(painReport(score, area, week.number, logged.id))}
            />
          )}
          {screen === 'plan' && <Plan program={program} day={day} />}
          {screen === 'week' && week && <WeekScreen program={program} week={week} day={day} runContext={runContext} />}
          {screen === 'progress' && <Progress program={program} day={day} logs={logs} unit={settings.unit} />}
          {screen === 'not-found' && <NotFound />}
        </main>
        <TabBar screen={navScreen} />
      </div>
    </RouterProvider>
  )
}

/** New title on every screen; on a change of screen, back to the top with focus on the heading. */
function useScreenChange(screen: Screen, title: string, route: Route) {
  const key = `${screen}/${route.week ?? ''}/${route.sessionId ?? ''}`
  const previous = useRef(key)
  useEffect(() => {
    document.title = `${title} · Compromised`
    if (previous.current === key) return
    previous.current = key
    window.scrollTo(0, 0)
    document.querySelector<HTMLElement>('main h1')?.focus()
  }, [key, title])
}

function SideRail({ screen, day }: { screen: Screen; day: CoachDay }) {
  return (
    <aside className="on-field sticky top-0 hidden h-dvh flex-col bg-cobalt px-6 py-7 text-on-cobalt desktop:flex">
      <span className="text-brand uppercase font-stretch-125%">Compromised</span>
      <nav aria-label="Main" className="mt-9 grid gap-1">
        {NAV.map((item) => (
          <Link
            key={item.screen}
            href={SCREEN_PATH[item.screen]}
            aria-current={screen === item.screen ? 'page' : undefined}
            className="flex items-center gap-3 rounded-sm px-3 py-2.5 text-[17px] font-bold text-on-cobalt no-underline hover:bg-white/12 data-current:bg-on-cobalt data-current:text-cobalt"
          >
            <Icon name={item.screen} />
            {item.label}
          </Link>
        ))}
      </nav>
      {screen !== 'today' && (
        <p className="mt-auto">
          <StripedNumeral value={String(Math.max(0, day.daysToRace))} className="text-[56px]" />
          <span className="mt-1.5 block">days to {longDay(day.raceDay)}</span>
        </p>
      )}
    </aside>
  )
}

function TabBar({ screen }: { screen: Screen }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t-2 border-ink bg-paper pt-2 pb-[calc(8px+env(safe-area-inset-bottom))] desktop:hidden"
    >
      {NAV.map((item) => (
        <Link
          key={item.screen}
          href={SCREEN_PATH[item.screen]}
          aria-current={screen === item.screen ? 'page' : undefined}
          className="flex min-w-18 flex-col items-center gap-[3px] py-1 text-label text-muted no-underline data-current:text-link"
        >
          <Icon name={item.screen} />
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
