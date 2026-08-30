import { useState } from 'react'

const EXAMPLES: { label: string; query: string }[] = [
  {
    label: 'A 2 bed with a bikeable commute',
    query:
      '2 bed apartment in San Jose under $3,500, 25 min bike to 1 Infinite Loop, gym open past 9pm',
  },
  {
    label: 'Dinner near Santana Row, open late',
    query: 'somewhere to eat within 1 mile of Santana Row in San Jose that is open past 10pm',
  },
  { label: 'Dinner near me, open late', query: 'mexican restaurants near me open past 10pm' },
  {
    label: 'Near the station and the shops',
    query: '1 bed within 3 km of Diridon Station and 3 km of Santana Row, in San Jose',
  },
]

const RECEIPTS: [string, string, string][] = [
  ['$2,800 a month', 'the listing', '2d ago'],
  ['21 min by bike, door to door', 'route data', '2d ago'],
  ['gym open past 9pm', 'map data', '2d ago'],
]

const STEPS: [string, string][] = [
  ['Say it in a sentence', 'Rent, commute, hours, places to be near. No filters to learn.'],
  [
    'Each requirement is checked at its source',
    'The rent from the listing, the ride from the road, the hours from the place itself.',
  ],
  [
    'Three honest answers',
    'Verified, couldn’t verify, and ruled out with the reason. Never a guess dressed as a result.',
  ],
]

const SUBJECTS = [
  'apartments',
  'homes for sale',
  'restaurants',
  'cafes',
  'bars',
  'gyms',
  'grocery stores',
  'schools',
  'universities',
  'parks',
  'pharmacies',
  'hotels',
]

export function Landing({ onSearch }: { onSearch: (query?: string) => void }) {
  const [query, setQuery] = useState('')

  return (
    <div className="landing">
      <section className="hero">
        <h1>
          Ask for a place like
          <br />
          you&rsquo;d ask a person.
        </h1>
        <p className="hero-sub">
          One question across rent, commute, and opening hours. Every answer checked at its source,
          with the receipt to prove it.
        </p>

        <form
          className="hero-search"
          onSubmit={(event) => {
            event.preventDefault()
            onSearch(query.trim() || undefined)
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={'Try “2 bed in San Jose under $3,500, 20 min bike to work”'}
            aria-label="What are you looking for"
          />
          <button type="submit">Search</button>
        </form>

        <div className="hero-examples">
          {EXAMPLES.map((example) => (
            <button key={example.query} onClick={() => onSearch(example.query)}>
              {example.label}
            </button>
          ))}
        </div>
      </section>

      <section className="receipts" aria-label="What an answer looks like">
        <p className="eyebrow">Every fact carries its receipt</p>
        <div className="receipt-strip">
          {RECEIPTS.map(([fact, source, age]) => (
            <div className="receipt" key={fact}>
              <span className="receipt-mark">✓</span>
              <span className="receipt-fact">{fact}</span>
              <span className="receipt-src">
                {source}
                <br />
                {age}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="steps" id="how">
        <p className="eyebrow">How it works</p>
        <div className="step-row">
          {STEPS.map(([title, detail], index) => (
            <div className="step" key={title}>
              <span className="step-n">{index + 1}</span>
              <h3>{title}</h3>
              <p>{detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="subjects">
        <p className="eyebrow">Works for</p>
        <div className="subject-chips">
          {SUBJECTS.map((subject) => (
            <span key={subject}>{subject}</span>
          ))}
        </div>
      </section>

      <footer className="landing-foot">
        <span>
          Live data through <b>SerpApi</b> · Ledger, budget and nightly watch on <b>Xano</b>
        </span>
        <span>Nothing scraped, nothing mirrored. Facts expire and say so.</span>
      </footer>
    </div>
  )
}
