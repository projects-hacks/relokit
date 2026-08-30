import { createPortal } from 'react-dom'
import type { SavedHome } from '../lib/saved.ts'
import { ago, money } from '../lib/format.ts'
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
  homes: SavedHome[]
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
                <p>Saved {ago(home.saved_at)}</p>
                <div className="saved-property-actions">
                  {home.url && (
                    <a href={home.url} target="_blank" rel="noreferrer">
                      View listing ↗
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
