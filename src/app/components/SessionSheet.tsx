import { useCallback, useEffect, useState } from 'react'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import type { RunContext } from '../../domain/paces'
import { describeSession, SESSION_TYPES } from '../../domain/program/describe'
import type { Session, Station, StationId } from '../../domain/program/types'
import type { WorkingWeights } from '../../domain/weights'
import { longDay, nb } from '../format'
import { primaryAction, quietButton } from './actions'
import { LaneChip } from './LaneChip'
import { Prescription } from './Prescription'

/** What the sheet offers under the Prescription. */
export type SheetAction =
  /** Up next itself: nothing to pick, Start stays on Today. */
  | { kind: 'none' }
  /** Another Session: make it today's. */
  | { kind: 'pick'; label: string; onPick: () => void }
  /** A Live session runs: it has to finish first. */
  | { kind: 'running'; heading: string }

/**
 * One Session's Prescription over Today: a sheet from the foot on the phone,
 * a dialog on desktop. Read it, then do it today or close it.
 */
export function SessionSheet({
  session,
  line,
  stations,
  run,
  weights,
  action,
  onClose,
}: {
  session: Session
  /** Why it is in the Bucket, when the meta doesn’t say: a Key session carried over. */
  line?: string
  stations: Record<StationId, Station>
  run?: RunContext
  weights?: WorkingWeights
  action: SheetAction
  onClose: () => void
}) {
  const description = describeSession(session, run, weights)
  const meta = [description.meta, session.date && longDay(session.date), line].filter(Boolean).join(' · ')
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => !open && onClose()}
      className="sheet-overlay fixed inset-0 z-50 flex items-end justify-center bg-black/40 desktop:items-center desktop:p-gutter"
    >
      <Modal className="sheet-rise flex max-h-[92dvh] w-full flex-col bg-paper text-ink outline-none border-t-2 border-ink desktop:max-w-[560px] desktop:rounded-sm desktop:border-2 desktop:shadow-[0_10px_30px_rgba(0,0,0,.18)]">
        <Dialog className="flex min-h-0 flex-col outline-none">
          <div className="min-h-0 overflow-y-auto px-pad pt-4 pb-6">
            <div className="grid grid-cols-[36px_1fr_auto] items-center gap-3">
              <LaneChip lane={SESSION_TYPES[session.type].lane} />
              <Heading slot="title" className="text-title">
                {nb(description.heading)}
              </Heading>
              <Button onPress={onClose} className={`${quietButton} justify-end`}>
                Close
              </Button>
            </div>
            <p className="mt-2 text-prescription">{nb(description.target)}</p>
            {meta && <p className="mt-1 text-body-quiet text-muted">{nb(meta)}</p>}
            {session.note && <p className="mt-3 text-body">{session.note}</p>}
            <Prescription session={session} stations={stations} run={run} weights={weights} />
          </div>
          {action.kind === 'pick' && (
            <div className="border-t-2 border-ink px-pad pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] desktop:pb-3">
              <Button onPress={action.onPick} className={`${primaryAction} w-full`}>
                {action.label}
              </Button>
            </div>
          )}
          {action.kind === 'running' && (
            <p className="border-t-2 border-ink px-pad pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] text-body desktop:pb-3">
              {nb(`${action.heading} is running. Finish it first.`)}
            </p>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}

const SHEET_STATE = 'compromised:sheet'

/**
 * Which Session's sheet is open. Opening it adds a history entry with the URL
 * unchanged, so Back (or a back swipe) closes the sheet instead of leaving Today.
 */
export function useSheet<T>(): [T | null, (target: T) => void, () => void] {
  const [open, setOpen] = useState<T | null>(null)
  useEffect(() => {
    const onPop = () => {
      if (!history.state?.[SHEET_STATE]) setOpen(null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const show = useCallback((target: T) => {
    if (!history.state?.[SHEET_STATE]) history.pushState({ ...history.state, [SHEET_STATE]: true }, '')
    setOpen(target)
  }, [])
  const close = useCallback(() => {
    setOpen(null)
    if (history.state?.[SHEET_STATE]) history.back()
  }, [])
  return [open, show, close]
}
