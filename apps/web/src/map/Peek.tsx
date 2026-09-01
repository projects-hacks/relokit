import type { Place } from '@relokit/schema'
import { money } from '../lib/format.ts'
import { described } from '../lib/attributes.ts'

/**
 * Which place the map is showing.
 *
 * On a wide screen the card is beside the map and the lit pin is enough. On a
 * phone the two take turns, so opening the map after choosing something left a
 * dot on a street with nothing to say what it was, and tapping a pin moved the
 * map without naming anything either. This is the label that was missing, and
 * the way from the map back to the whole answer.
 */
export function Peek({
  place,
  onOpen,
  onDismiss,
}: {
  place: Place
  onOpen: () => void
  onDismiss: () => void
}) {
  const price = money(place.price_cents)
  const traits = described(place).slice(0, 3).join(' · ')

  return (
    <div className="peek">
      <button className="peek-body" onClick={onOpen}>
        {place.photo_url && (
          <img
            src={place.photo_url}
            alt=""
            width={64}
            height={64}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.remove()
            }}
          />
        )}
        <span className="peek-copy">
          <b>{place.title}</b>
          {(price || traits) && (
            <span className="peek-traits">{[price, traits].filter(Boolean).join(' · ')}</span>
          )}
          <span className="peek-more">Everything checked ↗</span>
        </span>
      </button>
      <button className="peek-close" onClick={onDismiss} aria-label="Stop showing this one">
        ✕
      </button>
    </div>
  )
}
