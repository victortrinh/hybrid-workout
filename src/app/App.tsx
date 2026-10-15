import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { isTreadmill, matchActivities, type Activity } from '../domain/activity'
import { addDays } from '../domain/calendar'
import { nowDate, nowMs } from '../domain/clock'
import { Link, RouterProvider } from 'react-aria-components'
import { coach, findWeek, keyDeadline, prescribedWeek, type CoachDay } from '../domain/coach'
import { liftsLog, startLifts } from '../domain/lifts'
import { liveLog, startRun } from '../domain/live'
import { logDays, logFor, type SessionLog } from '../domain/log'
import type { Environment, RunContext } from '../domain/paces'
import type { PainArea, PainReport } from '../domain/pain'
import { mergeDecisions, painId, type Decision, type Suggestion } from '../domain/suggestion'
import type { Session } from '../domain/program/types'
import { environmentOn } from '../domain/settings'
import { startingFields } from '../domain/startingPoint'
import { program } from '../domain/program/program'
import { DockContext } from './components/ActionBar'
import { Icon } from './components/Icons'
import { StripedNumeral } from './components/StripedNumeral'
import { longDay } from './format'
import { navigate, SCREEN_PATH, useRoute, type Route, type Screen } from './router'
import { NotFound } from './screens/NotFound'
import { Plan } from './screens/Plan'
import { Progress } from './screens/Progress'
import { Shortcut } from './screens/Shortcut'
import { StartingPoint } from './screens/StartingPoint'
import { Workouts } from './screens/Workouts'
import { unlockSound } from './liveCues'
import { Live } from './screens/Live'
import { LogAfter } from './screens/LogAfter'
import type { PainAtStart } from './components/PainStep'
import { Today } from './screens/Today'
import { WeekScreen } from './screens/Week'
import { useActivities } from './useActivities'
import { usePicked } from './usePicked'
import { editedAt, useDecisions } from './useDecisions'
import { usePainReports } from './usePainReports'
import { useRecovery } from './useRecovery'
import { useSessionLogs } from './useSessionLogs'
import { useStartingPoint } from './useStartingPoint'
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
  shortcut: 'Recovery Shortcut',
  workouts: 'Workout Shortcut',
  'not-found': 'Not found',
}

