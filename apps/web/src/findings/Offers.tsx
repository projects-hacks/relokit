import type { AskResult } from '@relokit/client'

/**
 * What one change would buy.
 *
 * Every fact behind this was already paid for, so asking whether a minute more
 * on the bike would help costs nothing. Only homes held up by a single thing
 * appear: relaxing one of two blockers reaches nobody, and offering it would be
 * a promise the evidence cannot keep.
 */
export function Offers({
  result,
  onRelax,
}: {
  result: AskResult
  onRelax: (constraintId: string, to: number) => void
}) {
  if (result.relaxations.length === 0) return null

  return (
    <section>
      <p className="eyebrow">What one change would buy</p>
      {result.relaxations.map((offer) => (
        <div className="offer" key={offer.constraint_id}>
          <h3>{offer.source_text}</h3>
          <p className="note" style={{ marginBottom: 8 }}>
            The only thing standing in front of {offer.sole_blocker_count}{' '}
            {offer.sole_blocker_count === 1 ? 'home' : 'homes'}. These are the ones a small change
            reaches.
          </p>
          {offer.steps.map((step) => (
            <button
              className="offer-step"
              key={step.to}
              onClick={() => onRelax(offer.constraint_id, step.to)}
              disabled={offer.kind !== 'raise_bound'}
              title={
                offer.kind === 'raise_bound'
                  ? `Ask again with ${step.display_to} instead`
                  : 'Removing a requirement has to be done in the question itself'
              }
            >
              <span>
                {offer.kind === 'raise_bound' ? (
                  <>
                    <b>{offer.display_from}</b> → <b>{step.display_to}</b>
                  </>
                ) : (
                  <b>{step.display_to}</b>
                )}
              </span>
              <span>
                adds <b>{step.unlocks}</b>
              </span>
            </button>
          ))}
        </div>
      ))}
    </section>
  )
}
