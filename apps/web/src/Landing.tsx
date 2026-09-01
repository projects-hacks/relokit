import { useState } from 'react'

const EXAMPLES: { label: string; query: string }[] = [
  {
    label: 'A 2 bed I can cycle to work from',
    query:
      '2 bed apartment in San Jose under $3,500, 25 min bike to 1 Infinite Loop, gym open past 9pm',
  },
  {
    label: 'Dinner near Santana Row, still open late',
    query: 'somewhere to eat within 1 mile of Santana Row in San Jose that is open past 10pm',
  },
  { label: 'Mexican near me, open past 10', query: 'mexican restaurants near me open past 10pm' },
  {
    label: 'Near the station and the shops',
    query: '1 bed within 3 km of Diridon Station and 3 km of Santana Row, in San Jose',
  },
]

/**
 * Three facts about three different kinds of place, so the strip proves the
 * breadth while it demonstrates the receipt.
 */
const RECEIPTS: [string, string, string][] = [
  ['$2,800 a month', 'the listing', '2d ago'],
  ['21 min by bike, door to door', 'route data', '2d ago'],
  ['open until 11pm on Fridays', 'map data', '2d ago'],
]

const STEPS: [string, string][] = [
  [
    'Say it in a sentence',
    'The price, how far you will travel and by what, what has to be nearby and when it has to be open. No filters to learn, no fields to fill.',
  ],
  [
    'Each part is answered where it lives',
    'The price from the listing, the journey from the road itself, the opening hours from the place. Crossed in a single pass.',
  ],
  [
    'Everything comes back with its source',
    'Every fact carries where it came from and how old it is, so you can follow any of them back and see for yourself.',
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
        {/* No forced break: the line that suits 1500px is the wrong one at 390,
            and the browser balances it better than a guess can. */}
        <h1>Find places that fit, in a city you don&rsquo;t know yet.</h1>
        <p className="hero-sub">
          An apartment near the new job. Dinner that is still open. A gym before six. Say what you
          need in one sentence, and each part is checked against the source that holds it.
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
        <p className="eyebrow">Every fact shows its working</p>
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

      <section className="honesty">
        <p className="eyebrow">You always know where you stand</p>
        <div className="honesty-row">
          <div>
            <b>Verified</b>
            <p>Every requirement met, each fact showing its source and its date.</p>
          </div>
          <div>
            <b>Unconfirmed</b>
            <p>
              Where a place keeps something to itself, you get told which fact and why, and it is
              kept apart from the rest.
            </p>
          </div>
          <div>
            <b>Ruled out</b>
            <p>The one thing that decided it, named on the card.</p>
          </div>
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
