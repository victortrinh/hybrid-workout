/** Action styles shared by Today and the Week screen (DESIGN.md, buttons). */

export const lineAction =
  'inline-grid min-h-[54px] flex-1 cursor-pointer place-items-center rounded-sm px-5 text-center text-[17px] font-bold text-ink shadow-[inset_0_0_0_2px_var(--ink)] hover:bg-sunk data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link desktop:flex-none'

export const primaryAction =
  'inline-grid min-h-[54px] flex-1 cursor-pointer place-items-center rounded-sm bg-cobalt px-5 text-center text-[17px] font-bold text-on-cobalt hover:bg-cobalt-hover data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link desktop:flex-none'

export const buttonBase =
  'inline-flex min-h-11 cursor-pointer items-center text-[15px] font-bold data-focus-visible:outline-3 data-focus-visible:outline-offset-2 data-focus-visible:outline-link'
/** Quiet: Keep, Undo and Not now, in ink. */
export const quietButton = `${buttonBase} text-ink hover:underline hover:decoration-2 hover:underline-offset-4`
