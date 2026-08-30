/**
 * What sits here before anything has been asked.
 *
 * Not an illustration of the product but the reason for it, and a way in: the
 * examples are the fastest explanation of what can be asked, so they are the
 * thing you can press.
 */
const EXAMPLES: { query: string; label: string }[] = [
  {
    label: 'A place to live, with a commute that works',
    query:
      '2 bed apartment in San Jose under $3,500, 25 min bike to 1 Infinite Loop, gym open past 9pm',
  },
  {
    label: 'Somewhere to eat, still open when you finish',
    query: 'somewhere to eat within 1 mile of Santana Row in San Jose that is open past 10pm',
  },
  { label: 'A gym that opens before you do', query: 'gyms in downtown Austin open before 6am' },
  {
    label: 'Near two places at once',
    query: '1 bed within 3 km of Diridon Station and 3 km of Santana Row, in San Jose',
  },
]

const ANSWERS: [string, string][] = [
  ['Verified', 'Every requirement checked and met.'],
  ['Couldn’t verify', 'Something could not be established either way.'],
  ['Ruled out', 'Checked, and it does not hold. The reason is on the card.'],
]

export function Brief({ onAsk }: { onAsk: (query: string) => void }) {
  return (
    <div className="brief">
      <div className="brief-intro">
        <div className="intro-icon" aria-hidden="true">⌁</div>
        <p className="eyebrow">Search with confidence</p>
        <h2>One search. Every factor that makes a place work.</h2>
        <p className="note">
          Rent is only the beginning. Relokit brings together the commute, nearby essentials, and
          details that shape your daily life—then keeps the evidence for each answer close at hand.
        </p>
      </div>
      <div className="brief-benefits" aria-label="How Relokit works">
        <span><b>01</b> Your priorities</span>
        <span><b>02</b> Trusted sources</span>
        <span><b>03</b> Clear decisions</span>
      </div>

      <p className="eyebrow">Try one</p>
      <div className="examples">
        {EXAMPLES.map((example) => (
          <button className="example" key={example.query} onClick={() => onAsk(example.query)}>
            <b>{example.label}</b>
            <span>{example.query}</span>
          </button>
        ))}
      </div>

      <p className="eyebrow sources-label">What comes back</p>
      <div className="holders">
        {ANSWERS.map(([name, meaning]) => (
          <div className="holder" key={name}>
            <span>{name}</span>
            <span>{meaning}</span>
          </div>
        ))}
      </div>

      <p className="note">
        Nothing is ever ruled out because a check failed. Not knowing and not qualifying are
        different answers, and they are kept apart.
      </p>
    </div>
  )
}
