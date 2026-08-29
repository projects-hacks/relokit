/**
 * What sits here before anything has been asked.
 *
 * Not an illustration of the product but the reason for it: the requirements
 * that decide where someone lives are held by companies that have no interest
 * in talking to each other, and no single site can answer across them.
 */
const HOLDERS: [string, string][] = [
  ['Rent, bedrooms, in-unit laundry', 'Zillow'],
  ['How long the ride actually takes', 'Google Directions'],
  ['Whether the gym is open at six', 'Google Maps'],
  ['Whether the shop is open at ten', 'Google Maps'],
  ['What is happening on the street', 'Google News'],
  ['Where the food is', 'Yelp'],
]

export function Brief() {
  return (
    <div className="brief">
      <p className="eyebrow">Before anything is checked</p>
      <h2>The requirement you care about is almost never held by the site you are searching.</h2>
      <p className="note">
        A rental site knows the rent. It does not know how long the ride to work takes, or whether
        the gym opens before you do. Relokit asks each source the part it actually holds, then keeps
        what it could not establish apart from what it checked and rejected.
      </p>
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
