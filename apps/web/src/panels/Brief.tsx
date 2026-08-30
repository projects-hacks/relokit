/**
 * What sits here before anything has been asked.
 *
 * Not an illustration of the product but the reason for it: the requirements
 * that decide where someone lives are held by companies that have no interest
 * in talking to each other, and no single site can answer across them.
 */
const HOLDERS: [string, string][] = [
  ['Rent, bedrooms, in-unit laundry', 'Listing details'],
  ['How long the ride actually takes', 'Route estimates'],
  ['Whether the gym is open at six', 'Local place details'],
  ['Whether the shop is open at ten', 'Local place details'],
  ['What is happening on the street', 'Local context'],
  ['Where the food is', 'Nearby places'],
]

export function Brief() {
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
      <p className="eyebrow sources-label">What we can check</p>
      <div className="holders">
        {HOLDERS.map(([requirement, holder]) => (
          <div className="holder" key={requirement}>
            <span>{requirement}</span>
            <span>{holder}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