/** A Week is part of Plan in the navigation; Log after and Settings pages are part of Today. */
const NAV_SCREEN: Partial<Record<Screen, Screen>> = { week: 'plan', log: 'today', shortcut: 'today', workouts: 'today' }

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
  const recoveryNights = useRecovery()
  const { activities, answers: activityAnswers, answer, error: answerError } = useActivities()
  const { settings, change, overrides, override } = useSettings()
  const { point: startingPoint, answered, save: saveStartingPoint } = useStartingPoint()
  const { equipment } = settings
  const day = useMemo(
    () =>
      coach({
        program,
        today,
        logs,
        picked,
        decisions,
        equipment,
        painReports,
        recoveryNights,
        activities,
        activityAnswers,
        startingPoint,
      }),
    [today, logs, picked, decisions, equipment, painReports, recoveryNights, activities, activityAnswers, startingPoint],
  )
  /** Whether a run of the watch's was on a treadmill: its own flag, else the month's Environment. */
  const treadmill = (activity: Activity) => isTreadmill(activity, (date) => environmentOn(date, settings))
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
  /** The slot above the tab bar where a screen's ActionBar docks on the phone. */
  const [dock, setDock] = useState<HTMLElement | null>(null)
  /** A Pain report given now, for a Session or (with neither) from Something hurts. */
  const painReport = (score: number, area: PainArea | null, week: number | null, sessionId: string | null): PainReport => ({
    id: crypto.randomUUID(),
    date: today,
    score,
    area,
    week,
    sessionId,
    updatedAt: nowDate().toISOString(),
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
    const after = coach({
      program,
      today,
      logs,
      picked,
      decisions: decided,
      equipment,
      painReports: [...painReports, given],
      recoveryNights,
      activities,
      activityAnswers,
      startingPoint,
    })
    // Early or late, the Session isn't in the Bucket: its own Week, with the same pain rules.
    // Before the Program the Bucket is Week 1 without them, so it goes the same way.
    const started =
      (after.position.kind === 'in-week'
        ? after.bucket.find((e) => e.week === week && e.session.id === session.id)?.session
        : undefined) ??
      prescribedWeek(program, week, logs, decided, equipment, {
        reports: [...painReports, given],
        today,
        doneToday: true,
      })?.sessions.find((s) => s.id === session.id) ??
      session
    const now = nowMs()
    setLive(
      started.type === 'strength'
        ? startLifts(
            {
              week,
              session: started,
              date: today,
              weights: day.workingWeights,
              estimates: day.estimatedWeights,
              suggestions: after.suggestions,
            },
            now,
          )
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
  /** Accept or Keep, on Today or at the start of a Live Strength session: the same decision. Several at once go in one request. */
  const decideSuggestion = (suggestions: Suggestion | Suggestion[], decision: Decision) => {
    decide(
      ...[suggestions].flat().map((s) => {
        const previous = decisions.find((d) => d.id === s.id)
        return { id: s.id, decision, date: today, updatedAt: editedAt(previous?.updatedAt) }
      }),
    )
  }
  const route = useRoute()
  /** The watch's workout attached to a Session, from the same matching Today shows. */
  const attachedTo = (week: number, sessionId: string) =>
    matchActivities(program, activities, logs, activityAnswers).find(
      (o) => o.state === 'attached' && o.week === week && o.sessionId === sessionId,
    )?.activity ?? null
  const week =
    route.screen === 'week' || route.screen === 'log'
      ? prescribedWeek(program, route.week ?? 0, logs, decisions, equipment, { reports: painReports, today })
      : null
  const logged = route.screen === 'log' ? week?.sessions.find((s) => s.id === route.sessionId) : undefined
  const screen: Screen =
    (route.screen === 'week' && !week) || (route.screen === 'log' && !logged) ? 'not-found' : route.screen
  useScreenChange(screen, screen === 'week' && week ? `Week ${week.number}` : TITLES[screen], route)
  const loggableUntil = week && logged ? (logged.key ? keyDeadline(program, week) : addDays(week.startDate, 6)) : null
  // A Session logged early or late was opened from its Week, under Plan.
  const outsideWeek = week && loggableUntil ? logDays(week.startDate, loggableUntil, today).when !== null : false
  const navScreen = screen === 'log' && outsideWeek ? 'plan' : (NAV_SCREEN[screen] ?? screen)

  if (screen === 'live') {
    // Full screen, no navigation: nothing on it moves or competes with the clock.
    return (
      <RouterProvider navigate={navigate}>
        <main id="main">
          <Live
            live={live}
            runContext={{ paces: day.paces, unit: settings.unit, environment: 'indoor' }}
            onChange={setLive}
            onSave={(run, finish) => saveLive((id, updatedAt) => liveLog(run, nowMs(), { ...finish, id, updatedAt }))}
            onSaveLifts={(lifts, finish) =>
              saveLive((id, updatedAt) => liftsLog(lifts, nowMs(), { ...finish, id, updatedAt }))
            }
            onDecide={decideSuggestion}
          />
        </main>
      </RouterProvider>
    )
  }

  if (answered === false) {
    // First launch: the Starting point, once, before anything else.
    return (
      <main id="main">
        <StartingPoint onSave={saveStartingPoint} />
      </main>
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
        {/* Clear of the fixed dock (the tab bar, any ActionBar, the home-indicator inset), with room to spare. */}
        <DockContext value={dock}>
        <main id="main" className="min-w-0 pb-[calc(var(--dock-height,70px)+42px)] desktop:pb-12">
          {screen === 'today' && (
            <Today
              day={day}
              weekCount={program.weekCount}
              pending={pending}
              error={error ?? decisionError ?? answerError}
              onPick={(weekNumber, sessionId) => pick(weekNumber, sessionId, today)}
              onDecide={decideSuggestion}
              runContext={runContext}
              onEnvironment={setEnvironment}
              settings={settings}
              onSettings={change}
              startingPoint={{
                fields: startingFields(startingPoint, day.fiveKTest, day.workingWeights),
                onSave: saveStartingPoint,
              }}
              live={live}
              onStart={startLive}
              onSomethingHurts={(score, area) => report(painReport(score, area, null, null))}
              treadmill={treadmill}
              onAnswer={(activity, week, sessionId) => {
                const previous = activityAnswers.find((a) => a.activityId === activity.id)
                answer({ activityId: activity.id, week, sessionId, updatedAt: editedAt(previous?.updatedAt) })
              }}
            />
          )}
          {screen === 'log' && week && logged && (
            <LogAfter
              week={week}
              session={logged}
              lastDay={loggableUntil!}
              logs={logs}
              today={today}
              defaultEnvironment={(date) => environmentOn(date, settings)}
              onSave={save}
              onPain={(score, area) => report(painReport(score, area, week.number, logged.id))}
              activity={attachedTo(week.number, logged.id)}
              treadmill={treadmill}
              unit={settings.unit}
            />
          )}
          {screen === 'plan' && <Plan program={program} day={day} logs={logs} />}
          {screen === 'week' && week && (
            <WeekScreen
              program={program}
              week={week}
              day={day}
              runContext={runContext}
              logs={logs}
              live={live}
              onStart={startLive}
            />
          )}
          {screen === 'progress' && <Progress program={program} day={day} logs={logs} recoveryNights={recoveryNights} unit={settings.unit} />}
          {screen === 'shortcut' && <Shortcut nights={recoveryNights} />}
          {screen === 'workouts' && <Workouts activities={activities} />}
          {screen === 'not-found' && <NotFound />}
        </main>
        </DockContext>
        <Dock slotRef={setDock}>
          <TabBar screen={navScreen} />
        </Dock>
      </div>
    </RouterProvider>
  )
}

/**
 * New title on every screen; on a change of screen, back to the top with
 * focus on the heading. A screen that marks where the athlete will look
 * (Plan's current Week) opens there instead, a third of the way down.
 */
function useScreenChange(screen: Screen, title: string, route: Route) {
  const key = `${screen}/${route.week ?? ''}/${route.sessionId ?? ''}`
  const previous = useRef<string | null>(null)
  useEffect(() => {
    document.title = `${title} · Compromised`
    if (previous.current === key) return
    const first = previous.current === null
    previous.current = key
    const anchor = document.querySelector<HTMLElement>('main [data-scroll-anchor]')
    if (anchor) {
      const top = anchor.getBoundingClientRect().top + window.scrollY - window.innerHeight / 3
      window.scrollTo(0, Math.max(0, top))
    } else if (!first) {
      window.scrollTo(0, 0)
    }
    if (!first) document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true })
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

/**
 * Fixed to the bottom on the phone: a slot for the screen's ActionBar, then
 * the tab bar. Its height goes to --dock-height so the page always scrolls clear of it.
 */
function Dock({ slotRef, children }: { slotRef: (element: HTMLElement | null) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const root = document.documentElement
    const observer = new ResizeObserver(() => root.style.setProperty('--dock-height', `${element.offsetHeight}px`))
    observer.observe(element)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--dock-height')
    }
  }, [])
  return (
    <div ref={ref} className="fixed inset-x-0 bottom-0 z-20 desktop:hidden">
      <div ref={slotRef} />
      {children}
    </div>
  )
}

function TabBar({ screen }: { screen: Screen }) {
  return (
    <nav
      aria-label="Main"
      className="flex justify-around border-t-2 border-ink bg-paper pt-2 pb-[calc(8px+env(safe-area-inset-bottom))]"
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
