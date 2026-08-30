import { useEffect, useState } from 'react'

const EXAMPLE =
  'Under $2,800, one bedroom, no more than 25 minutes by bike to 2788 San Tomas Expressway, gym within half a mile open before 6am, in-unit laundry, grocery open past 10pm.'

export function Ask({
  onAsk,
  onStop,
  busy,
  asking,
}: {
  onAsk: (query: string) => void
  onStop: () => void
  busy: boolean
  /** The question currently running, wherever it was typed. */
  asking: string | null
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
        placeholder="Say what you need. Rent, bedrooms, how far you’ll travel and by what, what has to be nearby and when it has to be open."
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
        <button type="button" className="example" onClick={() => setQuery(EXAMPLE)}>
          Try an example
        </button>
      )}
    </form>
  )
}
