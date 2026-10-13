import { useEffect, useMemo, useRef } from 'react'
import { Link, RouterProvider } from 'react-aria-components'
import { coach, type CoachDay } from '../domain/coach'
import { program } from '../domain/program/program'
import { Icon } from './components/Icons'
import { StripedNumeral } from './components/StripedNumeral'
import { longDay } from './format'
import { navigate, SCREEN_PATH, useScreen, type Screen } from './router'
import { NotFound } from './screens/NotFound'
import { Plan } from './screens/Plan'
import { Progress } from './screens/Progress'
import { Today } from './screens/Today'
import { useToday } from './useToday'

const NAV = [
  { screen: 'today', label: 'Today' },
  { screen: 'plan', label: 'Plan' },
  { screen: 'progress', label: 'Progress' },
] as const

const TITLES: Record<Screen, string> = {
  today: 'Today',
  plan: 'Plan',
  progress: 'Progress',
  'not-found': 'Not found',
}

/**
 * The shell: a cobalt side rail from 960px, a bottom tab bar below it. The
 * Coach runs here, on the device, against today's date in Toronto.
 */
export function App() {
  const today = useToday()
  const day = useMemo(() => coach({ program, today }), [today])
  const screen = useScreen()
  useScreenChange(screen)

  return (
    <RouterProvider navigate={navigate}>
      <a
        href="#main"
        className="sr-only z-50 bg-paper px-4 py-3 font-bold text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <div className="grid min-h-dvh desktop:grid-cols-[240px_1fr]">
        <SideRail screen={screen} day={day} />
        <main id="main" className="min-w-0 pb-24 desktop:pb-12">
          {screen === 'today' && <Today day={day} weekCount={program.weekCount} />}
          {screen === 'plan' && <Plan program={program} />}
          {screen === 'progress' && <Progress program={program} />}
          {screen === 'not-found' && <NotFound />}
        </main>
        <TabBar screen={screen} />
      </div>
    </RouterProvider>
  )
}

/** New title on every screen; on a change of screen, back to the top with focus on the heading. */
function useScreenChange(screen: Screen) {
  const previous = useRef(screen)
  useEffect(() => {
    document.title = `${TITLES[screen]} · Compromised`
    if (previous.current === screen) return
    previous.current = screen
    window.scrollTo(0, 0)
    document.querySelector<HTMLElement>('main h1')?.focus()
  }, [screen])
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
