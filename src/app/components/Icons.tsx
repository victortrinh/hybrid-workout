/** The three navigation icons from the prototype: 24px, 2px stroke, round joins. */
const ICON_PATHS = {
  today: <path d="M3 8h18M3 12h18M3 16h18" />,
  plan: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M4 10h16M10 4v16" />
    </>
  ),
  progress: <path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6" />,
}

export function Icon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-6 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
    >
      {ICON_PATHS[name]}
    </svg>
  )
}
