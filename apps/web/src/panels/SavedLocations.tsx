import { createPortal } from 'react-dom'
import type { SavedHome } from '../lib/saved.ts'
import { ago, money } from '../lib/format.ts'
import { useDialog } from '../lib/dialog.ts'

/** A local, account-free shortlist of properties saved from search results. */
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
        aria-label="Saved locations"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="saved-locations-panel-head">
          <div>
            <p className="eyebrow">Kept locally</p>
            <h2>Saved locations</h2>
            <p className="note">Properties you starred from a search stay on this device.</p>
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close saved locations">
            ✕
          </button>
        </header>

        <div className="saved-properties">
          {homes.map((home) => (
            <article className="saved-property" key={home.entity_id}>
              {home.photo_url && (
                <img src={home.photo_url} alt="" width={168} height={112} loading="lazy" />
              )}
              <div className="saved-property-copy">
                <p className="saved-property-price">{money(home.price_cents) ?? 'Price unavailable'}</p>
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

        <button className="as-link clear-saved" onClick={onClear}>
          Clear all saved locations
        </button>
      </aside>
    </div>,
    document.body,
  )
}
