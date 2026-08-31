import { createPortal } from 'react-dom'
import type { SavedPlace } from '../lib/saved.ts'
import { ago, money } from '../lib/format.ts'
import { described } from '../lib/attributes.ts'
import { appleMapsUrl, googleMapsUrl } from '../lib/links.ts'
import { MapMark } from '../lib/MapMark.tsx'
import { useDialog } from '../lib/dialog.ts'

/**
 * The shortlist, in full.
 *
 * Kept on the device rather than behind an account, and not only homes: whatever
 * a search returned can be starred, so a saved place only shows a price when it
 * has one.
 */
export function SavedLocations({
  homes,
  onClose,
  onRemove,
  onClear,
}: {
  homes: SavedPlace[]
  onClose: () => void
  onRemove: (entityId: string) => void
  onClear: () => void
}) {
  const dialog = useDialog<HTMLElement>(onClose)

  return createPortal(
    <div className="saved-locations-scrim" onClick={onClose}>
      <aside
        className="saved-locations-panel"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Saved places"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="saved-locations-panel-head">
          <div>
            <p className="eyebrow">Kept on this device</p>
            <h2>Saved places</h2>
            <p className="note">Whatever you star in a search stays here, no account needed.</p>
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="saved-properties">
          {homes.length === 0 && <p className="note">Nothing saved yet.</p>}
          {homes.map((home) => (
            <article className="saved-property" key={home.entity_id}>
              {home.photo_url && (
                <img src={home.photo_url} alt="" width={168} height={112} loading="lazy" />
              )}
              <div className="saved-property-copy">
                {money(home.price_cents) && (
                  <p className="saved-property-price">{money(home.price_cents)}</p>
                )}
                <h3>{home.title}</h3>
                {/* The same facts the card showed when it was starred. A place
                    with no rent still has a rating, a price bracket and what it
                    is, and a bare title is not enough to choose from later. */}
                {described(home).length > 0 && (
                  <p className="saved-property-traits">{described(home).join(' · ')}</p>
                )}
                <p className="saved-property-from">Saved {ago(home.saved_at)}</p>
                {/* Written out rather than hidden behind a mark. This panel
                    scrolls, and anything absolutely positioned inside something
                    that scrolls is cut off at its edge, so the tooltip that was
                    here could not be read. Two lines, and the whole question on
                    hover, which nothing can clip. */}
                {home.query && (
                  <p className="saved-property-question" title={home.query}>
                    from “{home.query}”
                  </p>
                )}
                <div className="saved-property-actions">
                  {home.url && (
                    <a href={home.url} target="_blank" rel="noreferrer">
                      Open ↗
                    </a>
                  )}
                  {googleMapsUrl(home) && (
                    <a href={googleMapsUrl(home)!} target="_blank" rel="noreferrer">
                      <MapMark of="google" />
                      Google Maps
                    </a>
                  )}
                  {appleMapsUrl(home) && (
                    <a href={appleMapsUrl(home)!} target="_blank" rel="noreferrer">
                      <MapMark of="apple" />
                      Apple Maps
                    </a>
                  )}
                  <button onClick={() => onRemove(home.entity_id)}>Remove</button>
                </div>
              </div>
            </article>
          ))}
        </div>

        {homes.length > 0 && (
          <button className="as-link clear-saved" onClick={onClear}>
            Clear the list
          </button>
        )}
      </aside>
    </div>,
    document.body,
  )
}
