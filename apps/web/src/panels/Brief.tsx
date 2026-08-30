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
      <p className="eyebrow">Before anything is checked</p>
      <h2>The thing you care about is almost never held by the site you are searching.</h2>
      <p className="note">
        A rental site knows the rent. It does not know how long the ride to work takes, or whether
        the gym opens before you do. Ask in your own words and each requirement is checked against
        whatever actually holds the answer, with the source and the date on every fact.
      </p>

      <p className="eyebrow">Try one</p>
      <div className="examples">
        {EXAMPLES.map((example) => (
          <button className="example" key={example.query} onClick={() => onAsk(example.query)}>
            <b>{example.label}</b>
            <span>{example.query}</span>
          </button>
        ))}
      </div>

      <p className="eyebrow">What comes back</p>
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
