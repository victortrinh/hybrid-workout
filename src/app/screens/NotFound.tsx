import { Link } from 'react-aria-components'

export function NotFound() {
  return (
    <div className="px-pad pt-6 desktop:px-gutter desktop:pt-9">
      <h1 tabIndex={-1} className="text-headline-page">
        Nothing here.
      </h1>
      <p className="mt-3">
        <Link
          href="/"
          className="py-2 text-[15px] font-bold text-link underline decoration-2 underline-offset-4 hover:decoration-[3px]"
        >
          Back to Today
        </Link>
      </p>
    </div>
  )
}
