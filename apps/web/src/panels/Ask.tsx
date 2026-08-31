import { useEffect, useState } from 'react'
import type { Subject } from '@relokit/schema'

/**
 * A worked example follows whatever was last asked for, because an example is
 * only useful if it resembles the question in the reader's head. Somebody who
 * came here for a restaurant should not be handed a paragraph about bedrooms.
 */
const EXAMPLES: Partial<Record<Subject, string>> & { default: string } = {
  default:
    'Under $2,800, one bedroom, no more than 25 minutes by bike to 2788 San Tomas Expressway, gym within half a mile open before 6am, in-unit laundry, grocery open past 10pm.',
  restaurant:
    'Cheap, well reviewed mexican restaurants within 1 mile of Santana Row in San Jose, open past 10pm, not a chain.',
  cafe: 'Cafes with outdoor seating within walking distance of Diridon Station, open before 8am.',
  bar: 'Well reviewed bars within 1 mile of Santana Row that are open past midnight.',
  gym: 'Gyms in downtown Austin open before 6am, rated 4 or better.',
  hotel: 'Hotels within 2 miles of San Jose State University, rated 4.5 or better.',
  home_for_sale: 'Houses for sale in Santa Clara under $1,400,000, 3 beds, 20 min drive to work.',
}

export function Ask({
  onAsk,
  onStop,
  busy,
  asking,
  subject,
}: {
  onAsk: (query: string) => void
  onStop: () => void
  busy: boolean
  /** The question currently running, wherever it was typed. */
  asking: string | null
  /** What was last asked for, so the example resembles it. */
  subject: Subject | null
}) {
  const [query, setQuery] = useState('')

  // A search started from the landing page still belongs in this box: the
  // reader should always see what is being checked, and be able to stop it.
  useEffect(() => {
    if (busy && asking) setQuery(asking)
  }, [busy, asking])

  return (
    <form
      className="ask"
      onSubmit={(event) => {
        event.preventDefault()
        if (query.trim()) onAsk(query.trim())
      }}
    >
      <p className="eyebrow">What matters to you</p>
      <textarea
        value={query}
        readOnly={busy}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Say what matters. The price, how far you’ll travel and by what, what has to be nearby, and when it has to be open."
        aria-label="Your requirements"
      />
      {busy ? (
        <button type="button" className="stop" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button type="submit" disabled={query.trim() === ''}>
          Search
        </button>
      )}
      {!busy && (
        <button
          type="button"
          className="example"
          onClick={() => setQuery((subject && EXAMPLES[subject]) ?? EXAMPLES.default)}
        >
          Try an example
        </button>
      )}
    </form>
  )
}
