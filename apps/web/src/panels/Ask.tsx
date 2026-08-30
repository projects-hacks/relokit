import { useState } from 'react'
const EXAMPLE =
  'Under $2,800, one bedroom, no more than 25 minutes by bike to 2788 San Tomas Expressway, gym within half a mile open before 6am, in-unit laundry, grocery open past 10pm.'

export function Ask({
  onAsk,
  busy,
  configured,
}: {
  onAsk: (query: string) => void
  busy: boolean
  configured: boolean
}) {
  const [query, setQuery] = useState('')

  return (
    <form
      className="ask"
      onSubmit={(event) => {
        event.preventDefault()
        if (query.trim()) onAsk(query.trim())
      }}
    >
      <div className="ask-heading">
        <p className="eyebrow">Find your next place</p>
        <h2>Tell us what matters.</h2>
        <p>Use natural language. We’ll check each requirement against the source that knows it.</p>
      </div>
      <textarea
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Say what you need. Rent, bedrooms, how far you’ll travel and by what, what has to be nearby and when it has to be open."
        aria-label="Your requirements"
      />
      {/* Asking with no backend fails as a network error the page already knows
          it will get. Say so before, rather than after. */}
      <div className="ask-actions">
        <button type="submit" disabled={busy || query.trim() === '' || !configured}>
          {busy ? 'Checking your matches…' : 'Find matches'}
          {!busy && <span aria-hidden="true">→</span>}
        </button>
        <button type="button" className="example" onClick={() => setQuery(EXAMPLE)}>
          Try an example
        </button>
      </div>
      <p className="ask-footnote"><span aria-hidden="true">✦</span> Clear results, source by source.</p>
    </form>
  )
}
