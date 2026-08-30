import { useState } from 'react'

const EXAMPLE =
  'Under $2,800, one bedroom, no more than 25 minutes by bike to 2788 San Tomas Expressway, gym within half a mile open before 6am, in-unit laundry, grocery open past 10pm.'

export function Ask({ onAsk, busy }: { onAsk: (query: string) => void; busy: boolean }) {
  const [query, setQuery] = useState('')

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
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Say what you need. Rent, bedrooms, how far you’ll travel and by what, what has to be nearby and when it has to be open."
        aria-label="Your requirements"
      />
      <button type="submit" disabled={busy || query.trim() === ''}>
        {busy ? 'Checking…' : 'Search'}
      </button>
      <button type="button" className="example" onClick={() => setQuery(EXAMPLE)}>
        Try an example
      </button>
    </form>
  )
}
