/**
 * The Coach's words for a Suggestion, from its facts. Blunt, a little funny,
 * and always with the number and the reason (PRODUCT.md, Coach voice).
 */
import type { LocalDate } from '../domain/calendar'
import { PAIN_AREA_LABEL, PAIN_REPS_PERCENT, type PainLevel } from '../domain/pain'
import { LIFT_NAME, SESSION_TYPES } from '../domain/program/describe'
import { EASY_DAY_MINUTES, SLEEP_RPE_CAP, sleepText } from '../domain/recovery'
import type { Suggestion } from '../domain/suggestion'
import { plural, shortDay } from './format'

export interface SuggestionCopy {
  /** The change and the reason, while it is Open. */
  line: string
  /** The facts behind it, in a quieter line. */
  why: string
  /** The Keep button: what stays if the athlete says no. */
  keep: string
  /** After Accept. */
  accepted: string
  /** After Keep. */
  kept: string
}

export function suggestionCopy(s: Suggestion): SuggestionCopy {
  switch (s.kind) {
    case 're-entry': {
      const cut = s.from.volumePercent - s.to.volumePercent
      const skipped = s.trigger.skipped.map((x) => SESSION_TYPES[x.type].name)
      return {
        line: `${plural(skipped.length, 'Session')} skipped last Week. Full volume now is how calves file complaints. Week ${s.week} goes ${cut}% lighter.`,
        why: `Week ${s.trigger.week}: ${list(skipped)} skipped · every Prescription this Week at ${s.to.volumePercent}%`,
        keep: 'Keep full volume',
        accepted: `Done. Week ${s.week} is ${cut}% lighter. Ease in, then get greedy again.`,
        kept: 'Keeping full volume. Your call. Your calves.',
      }
    }
    case 'pain': {
      const { score, area, risingFrom } = s.trigger
      const where = area ? ` · ${PAIN_AREA_LABEL[area]}` : ''
      const rising = risingFrom === null ? '' : `, up from ${risingFrom}`
      return {
        line: painLine(score, s.level, risingFrom !== null),
        why: `Pain ${score}${rising}${where} · ${painChange(s.level)}`,
        keep: 'Keep as written',
        accepted:
          s.level === 'low-impact'
            ? 'Done. Easy bike or rest until it settles. Tell me when it does.'
            : 'Done. Bike for the jumps, fewer reps. Tell me when it settles.',
        kept: 'Keeping it as written. Your call. Stop if it gets worse.',
      }
    }
    case 'recovery': {
      const { sleepMinutes, hrvMs, hrvMean } = s.trigger
      const down = Math.round(((hrvMean - hrvMs) / hrvMean) * 100)
      return {
        line: `Slept ${sleepText(sleepMinutes)} and HRV is down ${down}%. Your nervous system called in sick. Easy ${EASY_DAY_MINUTES}′ or rest today.`,
        why: recoveryWhy(sleepMinutes, hrvMs, hrvMean),
        keep: 'Keep it, one rep fewer',
        accepted: `Done. Easy ${EASY_DAY_MINUTES}′ or nothing. The hard one waits for a better night.`,
        kept: `Keeping it. One rep fewer, nothing past RPE ${SLEEP_RPE_CAP}. Your call.`,
      }
    }
    case 'working-weight': {
      const lift = LIFT_NAME[s.lift]
      const from = `${s.from.pounds} lb`
      const to = `${s.to.pounds} lb`
      const step = `${s.to.pounds > s.from.pounds ? '+' : '−'}${Math.abs(s.to.pounds - s.from.pounds)} lb`
      const { trigger } = s
      if (trigger.reason === 'all-reps-easy') {
        return {
          line: `${lift}: every rep, nothing harder than RPE ${trigger.topRpe}. ${from} was a warm-up. ${to} next time.`,
          why: `Week ${s.week}: ${trigger.sets} × ${trigger.reps} at ${from}, top RPE ${trigger.topRpe} · ${step}`,
          keep: `Keep ${from}`,
          accepted: `${lift} is ${to} now. Same face, more plates.`,
          kept: `${lift} stays ${from}. Your call. It’ll still be light.`,
        }
      }
      return {
        line: `${lift} held twice in a row. Grinding isn’t progress. Back to ${to}, then build again.`,
        why: `Weeks ${list(trigger.weeks.map(String))}: RPE 9 or more, or reps missed · −5%, ${step}`,
        keep: `Keep ${from}`,
        accepted: `${lift} is ${to} now. Clean reps first.`,
        kept: `${lift} stays ${from}. Make the reps count.`,
      }
    }
  }
}

/** The numbers behind a recovery change: "Sleep 5 h 41 · HRV 38 ms against a 52 ms average". */
export function recoveryWhy(sleepMinutes: number, hrvMs: number | null, hrvMean: number | null): string {
  const hrv = hrvMs === null ? '' : ` · HRV ${hrvMs} ms${hrvMean === null ? '' : ` against a ${hrvMean} ms average`}`
  return `Sleep ${sleepText(sleepMinutes)}${hrv}`
}

/** Today's line when short sleep alone changed Up next. */
export function shortSleepLine(sleepMinutes: number): string {
  return `Slept ${sleepText(sleepMinutes)}. Bold of you. One fewer rep, nothing past RPE ${SLEEP_RPE_CAP}.`
}

/** The pain step's line and a pain Suggestion's: what the score does to training. */
export function painLine(score: number, level: PainLevel | null, rising: boolean): string {
  if (level === 'low-impact') return `Pain ${score}. Today becomes easy bike or rest. Not negotiable.`
  if (level === 'ease' && rising) return `Pain ${score} and rising. No jumps, fewer reps, before it gets a vote.`
  if (level === 'ease') return `Pain ${score}. No jumps, fewer reps. Your tendons will thank you.`
  return score === 0 ? 'Nothing hurts. Carry on.' : 'Noted. Carry on, carefully.'
}

/** What the pain rules change, in a few words. */
function painChange(level: PainLevel): string {
  return level === 'low-impact'
    ? 'every Session easy and low-impact'
    : `bike for jumps and accelerations, ${100 - PAIN_REPS_PERCENT}% fewer interval reps`
}

/** "Speed", "Speed and HYROX", "Speed, Strength and HYROX" */
function list(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/** A Session done outside its Week, on the Week screen and in Log after: which Week it still counts for. */
export function outsideWeekLine(when: 'early' | 'late', week: number, startDate: LocalDate, sunday: LocalDate): string {
  return when === 'early'
    ? `Early. Week ${week} starts ${shortDay(startDate)}. Anything done today counts for Week ${week}.`
    : `Late. Week ${week} closed ${shortDay(sunday)}. Better late than Skipped: anything done today counts for Week ${week}.`
}
