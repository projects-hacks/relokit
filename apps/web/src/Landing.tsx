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

const RECEIPTS: [string, string, string][] = [
  ['$2,800 a month', 'the listing', '2d ago'],
  ['21 min by bike, door to door', 'route data', '2d ago'],
  ['gym open past 9pm', 'map data', '2d ago'],
]

const STEPS: [string, string][] = [
  [
    'Say it in a sentence',
    'The rent, the ride to work, what has to be nearby and when it has to be open. No filters to learn, no fields to fill.',
  ],
  [
    'Each part is checked where the answer lives',
    'The rent from the listing, the journey from the road itself, the opening hours from the place. Crossed in one pass rather than one result at a time.',
  ],
  [
    'Three answers, including the honest one',
    'What holds up. What was ruled out, and why. And what could not be confirmed, said plainly instead of guessed.',
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
          Stop checking every
          <br />
          result by hand.
        </h1>
        <p className="hero-sub">
          A listing tells you what a place is. It never tells you whether it works for you. Ask
          once, in your own words, and every requirement is checked against whatever actually holds
          the answer.
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
        <p className="eyebrow">Why three answers and not a ranked list</p>
        <div className="honesty-row">
          <div>
            <b>It holds</b>
            <p>
              Every requirement checked, each fact showing where it came from and how old it is.
            </p>
          </div>
          <div>
            <b>It does not</b>
            <p>Ruled out, with the one thing that failed named rather than buried.</p>
          </div>
          <div>
            <b>Nobody could say</b>
            <p>
              A rent quoted as a range settles nothing against a limit. Said plainly, instead of
              counted as a pass.
            </p>
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
